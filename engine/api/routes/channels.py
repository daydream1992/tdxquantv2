"""``/api/channels`` 路由 - 推送通道配置管理。

- ``GET /api/channels``           - 列出所有通道状态
- ``PUT /api/channels``           - 批量更新通道配置（持久化到 channels.yaml）
- ``POST /api/channels/{name}/test`` - 向指定通道发送测试消息
- ``POST /api/signals/{id}/repush``  - 重新推送某条历史信号
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from engine.api.deps import get_config, get_state, get_storage
from engine.channels import ChannelPayload, get_registry

logger = logging.getLogger(__name__)

router = APIRouter(tags=["channels"])


# ============================================================================
# Schemas
# ============================================================================


class ChannelStatus(BaseModel):
    """单通道状态。"""

    name: str
    enabled: bool
    config: dict[str, Any] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)


class ChannelListResponse(BaseModel):
    """通道列表响应。"""

    channels: list[ChannelStatus]
    config_path: str


class ChannelUpdateRequest(BaseModel):
    """通道批量更新请求。"""

    channels: dict[str, dict[str, Any]]


class ChannelUpdateResponse(BaseModel):
    """通道更新响应。"""

    ok: bool
    errors: list[str] = Field(default_factory=list)
    channels: list[ChannelStatus] = Field(default_factory=list)


class ChannelTestResponse(BaseModel):
    """通道测试响应。"""

    ok: bool
    message: str = ""
    channel: str


class SignalRepushResponse(BaseModel):
    """信号重新推送响应。"""

    ok: bool
    signal_id: str
    fired: list[str] = Field(default_factory=list)
    results: list[dict[str, Any]] = Field(default_factory=list)


# ============================================================================
# 路由
# ============================================================================


@router.get(
    "",
    response_model=ChannelListResponse,
    summary="通道列表与状态",
)
async def list_channels() -> ChannelListResponse:
    """列出所有通道当前状态、配置、校验错误。"""
    reg = get_registry()
    from engine.channels.registry import _config_path

    items = [ChannelStatus(**c) for c in reg.list_channels()]
    return ChannelListResponse(
        channels=items,
        config_path=str(_config_path()),
    )


@router.put(
    "",
    response_model=ChannelUpdateResponse,
    summary="批量更新通道配置",
)
async def update_channels(req: ChannelUpdateRequest) -> ChannelUpdateResponse:
    """批量更新通道配置，持久化到 ``config/channels.yaml`` 并热重载。"""
    reg = get_registry()
    errors = reg.update_config(req.channels)
    if errors:
        return ChannelUpdateResponse(ok=False, errors=errors)
    items = [ChannelStatus(**c) for c in reg.list_channels()]
    return ChannelUpdateResponse(ok=True, errors=[], channels=items)


@router.post(
    "/{name}/test",
    response_model=ChannelTestResponse,
    summary="发送测试消息到指定通道",
)
async def test_channel(name: str = Path(..., description="通道名: csv_log|websocket|tdx_warn|feishu")) -> ChannelTestResponse:
    """向指定通道发送一条测试消息，验证连通性。"""
    reg = get_registry()
    result = reg.test_channel(name)
    return ChannelTestResponse(
        ok=result.ok,
        message=result.message,
        channel=name,
    )


# ============================================================================
# 信号重新推送
# ============================================================================


@router.post(
    "/signals/{signal_id}/repush",
    response_model=SignalRepushResponse,
    summary="重新推送某条历史信号",
)
async def repush_signal(
    signal_id: str,
    storage: Any = Depends(get_storage),
    cfg: Any = Depends(get_config),
) -> SignalRepushResponse:
    """从 DuckDB ``signal_events`` 表读出某条信号，重新分发到所有启用通道。"""
    if not _table_exists(storage, "signal_events"):
        raise HTTPException(status_code=404, detail="signal_events 表不存在")

    sql = (
        "SELECT event_id, strategy_id, stock_code, stock_name, alert_type, "
        "       condition_expr, severity, channels_fired, triggered_at "
        "FROM signal_events WHERE event_id = ? LIMIT 1"
    )
    try:
        df = storage.query(sql, [signal_id])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"查询失败: {exc}") from exc

    if df.empty:
        raise HTTPException(status_code=404, detail=f"信号 {signal_id} 不存在")

    row = df.iloc[0]
    strategy_id = str(row.get("strategy_id") or "") or ""
    strategy_name = ""
    strategy_emoji = ""
    if strategy_id and cfg is not None:
        try:
            strategies = cfg.strategies() or {}
            sc = strategies.get(strategy_id)
            if sc:
                strategy_name = getattr(sc, "strategy_name", "") or strategy_id
                strategy_emoji = getattr(sc, "strategy_emoji", "") or ""
        except Exception:  # noqa: BLE001
            pass

    alert_type = str(row.get("alert_type", "system"))
    severity = str(row.get("severity", "info"))
    fired_raw = row.get("channels_fired", "[]")
    try:
        fired_channels = json.loads(str(fired_raw)) if fired_raw else []
    except (TypeError, ValueError, json.JSONDecodeError):
        fired_channels = []

    triggered = row.get("triggered_at")
    if hasattr(triggered, "to_pydatetime"):
        triggered = triggered.to_pydatetime()
    if not isinstance(triggered, datetime):
        triggered = datetime.now()

    payload = ChannelPayload(
        signal_id=str(row.get("event_id", "")),
        signal_type=alert_type,
        strategy_id=strategy_id,
        strategy_name=strategy_name,
        strategy_emoji=strategy_emoji,
        stock_code=str(row.get("stock_code") or "") or "",
        stock_name=str(row.get("stock_name") or "") or "",
        title=f"【重新推送】{strategy_emoji} {strategy_name or alert_type}",
        content=str(row.get("condition_expr", "")) or alert_type,
        severity=severity,
        priority="medium",
        triggered_at=triggered,
    )

    reg = get_registry()
    # 重新推送到原 channels_fired 列表
    results = reg.dispatch(payload, channels=fired_channels or None)
    fired_ok = [r.channel for r in results if r.ok]

    return SignalRepushResponse(
        ok=bool(fired_ok),
        signal_id=signal_id,
        fired=fired_ok,
        results=[r.to_dict() for r in results],
    )


# ============================================================================
# 内部
# ============================================================================


def _table_exists(storage: Any, name: str) -> bool:
    if storage is None:
        return False
    try:
        return storage.table_exists(name)
    except Exception:  # noqa: BLE001
        return False
