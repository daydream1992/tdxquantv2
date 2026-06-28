"""WebSocket 通道 - 模拟推送（写入 EngineState 信号缓存）。

由于本环境 sandbox 不允许独立 mini-service 常驻，无法真正建立 socket.io 连接，
此通道把信号写入 EngineState 的 ``recent_signal_buftime`` 内存列表，
前端通过 10s 轮询 ``/api/monitor?action=status`` 拉取最近信号。

生产环境可替换为真正的 socket.io emit 实现，接口保持兼容。
"""

from __future__ import annotations

import logging
from collections import deque
from threading import Lock
from typing import Any

from engine.channels.base import BaseChannel, ChannelPayload, ChannelResult

logger = logging.getLogger(__name__)

# 进程级最近信号缓存（最多 50 条），供前端轮询拉取
_RECENT: deque[dict[str, Any]] = deque(maxlen=50)
_RECENT_LOCK = Lock()


def push_recent(payload_dict: dict[str, Any]) -> None:
    """供其他模块（如 selection 信号）直接写入缓存。"""
    with _RECENT_LOCK:
        _RECENT.append(payload_dict)


def drain_recent(limit: int = 20) -> list[dict[str, Any]]:
    """读取最近 N 条信号（不消费，保留）。"""
    with _RECENT_LOCK:
        items = list(_RECENT)
    return items[-limit:]


class WebSocketChannel(BaseChannel):
    """WebSocket 推送通道（轮询模拟）。"""

    name = "websocket"

    def __init__(self, config: dict | None = None) -> None:
        super().__init__(config)
        # 默认开启（轮询模式下无成本）
        self.config.setdefault("enabled", True)

    def send(self, payload: ChannelPayload) -> ChannelResult:
        try:
            item = {
                "signal_id": payload.signal_id,
                "time": payload.triggered_at.isoformat(timespec="seconds"),
                "type": payload.signal_type,
                "strategy_id": payload.strategy_id,
                "strategy_name": payload.strategy_name,
                "strategy_emoji": payload.strategy_emoji,
                "stock_code": payload.stock_code,
                "stock_name": payload.stock_name,
                "title": payload.display_title,
                "content": payload.content,
                "severity": payload.severity,
                "priority": payload.priority,
                "channel": "websocket",
            }
            push_recent(item)
            return ChannelResult(
                channel=self.name,
                ok=True,
                message="queued to recent_signals buffer",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("WebSocketChannel 推送失败: %s", exc)
            return ChannelResult(channel=self.name, ok=False, message=str(exc))
