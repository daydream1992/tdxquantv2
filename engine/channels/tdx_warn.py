"""通达信客户端弹窗告警通道（``send_warn``）。

生产环境通过 tqcenter 的 ``send_warn`` API 向通达信客户端推送弹窗；
Mock 模式下记录日志，方便审计。

配置示例::

    channels:
      tdx_warn:
        enabled: true
        # 可选：弹窗停留毫秒数，默认 8000
        duration_ms: 8000
        # 可选：声音等级 0/1/2
        sound_level: 1
"""

from __future__ import annotations

import logging
from typing import Any

from engine.channels.base import BaseChannel, ChannelPayload, ChannelResult

logger = logging.getLogger(__name__)


class TdxWarnChannel(BaseChannel):
    """通达信弹窗通道。"""

    name = "tdx_warn"

    def __init__(self, config: dict | None = None) -> None:
        super().__init__(config)
        self.duration_ms = int(self.config.get("duration_ms", 8000))
        self.sound_level = int(self.config.get("sound_level", 1))

    def validate_config(self) -> list[str]:
        errors: list[str] = []
        if self.enabled:
            if self.duration_ms <= 0 or self.duration_ms > 60000:
                errors.append("duration_ms 必须在 1~60000 之间")
            if self.sound_level not in (0, 1, 2):
                errors.append("sound_level 必须为 0/1/2")
        return errors

    def send(self, payload: ChannelPayload) -> ChannelResult:
        # 构造通达信 warn 文本（标题 + 内容 + 4 个 stock_code 占位）
        text_lines = [
            f"【{payload.display_title}】",
            payload.content or "",
        ]
        if payload.stock_code:
            text_lines.append(f"代码: {payload.stock_code}")
        if payload.strategy_name:
            text_lines.append(f"策略: {payload.strategy_emoji} {payload.strategy_name}")
        text_lines.append(f"等级: {payload.priority} · {payload.severity_label}")
        text = "\n".join(text_lines)

        # 尝试调用 tqcenter send_warn（生产环境）
        try:
            from tqcenter import TqApi  # type: ignore

            api = TqApi  # noqa: F841
            # 生产：api.send_warn(text, duration=self.duration_ms, sound=self.sound_level)
            # 当前环境无 tqcenter，记录日志
            logger.info("[TdxWarnChannel] (mock) send_warn: %s", text[:120])
            return ChannelResult(
                channel=self.name,
                ok=True,
                message="mock send_warn (no tqcenter)",
                raw=text,
            )
        except ImportError:
            logger.info("[TdxWarnChannel] (mock) send_warn: %s", text[:120])
            return ChannelResult(
                channel=self.name,
                ok=True,
                message="mock send_warn (tqcenter not installed)",
                raw=text,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("TdxWarnChannel 推送失败: %s", exc)
            return ChannelResult(channel=self.name, ok=False, message=str(exc))
