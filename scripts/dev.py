#!/usr/bin/env python3
"""TdxQuant 跨平台运维脚本 (统一入口).

替代 18 个 .sh/.ps1 双版本脚本, 一个 Python 走天下.
跨平台 (Linux / macOS / Windows), 仅依赖 Python 3.10+ 标准库 + (可选) PyYAML.

R18-B: 启动时强制 UTF-8 (PYTHONUTF8=1 / PYTHONIOENCODING=utf-8 / set_utf8_stdio),
       解决 Windows 默认 GBK 导致的中文乱码 / UnicodeEncodeError.

子命令
------
    python scripts/dev.py start [--no-fastapi|--no-next]   # 启动双服务 + 健康检查
    python scripts/dev.py stop                              # 停止所有服务
    python scripts/dev.py setup                             # venv + 装依赖 + 初始化 QuestDB
    python scripts/dev.py reload                            # 热加载配置 (调 reload_config.py)
    python scripts/dev.py test [--smoke|--lint|--all]       # 冒烟测试 / lint / 全部
    python scripts/dev.py paths --env <linux|windows> [--dry-run]  # 路径占位符替换
    python scripts/dev.py daemon                             # 守护进程模式 (5s 轮询)

兼容性: Linux / macOS / Windows (PowerShell 或 cmd).
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

# ─── 项目根目录 ────────────────────────────────────────────────
PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent
os.chdir(PROJECT_ROOT)  # 所有 subprocess 的 cwd 都从项目根开始

IS_WINDOWS: bool = platform.system() == "Windows"
IS_LINUX_LIKE: bool = platform.system() in ("Linux", "Darwin")

# ─── UTF-8 强制（R18-B：Windows 默认 GBK 会中文乱码/UnicodeEncodeError） ───
# 1) 设置环境变量：影响后续派生的 uvicorn / bun 子进程
#    PYTHONUTF8=1 启用 Python 3.7+ 的 UTF-8 mode（open 默认 UTF-8）
#    PYTHONIOENCODING=utf-8 强制 stdin/stdout/stderr 编码
if not os.environ.get("PYTHONUTF8"):
    os.environ["PYTHONUTF8"] = "1"
if not os.environ.get("PYTHONIOENCODING"):
    os.environ["PYTHONIOENCODING"] = "utf-8"
# 2) 重配当前进程的 stdio（Windows 上 sys.stdout 默认 cp936）
try:
    from engine.utils.encoding import set_utf8_stdio  # noqa: PLC0415

    set_utf8_stdio()
except Exception:  # noqa: BLE001
    # 引擎模块未就绪时静默跳过（如运行 paths 子命令前 __init__ 失败）
    pass

# ─── 彩色输出 (Windows 10+ 通过 ctypes 启用 ANSI, 无需 colorama) ───
def _enable_ansi_on_windows() -> bool:
    """在 Windows 10+ 上启用 ANSI 转义序列. 返回是否成功."""
    if not IS_WINDOWS:
        return False
    try:
        import ctypes  # noqa: PLC0415
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        # STD_OUTPUT_HANDLE = -11, ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
        handle = kernel32.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        new_mode = mode.value | 0x0004
        if not kernel32.SetConsoleMode(handle, new_mode):
            return False
        return True
    except Exception:
        return False


_ANSI_ENABLED = _enable_ansi_on_windows()


def _supports_color() -> bool:
    if IS_WINDOWS:
        return _ANSI_ENABLED
    # Linux/macOS: 终端才上色 (避免输出到文件/管道时夹带转义)
    return sys.stdout.isatty() or os.environ.get("FORCE_COLOR") == "1"


_PALETTE = {
    "green": "\033[32m",
    "red": "\033[31m",
    "yellow": "\033[33m",
    "cyan": "\033[36m",
    "gray": "\033[90m",
}
_RESET = "\033[0m"


def cprint(msg: str, color: str = "") -> None:
    """彩色 print. color ∈ {'', 'green','red','yellow','cyan','gray'}."""
    if color and _supports_color():
        print(f"{_PALETTE[color]}{msg}{_RESET}")
    else:
        print(msg)


def info(msg: str) -> None:
    cprint(f"[INFO] {msg}", "cyan")


def ok(msg: str) -> None:
    cprint(f"[OK]   {msg}", "green")


def warn(msg: str) -> None:
    cprint(f"[WARN] {msg}", "yellow")


def err(msg: str) -> None:
    cprint(f"[ERROR] {msg}", "red")


# ─── 工具函数 ──────────────────────────────────────────────────
def _python_bin() -> str:
    """选 Python 解释器 (优先 .venv, 然后 sys.executable)."""
    venv_python = (
        PROJECT_ROOT / ".venv"
        / ("Scripts" if IS_WINDOWS else "bin")
        / ("python.exe" if IS_WINDOWS else "python")
    )
    if venv_python.exists():
        return str(venv_python)
    return sys.executable or shutil.which("python") or "python"


def _bun_bin() -> Optional[str]:
    return shutil.which("bun")


def _detached_popen(cmd: list[str], **kw) -> subprocess.Popen:
    """跨平台 detached Popen: Linux/macOS 用 start_new_session, Windows 用 CREATE_NEW_PROCESS_GROUP.
    让子进程在父进程退出后仍能继续运行 (守护/启动场景必备).
    """
    if IS_WINDOWS:
        kw.setdefault("creationflags", subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        kw.setdefault("start_new_session", True)
    kw.setdefault("cwd", PROJECT_ROOT)
    return subprocess.Popen(cmd, **kw)


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    """subprocess.run 包装, 默认 cwd=PROJECT_ROOT."""
    kw.setdefault("cwd", PROJECT_ROOT)
    return subprocess.run(cmd, **kw)


def _http_status(url: str, timeout: float = 2.0) -> Optional[int]:
    """返回 HTTP 状态码, 网络错误返回 None."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def _run_precheck_json() -> Optional[dict]:
    """运行 precheck.py --json, 返回解析后的 dict (失败返回 None).

    用于 cmd_setup 前置检查: 若 precheck.py 不存在或 JSON 解析失败返回 None,
    调用方应跳过 precheck 流程 (不阻塞 setup).
    """
    precheck = PROJECT_ROOT / "scripts" / "precheck.py"
    if not precheck.exists():
        return None
    r = _run([sys.executable, str(precheck), "--json"],
             capture_output=True, text=True)
    if not r.stdout:
        return None
    try:
        return json.loads(r.stdout)
    except Exception:
        return None


