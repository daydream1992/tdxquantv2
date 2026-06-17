"""飞书自定义机器人 Webhook 通道。

配置示例::

    channels:
      feishu:
        enabled: true
        webhook_url: "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxx"
        # 可选：若机器人启用了签名校验，填 secret
        secret: ""
        # 可选：@ 用户 open_id 列表
        at_users: []
        # 可选：@ 所有人
        at_all: false

消息以飞书 **interactive card** 格式发送，包含：
- 标题：emoji + 策略名 + 信号类型
- 内容：信号摘要 + 股票代码 + 触发时间
- 高亮颜色：high=red / medium=orange / low=blue
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from base64 import b64encode
from typing import Any
from urllib import error, request

from engine.channels.base import BaseChannel, ChannelPayload, ChannelResult

logger = logging.getLogger(__name__)

# 飞书 card header 颜色模板
_COLOR_BY_PRIORITY = {
    "high": "red",
    "medium": "orange",
    "low": "blue",
    "info": "blue",
}


class FeishuChannel(BaseChannel):
    """飞书自定义机器人 Webhook 通道。"""

    name = "feishu"

    def __init__(self, config: dict | None = None) -> None:
        super().__init__(config)
        self.webhook_url: str = str(self.config.get("webhook_url", "") or "")
        self.secret: str = str(self.config.get("secret", "") or "")
        self.at_users: list[str] = list(self.config.get("at_users", []) or [])
        self.at_all: bool = bool(self.config.get("at_all", False))

    def validate_config(self) -> list[str]:
        errors: list[str] = []
        if not self.enabled:
            return errors
        if not self.webhook_url:
            errors.append("webhook_url 必填")
        elif not self.webhook_url.startswith("https://open.feishu.cn/"):
            errors.append("webhook_url 必须是飞书开放平台域名")
        return errors

    def _build_card(self, payload: ChannelPayload) -> dict[str, Any]:
        """构造飞书 interactive card。"""
        color = _COLOR_BY_PRIORITY.get(payload.priority, "blue")
        # 内容分行
        lines: list[dict[str, Any]] = []
        if payload.content:
            lines.append(
                {"tag": "div", "text": {"tag": "lark_md", "content": payload.content}}
            )
        if payload.stock_name or payload.stock_code:
            stock_text = f"**股票**: {payload.stock_name} ({payload.stock_code})"
            lines.append(
                {"tag": "div", "text": {"tag": "lark_md", "content": stock_text}}
            )
        if payload.strategy_name:
            strat_text = (
                f"**策略**: {payload.strategy_emoji} {payload.strategy_name}"
            )
            lines.append(
                {"tag": "div", "text": {"tag": "lark_md", "content": strat_text}}
            )
        # 时间 + 优先级
        meta_text = (
            f"**时间**: {payload.triggered_at.strftime('%Y-%m-%d %H:%M:%S')}"
            f"  ·  **优先级**: {payload.priority}  ·  **等级**: {payload.severity_label}"
        )
        lines.append({"tag": "div", "text": {"tag": "lark_md", "content": meta_text}})

        # @ 用户
        if self.at_all or self.at_users:
            at_elements: list[dict[str, Any]] = []
            if self.at_all:
                at_elements.append({"tag": "at", "is_all": True})
            for uid in self.at_users:
                at_elements.append({"tag": "at", "user_id": uid})
            lines.append({"tag": "div", "elements": at_elements})

        return {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": payload.display_title},
                "template": color,
            },
            "elements": lines,
        }

    def _sign(self, ts: int) -> str:
        """计算飞书签名（若启用 secret）。"""
        if not self.secret:
            return ""
        string_to_sign = f"{ts}\n{self.secret}"
        hmac_code = hmac.new(
            string_to_sign.encode("utf-8"), digestmod=hashlib.sha256
        ).digest()
        return b64encode(hmac_code).decode("utf-8")

    def send(self, payload: ChannelPayload) -> ChannelResult:
        errors = self.validate_config()
        if errors:
            return ChannelResult(
                channel=self.name,
                ok=False,
                message="; ".join(errors),
            )

        card = self._build_card(payload)
        ts = int(time.time())
        body: dict[str, Any] = {"msg_type": "interactive", "card": card}
        if self.secret:
            body["timestamp"] = str(ts)
            body["sign"] = self._sign(ts)

        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = request.Request(
            self.webhook_url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=5) as resp:
                raw = resp.read().decode("utf-8")
                ok_code = 0
                try:
                    resp_json = json.loads(raw)
                    ok_code = int(resp_json.get("StatusCode", resp_json.get("code", 0)))
                except (TypeError, ValueError, json.JSONDecodeError):
                    pass
                if ok_code == 0:
                    return ChannelResult(
                        channel=self.name,
                        ok=True,
                        message="feishu ok",
                        raw=raw,
                    )
                return ChannelResult(
                    channel=self.name,
                    ok=False,
                    message=f"feishu error: {raw[:200]}",
                    raw=raw,
                )
        except error.URLError as exc:
            logger.warning("FeishuChannel 网络错误: %s", exc)
            return ChannelResult(channel=self.name, ok=False, message=f"URLError: {exc}")
        except Exception as exc:  # noqa: BLE001
            logger.warning("FeishuChannel 推送失败: %s", exc)
            return ChannelResult(channel=self.name, ok=False, message=str(exc))
