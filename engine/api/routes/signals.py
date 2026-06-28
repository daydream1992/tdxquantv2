"""``/api/signals`` 路由 - 信号事件查询与统计。

- ``GET /api/signals``             - 信号列表（支持 type/strategy_id/date 筛选）
- ``GET /api/signals/stats``       - 信号统计
- ``GET /api/signals/{signal_id}`` - 信号详情 (含 snapshot JSON)
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from engine.api.deps import get_config, get_state, get_storage
from engine.api.schemas import (
    SignalEventResponse,
    SignalStatsItem,
    SignalStatsResponse,
)

logger = logging.getLogger(__name__)

# 系统时区 Asia/Shanghai (QuestDB QDB_TIMEZONE)，triggered_at 从 QuestDB 读出为 naive ISO，
# 补 +08:00 避免与 mock 降级数据(带 Z) 时间基准不一致导致前端显示跳变。
_CN_TZ = timezone(timedelta(hours=8))


def _iso_with_tz(val: Any) -> str:
    """naive ISO 时间补 +08:00 时区；已带时区或解析失败则原样返回。"""
    if val is None:
        return ""
    s = str(val)
    if not s:
        return ""
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_CN_TZ)
        return dt.isoformat()
    except (ValueError, TypeError):
        return s


router = APIRouter(tags=["signals"])


@router.get(
    "/stats",
    response_model=SignalStatsResponse,
    summary="信号统计",
)
async def get_signal_stats(
    storage: Any = Depends(get_storage),
) -> SignalStatsResponse:
    """按 ``alert_type`` 分组统计信号数量与最近时间。"""
    if not _table_exists(storage, "signal_events"):
        return SignalStatsResponse(total=0, by_type=[])
    sql = (
        "SELECT alert_type, COUNT(*) AS cnt, MAX(triggered_at) AS last_ts "
        "FROM signal_events GROUP BY alert_type ORDER BY cnt DESC"
    )
    try:
        df = storage.query(sql)
    except Exception as exc:  # noqa: BLE001
        logger.warning("查询 signal_events 统计失败: %s", exc)
        return SignalStatsResponse(total=0, by_type=[])

    items: list[SignalStatsItem] = []
    total = 0
    for _, row in df.iterrows():
        cnt = int(row.get("cnt", 0) or 0)
        total += cnt
        items.append(
            SignalStatsItem(
                type=str(row.get("alert_type", "")),
                count=cnt,
                last_time=_to_str(row.get("last_ts")),
            )
        )
    return SignalStatsResponse(total=total, by_type=items)


@router.get(
    "/{signal_id}",
    response_model=SignalEventResponse,
    summary="信号详情",
)
async def get_signal_detail(
    signal_id: str,
    storage: Any = Depends(get_storage),
    cfg: Any = Depends(get_config),
) -> SignalEventResponse:
    """返回单条信号完整详情 (含 snapshot JSON)。

    用途: 信号中心行点击 → 抽屉展示完整快照与 severity。
    """
    if not _table_exists(storage, "signal_events"):
        raise HTTPException(status_code=404, detail=f"信号 {signal_id} 不存在")

    sql = (
        "SELECT event_id, strategy_id, stock_code, stock_name, "
        "       alert_type, condition_expr, severity, snapshot, channels_fired, triggered_at "
        "FROM signal_events WHERE event_id = ? LIMIT 1"
    )
    try:
        df = storage.query(sql, (signal_id,))
    except Exception as exc:  # noqa: BLE001
        logger.warning("查询 signal_events 详情失败: %s", exc)
        raise HTTPException(status_code=500, detail=f"查询失败: {exc}") from exc

    if df.empty:
        raise HTTPException(status_code=404, detail=f"信号 {signal_id} 不存在")

    smap = _build_strategy_map(cfg)
    return _row_to_signal(df.iloc[0], smap)


@router.get(
    "",
    response_model=list[SignalEventResponse],
    summary="信号列表",
)
async def list_signals(
    storage: Any = Depends(get_storage),
    state: Any = Depends(get_state),
    cfg: Any = Depends(get_config),
    type: str | None = Query(None, description="按类型筛选: limit_up|drop_alert|breakout|selection|system"),
    strategy_id: str | None = Query(None, description="按策略 ID 筛选"),
    start_date: str | None = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: str | None = Query(None, description="结束日期 YYYY-MM-DD"),
    limit: int = Query(50, ge=1, le=500),
) -> list[SignalEventResponse]:
    """从 DuckDB ``signal_events`` 表查询；表不存在或空时返回空列表。"""
    if not _table_exists(storage, "signal_events"):
        return []

    where_parts: list[str] = []
    params: list[Any] = []
    if type and type != "all":
        where_parts.append("alert_type = ?")
        params.append(type)
    if strategy_id and strategy_id != "all":
        where_parts.append("strategy_id = ?")
        params.append(strategy_id)
    if start_date:
        where_parts.append("triggered_at >= ?")
        params.append(start_date)
    if end_date:
        where_parts.append("triggered_at <= ?")
        params.append(end_date + " 23:59:59")
    where_clause = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""

    sql = (
        "SELECT event_id, strategy_id, stock_code, stock_name, "
        "       alert_type, condition_expr, severity, snapshot, channels_fired, triggered_at "
        f"FROM signal_events{where_clause} "
        "ORDER BY triggered_at DESC LIMIT ?"
    )
    params.append(int(limit))

    try:
        df = storage.query(sql, params)
    except Exception as exc:  # noqa: BLE001
        logger.warning("查询 signal_events 失败: %s", exc)
        return []

    # 预构建 strategy_id → (name, emoji) 映射，避免每行都查 cfg
    smap = _build_strategy_map(cfg)

    out: list[SignalEventResponse] = []
    for _, row in df.iterrows():
        out.append(_row_to_signal(row, smap))

    # 同步把信号计数累加到 EngineState（best-effort）
    try:
        if out:
            state.heartbeat()
    except Exception:  # noqa: BLE001
        pass

    return out


# ============================================================================
# 内部
# ============================================================================


def _build_strategy_map(cfg: Any) -> dict[str, dict[str, str]]:
    """构建 ``strategy_id → {name, emoji, sector_code}`` 映射。

    从 :class:`ConfigLoader.strategies()` 反查，失败时返回空 dict。
    """
    smap: dict[str, dict[str, str]] = {}
    if cfg is None:
        return smap
    try:
        strategies = cfg.strategies() or {}
        for sid, sc in strategies.items():
            smap[sid] = {
                "name": getattr(sc, "strategy_name", "") or sid,
                "emoji": getattr(sc, "strategy_emoji", "") or "",
                "sector_code": getattr(sc, "sector_code", "") or "",
            }
    except Exception as exc:  # noqa: BLE001
        logger.warning("构建 strategy_map 失败: %s", exc)
    return smap


def _row_to_signal(row: Any, smap: dict[str, dict[str, str]] | None = None) -> SignalEventResponse:
    import json

    alert_type = str(row.get("alert_type", "system"))
    channels_raw = row.get("channels_fired", "[]")
    try:
        channels = json.loads(str(channels_raw)) if channels_raw else []
    except (TypeError, ValueError, json.JSONDecodeError):
        channels = []

    # snapshot 列: VARCHAR 存储 JSON 字符串, 解析失败返回 None
    snapshot_raw = row.get("snapshot")
    snapshot: dict[str, Any] | None = None
    if snapshot_raw:
        try:
            parsed = json.loads(str(snapshot_raw))
            if isinstance(parsed, dict):
                snapshot = parsed
            elif isinstance(parsed, list):
                snapshot = {"_list": parsed}
        except (TypeError, ValueError, json.JSONDecodeError):
            snapshot = None

    # 前端 type 字段：把 alert_type 直接透传（limit_up/drop_alert/breakout/selection/system）
    # 后端若写 'limit_up'/'drop_alert' 等则与前端一致；其它视为 'system'
    frontend_type = alert_type if alert_type in (
        "limit_up", "drop_alert", "breakout", "selection", "system"
    ) else "system"

    # 推送状态：severity=error 视为 failed，warn 视为 partial，info 视为 success
    severity = str(row.get("severity", "info"))
    push_status = {
        "error": "failed",
        "warn": "partial",
        "info": "success",
    }.get(severity, "success")

    # 反查 strategy_name + emoji（之前硬编码 None，QA 发现信号中心策略列显示 "—"）
    sid = str(row.get("strategy_id") or "") or None
    strategy_name: str | None = None
    strategy_emoji: str | None = None
    if sid and smap:
        info = smap.get(sid)
        if info:
            strategy_name = info.get("name") or sid
            strategy_emoji = info.get("emoji") or None

    return SignalEventResponse(
        id=str(row.get("event_id", "")),
        time=_iso_with_tz(row.get("triggered_at")),
        type=frontend_type,
        strategy_id=sid,
        strategy_name=strategy_name,
        stock_code=str(row.get("stock_code") or "") or None,
        stock_name=str(row.get("stock_name") or "") or None,
        content=str(row.get("condition_expr", "")) or alert_type,
        pushed_channels=channels if isinstance(channels, list) else [],
        push_status=push_status,
        snapshot=snapshot,
        severity=severity,
    )


def _table_exists(storage: Any, name: str) -> bool:
    if storage is None:
        return False
    try:
        return storage.table_exists(name)
    except Exception:  # noqa: BLE001
        return False


def _to_str(v: Any) -> str | None:
    if v is None:
        return None
    try:
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return str(v)
    except Exception:  # noqa: BLE001
        return None