def _run_precheck_text() -> int:
    """运行 precheck.py (文本模式), 输出最终就绪度报告. 返回 precheck 退出码."""
    precheck = PROJECT_ROOT / "scripts" / "precheck.py"
    if not precheck.exists():
        warn("precheck.py 不存在, 跳过最终就绪度检查")
        return 0
    r = _run([sys.executable, str(precheck)])
    return r.returncode


# ─── 1. start ──────────────────────────────────────────────────
def cmd_start(args) -> int:
    """启动 FastAPI + Next.js + 健康检查."""
    (PROJECT_ROOT / "data" / "logs").mkdir(parents=True, exist_ok=True)

    # 0. 先停旧服务 (避免端口冲突, 与原 start_all.sh 行为一致)
    info("停旧服务 ...")
    _stop_services()
    time.sleep(1)

    # 1. 启动 FastAPI
    api_proc: Optional[subprocess.Popen] = None
    api_log_fp = None
    if not args.no_fastapi:
        api_log = PROJECT_ROOT / "data" / "logs" / "fastapi.log"
        info(f"启动 FastAPI (port 8000) → {api_log.relative_to(PROJECT_ROOT)}")
        api_log_fp = open(api_log, "ab")
        api_proc = _detached_popen(
            [_python_bin(), "-m", "uvicorn", "engine.api.main:app",
             "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"],
            stdout=api_log_fp, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        )
        ok(f"FastAPI started (PID {api_proc.pid})")

    # 2. 启动 Next.js
    web_proc: Optional[subprocess.Popen] = None
    web_log_fp = None
    if not args.no_next:
        bun = _bun_bin()
        if not bun:
            err("bun 未安装, 无法启动 Next.js (https://bun.sh)")
            return 1
        web_log = PROJECT_ROOT / "dev.log"
        info(f"启动 Next.js (port 3000) → {web_log.relative_to(PROJECT_ROOT)}")
        web_log_fp = open(web_log, "ab")
        web_proc = _detached_popen(
            [bun, "run", "dev"],
            stdout=web_log_fp, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        )
        ok(f"Next.js started (PID {web_proc.pid})")

    # 3. 健康检查 - 轮询 20 次每次 2s
    info("等待服务就绪 (最多 40s) ...")
    api_ready = bool(args.no_fastapi)  # 若不启 FastAPI, 视为 ready
    web_ready = bool(args.no_next)
    for i in range(1, 21):
        time.sleep(2)
        if not api_ready and _http_status("http://127.0.0.1:8000/health") == 200:
            api_ready = True
            ok(f"FastAPI ready ({i * 2}s)")
        if not web_ready and _http_status("http://127.0.0.1:3000/") == 200:
            web_ready = True
            ok(f"Next.js ready ({i * 2}s)")
        if api_ready and web_ready:
            break

    # 4. 结果汇报
    print()
    if api_ready and web_ready:
        ok("Both services ready")
        cprint("  停止服务: python scripts/dev.py stop", "gray")
        return 0
    if not api_ready:
        err(f"FastAPI 未就绪, 查日志: data/logs/fastapi.log (PID {api_proc.pid if api_proc else 'N/A'})")
    if not web_ready:
        err(f"Next.js 未就绪, 查日志: dev.log (PID {web_proc.pid if web_proc else 'N/A'})")
    return 1


