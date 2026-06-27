"""飞书推送通道 v2(借鉴 spjk 简洁风格 + 保留 R21 App 模式)。

模式 1 — 自定义机器人 Webhook::

    channels:
      feishu:
        enabled: true
        webhook_url: "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxx"
        secret: ""              # 可选:机器人启用签名校验时填
        at_users: []
        at_all: false

模式 2 — 开放平台 App(R21,用 App ID/Secret)::

    channels:
      feishu:
        enabled: true
        app_id: ""              # 留空则读环境变量 FEISHU_APP_ID
        app_secret: ""          # 留空则读环境变量 FEISHU_APP_SECRET(放 .env)
        receive_id_type: chat_id
        receive_id: "oc_xxxxx"
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from base64 import b64encode
from typing import Any
from urllib import error, parse, request

from engine.channels.base import BaseChannel, ChannelPayload, ChannelResult
from engine.utils.env import ensure_env_loaded

logger = logging.getLogger(__name__)

# 飞书 card header 颜色模板
_COLOR_BY_PRIORITY = {
    "high": "red",
    "medium": "orange",
    "low": "blue",
    "info": "blue",
}

# 开放平台 API
_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
_MSG_URL = "https://open.feishu.cn/open-apis/im/v1/messages"


def _env(key: str) -> str:
    """读环境变量(ensure_env_loaded 已把 .env 注入 os.environ)。"""
    import os

    return os.environ.get(key, "")


class FeishuChannel(BaseChannel):
    """飞书推送通道(Webhook 机器人 或 开放平台 App)。"""

    name = "feishu"

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        ensure_env_loaded()  # 让 .env 里的 FEISHU_APP_* 生效
        super().__init__(config)
        # Webhook 模式
        self.webhook_url: str = str(self.config.get("webhook_url", "") or "")
        self.secret: str = str(self.config.get("secret", "") or "")
        # App 模式(env 优先,避免密钥进 git 追踪的 channels.yaml)
        self.app_id: str = str(
            self.config.get("app_id", "") or _env("FEISHU_APP_ID")
        )
        self.app_secret: str = str(
            self.config.get("app_secret", "") or _env("FEISHU_APP_SECRET")
        )
        self.receive_id_type: str = str(
            self.config.get("receive_id_type", "chat_id") or "chat_id"
        )
        self.receive_id: str = str(self.config.get("receive_id", "") or "")
        # 通用
        self.at_users: list[str] = list(self.config.get("at_users", []) or [])
        self.at_all: bool = bool(self.config.get("at_all", False))
        # token 缓存
        self._token: str = ""
        self._token_expire: float = 0.0

    @property
    def is_app_mode(self) -> bool:
        """是否走 App 模式(配了 app_id)。"""
        return bool(self.app_id)

    def validate_config(self) -> list[str]:
        errors: list[str] = []
        if not self.enabled:
            return errors
        if self.is_app_mode:
            if not self.app_secret:
                errors.append(
                    "App 模式缺 app_secret(配 app_secret 或环境变量 FEISHU_APP_SECRET)"
                )
            if not self.receive_id:
                errors.append(
                    f"App 模式缺 receive_id(receive_id_type={self.receive_id_type},"
                    "需填群 chat_id / 用户 open_id / 邮箱等)"
                )
        else:
            if not self.webhook_url:
                errors.append("webhook_url 必填(或改用 App 模式填 app_id/app_secret)")
            elif not self.webhook_url.startswith("https://open.feishu.cn/"):
                errors.append("webhook_url 必须是飞书开放平台域名")
        return errors

    def _build_card(self, payload: ChannelPayload) -> dict[str, Any]:
        """构造飞书 interactive card。"""
        color = _COLOR_BY_PRIORITY.get(payload.priority, "blue")
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
            strat_text = f"**策略**: {payload.strategy_emoji} {payload.strategy_name}"
            lines.append(
                {"tag": "div", "text": {"tag": "lark_md", "content": strat_text}}
            )
        meta_text = (
            f"**时间**: {payload.triggered_at.strftime('%Y-%m-%d %H:%M:%S')}"
            f"  ·  **优先级**: {payload.priority}  ·  **等级**: {payload.severity_label}"
        )
        lines.append({"tag": "div", "text": {"tag": "lark_md", "content": meta_text}})

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
        """计算飞书签名(Webhook 模式启用 secret 时)。"""
        if not self.secret:
            return ""
        string_to_sign = f"{ts}\n{self.secret}"
        hmac_code = hmac.new(
            string_to_sign.encode("utf-8"), digestmod=hashlib.sha256
        ).digest()
        return b64encode(hmac_code).decode("utf-8")

    def _get_tenant_token(self) -> str:
        """获取并缓存 tenant_access_token(提前 60s 刷新)。"""
        if self._token and time.time() < self._token_expire - 60:
            return self._token
        body = json.dumps(
            {"app_id": self.app_id, "app_secret": self.app_secret}
        ).encode("utf-8")
        req = request.Request(
            _TOKEN_URL,
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        with request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("code") != 0:
            raise RuntimeError(
                f"飞书 tenant_access_token 获取失败: code={data.get('code')} "
                f"msg={data.get('msg')}"
            )
        self._token = data["tenant_access_token"]
        self._token_expire = time.time() + int(data.get("expire", 7200))
        return self._token

    def _send_app(self, card: dict[str, Any]) -> ChannelResult:
        """App 模式:走 /im/v1/messages 发 interactive 卡片。"""
        try:
            token = self._get_tenant_token()
        except error.URLError as exc:
            logger.warning("FeishuChannel(App) token 网络错误: %s", exc)
            return ChannelResult(channel=self.name, ok=False, message=f"URLError: {exc}")
        except Exception as exc:  # noqa: BLE001
            logger.warning("FeishuChannel(App) token 获取失败: %s", exc)
            return ChannelResult(channel=self.name, ok=False, message=str(exc))

        body = json.dumps(
            {
                "receive_id": self.receive_id,
                "msg_type": "interactive",
                "content": json.dumps(card, ensure_ascii=False),
            },
            ensure_ascii=False,
        ).encode("utf-8")
        url = f"{_MSG_URL}?receive_id_type={parse.quote(self.receive_id_type)}"
        req = request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": f"Bearer {token}",
            },
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=5) as resp:
                raw = resp.read().decode("utf-8")
            resp_json = json.loads(raw)
            if resp_json.get("code") == 0:
                return ChannelResult(
                    channel=self.name, ok=True, message="feishu app ok", raw=raw
                )
            return ChannelResult(
                channel=self.name,
                ok=False,
                message=(
                    f"feishu app error: code={resp_json.get('code')} "
                    f"msg={resp_json.get('msg')} raw={raw[:200]}"
                ),
                raw=raw,
            )
        except error.URLError as exc:
            logger.warning("FeishuChannel(App) 网络错误: %s", exc)
            return ChannelResult(channel=self.name, ok=False, message=f"URLError: {exc}")
        except Exception as exc:  # noqa: BLE001
            logger.warning("FeishuChannel(App) 推送失败: %s", exc)
            return ChannelResult(channel=self.name, ok=False, message=str(exc))

    def send(self, payload: ChannelPayload) -> ChannelResult:
        # enabled=False 时直接早返,避免 urlopen("") 抛 URLError 刷屏
        if not self.enabled:
            return ChannelResult(
                channel=self.name,
                ok=False,
                message="disabled, skipped",
            )
        errors = self.validate_config()
        if errors:
            return ChannelResult(
                channel=self.name,
                ok=False,
                message="; ".join(errors),
            )

        card = self._build_card(payload)

        # App 模式
        if self.is_app_mode:
            return self._send_app(card)

        # Webhook 模式
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