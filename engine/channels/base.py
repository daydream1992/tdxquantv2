"""消息总线通道抽象基类与数据结构。"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ChannelPayload:
    """通道消息载体（统一格式）。

    各通道负责把它转换成自己的协议格式（飞书 card、通达信 warn 字符串等）。
    """

    signal_id: str = ""
    signal_type: str = "system"  # limit_up | drop_alert | breakout | selection | system
    strategy_id: str = ""
    strategy_name: str = ""
    strategy_emoji: str = ""
    stock_code: str = ""
    stock_name: str = ""
    title: str = ""
    content: str = ""
    severity: str = "info"  # info | warn | error
    priority: str = "medium"  # high | medium | low
    extra: dict[str, Any] = field(default_factory=dict)
    triggered_at: datetime = field(default_factory=datetime.now)

    @property
    def display_title(self) -> str:
        """优先使用 title，否则按 strategy/stock 拼装。"""
        if self.title:
            return self.title
        if self.stock_name:
            return f"{self.strategy_emoji} {self.stock_name} {self.signal_type_label}"
        if self.strategy_name:
            return f"{self.strategy_emoji} 策略「{self.strategy_name}」"
        return self.signal_type_label

    @property
    def signal_type_label(self) -> str:
        return {
            "limit_up": "涨停",
            "drop_alert": "下跌",
            "breakout": "突破",
            "selection": "选股",
            "system": "系统",
        }.get(self.signal_type, self.signal_type)

    @property
    def severity_label(self) -> str:
        return {
            "info": "普通",
            "warn": "警告",
            "error": "严重",
        }.get(self.severity, self.severity)


@dataclass
class ChannelResult:
    """单通道发送结果。"""

    channel: str
    ok: bool
    message: str = ""
    raw: Any = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "channel": self.channel,
            "ok": self.ok,
            "message": self.message,
        }


class BaseChannel(ABC):
    """通道抽象基类。

    子类必须实现 :meth:`send`。可选重写 :meth:`validate_config`、:meth:`enabled`。
    """

    # 通道唯一标识，子类覆盖
    name: str = "base"

    # 是否允许用户关闭（csv_log 永远开启）
    force_enabled: bool = False

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config: dict[str, Any] = config or {}

    @property
    def enabled(self) -> bool:
        """是否启用。``force_enabled=True`` 时强制启用。"""
        if self.force_enabled:
            return True
        return bool(self.config.get("enabled", False))

    def validate_config(self) -> list[str]:
        """校验配置，返回错误信息列表（空表示通过）。"""
        return []

    @abstractmethod
    def send(self, payload: ChannelPayload) -> ChannelResult:
        """发送消息，返回 :class:`ChannelResult`。"""
        raise NotImplementedError

    def status(self) -> dict[str, Any]:
        """返回通道状态摘要，供 /api/channels 查询。"""
        return {
            "name": self.name,
            "enabled": self.enabled,
            "config": {k: ("***" if "secret" in k.lower() or "token" in k.lower() or "key" in k.lower() else v) for k, v in self.config.items()},
            "errors": self.validate_config(),
        }