# ─── 2. stop ───────────────────────────────────────────────────
def _stop_services() -> int:
    """跨平台杀进程, 返回杀掉的进程数. 仅匹配本项目相关进程."""
    stopped = 0
    if IS_LINUX_LIKE:
        # 按端口 (8000/3000) 精准停
        for port in (8000, 3000):
            try:
                r = subprocess.run(["lsof", "-ti", f":{port}"],
                                   capture_output=True, text=True, timeout=5)
                for pid in r.stdout.split():
                    try:
                        subprocess.run(["kill", "-9", pid], timeout=5)
                        ok(f"停止端口 {port} PID {pid}")
                        stopped += 1
                    except Exception:
                        pass
            except FileNotFoundError:
                # lsof 不存在, 兜底 ss
                try:
                    r = subprocess.run(["ss", "-tlnp"], capture_output=True, text=True, timeout=5)
                    for line in r.stdout.splitlines():
                        if f":{port} " in line:
                            m = re.search(r"pid=(\d+)", line)
                            if m:
                                subprocess.run(["kill", "-9", m.group(1)], timeout=5)
                                ok(f"停止端口 {port} PID {m.group(1)}")
                                stopped += 1
                except Exception:
                    pass
            except Exception:
                pass
        # 按进程名匹配 (项目特定 pattern)
        for pattern in ("uvicorn engine.api", "next-server", "next dev", "bun run dev"):
            try:
                r = subprocess.run(["pgrep", "-f", pattern],
                                   capture_output=True, text=True, timeout=5)
                for pid in r.stdout.split():
                    try:
                        subprocess.run(["kill", "-9", pid], timeout=5)
                        ok(f"停止 PID {pid} ({pattern})")
                        stopped += 1
                    except Exception:
                        pass
            except FileNotFoundError:
                break
            except Exception:
                pass
    elif IS_WINDOWS:
        # PowerShell: 匹配 commandline 含项目目录 + uvicorn/next/bun 的进程
        root = str(PROJECT_ROOT).replace("'", "''")
        ps_script = (
            f"$root = '{root}';\n"
            "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {\n"
            "  $_.CommandLine -and\n"
            "  ($_.CommandLine -match 'uvicorn|next-server|next dev|bun run') -and\n"
            "  $_.CommandLine -match [regex]::Escape($root)\n"
            "} | ForEach-Object {\n"
            "  Write-Output ($_.ProcessId.ToString() + '|' + $_.Name);\n"
            "  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue\n"
            "}"
        )
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                capture_output=True, text=True, timeout=30,
            )
            for line in r.stdout.strip().splitlines():
                line = line.strip()
                if "|" in line:
                    pid, name = line.split("|", 1)
                    ok(f"停止 PID {pid} ({name})")
                    stopped += 1
        except Exception as e:
            warn(f"PowerShell 停止失败: {e}")
    return stopped


def cmd_stop(args) -> int:
    info("停止 TdxQuant 服务 ...")
    n = _stop_services()
    if n == 0:
        warn("没有找到运行中的 TdxQuant 进程")
    else:
        ok(f"停止 {n} 个进程")
    return 0


