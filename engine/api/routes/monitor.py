"""``/api/monitor`` 路由 - 监控状态与实时行情快照。

- ``GET /api/monitor/status``        - 监控状态（监控股票数/今日信号/订阅/心跳）
- ``GET /api/monitor/quotes``        - 实时行情快照（前 N 只订阅股票的价量）
- ``GET /api/monitor/subscriptions`` - 当前订阅列表
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, Query

from engine.api.deps import get_adapter, get_config, get_state
from engine.api.schemas import (
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
) -> MonitorStatusResponse:
    """返回引擎运行时状态。

    - ``adapter_mode`` 来自 ``app.adapter_mode``
    - ``monitored_count`` 来自 ``EngineState`` 的订阅缓存
    - 信号计数由 ``EngineState.record_signal`` 累加（监控引擎产生）
    """
    state.heartbeat()
    counts = state.today_signal_counts()
    return MonitorStatusResponse(
        engine_status="running",
        adapter_mode=str(cfg.get("app.adapter_mode", "mock")),
        monitored_count=state.monitored_count(),
        today_signals=counts["today_signals"],
        today_limit_up=counts["today_limit_up"],
        today_alerts=counts["today_alerts"],
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
    count: int = Query(12, ge=1, le=200),
) -> list[QuoteSnapshot]:
    """返回订阅列表前 N 只股票的价量快照。

    适配器为 Mock 时，从 V8 快照 CSV 取静态数据；Real 模式调用
    ``tq.get_pricevol`` 实时数据。
    """
    subs = state.list_subscriptions()
    if not subs:
        return []
    codes = [s["stock_code"] for s in subs][:count]
    out: list[QuoteSnapshot] = []
    now_ms = int(time.time() * 1000)
    try:
        # 优先调批量 pricevol
        pv = adapter.get_pricevol(codes) if hasattr(adapter, "get_pricevol") else {}
        if pv and isinstance(pv, dict):
            for code in codes:
                fields = pv.get(code) or {}
                last = _safe_float(fields.get("Now")) or _safe_float(fields.get("last")) or 0.0
                last_close = _safe_float(fields.get("LastClose")) or _safe_float(fields.get("last_close")) or 0.0
                pct = _safe_float(fields.get("pct_change")) or (last / last_close - 1 if last_close else 0.0)
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
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("get_market_snapshot(%s) 失败: %s", code, exc)
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
