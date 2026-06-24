#!/usr/bin/env python3
"""TdxQuant 稳定性巡检（可复用 / 只读 / 无副作用）。

对**运行中**的 TdxQuant 各业务线做冒烟与健康检查：

  - service : FastAPI 引擎 / QuestDB / Next.js 前端 / 通达信终端 进程与端口
  - api     : 覆盖全部 16 个业务路由的代表性 GET 端点
  - config  : 全局配置 / 推送通道 / match 策略 热加载态

全程只读，可随时安全复跑，适合作为日常稳定性巡检。
选股真跑（有副作用，会临时改 strategy YAML 的 include_only）不在此脚本，
由独立流程执行（见 memory: selection-whitelist-scoping）。

用法
----
    python scripts/stability_check.py                  # 全量只读巡检
    python scripts/stability_check.py --section api    # 仅 API 路由冒烟
    python scripts/stability_check.py --json           # JSON 输出（机器可读）
    python scripts/stability_check.py --base-url http://127.0.0.1:8000

退出码: 0 = 全部 PASS / 1 = 存在 FAIL / 2 = 脚本自身错误（如缺依赖）
"""
from __future__ import annotations

import argparse
import json
import platform
import re
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

# Windows 控制台默认 GBK，强制 stdout/stderr UTF-8，避免中文/符号编码崩溃
# （precheck.py 未做此处理，直接命令行调用会因 emoji 崩，此处修复）
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

try:
    import requests
except ImportError:  # pragma: no cover
    print("[ERROR] 缺少 requests，请 pip install requests", file=sys.stderr)
    sys.exit(2)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
IS_WINDOWS = platform.system() == "Windows"

PASS, FAIL, WARN, SKIP = "PASS", "FAIL", "WARN", "SKIP"

# ----------------------------------------------------------------------------
# 业务线 -> 代表性 GET 端点（覆盖 main.py 注册的全部 16 个路由模块）
# ----------------------------------------------------------------------------
API_ENDPOINTS: list[tuple[str, str]] = [
    ("/health", "health 根健康"),
    ("/", "root 根路径"),
    ("/api/strategies", "strategies 策略列表"),
    ("/api/strategies/dbqzt", "strategies 单策略详情"),
    ("/api/strategies/dbqzt/runs", "strategies 历史 run"),
    ("/api/selections", "selection 选股结果列表"),
    ("/api/monitor/status", "monitor 引擎状态"),
    ("/api/monitor/health", "monitor 健康度"),
    ("/api/monitor/subscriptions", "monitor 订阅列表"),
    ("/api/monitor/rules", "monitor 预警模板"),
    ("/api/monitor/flow-ranking", "monitor 资金流排名"),
    ("/api/monitor/auction?codes=600519.SH,000858.SZ", "monitor 竞价评分"),
    ("/api/monitor/quotes?count=6", "monitor 实时行情"),
    ("/api/monitor/match-strategies", "match_strategy match 列表"),
    ("/api/monitor/watchlist", "watchlist 自选股"),
    ("/api/monitor/sector-heatmap", "sector_heatmap 板块热度"),
    ("/api/sectors", "sectors 板块列表"),
    ("/api/signals", "signals 信号列表"),
    ("/api/signals/stats", "signals 信号统计"),
    ("/api/config", "config 全局配置摘要"),
    ("/api/config/strategies", "config 策略文件清单"),
    ("/api/theme", "theme 主题"),
    ("/api/channels", "channels 推送通道"),
    ("/api/backtest/history", "backtest 回测历史"),
    ("/api/backtest/leaderboard", "backtest 回测榜单"),
    ("/api/search?q=%E6%B6%A8%E5%81%9C", "search 搜索(涨停)"),
    ("/api/stocks/600519.SH/sectors", "stocks 个股板块归属"),
]


# ----------------------------------------------------------------------------
# 配置读取（端口等从 config/app.yaml 取，避免硬编码）
# ----------------------------------------------------------------------------
def _read_app_yaml() -> dict[str, Any]:
    cfg_path = PROJECT_ROOT / "config" / "app.yaml"
    if not cfg_path.exists():
        return {}
    text = cfg_path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore[import-untyped]

        data = yaml.safe_load(text) or {}
        return data if isinstance(data, dict) else {}
    except ImportError:
        # 降级：正则取关键端口
        out: dict[str, Any] = {"server": {}, "questdb": {}}
        m = re.search(r"port:\s*(\d+)", text.split("server:", 1)[-1].split("paths:", 1)[0])
        if m:
            out["server"]["port"] = int(m.group(1))
        return out


def _cfg(data: dict[str, Any], dotted: str, default: Any) -> Any:
    cur: Any = data
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