# ─── 3. setup ──────────────────────────────────────────────────
def cmd_setup(args) -> int:
    """venv + 装依赖 + 初始化数据库 (R18: QuestDB 优先, 沙箱无 QuestDB 时优雅降级)."""
    info("环境初始化开始 ...")

    # 0. 前置预检: Python 版本/pip 失败则直接退出 (避免无谓的 venv/依赖安装)
    info("运行预检 (precheck --json) ...")
    pre = _run_precheck_json()
    if pre:
        critical_fail = False
        for chk in pre.get("checks", []):
            if chk.get("id") in ("python_version", "pip") and chk.get("status") == "FAIL":
                err(f"预检关键失败: {chk['name']} — {chk.get('detail', '')}")
                if chk.get("fix"):
                    err(f"修复建议: {chk['fix']}")
                critical_fail = True
        if critical_fail:
            err("setup 已中止 (请先修复上述关键问题, 再重试 setup)")
            return 1
        ok("前置预检通过 (Python 版本 + pip 可用)")
    else:
        warn("precheck.py 不可用或 JSON 解析失败, 跳过前置预检")

    # 1. 创建 venv
    venv_dir = PROJECT_ROOT / ".venv"
    if venv_dir.exists():
        warn(f".venv 已存在, 跳过创建 ({venv_dir.relative_to(PROJECT_ROOT)})")
    else:
        # Linux/macOS: python3 -m venv .venv; Windows: py -m venv .venv (兜底 python)
        if IS_WINDOWS:
            venv_exe = "py" if shutil.which("py") else "python"
        else:
            venv_exe = "python3" if shutil.which("python3") else "python"
        venv_cmd = [venv_exe, "-m", "venv", ".venv"]
        info(f"创建 venv: {' '.join(venv_cmd)}")
        r = _run(venv_cmd)
        if r.returncode != 0:
            err(f"venv 创建失败 (rc={r.returncode})")
            return r.returncode
        ok(".venv 已创建")

    py = _python_bin()

    # 2. pip install -r requirements.txt
    info("安装 Python 依赖 (pip install -r requirements.txt) ...")
    r = _run([py, "-m", "pip", "install", "-r", "requirements.txt"])
    if r.returncode == 0:
        ok("Python 依赖已安装")
    else:
        warn(f"pip install 失败 (rc={r.returncode})")

    # 3. bun install
    bun = _bun_bin()
    if bun:
        info("安装前端依赖 (bun install) ...")
        r = _run([bun, "install"])
        if r.returncode == 0:
            ok("前端依赖已安装")
        else:
            warn(f"bun install 失败 (rc={r.returncode})")
    else:
        warn("bun 未安装, 跳过 bun install (https://bun.sh)")

    # 4. 初始化数据库 (R18: QuestDB; DuckDBStore 已是 QuestDBStore 别名, 沙箱无服务时优雅降级)
    info("初始化数据库 (QuestDB 优先; 沙箱无服务时跳过) ...")
    r = _run([py, "scripts/init_db.py"])
    if r.returncode == 0:
        ok("数据库已初始化 (QuestDB 或降级模式)")
    else:
        warn(f"init_db.py 失败 (rc={r.returncode})")

    # 5. 创建数据目录
    for d in ("data/logs", "data/csv", "data/excel", "data/duckdb"):
        (PROJECT_ROOT / d).mkdir(parents=True, exist_ok=True)

    # 6. 最终就绪度报告 (precheck 文本模式)
    print()
    info("最终就绪度检查 (precheck) ...")
    _run_precheck_text()

    print()
    ok("环境就绪! 下一步: python scripts/dev.py start")
    return 0


# ─── 4. reload ─────────────────────────────────────────────────
def cmd_reload(args) -> int:
    info("热加载配置 (调 reload_config.py) ...")
    r = _run([_python_bin(), "scripts/reload_config.py"])
    return r.returncode


