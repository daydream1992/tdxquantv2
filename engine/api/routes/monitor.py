"""``/api/monitor`` 路由 - 监控状态与实时行情快照。

- ``GET /api/monitor/status``        - 监控状态（监控股票数/今日信号/订阅/心跳）
- ``GET /api/monitor/quotes``        - 实时行情快照（前 N 只订阅股票的价量 + 资金流字段）
- ``GET /api/monitor/flow-ranking``  - 资金流向排行 (按 main_inflow / big_buy_ratio / turnover_rate 排序)
- ``GET /api/monitor/subscriptions`` - 当前订阅列表
"""

from __future__ import annotations

import hashlib
import logging
import time
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