# ----------------------------------------------------------------------------
# 探测原语
# ----------------------------------------------------------------------------
def http_get(url: str, timeout: float = 10.0) -> tuple[str, int, float, str, Any]:
    """GET 一个 URL，返回 (status, http_code, ms, detail, json_or_none)。"""
    t0 = time.time()
    try:
        r = requests.get(url, timeout=timeout)
    except requests.ConnectionError:
        return FAIL, 0, 0.0, "连接失败（服务未启动？）", None
    except requests.Timeout:
        return WARN, 0, (time.time() - t0) * 1000, f"超时(>{timeout:g}s)", None
    except Exception as exc:  # noqa: BLE001
        return FAIL, 0, 0.0, f"异常 {type(exc).__name__}: {exc}", None
    ms = (time.time() - t0) * 1000
    code = r.status_code
    parsed: Any = None
    try:
        parsed = r.json()
    except Exception:  # noqa: BLE001
        parsed = None
    if 200 <= code < 300:
        return PASS, code, ms, "", parsed
    if code in (422,):
        return WARN, code, ms, "422 参数语义（端点存活）", parsed
    if code == 429:
        return WARN, code, ms, "429 被限流（端点存活）", parsed
    if code == 404:
        return FAIL, code, ms, "404 端点不存在/路径变更", parsed
    if code >= 500:
        return FAIL, code, ms, f"{code} 服务端错误", parsed
    return WARN, code, ms, f"HTTP {code}", parsed


def tcp_reachable(host: str, port: int, timeout: float = 2.0) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _proc_running(name: str) -> bool:
    """Windows: tasklist 查进程是否在跑。非 Windows 返回 False（调用方自行降级）。"""
    if not IS_WINDOWS:
        return False
    try:
        r = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {name}", "/NH"],
            capture_output=True, text=True, timeout=8,
        )
        return name.lower() in (r.stdout or "").lower()
    except Exception:  # noqa: BLE001
        return False