# ─── 5. test ───────────────────────────────────────────────────
def _smoke_test() -> tuple[int, int]:
    """跑 8 个端点冒烟测试, 返回 (passes, fails)."""
    api = "http://127.0.0.1:8000"
    checks = [
        ("GET /api/monitor/status",           f"{api}/api/monitor/status",          200, "engine_status"),
        ("GET /api/monitor/quotes",           f"{api}/api/monitor/quotes?count=5",  200, ""),
        ("GET /api/monitor/match-strategies", f"{api}/api/monitor/match-strategies",200, "match_id"),
        ("GET /api/monitor/watchlist",        f"{api}/api/monitor/watchlist",       200, ""),
        ("GET /api/strategies",               f"{api}/api/strategies",              200, "strategy_id"),
        ("GET /api/sectors",                  f"{api}/api/sectors",                 200, ""),
        ("GET /api/channels",                 f"{api}/api/channels",                200, "channels"),
        ("GET /api/config",                   f"{api}/api/config",                  200, "adapter_mode"),
    ]

    passes = fails = 0
    for name, url, expect, body_contains in checks:
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                code = r.status
                body = r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            code = e.code
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                body = ""
        except Exception as e:
            cprint(f"  [FAIL] {name} -> 连接失败: {e}", "red")
            fails += 1
            continue
        if code == expect and (not body_contains or body_contains in body):
            cprint(f"  [PASS] {name} -> {code}", "green")
            passes += 1
        else:
            detail = f"body 缺少 '{body_contains}'" if body_contains else ""
            cprint(f"  [FAIL] {name} -> {code} (期望 {expect}) {detail}".rstrip(), "red")
            fails += 1
    return passes, fails


def cmd_test(args) -> int:
    # 默认跑全部 (用户不带 flag 时)
    if not (args.smoke or args.lint or args.all):
        args.smoke = args.lint = args.all = True

    rc = 0
    if args.smoke or args.all:
        info("冒烟测试 (8 端点) ...")
        p, f = _smoke_test()
        if f == 0:
            ok(f"smoke: PASS={p}  FAIL={f}")
        else:
            err(f"smoke: PASS={p}  FAIL={f}")
            rc = 1
    if args.lint or args.all:
        bun = _bun_bin()
        if not bun:
            err("bun 未安装, 无法跑 lint")
            rc = 1
        else:
            info("lint (bun run lint) ...")
            r = _run([bun, "run", "lint"])
            if r.returncode == 0:
                ok("lint: PASS")
            else:
                err(f"lint: FAIL (rc={r.returncode})")
                rc = 1
    return rc


# ─── 6. paths ──────────────────────────────────────────────────
def _parse_paths_yaml(env: str) -> list[tuple[str, str]]:
    """读 scripts/paths.yaml, 返回 [(placeholder, value), ...]."""
    paths_yaml = PROJECT_ROOT / "scripts" / "paths.yaml"
    if not paths_yaml.exists():
        err(f"找不到配置文件: {paths_yaml}")
        return []
    text = paths_yaml.read_text(encoding="utf-8")

    # 优先用 PyYAML (在 requirements.txt 中)
    try:
        import yaml  # type: ignore[import-untyped]
        data = yaml.safe_load(text) or {}
        result: list[tuple[str, str]] = []
        for ph, env_map in (data.get("placeholders") or {}).items():
            if isinstance(env_map, dict):
                val = env_map.get(env) or next(iter(env_map.values()), "")
            else:
                val = str(env_map)
            result.append((ph, val))
        return result
    except ImportError:
        # 兜底: 正则解析 (与原 .sh 实现一致, 不依赖 PyYAML)
        result = []
        m = re.search(r"^placeholders:\s*\n((?:\s{2,}.*\n|\s*\n)+)", text, re.M)
        if not m:
            return result
        block = m.group(1)
        for key, body in re.findall(
            r'"(\{\{[^"}]+\}\})":\s*\n((?:[ \t]+(?:linux|windows):\s*.*\n)+)',
            block,
        ):
            m2 = re.search(rf"^[ \t]+{env}:\s*\"?(.*?)\"?\s*$", body, re.M)
            val = m2.group(1) if m2 else ""
            result.append((key, val))
        return result


