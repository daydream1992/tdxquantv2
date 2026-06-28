#!/usr/bin/env python3
"""TdxQuant Real 模式实盘诊断脚本 (R22).

聚焦"选股能否真落库"这条主链路, 补 precheck.py (部署预检) 和 stability_check.py
(运行中巡检) 没覆盖的盲区:

  - tqcenter 真实 import + 关键 API 签名验证 (Bug 12 那类: 参数名 stocks→stock_list)
  - 配置项实际值核对 (adapter_mode / python_path / qps)
  - QuestDB 方言探针 (R21 教训: 9.x 方言兼容性是踩坑重灾区)
  - 选股冒烟 + 落库回查 (R21 教训3: API count≠落库, 必须回查表)
  - 日志 ERROR/Traceback 关键行抓取

只读诊断 (选股冒烟默认跳过, --run 才触发), 可随时安全复跑.

用法
----
    python scripts/diagnose_real.py              # 全量只读诊断 (不跑选股)
    python scripts/diagnose_real.py --run        # 含选股冒烟 (~5-6 分钟)
    python scripts/diagnose_real.py --section tqcenter   # 仅查 tqcenter
    python scripts/diagnose_real.py --json       # JSON 输出 (机器可读)

退出码: 0 = 全部 PASS / 1 = 存在 FAIL / 2 = 脚本自身错误

适用: Real 模式实盘接入前 / 接入后故障排查 / 升级 QuestDB 后回归
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
IS_WINDOWS = platform.system() == "Windows"

# Windows 控制台默认 GBK, 强制 stdout/stderr UTF-8, 避免中文/符号 UnicodeEncodeError
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

# 标记符号 (纯 ASCII, Windows cmd 友好)
PASS_MARK = "[ OK ]"
FAIL_MARK = "[FAIL]"
WARN_MARK = "[WARN]"
INFO_MARK = "[INFO]"


def _c(text: str) -> str:
    """安全打印 (兜底编码)."""
    try:
        return text
    except Exception:  # noqa: BLE001
        return text.encode("utf-8", errors="replace").decode("utf-8")


class Diagnoser:
    def __init__(self, base_url: str = "http://127.0.0.1:8000",
                 qdb_http: str = "http://127.0.0.1:9000"):
        self.base_url = base_url.rstrip("/")
        self.qdb_http = qdb_http.rstrip("/")
        self.results: list[dict[str, Any]] = []
        self.cfg: dict[str, Any] = {}
        self.fail_count = 0
        self.warn_count = 0

    def _record(self, section: str, name: str, status: str,
                value: Any = "", detail: str = ""):
        self.results.append({
            "section": section, "name": name, "status": status,
            "value": str(value), "detail": detail,
        })
        if status == "FAIL":
            self.fail_count += 1
        elif status == "WARN":
            self.warn_count += 1

    def _print(self, mark: str, name: str, value: Any = "", detail: str = ""):
        line = f"  {mark} {name}"
        if value != "" and value is not None:
            line += f": {value}"
        if detail:
            line += f"  | {detail}"
        print(_c(line))

    # ---------- 1. 环境 ----------
    def check_env(self):
        print("\n" + "=" * 64)
        print("  [1/9] 环境基础")
        print("=" * 64)
        print(f"  {INFO_MARK} 时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"  {INFO_MARK} OS: {platform.platform()}")
        print(f"  {INFO_MARK} Python: {sys.version.split()[0]}")
        print(f"  {INFO_MARK} 项目根: {PROJECT_ROOT}")

        deps = ["fastapi", "uvicorn", "psycopg2", "pandas",
                "requests", "yaml", "simpleeval"]
        for dep in deps:
            try:
                m = __import__(dep)
                ver = getattr(m, "__version__", "?")
                self._print(PASS_MARK, f"依赖 {dep}", ver)
                self._record("env", f"dep_{dep}", "PASS", ver)
            except ImportError:
                self._print(FAIL_MARK, f"依赖 {dep}", "未安装")
                self._record("env", f"dep_{dep}", "FAIL", "未安装")

    # ---------- 2. 配置 ----------
    def check_config(self):
        print("\n" + "=" * 64)
        print("  [2/9] 配置检查 (config/app.yaml)")
        print("=" * 64)
        cfg_path = PROJECT_ROOT / "config" / "app.yaml"
        if not cfg_path.exists():
            self._print(FAIL_MARK, "config/app.yaml", "不存在")
            self._record("config", "app_yaml", "FAIL", "不存在")
            return

        try:
            import yaml
            with open(cfg_path, encoding="utf-8") as f:
                self.cfg = yaml.safe_load(f) or {}
        except Exception as exc:
            self._print(FAIL_MARK, "config/app.yaml 解析", str(exc))
            self._record("config", "app_yaml_parse", "FAIL", str(exc))
            return

        app = self.cfg.get("app", {})
        tq = self.cfg.get("tqcenter", {})
        qdb = self.cfg.get("questdb", {})

        mode = app.get("adapter_mode", "?")
        ok = mode == "real"
        self._print(PASS_MARK if ok else FAIL_MARK,
                    "app.adapter_mode", mode,
                    "" if ok else "必须为 real 才走实盘")
        self._record("config", "adapter_mode", "PASS" if ok else "FAIL", mode)

        py_path = tq.get("python_path", "")
        ok = bool(py_path)
        self._print(PASS_MARK if ok else FAIL_MARK,
                    "tqcenter.python_path", py_path or "(空)",
                    "" if ok else "real 模式必填")
        self._record("config", "python_path", "PASS" if ok else "FAIL", py_path)

        for key in ("global_qps", "burst", "acquire_timeout"):
            v = tq.get(key)
            ok = v is not None
            self._print(PASS_MARK if ok else WARN_MARK,
                        f"tqcenter.{key}", v)
            self._record("config", f"tqcenter_{key}",
                         "PASS" if ok else "WARN", v)

        for key in ("host", "pg_port", "http_port"):
            v = qdb.get(key)
            self._print(PASS_MARK if v else WARN_MARK,
                        f"questdb.{key}", v)
            self._record("config", f"questdb_{key}",
                         "PASS" if v else "WARN", v)

    # ---------- 3. 端口 ----------
    def check_ports(self):
        print("\n" + "=" * 64)
        print("  [3/9] 端口监听")
        print("=" * 64)
        ports = [
            (8000, "FastAPI"),
            (3000, "Next.js"),
            (9000, "QuestDB HTTP"),
            (8812, "QuestDB PG wire"),
            (9009, "QuestDB ILP"),
        ]
        for port, name in ports:
            s = socket.socket()
            s.settimeout(1)
            try:
                s.connect(("127.0.0.1", port))
                self._print(PASS_MARK, f"端口 {port} ({name})", "监听中")
                self._record("port", f"port_{port}", "PASS", name)
            except Exception:
                self._print(FAIL_MARK, f"端口 {port} ({name})", "未监听")
                self._record("port", f"port_{port}", "FAIL", "未监听")
            finally:
                s.close()

    # ---------- 4. 通达信进程 ----------
    def check_tdx(self):
        print("\n" + "=" * 64)
        print("  [4/9] 通达信终端进程")
        print("=" * 64)
        try:
            if IS_WINDOWS:
                r = subprocess.run(["tasklist"], capture_output=True,
                                   text=True, timeout=5, shell=False)
                tdx_running = "tdxw.exe" in r.stdout.lower()
            else:
                r = subprocess.run(["pgrep", "-f", "tdxw"],
                                   capture_output=True, text=True, timeout=5)
                tdx_running = bool(r.stdout.strip())
            self._print(PASS_MARK if tdx_running else FAIL_MARK,
                        "tdxw.exe", "运行中" if tdx_running else "未运行",
                        "" if tdx_running else "real 模式必须先启动并登录通达信")
            self._record("tdx", "tdxw_running",
                         "PASS" if tdx_running else "FAIL",
                         "运行中" if tdx_running else "未运行")
        except Exception as exc:
            self._print(WARN_MARK, "tdxw.exe 检查", f"无法检查: {exc}")
            self._record("tdx", "tdxw_running", "WARN", str(exc))

    # ---------- 5. tqcenter 真实 import ----------
    def _ensure_cfg(self):
        """懒加载配置 (--section 模式下 check_config 可能没跑, self.cfg 为空)."""
        if self.cfg:
            return
        cfg_path = PROJECT_ROOT / "config" / "app.yaml"
        if not cfg_path.exists():
            return
        try:
            import yaml
            with open(cfg_path, encoding="utf-8") as f:
                self.cfg = yaml.safe_load(f) or {}
        except Exception:  # noqa: BLE001
            pass

    def check_tqcenter(self):
        print("\n" + "=" * 64)
        print("  [5/9] tqcenter 真实 import + API 签名 (Bug 12 类)")
        print("=" * 64)
        self._ensure_cfg()
        py_path = self.cfg.get("tqcenter", {}).get("python_path", "")
        if not py_path:
            self._print(FAIL_MARK, "tqcenter.python_path", "未配置, 跳过")
            self._record("tqcenter", "python_path", "FAIL", "未配置")
            return

        tq_file = Path(py_path) / "tqcenter.py"
        if not tq_file.exists():
            self._print(FAIL_MARK, "tqcenter.py 存在", str(tq_file))
            self._record("tqcenter", "tqcenter_py", "FAIL",
                         f"{tq_file} 不存在")
            return
        self._print(PASS_MARK, "tqcenter.py 存在", str(tq_file))
        self._record("tqcenter", "tqcenter_py", "PASS", str(tq_file))

        # 尝试 import (不调 initialize, 避免连终端)
        try:
            if py_path not in sys.path:
                sys.path.insert(0, py_path)
            import tqcenter as tq_mod  # type: ignore
            self._print(PASS_MARK, "import tqcenter", "成功")
            self._record("tqcenter", "import", "PASS", "成功")
        except Exception as exc:
            self._print(FAIL_MARK, "import tqcenter", f"失败: {exc}")
            self._record("tqcenter", "import", "FAIL", str(exc))
            return

        # tqcenter 的 API 是 `class tq` 的 classmethod (tqcenter.py 约 588 行起),
        # 不是模块层函数. 必须在类对象上查 hasattr, 否则恒为 False (R22 诊断误报修复).
        tq_cls = getattr(tq_mod, "tq", None)
        if tq_cls is None:
            self._print(FAIL_MARK, "tqcenter.tq 类", "未找到",
                        "API 挂在 class tq 上, 模块无 tq 类则无法验证")
            self._record("tqcenter", "tq_class", "FAIL", "未找到 class tq")
            return
        self._print(PASS_MARK, "tqcenter.tq 类", "找到")
        self._record("tqcenter", "tq_class", "PASS", "找到")

        # 检查关键 API 存在性 (在 class tq 上查)
        apis = [
            "get_stock_list", "get_more_info", "get_market_data",
            "send_user_block", "create_sector", "get_sector_list",
            "get_stock_list_in_sector", "get_relation",
            "subscribe_hq", "unsubscribe_hq", "initialize",
        ]
        missing = []
        for api in apis:
            has = hasattr(tq_cls, api)
            if has:
                self._print(PASS_MARK, f"  tq.{api}", "存在")
            else:
                self._print(FAIL_MARK, f"  tq.{api}", "缺失")
                missing.append(api)
        self._record("tqcenter", "api_coverage",
                     "PASS" if not missing else "FAIL",
                     f"缺失: {missing}" if missing else "全部存在")

        # send_user_block 签名验证 (Bug 12: 参数名 stocks→stock_list)
        # 注意: classmethod 的 __func__ 才能拿到去掉 cls 的真实签名
        try:
            import inspect
            raw = getattr(tq_cls, "send_user_block", None)
            if raw is None:
                self._print(FAIL_MARK, "send_user_block 签名",
                            "方法不存在")
                self._record("tqcenter", "send_user_block_sig",
                             "FAIL", "方法不存在")
            else:
                # classmethod object → __func__ 拿底层函数
                target = getattr(raw, "__func__", raw)
                sig = inspect.signature(target)
                params = list(sig.parameters.keys())
                # 去掉 cls (classmethod 第一参)
                if params and params[0] == "cls":
                    params = params[1:]
                ok = "stock_list" in params
                self._print(PASS_MARK if ok else FAIL_MARK,
                            "send_user_block 签名",
                            f"params={params}",
                            "stock_list OK" if ok
                            else "Bug12: 期望 stock_list, 实际可能是 stocks")
                self._record("tqcenter", "send_user_block_sig",
                             "PASS" if ok else "FAIL", str(params))
        except Exception as exc:
            self._print(WARN_MARK, "send_user_block 签名", f"无法检查: {exc}")
            self._record("tqcenter", "send_user_block_sig", "WARN", str(exc))

    # ---------- 6. FastAPI ----------
    def check_fastapi(self):
        print("\n" + "=" * 64)
        print("  [6/9] FastAPI 健康")
        print("=" * 64)
        import requests
        try:
            r = requests.get(f"{self.base_url}/api/monitor/status",
                             timeout=5)
            if r.status_code == 200:
                data = r.json()
                mode = data.get("adapter_mode", "?")
                status = data.get("engine_status", "?")
                ok = mode == "real" and status == "running"
                self._print(PASS_MARK if ok else WARN_MARK,
                            "GET /api/monitor/status", "200",
                            f"adapter_mode={mode}, engine_status={status}")
                self._record("fastapi", "status",
                             "PASS" if ok else "WARN",
                             f"mode={mode}, status={status}")
            else:
                self._print(FAIL_MARK, "GET /api/monitor/status",
                            f"HTTP {r.status_code}")
                self._record("fastapi", "status", "FAIL",
                             f"HTTP {r.status_code}")
        except Exception as exc:
            self._print(FAIL_MARK, "GET /api/monitor/status",
                        f"连接失败: {exc}")
            self._record("fastapi", "status", "FAIL", str(exc))

        try:
            r = requests.get(f"{self.base_url}/health", timeout=5)
            ok = r.status_code == 200
            self._print(PASS_MARK if ok else FAIL_MARK,
                        "GET /health", f"HTTP {r.status_code}")
            self._record("fastapi", "health",
                         "PASS" if ok else "FAIL", r.status_code)
        except Exception as exc:
            self._print(FAIL_MARK, "GET /health", f"连接失败: {exc}")
            self._record("fastapi", "health", "FAIL", str(exc))

    # ---------- 7. QuestDB 方言探针 ----------
    def check_questdb(self):
        print("\n" + "=" * 64)
        print("  [7/9] QuestDB 方言探针 + 表计数")
        print("=" * 64)
        import requests

        # 基础连通
        try:
            r = requests.get(f"{self.qdb_http}/exec",
                             params={"query": "SELECT 1"}, timeout=5)
            ok = r.status_code == 200
            self._print(PASS_MARK if ok else FAIL_MARK,
                        "QuestDB /exec SELECT 1",
                        f"HTTP {r.status_code}")
            self._record("questdb", "connect",
                         "PASS" if ok else "FAIL", r.status_code)
        except Exception as exc:
            self._print(FAIL_MARK, "QuestDB /exec", f"连接失败: {exc}")
            self._record("questdb", "connect", "FAIL", str(exc))
            return

        # 方言探针 (R21 教训: 9.x 方言是踩坑重灾区)
        probes = [
            ("SELECT now()", True, "now() 应可用"),
            ("SELECT timestamp_floor('d', now())", True,
             "timestamp_floor 应可用"),
            ("SELECT CURRENT_DATE", False,
             "9.x 不支持 CURRENT_DATE (应报错, 确认兜底生效)"),
            ("DELETE FROM strategies WHERE 1=0", False,
             "9.x 不支持 DELETE (应报错)"),
        ]
        for query, expect_ok, note in probes:
            try:
                r = requests.get(f"{self.qdb_http}/exec",
                                 params={"query": query}, timeout=5)
                actual_ok = r.status_code == 200
                # 期望失败但实际成功, 或期望成功但实际失败
                bad = (expect_ok and not actual_ok) or \
                      (not expect_ok and actual_ok)
                mark = FAIL_MARK if bad else PASS_MARK
                self._print(mark, f"  方言: {query[:40]}",
                            f"HTTP {r.status_code}", note)
                self._record("questdb", f"dialect_{hash(query) % 1000}",
                             "FAIL" if bad else "PASS", note)
            except Exception as exc:
                self._print(WARN_MARK, f"  方言: {query[:40]}",
                            f"异常: {exc}")
                self._record("questdb", "dialect", "WARN", str(exc))

        # 表计数
        tables = ["selection_results", "signal_events", "strategy_runs",
                  "monitor_subscriptions", "sector_snapshots"]
        for t in tables:
            try:
                r = requests.get(f"{self.qdb_http}/exec",
                                 params={"query": f"SELECT count(*) FROM {t}"},
                                 timeout=5)
                if r.status_code == 200:
                    data = r.json()
                    ds = data.get("dataset") or [["?"]]
                    count = ds[0][0] if ds else "?"
                    self._print(PASS_MARK, f"  表 {t}", f"{count} 行")
                    self._record("questdb", f"table_{t}", "PASS", count)
                else:
                    # 表可能不存在 (init_db 未跑)
                    self._print(FAIL_MARK, f"  表 {t}",
                                f"HTTP {r.status_code}",
                                "可能未 init_db, 跑 python scripts/init_db.py")
                    self._record("questdb", f"table_{t}", "FAIL",
                                 f"HTTP {r.status_code}")
            except Exception as exc:
                self._print(WARN_MARK, f"  表 {t}", f"查询失败: {exc}")
                self._record("questdb", f"table_{t}", "WARN", str(exc))

    # ---------- 8. 日志 ----------
    def check_logs(self):
        print("\n" + "=" * 64)
        print("  [8/9] 日志 ERROR/Exception/Traceback 关键行")
        print("=" * 64)
        log_dir = PROJECT_ROOT / "logs"
        if not log_dir.exists():
            self._print(WARN_MARK, "logs/ 目录", "不存在")
            self._record("logs", "log_dir", "WARN", "不存在")
            return

        log_files = sorted(log_dir.glob("*.log")) + \
                    sorted(log_dir.glob("*.txt"))
        if not log_files:
            self._print(WARN_MARK, "日志文件", "无 .log/.txt")
            self._record("logs", "log_files", "WARN", "无")
            return

        keywords = ["ERROR", "Exception", "Traceback",
                    "ExporterError", "RateLimitError"]
        total_errs = 0
        for lf in log_files[-5:]:  # 最近 5 个日志文件
            try:
                with open(lf, encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
                err_lines = [l.strip() for l in lines[-1000:]
                             if any(k in l for k in keywords)
                             and "INFO" not in l[:20]]
                if err_lines:
                    total_errs += len(err_lines)
                    print(f"  {INFO_MARK} {lf.name} "
                          f"({len(err_lines)} 行错误, 末 15 行):")
                    for l in err_lines[-15:]:
                        print(f"      {l[:200]}")
                else:
                    print(f"  {PASS_MARK} {lf.name} (末 1000 行无错误)")
            except Exception as exc:
                self._print(WARN_MARK, f"读 {lf.name}", str(exc))

        if total_errs == 0:
            self._record("logs", "errors", "PASS", "0")
        else:
            self._print(WARN_MARK, "日志错误总数", total_errs)
            self._record("logs", "errors", "WARN", str(total_errs))

    # ---------- 9. 选股冒烟 ----------
    def check_selection(self):
        print("\n" + "=" * 64)
        print("  [9/9] 选股冒烟测试 (POST /api/strategies/dbqzt/run)")
        print("=" * 64)
        import requests
        print(f"  {INFO_MARK} 触发选股 (real 模式约 5-6 分钟, 请耐心等待)...")
        t0 = time.time()
        try:
            r = requests.post(
                f"{self.base_url}/api/strategies/dbqzt/run",
                timeout=900,  # 15 分钟兜底
            )
            elapsed = time.time() - t0
            ok = r.status_code == 200
            self._print(PASS_MARK if ok else FAIL_MARK,
                        "POST /api/strategies/dbqzt/run",
                        f"HTTP {r.status_code} ({elapsed:.1f}s)")
            if ok:
                data = r.json()
                count = data.get("count", 0)
                run_id = data.get("run_id", "")
                self._print(INFO_MARK, "  ok", data.get("ok"))
                self._print(INFO_MARK, "  count", count)
                self._print(INFO_MARK, "  run_id", run_id)
                self._print(INFO_MARK, "  duration",
                            data.get("duration", "?"))

                # 回查落库 (R21 教训3: API count≠落库)
                if run_id:
                    try:
                        r2 = requests.get(
                            f"{self.qdb_http}/exec",
                            params={"query":
                                    f"SELECT count(*) FROM selection_results "
                                    f"WHERE run_id = '{run_id}'"},
                            timeout=5,
                        )
                        if r2.status_code == 200:
                            ds = r2.json().get("dataset") or [["?"]]
                            db_count = ds[0][0] if ds else "?"
                            landed = db_count != "?" and int(db_count) > 0
                            self._print(
                                PASS_MARK if landed else FAIL_MARK,
                                "  落库回查",
                                f"{db_count} 行 (selection_results)",
                                "" if landed
                                else "R21 教训3: API count>0 但落库 0, "
                                     "查 exporters/duckdb_exporter.py "
                                     "timestamp 列",
                            )
                            self._record("selection", "landed",
                                         "PASS" if landed else "FAIL",
                                         f"{db_count} 行")
                        else:
                            self._print(WARN_MARK, "  落库回查",
                                        f"HTTP {r2.status_code}")
                    except Exception as exc:
                        self._print(WARN_MARK, "  落库回查", str(exc))

                self._record("selection", "run",
                             "PASS" if count > 0 else "FAIL",
                             f"count={count}")
            else:
                self._print(FAIL_MARK, "  响应", r.text[:500])
                self._record("selection", "run", "FAIL", r.text[:300])
        except Exception as exc:
            elapsed = time.time() - t0
            self._print(FAIL_MARK, "选股请求",
                        f"失败 ({elapsed:.1f}s): {exc}")
            self._record("selection", "run", "FAIL", str(exc))

    # ---------- 总结 ----------
    def summary(self):
        print("\n" + "=" * 64)
        print("  诊断总结")
        print("=" * 64)
        total = len(self.results)
        passed = sum(1 for r in self.results if r["status"] == "PASS")
        failed = self.fail_count
        warned = self.warn_count
        print(f"  {INFO_MARK} 总检查项: {total}")
        print(f"  {PASS_MARK} PASS: {passed}")
        print(f"  {FAIL_MARK} FAIL: {failed}")
        print(f"  {WARN_MARK} WARN: {warned}")

        if failed > 0:
            print(f"\n  {FAIL_MARK} 失败项:")
            for r in self.results:
                if r["status"] == "FAIL":
                    print(f"      [{r['section']}] {r['name']}: {r['value']}")

        print("\n  " + "=" * 60)
        if failed == 0 and warned == 0:
            print("  全部通过! Real 模式实盘链路健康.")
        elif failed == 0:
            print("  无致命失败, 有警告项需关注.")
        else:
            print("  存在失败项, 请按失败项明细排查.")
            print("  常见排查: 见 docs/QUESTDB9_REALMODE_FIXES.md §六 故障排查")
        print("  " + "=" * 60)

        return 0 if failed == 0 else 1


def main():
    parser = argparse.ArgumentParser(
        description="TdxQuant Real 模式实盘诊断 (R22)")
    parser.add_argument("--run", action="store_true",
                        help="含选股冒烟测试 (~5-6 分钟)")
    parser.add_argument("--section",
                        choices=["env", "config", "ports", "tdx",
                                 "tqcenter", "fastapi", "questdb",
                                 "logs", "selection"],
                        help="仅跑指定段")
    parser.add_argument("--json", action="store_true",
                        help="JSON 输出 (机器可读)")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--qdb-http", default="http://127.0.0.1:9000")
    args = parser.parse_args()

    d = Diagnoser(base_url=args.base_url, qdb_http=args.qdb_http)

    sections = [
        ("env", d.check_env),
        ("config", d.check_config),
        ("ports", d.check_ports),
        ("tdx", d.check_tdx),
        ("tqcenter", d.check_tqcenter),
        ("fastapi", d.check_fastapi),
        ("questdb", d.check_questdb),
        ("logs", d.check_logs),
        ("selection", d.check_selection),
    ]

    if args.section:
        sections = [(n, fn) for n, fn in sections
                    if n == args.section
                    or (args.section == "selection" and args.run)
                    or (n == "selection" and args.run
                        and args.section != "selection")]
        # 如果指定段但 selection 需要 --run
        if args.section == "selection" and not args.run:
            print("  [INFO] selection 段需要 --run 参数才会跑选股")
            return 2
    else:
        # 默认全跑, selection 仅在 --run 时跑
        if not args.run:
            sections = [(n, fn) for n, fn in sections
                        if n != "selection"]

    for _, fn in sections:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            print(f"  {FAIL_MARK} 该段异常: {exc}")

    if args.json:
        print(json.dumps({
            "results": d.results,
            "summary": {
                "total": len(d.results),
                "pass": sum(1 for r in d.results
                            if r["status"] == "PASS"),
                "fail": d.fail_count,
                "warn": d.warn_count,
            },
        }, ensure_ascii=False, indent=2))
        return 0 if d.fail_count == 0 else 1

    return d.summary()


if __name__ == "__main__":
    sys.exit(main())
