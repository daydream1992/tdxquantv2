#!/usr/bin/env python3
"""TdxQuant 部署预检脚本. 跨平台 (Linux 也能跑, 用于本地预演).

检查所有 Windows 部署前置条件, 打印清晰的 ✅/❌ 报告.

用法: precheck.py [--json] [--fix]
  --json  JSON 输出 (供 install.bat 解析)
  --fix   自动修复可修复项 (创建缺失目录, 初始化 DuckDB)
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
IS_WINDOWS = platform.system() == "Windows"
# 通达信终端常见安装路径 (Windows)
TDX_COMMON_PATHS = [
    r"C:\new_tdx", r"D:\new_tdx", r"C:\通达信", r"D:\通达信",
    r"C:\Program Files\通达信", r"D:\Program Files\通达信",
]
_PALETTE = {"green": "\033[32m", "red": "\033[31m", "yellow": "\033[33m", "cyan": "\033[36m"}
_RESET = "\033[0m"
PASS, FAIL, WARN = "PASS", "FAIL", "WARN"


def _supports_color() -> bool:
    if IS_WINDOWS:
        try:
            import ctypes  # noqa: PLC0415
            k32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            k32.SetConsoleMode(k32.GetStdHandle(-11), 7)
            return True
        except Exception:
            return False
    return sys.stdout.isatty() or os.environ.get("FORCE_COLOR") == "1"


def _c(msg: str, color: str = "") -> str:
    if color and _supports_color():
        return f"{_PALETTE.get(color, '')}{msg}{_RESET}"
    return msg


def _r(id_: str, name: str, status: str, detail: str = "", fix: str = "") -> dict[str, Any]:
    return {"id": id_, "name": name, "status": status, "detail": detail, "fix": fix}


def _try_cmd(cmd: list[str]) -> Optional[str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            out = (r.stdout or r.stderr).strip()
            return out.splitlines()[0] if out else "ok"
    except Exception:
        pass
    return None


def _read_adapter_mode() -> str:
    cfg = PROJECT_ROOT / "config" / "app.yaml"
    if not cfg.exists():
        return "mock"
    m = re.search(r"adapter_mode:\s*(\w+)", cfg.read_text(encoding="utf-8"))
    return m.group(1) if m else "mock"


def _can_import(mod: str) -> bool:
    try:
        __import__(mod)
        return True
    except ImportError:
        return False


def check_python_version() -> dict[str, Any]:
    v = sys.version_info
    detail = f"Python {v.major}.{v.minor}.{v.micro}"
    if (v.major, v.minor) >= (3, 13):
        return _r("python_version", "Python 版本", PASS, detail)
    return _r("python_version", "Python 版本", FAIL, detail,
              "请安装 Python 3.13+ (https://www.python.org/downloads/)")


def check_pip() -> dict[str, Any]:
    out = _try_cmd([sys.executable, "-m", "pip", "--version"])
    if out:
        return _r("pip", "pip 可用", PASS, out)
    return _r("pip", "pip 可用", FAIL, "pip 不可用", "python -m ensurepip --upgrade")


def check_bun() -> dict[str, Any]:
    bun = shutil.which("bun")
    if bun:
        return _r("bun", "bun 可用", PASS, f"bun {_try_cmd([bun, '--version'])}")
    return _r("bun", "bun 可用", WARN, "bun 未安装",
              'Windows: powershell -c "irm bun.sh/install.ps1 | iex"  /  Linux: curl -fsSL https://bun.sh/install | bash')


def check_tqcenter() -> dict[str, Any]:
    try:
        import tqcenter  # noqa: F401,PLC0415
        return _r("tqcenter", "tqcenter (Real 模式)", PASS, "已安装")
    except ImportError:
        if _read_adapter_mode() == "real":
            return _r("tqcenter", "tqcenter (Real 模式)", FAIL, "未安装",
                      "python scripts/install_tqcenter.py")
        return _r("tqcenter", "tqcenter (Real 模式)", WARN, "未安装 (mock 模式可忽略)",
                  "Real 模式需安装: python scripts/install_tqcenter.py")


def check_python_deps() -> dict[str, Any]:
    missing = [m for m in ("fastapi", "uvicorn", "duckdb", "simpleeval") if not _can_import(m)]
    if not missing:
        return _r("python_deps", "Python 依赖", PASS, "fastapi/uvicorn/duckdb/simpleeval 已装")
    return _r("python_deps", "Python 依赖", FAIL, f"缺失: {', '.join(missing)}",
              "pip install -r requirements.txt")


def check_ports() -> dict[str, Any]:
    parts, occupied = [], False
    for port in (8000, 3000):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", port))
            parts.append(f"端口 {port} 空闲")
        except OSError:
            parts.append(f"端口 {port} 被占用")
            occupied = True
        finally:
            s.close()
    detail = "; ".join(parts)
    if occupied:
        return _r("ports", "端口 8000/3000", WARN, detail, "python scripts/dev.py stop 释放端口")
    return _r("ports", "端口 8000/3000", PASS, detail)


def check_dirs_writable() -> dict[str, Any]:
    bad = []
    for d in ("data", "data/duckdb", "data/logs", "data/csv", "data/excel"):
        p = PROJECT_ROOT / d
        try:
            p.mkdir(parents=True, exist_ok=True)
            t = p / ".precheck_write_test"
            t.write_text("ok", encoding="utf-8")
            t.unlink()
        except Exception as e:
            bad.append(f"{d} ({e})")
    if bad:
        return _r("dirs", "数据目录可写", FAIL, f"不可写: {', '.join(bad)}", "检查目录权限")
    return _r("dirs", "数据目录可写", PASS, "5 个目录均可写 (已自动 mkdir -p)")


def check_duckdb_file() -> dict[str, Any]:
    db = PROJECT_ROOT / "data" / "duckdb" / "quant.db"
    if db.exists() and db.stat().st_size > 0:
        return _r("duckdb_file", "DuckDB 文件", PASS, f"{db.name} ({db.stat().st_size} bytes)")
    return _r("duckdb_file", "DuckDB 文件", FAIL, f"{db} 不存在或为空", "python scripts/init_db.py")


def check_tdx_terminal() -> dict[str, Any]:
    if not IS_WINDOWS:
        return _r("tdx_terminal", "通达信终端", WARN, "非 Windows, 跳过")
    for path in TDX_COMMON_PATHS:
        if Path(path).exists():
            return _r("tdx_terminal", "通达信终端", PASS, f"找到: {path}")
    return _r("tdx_terminal", "通达信终端", FAIL, "未找到通达信终端",
              "请手动指定通达信安装路径, 或运行 python scripts/install_tqcenter.py --path <path>")


def check_tdx_tqcenter_path() -> dict[str, Any]:
    if not IS_WINDOWS:
        return _r("tdx_tqcenter_path", "tqcenter 路径", WARN, "非 Windows, 跳过")
    for path in TDX_COMMON_PATHS:
        root = Path(path)
        if not root.exists():
            continue
        for c in (root / "T0002" / "hq_cache" / "PythonLib" / "tqcenter",
                  root / "T0002" / "hq_cache" / "PythonLib",
                  root / "Python" / "site-packages" / "tqcenter"):
            if (c / "__init__.py").exists() or (c / "tqcenter" / "__init__.py").exists():
                return _r("tdx_tqcenter_path", "tqcenter 路径", PASS, f"找到: {c}")
    return _r("tdx_tqcenter_path", "tqcenter 路径", WARN, "未在通达信目录找到 tqcenter",
              "python scripts/install_tqcenter.py")


def check_configs() -> dict[str, Any]:
    files = ["config/app.yaml", "config/monitor.yaml", "config/channels.yaml"]
    bad = [f for f in files
           if not (PROJECT_ROOT / f).exists() or (PROJECT_ROOT / f).stat().st_size == 0]
    if not bad:
        return _r("configs", "配置文件", PASS, "app/monitor/channels.yaml 均存在且非空")
    return _r("configs", "配置文件", FAIL, f"缺失或为空: {', '.join(bad)}",
              "从 git 恢复或检查 config/ 目录")


def check_disk_space() -> dict[str, Any]:
    try:
        free_mb = shutil.disk_usage(PROJECT_ROOT).free / 1024 / 1024
    except Exception as e:
        return _r("disk_space", "磁盘空间", WARN, f"无法获取: {e}")
    if free_mb >= 500:
        return _r("disk_space", "磁盘空间", PASS, f"剩余 {free_mb:.0f} MB")
    return _r("disk_space", "磁盘空间", FAIL, f"剩余 {free_mb:.0f} MB (< 500 MB)", "清理磁盘空间")


CHECKS = [
    check_python_version, check_pip, check_bun, check_tqcenter,
    check_python_deps, check_ports, check_dirs_writable, check_duckdb_file,
    check_tdx_terminal, check_tdx_tqcenter_path, check_configs, check_disk_space,
]


def run_fix(results: list[dict[str, Any]]) -> list[str]:
    """自动修复可修复项 (创建缺失目录/初始化 DuckDB). 静默执行, 返回修复 id 列表."""
    by_id = {r["id"]: r for r in results}
    fixed = []
    if by_id["duckdb_file"]["status"] == FAIL:
        r = subprocess.run([sys.executable, str(PROJECT_ROOT / "scripts" / "init_db.py")],
                           capture_output=True, text=True, cwd=PROJECT_ROOT)
        if r.returncode == 0:
            fixed.append("duckdb_file")
    return fixed


_STATUS_META = {PASS: ("[PASS]", "green", "✅", "修复"),
                FAIL: ("[FAIL]", "red", "❌", "修复"),
                WARN: ("[WARN]", "yellow", "⚠️ ", "建议")}


def print_banner() -> None:
    line = _c("=" * 64, "cyan")
    print(line)
    print(_c(f"  TdxQuant 部署预检  |  平台: {platform.system()} {platform.release()}"
             f"  |  时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", "cyan"))
    print(line)
    print()


def print_report(results: list[dict[str, Any]]) -> None:
    for r in results:
        tag, color, icon, label = _STATUS_META[r["status"]]
        line = f"  {_c(tag, color)} {icon} {r['name']} — {r['detail']}"
        if r["fix"]:
            line += f"  ——  {label}: {r['fix']}"
        print(line)


def print_summary(results: list[dict[str, Any]]) -> None:
    counts = {s: sum(1 for r in results if r["status"] == s) for s in (PASS, FAIL, WARN)}
    print()
    print(_c("-" * 64, "cyan"))
    print(f"  通过 {counts[PASS]} / 失败 {counts[FAIL]} / 警告 {counts[WARN]}")
    verdict = "READY ✅" if counts[FAIL] == 0 else "NOT READY ❌"
    print(_c(f"  整体结论: {verdict}", "green" if counts[FAIL] == 0 else "red"))


def main() -> int:
    parser = argparse.ArgumentParser(description="TdxQuant 部署预检")
    parser.add_argument("--json", action="store_true", help="JSON 输出 (供 install.bat 解析)")
    parser.add_argument("--fix", action="store_true",
                        help="自动修复可修复项 (创建缺失目录, 初始化 DuckDB)")
    args = parser.parse_args()

    results = [check() for check in CHECKS]
    if args.fix:
        fixed = run_fix(results)
        if not args.json:
            for f in fixed:
                print(_c(f"  [FIX] 已修复: {f}", "cyan"))
        results = [check() for check in CHECKS]  # 重跑

    if args.json:
        counts = {s: sum(1 for r in results if r["status"] == s) for s in (PASS, FAIL, WARN)}
        print(json.dumps({
            "platform": platform.system(),
            "time": datetime.now().isoformat(),
            "checks": results,
            "summary": {"pass": counts[PASS], "fail": counts[FAIL], "warn": counts[WARN]},
        }, ensure_ascii=False, indent=2))
    else:
        print_banner()
        print_report(results)
        print_summary(results)

    return 1 if any(r["status"] == FAIL for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