def cmd_paths(args) -> int:
    env = args.env
    mapping = _parse_paths_yaml(env)
    if not mapping:
        err("未从 paths.yaml 读到任何占位符")
        return 1

    info(f"激活环境: {env}")
    info("DRY-RUN (不写文件)" if args.dry_run else "模式: 实际写入")
    info("扫描目录: scripts docs engine config")
    print()
    info("占位符映射表:")
    for ph, val in mapping:
        print(f"    {ph}  ->  {val}")
    print("-" * 40)

    # 扫描配置
    scan_dirs = ["scripts", "docs", "engine", "config"]
    skip_dir_names = {
        "node_modules", "__pycache__", ".git", ".next",
        "data", "logs", "tool-results", "upload", "download",
    }
    skip_exts = {
        ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".zip", ".7z",
        ".xlsx", ".csv", ".db", ".db.bak", ".wal", ".pyc", ".lock",
    }
    skip_files = {"paths.yaml", "dev.py", "PATH_REPLACEMENT_GUIDE.md"}

    total_files = changed_files = total_replacements = 0

    for d in scan_dirs:
        full = PROJECT_ROOT / d
        if not full.is_dir():
            continue
        for fpath in full.rglob("*"):
            if not fpath.is_file():
                continue
            # 跳过目录 (按路径任一段匹配)
            parts = set(fpath.relative_to(PROJECT_ROOT).parts[:-1])
            if parts & skip_dir_names:
                continue
            # 跳过扩展名
            if fpath.suffix.lower() in skip_exts:
                continue
            # 跳过特定文件
            if fpath.name in skip_files:
                continue
            # 跳过二进制 (前 4KB 检测 NUL)
            try:
                with open(fpath, "rb") as bf:
                    chunk = bf.read(4096)
                if b"\x00" in chunk:
                    continue
            except Exception:
                continue

            total_files += 1
            try:
                content = fpath.read_text(encoding="utf-8")
            except Exception:
                continue

            count = 0
            for ph, val in mapping:
                if ph in content:
                    count += content.count(ph)
                    content = content.replace(ph, val)
            if count > 0:
                changed_files += 1
                total_replacements += count
                rel = fpath.relative_to(PROJECT_ROOT).as_posix()
                if args.dry_run:
                    cprint(f"  [DRY] {rel}  ({count} 处)", "yellow")
                else:
                    cprint(f"  [OK]  {rel}  ({count} 处)", "green")
                    try:
                        fpath.write_text(content, encoding="utf-8")
                    except Exception as e:
                        err(f"写入失败 {rel}: {e}")

    print("-" * 40)
    info(f"扫描文件数: {total_files}")
    info(f"修改文件数: {changed_files}")
    info(f"替换总处数: {total_replacements}")
    if args.dry_run:
        info("(DRY-RUN, 未实际写入)")
    else:
        ok("已写入磁盘")
    return 0


# ─── 7. daemon ─────────────────────────────────────────────────
def _is_service_alive(pattern: str) -> bool:
    """跨平台检测服务进程是否存活 (按 commandline pattern 匹配)."""
    if IS_LINUX_LIKE:
        try:
            r = subprocess.run(["pgrep", "-f", pattern],
                               capture_output=True, timeout=5)
            return r.returncode == 0 and bool(r.stdout.strip())
        except FileNotFoundError:
            # 无 pgrep, 兜底 ps + grep
            try:
                r = subprocess.run(["ps", "aux"], capture_output=True, text=True, timeout=5)
                return any(pattern in line for line in r.stdout.splitlines())
            except Exception:
                return False
        except Exception:
            return False
    elif IS_WINDOWS:
        ps_script = (
            "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | "
            "Where-Object { $_.CommandLine -match '" + pattern.replace("'", "''") + "' } | "
            "Select-Object -First 1 | ForEach-Object { $_.ProcessId }"
        )
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                capture_output=True, text=True, timeout=10,
            )
            return bool(r.stdout.strip())
        except Exception:
            return False
    return False


def _start_fastapi_bg() -> None:
    """后台启动 FastAPI, 写入 data/logs/fastapi.log."""
    api_log = PROJECT_ROOT / "data" / "logs" / "fastapi.log"
    (PROJECT_ROOT / "data" / "logs").mkdir(parents=True, exist_ok=True)
    fp = open(api_log, "ab")
    _detached_popen(
        [_python_bin(), "-m", "uvicorn", "engine.api.main:app",
         "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"],
        stdout=fp, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
    )


def _start_next_bg() -> None:
    """后台启动 Next.js, 写入 dev.log."""
    bun = _bun_bin()
    if not bun:
        warn("bun 未安装, 无法启动 Next.js")
        return
    web_log = PROJECT_ROOT / "dev.log"
    fp = open(web_log, "ab")
    _detached_popen(
        [bun, "run", "dev"],
        stdout=fp, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
    )


