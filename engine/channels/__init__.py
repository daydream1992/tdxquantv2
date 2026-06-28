"""消息总线插件化通道。

支持的通道：
- ``tdx_warn``   通达信客户端弹窗告警 (send_warn)
- ``websocket``  实时推送给 Web 大屏 (本环境走轮询，预留 WS 接口)
- ``feishu``     飞书自定义机器人 Webhook
- ``csv_log``    CSV 日志文件 (默认开启，不可关闭)

每个通道继承 :class:`BaseChannel`，实现 ``send(payload)`` 方法。
注册中心 :class:`ChannelRegistry` 负责实例化、配置加载、批量分发。
"""

from engine.channels.base import BaseChannel, ChannelResult, ChannelPayload
from engine.channels.registry import (
    ChannelRegistry,
    get_registry,
    reload_channel_config,
)

__all__ = [
    "BaseChannel",
    "ChannelResult",
    "ChannelPayload",
    "ChannelRegistry",
    "get_registry",
    "reload_channel_config",
]
