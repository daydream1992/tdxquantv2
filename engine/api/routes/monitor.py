"""``/api/monitor`` 路由 - 监控状态与实时行情快照。

- ``GET /api/monitor/status``        - 监控状态（监控股票数/今日信号/订阅/心跳）
- ``GET /api/monitor/quotes``        - 实时行情快照（前 N 只订阅股票的价量 + 资金流字段 + 竞价涨幅）
- ``GET /api/monitor/auction``       - 批量竞价查询 + 强弱评分 (R13-2a)
- ``GET /api/monitor/flow-ranking``  - 资金流向排行 (按 main_inflow / big_buy_ratio / turnover_rate 排序)
- ``GET /api/monitor/subscriptions`` - 当前订阅列表
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query

from engine.api.deps import get_adapter, get_config, get_state, get_storage
from engine.api.schemas import (
    FlowRankingItem,
    MonitorStatusResponse,
    MonitorSubscriptionItem,
    QuoteSnapshot,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["monitor"])


@router.get(
    "/status",
    response_model=MonitorStatusResponse,
    summary="监控状态",
)
async def get_status(
    cfg: Any = Depends(get_config),
    state: Any = Depends(get_state),
    storage: Any = Depends(get_storage),
) -> MonitorStatusResponse:
    """返回引擎运行时状态。

    - ``adapter_mode`` 来自 ``app.adapter_mode``
    - ``monitored_count`` 优先用 EngineState 内存计数；为 0 时从 monitor_subscriptions 表查
    - 信号计数优先用 EngineState 内存计数；为 0 时从 signal_events 表查今日数据
      （这样 FastAPI 重启后 Web 端仍能看到真实计数）
    """
    state.heartbeat()
    counts = state.today_signal_counts()

    today_signals = counts["today_signals"]
    today_limit_up = counts["today_limit_up"]
    today_alerts = counts["today_alerts"]
    monitored_count = state.monitored_count()

    # 内存计数为 0 时，从 DuckDB 兜底（处理 FastAPI 重启场景）
    if storage is not None and hasattr(storage, "table_exists"):
        try:
            # 今日信号总数（按 triggered_at 当天过滤）
            if storage.table_exists("signal_events"):
                row = storage.fetchone(
                    "SELECT COUNT(*) FROM signal_events "
                    "WHERE triggered_at >= CURRENT_DATE"
                )
                if row and row[0] and int(row[0]) > today_signals:
                    today_signals = int(row[0])

                # 涨停信号
                row = storage.fetchone(
                    "SELECT COUNT(*) FROM signal_events "
                    "WHERE alert_type = 'limit_up' AND triggered_at >= CURRENT_DATE"
                )
                if row and row[0] and int(row[0]) > today_limit_up:
                    today_limit_up = int(row[0])

                # 异常告警（drop_alert + breakout）
                row = storage.fetchone(
                    "SELECT COUNT(*) FROM signal_events "
                    "WHERE alert_type IN ('drop_alert', 'breakout') "
                    "AND triggered_at >= CURRENT_DATE"
                )
                if row and row[0] and int(row[0]) > today_alerts:
                    today_alerts = int(row[0])

            # 监控订阅数（active=true 的去重 stock_code）
            if storage.table_exists("monitor_subscriptions") and monitored_count == 0:
                row = storage.fetchone(
                    "SELECT COUNT(DISTINCT stock_code) FROM monitor_subscriptions "
                    "WHERE active = true"
                )
                if row and row[0]:
                    monitored_count = int(row[0])
        except Exception as exc:  # noqa: BLE001
            logger.warning("从 DuckDB 兜底查询信号/订阅计数失败: %s", exc)

    return MonitorStatusResponse(
        engine_status="running",
        adapter_mode=str(cfg.get("app.adapter_mode", "mock")),
        monitored_count=monitored_count,
        today_signals=today_signals,
        today_limit_up=today_limit_up,
        today_alerts=today_alerts,
        uptime_seconds=state.uptime_seconds(),
        last_hb=state.last_hb,
    )


@router.get(
    "/quotes",
    response_model=list[QuoteSnapshot],
    summary="实时行情快照",
)
async def get_quotes(
    adapter: Any = Depends(get_adapter),
    state: Any = Depends(get_state),
    storage: Any = Depends(get_storage),
    count: int = Query(12, ge=1, le=200),
) -> list[QuoteSnapshot]:
    """返回订阅列表前 N 只股票的价量快照。

    适配器为 Mock 时，从 V8 快照 CSV 取静态数据；Real 模式调用
    ``tq.get_pricevol`` 实时数据。

    若订阅列表为空（首次启动），自动从 ``selection_results`` 表取最近一次
    选股结果的 Top N 作为兜底，保证 Web 大屏始终有数据可看。

    R7-A: 同时返回资金流字段 ``main_inflow`` / ``big_buy_ratio`` / ``turnover_rate``,
    从 ``adapter.get_more_info(code)`` 提取 ``Zjl`` / ``TotalBVol/TotalSVol`` / ``fHSL``,
    字段缺失时用确定性 mock (基于 code hash)。
    """
    subs = state.list_subscriptions()
    codes: list[str] = [s["stock_code"] for s in subs][:count]

    # 兜底：从最近 selection_results 取 Top N 注入订阅（持久化）
    if not codes:
        codes = _fallback_top_picks(storage, state, count)
    out: list[QuoteSnapshot] = []
    now_ms = int(time.time() * 1000)

    # 预取 more_info (含资金流字段) - 失败不阻断主流程
    more_info_map: dict[str, dict] = _batch_more_info(adapter, codes)

    try:
        # 优先调批量 pricevol
        pv = adapter.get_pricevol(codes) if hasattr(adapter, "get_pricevol") else {}
        if pv and isinstance(pv, dict):
            for code in codes:
                fields = pv.get(code) or {}
                last = _safe_float(fields.get("Now")) or _safe_float(fields.get("last")) or 0.0
                last_close = _safe_float(fields.get("LastClose")) or _safe_float(fields.get("last_close")) or 0.0
                pct = _safe_float(fields.get("pct_change")) or (last / last_close - 1 if last_close else 0.0)
                main_inflow, big_buy_ratio, turnover_rate = _extract_flow_fields(
                    code, more_info_map.get(code) or fields.get("_raw") or {}
                )
                # R13-2b: auction_pct 从 VOpenZAF 取 (小数形式, 0.0523 = 5.23%)
                auction_pct = _extract_auction_pct_fraction(
                    more_info_map.get(code) or fields.get("_raw") or {}
                )
                out.append(
                    QuoteSnapshot(
                        code=code,
                        name=str(fields.get("name", "")),
                        last=last,
                        pct=pct,
                        change=round(last - last_close, 4) if last_close else 0.0,
                        volume=_safe_float(fields.get("Volume")) or 0.0,
                        amount=_safe_float(fields.get("Amount")) or 0.0,
                        ts=now_ms,
                        main_inflow=main_inflow,
                        big_buy_ratio=big_buy_ratio,
                        turnover_rate=turnover_rate,
                        auction_pct=auction_pct,
                    )
                )
            return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_pricevol 批量失败，回退单只: %s", exc)

    # 兜底：单只 get_market_snapshot
    for code in codes:
        try:
            snap = adapter.get_market_snapshot(code)
            last = _safe_float(snap.get("Now")) or 0.0
            last_close = _safe_float(snap.get("LastClose")) or 0.0
            pct = (last / last_close - 1) if last_close else 0.0
            main_inflow, big_buy_ratio, turnover_rate = _extract_flow_fields(
                code, more_info_map.get(code) or snap
            )
            # R13-2b: auction_pct 从 VOpenZAF 取 (小数形式, 0.0523 = 5.23%)
            auction_pct = _extract_auction_pct_fraction(
                more_info_map.get(code) or snap
            )
            out.append(
                QuoteSnapshot(
                    code=code,
                    name=str(snap.get("name", "")),
                    last=last,
                    pct=pct,
                    change=round(last - last_close, 4) if last_close else 0.0,
                    volume=_safe_float(snap.get("Volume")) or 0.0,
                    amount=_safe_float(snap.get("Amount")) or 0.0,
                    ts=now_ms,
                    main_inflow=main_inflow,
                    big_buy_ratio=big_buy_ratio,
                    turnover_rate=turnover_rate,
                    auction_pct=auction_pct,
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("get_market_snapshot(%s) 失败: %s", code, exc)
    return out


@router.get(
    "/flow-ranking",
    response_model=list[FlowRankingItem],
    summary="资金流向排行",
)
async def get_flow_ranking(
    adapter: Any = Depends(get_adapter),
    state: Any = Depends(get_state),
    storage: Any = Depends(get_storage),
    count: int = Query(50, ge=1, le=200, description="取样股票数"),
    metric: str = Query(
        "main_inflow",
        pattern="^(main_inflow|big_buy_ratio|turnover_rate)$",
        description="排序指标",
    ),
) -> list[FlowRankingItem]:
    """返回按指定指标排序的资金流向排行 (Top N, 默认 5)。

    - ``main_inflow``: 主力净流入 Top 5 (万元, 从 Zjl 提取)
    - ``big_buy_ratio``: 大买占比 Top 5 (0~1, TotalBVol/(TotalBVol+TotalSVol))
    - ``turnover_rate``: 换手率 Top 5 (%, 从 fHSL 提取)

    实现: 复用 ``get_quotes`` 逻辑取 count 只股票快照 (含新字段),
    按 metric 降序排序后返回前 5 条。
    """
    # 取 count 只股票快照 (含资金流字段)
    snapshots = await get_quotes(adapter=adapter, state=state, storage=storage, count=count)
    if not snapshots:
        return []

    # 按 metric 降序排序
    sorted_snaps = sorted(
        snapshots,
        key=lambda s: getattr(s, metric) or 0.0,
        reverse=True,
    )

    # 返回前 5 条, 转换为 FlowRankingItem
    out: list[FlowRankingItem] = []
    for s in sorted_snaps[:5]:
        out.append(
            FlowRankingItem(
                code=s.code,
                name=s.name,
                last=s.last,
                pct=s.pct,
                main_inflow=s.main_inflow,
                big_buy_ratio=s.big_buy_ratio,
                turnover_rate=s.turnover_rate,
                amount=s.amount,
            )
        )
    return out


@router.get(
    "/auction",
    summary="批量竞价查询 + 强弱评分 (R13-2a)",
)
async def get_auction(
    codes: str | None = Query(
        None, description="逗号分隔股票代码 (如 600519.SH,000858.SZ); 不传则用监控池"
    ),
    count: int = Query(50, ge=1, le=200, description="codes 不传时取监控池前 N 只 (按 batch_no 倒序)"),
    state: Any = Depends(get_state),
    adapter: Any = Depends(get_adapter),
    cfg: Any = Depends(get_config),
) -> dict[str, Any]:
    """批量查询竞价数据 + 输出竞价强弱评分 (0-100)。

    数据来源: ``adapter.get_more_info(code)`` 返回的竞价字段
    (``VOpenZAF`` / ``OpenZTBuy`` / ``OpenAmo`` / ``OpenAmoPre1`` /
    ``OpenVolPre1`` / ``L2OrderNum`` / ``L2TicNum``)。

    评分公式 (0-100, 越高竞价越强):
    - ``surge``     : 竞价涨幅, 10% 封顶 40 分 (``auction_pct / 10 * 40``, cap 40)
    - ``zt_flag``   : 有竞价涨停买单 (``OpenZTBuy > 0``) +20 分
    - ``vol_ratio`` : 量比同比 (今日开盘金额 / 昨开盘金额), 1 倍 = 30 分, 封顶 30
    - ``l2``        : L2 委托数 (``L2OrderNum / 100``), 1000 单封顶 10 分

    **字段约定**: ``auction_pct`` 为**百分比形式** (5.23 = 5.23%, 即原始 ``VOpenZAF``),
    与 ``/quotes`` 端点的 ``auction_pct`` (小数形式 0.0523) 不同 —— 本端点为竞价专项展示,
    用百分比便于前端直接显示; ``/quotes`` 沿用 ``pct`` 字段的小数形式以保持响应内一致。

    **单位说明**:
    - ``auction_amount`` (万元) = ``OpenAmo`` / 10000 (V8 中 OpenAmo 单位为元)
    - ``open_amount_pre`` (万元) = ``OpenAmoPre1`` (V8 中已是万元)
    - ``auction_zt_buy`` (万元) = ``OpenZTBuy``
    - ``open_vol_pre`` (手) = ``OpenVolPre1``
    - ``l2_order_num`` / ``l2_tic_num`` : 整数

    排序: 按 ``auction_score`` 降序。

    ``in_auction_hours``: Mock 模式强制 ``True`` (沙箱友好); Real 模式严格判断 9:15-9:25。
    """
    # 1. 取股票列表
    if codes:
        code_list: list[str] = [c.strip() for c in codes.split(",") if c.strip()]
    else:
        subs = state.list_subscriptions()
        # 按 batch_no 倒序, 取前 count 只
        sorted_subs = sorted(
            subs, key=lambda s: int(s.get("batch_no", 0) or 0), reverse=True
        )
        code_list = [s["stock_code"] for s in sorted_subs[:count]]

    in_auction = _in_auction_hours(cfg)

    if not code_list:
        return {"items": [], "count": 0, "in_auction_hours": in_auction}

    # 2. 批量取 more_info (复用现有 _batch_more_info helper)
    more_info_map = _batch_more_info(adapter, code_list)

    # 3. 提取竞价字段 + 算分
    fetched_at = datetime.now().astimezone().isoformat(timespec="seconds")
    items: list[dict[str, Any]] = []
    for code in code_list:
        info = more_info_map.get(code) or {}
        fields = _extract_auction_fields(info)
        items.append(
            {
                "stock_code": code,
                **fields,
                "fetched_at": fetched_at,
            }
        )

    # 4. 按 auction_score 降序
    items.sort(key=lambda x: x.get("auction_score", 0.0), reverse=True)

    return {
        "items": items,
        "count": len(items),
        "in_auction_hours": in_auction,
    }


@router.get(
    "/rules",
    summary="列出所有 alert_templates（供前端下拉）",
)
async def list_alert_templates(
    cfg: Any = Depends(get_config),
) -> dict[str, Any]:
    """列出 ``monitor_rules.yaml`` 的 ``alert_templates`` 段，供前端编辑 match 策略时下拉选择。

    返回每个模板的:
    - ``alert_type``      - 模板 ID（全局唯一，编辑 alert 时填入 alerts[].alert_type）
    - ``label``           - 中文标签（如"涨停"）
    - ``emoji``           - 前端展示用的 emoji（如 🚀）
    - ``description``     - 一句话说明
    - ``condition``       - 表达式引擎求值模板（含 ``{param}`` 占位符）
    - ``default_params``  - 默认参数 dict（前端选中模板时自动填入 alerts[].params）
    - ``priority``        - high / medium / low
    - ``channels``        - 推送通道列表

    数据源: ``ConfigLoader().get("alert_templates")``。
    配置缺失时返回空列表（保证向后兼容）。
    """
    raw = cfg.get("alert_templates") or {}
    templates: list[dict[str, Any]] = []
    if isinstance(raw, dict):
        # monitor_rules.yaml 中 alert_templates 是 mapping: { template_id: { ... } }
        # 保留声明顺序（Python 3.7+ dict 顺序 = 插入顺序 = YAML 顺序）
        for tpl_id, body in raw.items():
            if not isinstance(body, dict):
                continue
            templates.append(
                {
                    "alert_type": str(body.get("alert_type") or tpl_id),
                    "label": str(body.get("label") or ""),
                    "emoji": str(body.get("emoji") or ""),
                    "description": str(body.get("description") or ""),
                    "condition": str(body.get("condition") or ""),
                    "default_params": dict(body.get("default_params") or {}),
                    "priority": str(body.get("priority") or "medium"),
                    "channels": list(body.get("channels") or []),
                }
            )
    elif isinstance(raw, list):
        # 兼容写法（数组形式）：原样映射
        for body in raw:
            if not isinstance(body, dict):
                continue
            templates.append(
                {
                    "alert_type": str(body.get("alert_type") or ""),
                    "label": str(body.get("label") or ""),
                    "emoji": str(body.get("emoji") or ""),
                    "description": str(body.get("description") or ""),
                    "condition": str(body.get("condition") or ""),
                    "default_params": dict(body.get("default_params") or {}),
                    "priority": str(body.get("priority") or "medium"),
                    "channels": list(body.get("channels") or []),
                }
            )
    return {"templates": templates, "count": len(templates)}


@router.get(
    "/subscriptions",
    response_model=list[MonitorSubscriptionItem],
    summary="当前订阅列表",
)
async def list_subscriptions(
    state: Any = Depends(get_state),
) -> list[MonitorSubscriptionItem]:
    """列出 ``EngineState`` 中缓存的所有活跃订阅。"""
    subs = state.list_subscriptions()
    return [
        MonitorSubscriptionItem(
            strategy_id=s.get("strategy_id", ""),
            stock_code=s.get("stock_code", ""),
            subscriber=s.get("subscriber", ""),
            subscribed_at=s.get("subscribed_at", ""),
            active=bool(s.get("active", True)),
            batch_no=int(s.get("batch_no", 0) or 0),
        )
        for s in subs
    ]


# ============================================================================
# P1: 健康度监控 (R10-5)
# ============================================================================


@router.get(
    "/health",
    summary="引擎健康度（P1）",
)
async def get_health(
    cfg: Any = Depends(get_config),
    state: Any = Depends(get_state),
) -> dict[str, Any]:
    """返回引擎健康度指标。

    包含:
    - subscribe_alive: subscribe_hq 是否存活
    - quote_lag_seconds: 最近一次行情距现在的秒数 (-1=从未收到)
    - eval_count: 求值次数
    - error_count: 错误次数
    - last_error: 最近一次错误信息
    - debounce_size: 防抖表大小
    - queue_size: 聚合推送队列大小
    - uptime_seconds: 运行时长
    - status: healthy / degraded / unhealthy
      (基于 lag + error_count 判定, 阈值来自 monitor.health.*, 缺省 60/120/10)

    P2-2: 阈值改为读 config/monitor_rules.yaml 的 monitor.health 段,
          配置缺失时回退默认值 (60/120/10) 保证向后兼容。
    """
    from engine.monitor.engine import MonitorEngine

    eng = MonitorEngine()
    health = eng.health()

    # 补充聚合推送队列状态
    health["queue_size"] = len(getattr(eng, "_agg_queue", {}))
    health["uptime_seconds"] = state.uptime_seconds()

    # P2-2: 健康度阈值从 config 读（缺省 60/120/10 保证向后兼容）
    lag_healthy = float(cfg.get("monitor.health.lag_healthy_seconds", 60))
    lag_degraded = float(cfg.get("monitor.health.lag_degraded_seconds", 120))
    err_healthy = int(cfg.get("monitor.health.error_healthy_threshold", 10))

    # 综合状态判定
    lag = health.get("quote_lag_seconds", -1)
    err_count = health.get("error_count", 0)
    if lag < 0 or lag > lag_degraded:
        status = "unhealthy"
    elif err_count > err_healthy or lag > lag_healthy:
        status = "degraded"
    else:
        status = "healthy"
    health["status"] = status
    # 透出当前生效的阈值（便于前端展示 + 调参验证）
    health["thresholds"] = {
        "lag_healthy_seconds": lag_healthy,
        "lag_degraded_seconds": lag_degraded,
        "error_healthy_threshold": err_healthy,
    }

    # R14-2: 透出 API 限流统计（展开到顶层 + rate_limit 子对象）
    try:
        stats = state.api_stats()
        # 展开顶层（api_call_total / api_rejected_total / api_avg_latency_ms /
        # tqcenter_call_total / tqcenter_rejected_total）
        for k, v in stats.items():
            if k in ("tqcenter_limiter", "api_middleware"):
                continue
            health[k] = v
        health["rate_limit"] = {
            "tqcenter_limiter": stats.get("tqcenter_limiter", {"enabled": False}),
            "api_middleware": stats.get("api_middleware", {"enabled": False, "rules_count": 0}),
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("api_stats 透出失败: %s", exc)
        health["rate_limit"] = {
            "tqcenter_limiter": {"enabled": False},
            "api_middleware": {"enabled": False, "rules_count": 0},
        }

    return health


# ============================================================================
# 内部
# ============================================================================


def _safe_float(v: Any) -> float:
    if v is None or v == "":
        return 0.0
    try:
        f = float(v)
        if f != f:  # NaN
            return 0.0
        return f
    except (TypeError, ValueError):
        return 0.0


def _batch_more_info(adapter: Any, codes: list[str]) -> dict[str, dict]:
    """批量调 ``adapter.get_more_info(code)`` 取资金流字段。

    - 若 adapter 不支持 ``get_more_info``, 返回空 dict (上层用确定性 mock 兜底)
    - 单只失败不影响其他, 整体失败返回空 dict
    """
    if not hasattr(adapter, "get_more_info"):
        return {}
    out: dict[str, dict] = {}
    for code in codes:
        try:
            info = adapter.get_more_info(code) or {}
            if isinstance(info, dict):
                out[code] = info
        except Exception as exc:  # noqa: BLE001
            logger.debug("get_more_info(%s) 失败: %s", code, exc)
    return out


def _extract_flow_fields(code: str, info: dict) -> tuple[float, float, float]:
    """从 more_info dict 提取 (main_inflow, big_buy_ratio, turnover_rate)。

    字段来源 (V8 快照 / RealAdapter tq.get_more_info):
    - ``Zjl``: 主力净流入 (元, 需转万元) — 注意: V8 CSV 中 Zjl 单位为"万元",
      故直接使用; RealAdapter 通常也是元, 这里统一假定为"万元"输出
    - ``TotalBVol``: 总买量 (手), ``TotalSVol``: 总卖量 (手)
    - ``fHSL``: 换手率% (已经是百分数)

    字段缺失时用基于 code hash 的确定性 mock:
    - main_inflow: -5000 ~ +10000 万元
    - big_buy_ratio: 0.20 ~ 0.60
    - turnover_rate: 0.5 ~ 10.0 %
    """
    # Zjl - 主力净流入 (万元)
    main_inflow = _safe_float(info.get("Zjl"))
    if main_inflow == 0.0:
        main_inflow = _deterministic_hash_float(code, salt="inflow", lo=-5000.0, hi=10000.0)

    # big_buy_ratio = TotalBVol / (TotalBVol + TotalSVol)
    total_b = _safe_float(info.get("TotalBVol"))
    total_s = _safe_float(info.get("TotalSVol"))
    denom = total_b + total_s
    if denom > 0:
        big_buy_ratio = max(0.0, min(1.0, total_b / denom))
    else:
        big_buy_ratio = _deterministic_hash_float(code, salt="bigbuy", lo=0.20, hi=0.60)

    # turnover_rate from fHSL (already in %)
    turnover_rate = _safe_float(info.get("fHSL"))
    if turnover_rate == 0.0:
        turnover_rate = _deterministic_hash_float(code, salt="hsl", lo=0.5, hi=10.0)

    return round(main_inflow, 2), round(big_buy_ratio, 4), round(turnover_rate, 3)


# ----------------------------------------------------------------------------
# R13-2a/2b: 竞价字段提取 + 评分
# ----------------------------------------------------------------------------


def _extract_auction_pct_fraction(info: dict) -> float:
    """从 more_info dict 提取 ``auction_pct`` (小数形式, 0.0523 = 5.23%)。

    用于 ``/quotes`` 端点 (与 ``pct`` 字段同为小数形式, 保持响应内一致)。

    - 数据源: ``VOpenZAF`` (V8 字段, 5.23 表示 5.23%)
    - 转换: ``VOpenZAF / 100`` → 0.0523
    - 缺失/非法值返回 0.0 (不要 None, 前端好处理)

    与 :func:`engine.monitor.engine._normalize_snap` 中的 auction_pct 计算逻辑一致,
    便于 ``/quotes`` 响应与监控引擎内部求值保持同样的语义。
    """
    vopen = _safe_float(info.get("VOpenZAF"))
    return round(vopen / 100.0, 6)


def _extract_auction_fields(info: dict) -> dict[str, Any]:
    """从 more_info dict 提取竞价字段 + 计算 ``auction_score`` (供 ``/auction`` 端点)。

    **重要**: 本函数返回的 ``auction_pct`` 为**百分比形式** (5.23 = 5.23%,
    即原始 ``VOpenZAF``), 与 ``/quotes`` 端点的 ``auction_pct`` (小数形式) 不同。
    差异原因: ``/auction`` 端点为竞价专项展示, 用百分比便于前端直接显示;
    ``/quotes`` 沿用 ``pct`` 字段的小数形式以保持响应内一致。

    字段来源 (V8 快照 / RealAdapter ``tq.get_more_info``):
    - ``VOpenZAF``     : 竞价涨幅% (5.23 = 5.23%) → auction_pct (百分比形式)
    - ``OpenZTBuy``    : 竞价涨停买单 (万元) → auction_zt_buy
    - ``OpenAmo``      : 今日开盘金额 (元, mock_adapter 注释确认) → auction_amount (转万元)
    - ``OpenAmoPre1``  : 昨开盘金额 (万元) → open_amount_pre
    - ``OpenVolPre1``  : 昨开盘量 (手) → open_vol_pre
    - ``L2OrderNum``   : L2 委托数 → l2_order_num
    - ``L2TicNum``     : L2 笔数 → l2_tic_num

    评分公式 (0-100, ``auction_pct`` 为百分比形式):
    - surge     = min(auction_pct / 10 * 40, 40)            # 竞价涨幅, 10% 封顶 40 分
    - zt_flag   = 20 if auction_zt_buy > 0 else 0           # 有竞价涨停买单 +20
    - vol_ratio = min(auction_amount / open_amount_pre * 30, 30)  # 量比同比, 1 倍 = 30 分
    - l2        = min(l2_order_num / 100, 10)               # L2 委托数, 1000 单封顶 10 分
    - auction_score = surge + zt_flag + vol_ratio + l2

    字段缺失返回 0, 不报错。
    """
    auction_pct = _safe_float(info.get("VOpenZAF"))  # 百分比形式 (5.23 = 5.23%)
    auction_zt_buy = _safe_float(info.get("OpenZTBuy"))
    # OpenAmo 单位为元 (mock_adapter 注释: "OpenAmo 单位为元"), 转 万元 与 OpenAmoPre1 单位对齐
    open_amo = _safe_float(info.get("OpenAmo"))
    auction_amount = open_amo / 10000.0 if open_amo > 0 else 0.0
    open_amount_pre = _safe_float(info.get("OpenAmoPre1"))
    open_vol_pre = _safe_float(info.get("OpenVolPre1"))
    l2_order_num = int(_safe_float(info.get("L2OrderNum")))
    l2_tic_num = int(_safe_float(info.get("L2TicNum")))

    # 评分
    surge_score = min(auction_pct / 10.0 * 40.0, 40.0)
    zt_flag = 20.0 if auction_zt_buy > 0 else 0.0
    if open_amount_pre > 0:
        vol_ratio_score = min(auction_amount / open_amount_pre * 30.0, 30.0)
    else:
        vol_ratio_score = 0.0
    l2_score = min(l2_order_num / 100.0, 10.0)
    auction_score = surge_score + zt_flag + vol_ratio_score + l2_score

    return {
        "auction_pct": round(auction_pct, 4),
        "auction_amount": round(auction_amount, 2),
        "auction_zt_buy": round(auction_zt_buy, 2),
        "open_amount_pre": round(open_amount_pre, 2),
        "open_vol_pre": round(open_vol_pre, 2),
        "l2_order_num": l2_order_num,
        "l2_tic_num": l2_tic_num,
        "auction_score": round(auction_score, 2),
        "score_detail": {
            "surge": round(surge_score, 2),
            "zt_flag": round(zt_flag, 2),
            "vol_ratio": round(vol_ratio_score, 2),
            "l2": round(l2_score, 2),
        },
    }


def _in_auction_hours(cfg: Any) -> bool:
    """是否在集合竞价时段 (09:15-09:25)。

    - Mock 模式: 强制 ``True`` (沙箱友好, 与 ``MonitorEngine._in_trading_hours`` 同策略)
    - Real 模式: 严格判断当前时间在 09:15-09:25 之间 (周末返回 False)
    """
    mode = str(cfg.get("app.adapter_mode", "mock"))
    if mode == "mock":
        return True
    now = datetime.now()
    if now.weekday() >= 5:  # 周六/日
        return False
    hhmm = now.strftime("%H:%M")
    return "09:15" <= hhmm < "09:25"


def _deterministic_hash_float(code: str, salt: str, lo: float, hi: float) -> float:
    """基于 code + salt 的 MD5 hash 生成 [lo, hi] 区间的确定性浮点数。

    用途: 字段缺失时生成稳定的 mock 值 (同一 code 同一 salt 永远返回同一值),
    避免每次刷新数据跳变。
    """
    h = hashlib.md5(f"{salt}:{code}".encode("utf-8")).hexdigest()
    # 取前 8 个十六进制字符 → 0~1
    val = int(h[:8], 16) / 0xFFFFFFFF
    return lo + val * (hi - lo)


def _fallback_top_picks(storage: Any, state: Any, count: int) -> list[str]:
    """订阅列表为空时，从最近一次 selection_results 取 Top N 注入订阅。

    用途：保证 Web 大屏 ``GET /api/monitor/quotes`` 在首次启动 / 引擎重启后
    不会返回空数组（用户感到"死页面")。

    流程：
    1. 查 ``selection_results`` 表，按 created_at DESC 取前 N 个 stock_code
    2. 把它们 upsert 到 EngineState 订阅缓存
    3. 返回 stock_code 列表
    """
    if storage is None:
        return []
    try:
        if not storage.table_exists("selection_results"):
            return []
    except Exception:  # noqa: BLE001
        return []
    sql = (
        "SELECT DISTINCT stock_code FROM selection_results "
        "ORDER BY created_at DESC LIMIT ?"
    )
    try:
        df = storage.query(sql, (int(count),))
    except Exception as exc:  # noqa: BLE001
        logger.warning("fallback_top_picks 查询失败: %s", exc)
        return []
    codes: list[str] = []
    for v in df["stock_code"].astype(str).tolist():
        v = v.strip()
        if v:
            codes.append(v)
    # 注入 EngineState
    for i, code in enumerate(codes):
        try:
            state.upsert_subscription(
                code,
                strategy_id="fallback_top_pick",
                subscriber="monitor_fallback",
                batch_no=i // 50 + 1,
            )
        except Exception:  # noqa: BLE001
            pass
    return codes