def cmd_daemon(args) -> int:
    """守护进程模式: 5s 轮询, 服务挂了重启."""
    info("守护模式启动, 5s 轮询, Ctrl+C 退出 (子进程会继续运行)")

    while True:
        try:
            if not _is_service_alive("uvicorn engine.api"):
                ts = time.strftime("%H:%M:%S")
                cprint(f"[{ts}] FastAPI 挂了, 重启", "cyan")
                _start_fastapi_bg()
                time.sleep(3)
            if not _is_service_alive("next-server") and not _is_service_alive("next dev"):
                ts = time.strftime("%H:%M:%S")
                cprint(f"[{ts}] Next.js 挂了, 重启", "cyan")
                _start_next_bg()
                time.sleep(5)
            time.sleep(5)
        except KeyboardInterrupt:
            cprint("\n[中断] 用户 Ctrl+C, 守护退出 (子进程仍在运行)", "yellow")
            cprint("  停止子进程: python scripts/dev.py stop", "gray")
            return 130
        except Exception as e:
            warn(f"守护循环异常 (继续): {e}")
            time.sleep(5)


# ─── argparse ──────────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dev.py",
        description="TdxQuant 跨平台运维脚本 (统一入口, 替代 18 个 .sh/.ps1)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
示例:
  python scripts/dev.py start                  # 启动 FastAPI + Next.js
  python scripts/dev.py start --no-fastapi     # 只启 Next.js
  python scripts/dev.py start --no-next        # 只启 FastAPI
  python scripts/dev.py stop                   # 停止所有服务
  python scripts/dev.py setup                  # 初始化环境 (venv + 依赖 + QuestDB)
  python scripts/dev.py reload                 # 热加载配置
  python scripts/dev.py test --all             # 跑冒烟 + lint
  python scripts/dev.py paths --env linux      # 路径替换 (linux)
  python scripts/dev.py paths --env windows --dry-run  # 预览 (windows)
  python scripts/dev.py daemon                 # 守护进程 (5s 轮询)

兼容: 老 bash scripts/start_all.sh 仍可运行 (内部转发到本脚本).
""",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_start = sub.add_parser("start", help="启动 FastAPI + Next.js + 健康检查")
    p_start.add_argument("--no-fastapi", action="store_true",
                         help="不启 FastAPI (只启 Next.js)")
    p_start.add_argument("--no-next", action="store_true",
                         help="不启 Next.js (只启 FastAPI)")
    p_start.set_defaults(func=cmd_start)

    p_stop = sub.add_parser("stop", help="停止所有服务")
    p_stop.set_defaults(func=cmd_stop)

    p_setup = sub.add_parser("setup", help="venv + 装依赖 + 初始化数据库 (QuestDB 优先)")
    p_setup.set_defaults(func=cmd_setup)

    p_reload = sub.add_parser("reload", help="热加载配置 (调 reload_config.py)")
    p_reload.set_defaults(func=cmd_reload)

    p_test = sub.add_parser("test", help="冒烟测试 / lint / 全部")
    g = p_test.add_mutually_exclusive_group()
    g.add_argument("--smoke", action="store_true", help="跑冒烟测试 (8 端点)")
    g.add_argument("--lint", action="store_true", help="跑 bun run lint")
    g.add_argument("--all", action="store_true", help="冒烟 + lint 全跑")
    p_test.set_defaults(func=cmd_test)

    p_paths = sub.add_parser("paths", help="路径占位符替换")
    p_paths.add_argument("--env", required=True, choices=["linux", "windows"],
                         help="目标环境")
    p_paths.add_argument("--dry-run", action="store_true",
                         help="只打印不写文件")
    p_paths.set_defaults(func=cmd_paths)

    p_daemon = sub.add_parser("daemon",
                              help="守护进程模式 (5s 轮询, 挂了重启)")
    p_daemon.set_defaults(func=cmd_daemon)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        rc = args.func(args)
        return int(rc or 0)
    except KeyboardInterrupt:
        cprint("\n[中断] 用户 Ctrl+C, 退出", "yellow")
        return 130
    except Exception as e:
        err(f"未捕获异常: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