# ----------------------------------------------------------------------------
# 各 section 检查
# ----------------------------------------------------------------------------
def check_service(base_url: str, fe_url: str, qdb_http: str, qdb_pg: tuple[str, int]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    # 引擎 /health —— 进一步验证 body.status == ok
    st, code, ms, detail, body = http_get(f"{base_url}/health")
    extra = ""
    if st == PASS and isinstance(body, dict):
        extra = f"status={body.get('status')} uptime={body.get('uptime_seconds', '?')}s"
        if body.get("status") != "ok":
            st, detail = WARN, "health 返回但 status 非 ok"
    out.append(_row("service", "FastAPI 引擎 /health", st, code, ms, detail or extra))

    # QuestDB HTTP Web 控制台 —— 仅观测面；业务读写走 PG wire，Web UI 响应慢不致命
    from urllib.parse import urlparse

    _u = urlparse(qdb_http)
    _web_host = _u.hostname or "127.0.0.1"
    _web_port = _u.port or 9000
    qdb_web_port_open = tcp_reachable(_web_host, _web_port, timeout=3)
    st, code, ms, detail, _ = http_get(qdb_http, timeout=15)
    if st == PASS:
        note = f"HTTP {code} {ms:.0f}ms"
        if ms > 3000:
            note += "（Web UI 偏慢；业务走 PG wire 不受影响）"
        out.append(_row("service", "QuestDB Web 控制台 :9000", PASS, code, ms, note))
    elif qdb_web_port_open:
        out.append(_row("service", "QuestDB Web 控制台 :9000", WARN, code, ms,
                        f"HTTP 探测 {detail}；端口可达，业务走 PG wire 不受影响"))
    else:
        out.append(_row("service", "QuestDB Web 控制台 :9000", FAIL, code, ms, detail))
    # QuestDB PG wire（psycopg2 连接端口，业务实际依赖）
    ok = tcp_reachable(*qdb_pg)
    out.append(_row("service", "QuestDB PG wire :8812", PASS if ok else FAIL, 0, 0, "可达" if ok else "不可达"))

    # 前端
    st, code, ms, detail, _ = http_get(fe_url, timeout=8)
    out.append(_row("service", "Next.js 前端 :3000", st, code, ms, detail))

    # 通达信终端进程（real 模式硬依赖）
    if IS_WINDOWS:
        running = _proc_running("tdxw.exe")
        out.append(_row("service", "通达信终端 tdxw.exe",
                        PASS if running else WARN, 0, 0,
                        "进程在运行" if running else "未检测到（real 模式必需）"))
    else:
        out.append(_row("service", "通达信终端 tdxw.exe", SKIP, 0, 0, "非 Windows，跳过"))
    return out


def check_api(base_url: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for path, label in API_ENDPOINTS:
        st, code, ms, detail, _ = http_get(f"{base_url}{path}")
        out.append(_row("api", f"{label}  [{path}]", st, code, ms, detail))
    return out


def check_config(base_url: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    # adapter_mode
    st, code, ms, detail, body = http_get(f"{base_url}/api/config")
    mode = ""
    if isinstance(body, dict):
        mode = str(body.get("adapter_mode") or body.get("app", {}).get("adapter_mode") or "")
    out.append(_row("config", f"全局配置 /api/config  (adapter_mode={mode or '?'})", st, code, ms, detail))

    # channels —— 统计启用数
    st, code, ms, detail, body = http_get(f"{base_url}/api/channels")
    ch_note = ""
    if isinstance(body, dict):
        items = body.get("channels") or []
        if isinstance(items, list):
            enabled = sum(1 for c in items if c.get("enabled"))
            ch_note = f"启用 {enabled}/{len(items)}"
    out.append(_row("config", f"推送通道 /api/channels  ({ch_note})", st, code, ms, detail))

    # match strategies
    st, code, ms, detail, body = http_get(f"{base_url}/api/monitor/match-strategies")
    m_note = ""
    if isinstance(body, dict):
        ms_list = body.get("match_strategies") or body.get("items") or []
        if isinstance(ms_list, list):
            m_note = f"{len(ms_list)} 套"
    out.append(_row("config", f"match 策略 /api/monitor/match-strategies  ({m_note})", st, code, ms, detail))
    return out


# ----------------------------------------------------------------------------
# 报告
# ----------------------------------------------------------------------------
def _row(section: str, name: str, status: str, code: int, ms: float, detail: str) -> dict[str, Any]:
    return {
        "section": section, "name": name, "status": status,
        "http_code": code, "latency_ms": round(ms, 1), "detail": detail,
    }


_TAG = {PASS: "[PASS]", FAIL: "[FAIL]", WARN: "[WARN]", SKIP: "[SKIP]"}


def _print_report(results: list[dict[str, Any]]) -> None:
    cur_section = ""
    for r in results:
        if r["section"] != cur_section:
            cur_section = r["section"]
            print(f"\n=== {cur_section} ===")
        tag = _TAG[r["status"]]
        lat = f"{r['latency_ms']:.0f}ms" if r["latency_ms"] else "-"
        code = r["http_code"] or "-"
        print(f"  {tag} {r['name']}  <{code} {lat}> {r['detail']}".rstrip())


def _summary(results: list[dict[str, Any]]) -> dict[str, int]:
    counts = {s: sum(1 for r in results if r["status"] == s) for s in (PASS, FAIL, WARN, SKIP)}
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description="TdxQuant 稳定性巡检（只读）")
    parser.add_argument("--section", choices=["service", "api", "config", "all"], default="all")
    parser.add_argument("--base-url", default=None, help="引擎基地址（默认读 config/app.yaml server.port）")
    parser.add_argument("--json", action="store_true", help="JSON 输出")
    args = parser.parse_args()

    cfg = _read_app_yaml()
    be_port = int(args.base_url.split(":")[-1]) if args.base_url else int(_cfg(cfg, "server.port", 8000))
    base_url = args.base_url or f"http://127.0.0.1:{be_port}"
    qdb_host = str(_cfg(cfg, "questdb.host", "127.0.0.1"))
    qdb_http_port = int(_cfg(cfg, "questdb.http_port", 9000))
    qdb_pg_port = int(_cfg(cfg, "questdb.pg_port", 8812))
    qdb_http = f"http://{qdb_host}:{qdb_http_port}"
    fe_url = "http://127.0.0.1:3000"

    sections = ["service", "api", "config"] if args.section == "all" else [args.section]
    results: list[dict[str, Any]] = []
    for sec in sections:
        if sec == "service":
            results += check_service(base_url, fe_url, qdb_http, (qdb_host, qdb_pg_port))
        elif sec == "api":
            results += check_api(base_url)
        elif sec == "config":
            results += check_config(base_url)

    meta = {
        "base_url": base_url,
        "questdb": f"{qdb_host}:{qdb_pg_port}(pg)/{qdb_http_port}(http)",
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "summary": _summary(results),
    }

    if args.json:
        print(json.dumps({"meta": meta, "results": results}, ensure_ascii=False, indent=2))
    else:
        print(f"\nTdxQuant 稳定性巡检  |  {meta['time']}  |  engine={base_url}")
        _print_report(results)
        c = meta["summary"]
        print("\n" + "-" * 60)
        verdict = "READY ✅" if c[FAIL] == 0 else "HAS FAILURES ❌"
        print(f"  PASS {c[PASS]} / FAIL {c[FAIL]} / WARN {c[WARN]} / SKIP {c[SKIP]}  →  {verdict}")

    return 1 if meta["summary"][FAIL] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
