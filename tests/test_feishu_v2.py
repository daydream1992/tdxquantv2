"""飞书推送通道 v2 单元测试。

覆盖范围:
- validate_config: Webhook / App 两种模式的配置校验
- _sign: 有/无 secret 的签名
- _build_card: 不同 priority 颜色、@用户、内容分块
- send: Webhook 模式 成功 / 业务错误 / URLError / 通用异常
- send: App 模式 成功 / token 失败 / 网络错误 / 业务错误
"""

from __future__ import annotations

import json
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from urllib import error

from engine.channels.base import ChannelPayload
from engine.channels.feishu_v2 import FeishuChannel


# ---------- fixtures ----------

@pytest.fixture(autouse=True)
def _clean_feishu_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """隔离 .env:每个测试前清掉 FEISHU_APP_* 环境变量,并让
    ensure_env_loaded 不重新从 .env 注入。

    原因:仓库 .env 已设了 FEISHU_APP_ID,生产中 FeishuChannel 会自动
    读环境变量走 App 模式。测试需要可控,默认按"无 App 配置"行为验证。
    """
    # 先清一次,再禁用 ensure_env_loaded 防止 .env 重新注入
    monkeypatch.delenv("FEISHU_APP_ID", raising=False)
    monkeypatch.delenv("FEISHU_APP_SECRET", raising=False)
    monkeypatch.setattr(
        "engine.channels.feishu_v2.feishu.ensure_env_loaded", lambda: None
    )


@pytest.fixture
def payload() -> ChannelPayload:
    return ChannelPayload(
        signal_id="sig-1",
        signal_type="limit_up",
        strategy_id="st-1",
        strategy_name="涨停策略",
        strategy_emoji="🚀",
        stock_code="600000",
        stock_name="浦发银行",
        title="测试信号",
        content="这是一条测试推送",
        severity="info",
        priority="medium",
        triggered_at=datetime(2026, 6, 28, 10, 30, 0),
    )


@pytest.fixture
def webhook_config() -> dict:
    return {
        "enabled": True,
        "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx",
        "secret": "test-secret",
        "at_users": ["ou_user1"],
        "at_all": False,
    }


@pytest.fixture
def app_config() -> dict:
    return {
        "enabled": True,
        "app_id": "cli_test_app",
        "app_secret": "app-secret",
        "receive_id_type": "chat_id",
        "receive_id": "oc_chat1",
    }


def _ok_response(body: bytes = b'{"code":0,"msg":"ok"}') -> MagicMock:
    """构造一个 urlopen 返回的 mock 响应。"""
    resp = MagicMock()
    resp.read = MagicMock(return_value=body)
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


# ---------- name 属性 ----------

def test_name_is_feishu() -> None:
    """通道名契约 — YAML 字符串 "feishu" 必须匹配。"""
    assert FeishuChannel.name == "feishu"


# ---------- __init__ ----------

def test_init_webhook_mode(webhook_config: dict) -> None:
    ch = FeishuChannel(webhook_config)
    assert ch.webhook_url == webhook_config["webhook_url"]
    assert ch.secret == "test-secret"
    assert ch.at_users == ["ou_user1"]
    assert ch.at_all is False
    assert ch.is_app_mode is False


def test_init_app_mode(app_config: dict) -> None:
    ch = FeishuChannel(app_config)
    assert ch.app_id == "cli_test_app"
    assert ch.app_secret == "app-secret"
    assert ch.receive_id_type == "chat_id"
    assert ch.receive_id == "oc_chat1"
    assert ch.is_app_mode is True


def test_init_app_mode_env_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """app_id/app_secret 留空时,应回退到环境变量。"""
    monkeypatch.setenv("FEISHU_APP_ID", "cli_env_app")
    monkeypatch.setenv("FEISHU_APP_SECRET", "env-secret")
    ch = FeishuChannel({"enabled": True, "receive_id": "oc_x"})
    assert ch.app_id == "cli_env_app"
    assert ch.app_secret == "env-secret"
    assert ch.is_app_mode is True


# ---------- validate_config (Webhook) ----------

def test_validate_webhook_missing_url() -> None:
    ch = FeishuChannel({"enabled": True})
    errors = ch.validate_config()
    assert any("webhook_url 必填" in e for e in errors)


def test_validate_webhook_wrong_domain() -> None:
    ch = FeishuChannel(
        {"enabled": True, "webhook_url": "https://example.com/hook/xxx"}
    )
    errors = ch.validate_config()
    assert any("飞书开放平台域名" in e for e in errors)


def test_validate_webhook_pass(webhook_config: dict) -> None:
    ch = FeishuChannel(webhook_config)
    assert ch.validate_config() == []


def test_validate_disabled_returns_empty() -> None:
    """enabled=False 时即使配置不全也不报错(返回空列表)。"""
    ch = FeishuChannel({"enabled": False})
    assert ch.validate_config() == []


# ---------- validate_config (App) ----------

def test_validate_app_missing_secret(app_config: dict) -> None:
    app_config["app_secret"] = ""
    ch = FeishuChannel(app_config)
    errors = ch.validate_config()
    assert any("app_secret" in e for e in errors)


def test_validate_app_missing_receive_id(app_config: dict) -> None:
    app_config["receive_id"] = ""
    ch = FeishuChannel(app_config)
    errors = ch.validate_config()
    assert any("receive_id" in e for e in errors)


def test_validate_app_pass(app_config: dict) -> None:
    ch = FeishuChannel(app_config)
    assert ch.validate_config() == []


# ---------- _sign ----------

def test_sign_without_secret() -> None:
    ch = FeishuChannel({"enabled": True, "webhook_url": "https://open.feishu.cn/x"})
    assert ch._sign(1700000000) == ""


def test_sign_with_secret() -> None:
    """HMAC-SHA256 + Base64,签名应非空字符串。"""
    ch = FeishuChannel(
        {
            "enabled": True,
            "webhook_url": "https://open.feishu.cn/x",
            "secret": "abc",
        }
    )
    sig = ch._sign(1700000000)
    assert isinstance(sig, str)
    assert len(sig) > 0
    # 同一时间戳 + 同一 secret 签名应稳定
    assert sig == ch._sign(1700000000)


# ---------- _build_card ----------

def test_build_card_priority_colors() -> None:
    """high → red, medium → orange, low/info → blue。"""
    ch = FeishuChannel(
        {"enabled": True, "webhook_url": "https://open.feishu.cn/x"}
    )
    for priority, expected in [
        ("high", "red"),
        ("medium", "orange"),
        ("low", "blue"),
        ("info", "blue"),
    ]:
        p = ChannelPayload(priority=priority, content="x")
        card = ch._build_card(p)
        assert card["header"]["template"] == expected


def test_build_card_title_uses_display_title(payload: ChannelPayload) -> None:
    ch = FeishuChannel(
        {"enabled": True, "webhook_url": "https://open.feishu.cn/x"}
    )
    card = ch._build_card(payload)
    assert card["header"]["title"]["content"] == payload.display_title


def test_build_card_at_users(webhook_config: dict) -> None:
    webhook_config["at_users"] = ["u1", "u2"]
    webhook_config["at_all"] = True
    ch = FeishuChannel(webhook_config)
    card = ch._build_card(ChannelPayload(content="hi"))
    at_div = next((e for e in card["elements"] if "elements" in e), None)
    assert at_div is not None
    tags = [e.get("tag") for e in at_div["elements"]]
    assert tags.count("at") == 3  # 1 个 all + 2 个 user


def test_build_card_no_at_users() -> None:
    ch = FeishuChannel(
        {"enabled": True, "webhook_url": "https://open.feishu.cn/x"}
    )
    card = ch._build_card(ChannelPayload(content="hi"))
    assert not any("elements" in e for e in card["elements"])


def test_build_card_includes_stock_and_strategy(payload: ChannelPayload) -> None:
    ch = FeishuChannel(
        {"enabled": True, "webhook_url": "https://open.feishu.cn/x"}
    )
    card = ch._build_card(payload)
    texts = [
        e["text"]["content"]
        for e in card["elements"]
        if "text" in e
    ]
    assert any("浦发银行" in t and "600000" in t for t in texts)
    assert any("涨停策略" in t for t in texts)


# ---------- send (Webhook 模式) ----------

def test_send_webhook_disabled_returns_skipped(webhook_config: dict) -> None:
    webhook_config["enabled"] = False
    ch = FeishuChannel(webhook_config)
    result = ch.send(ChannelPayload(content="x"))
    assert result.ok is False
    assert "disabled" in result.message


def test_send_webhook_missing_config() -> None:
    ch = FeishuChannel({"enabled": True})
    result = ch.send(ChannelPayload(content="x"))
    assert result.ok is False
    assert "webhook_url" in result.message


@patch("engine.channels.feishu_v2.feishu.request.urlopen")
def test_send_webhook_success(
    mock_urlopen: MagicMock, webhook_config: dict, payload: ChannelPayload
) -> None:
    mock_urlopen.return_value = _ok_response()
    ch = FeishuChannel(webhook_config)
    result = ch.send(payload)
    assert result.ok is True
    assert result.message == "feishu ok"
    # 验证请求体包含签名 + timestamp
    req = mock_urlopen.call_args[0][0]
    body = json.loads(req.data.decode("utf-8"))
    assert body["msg_type"] == "interactive"
    assert "timestamp" in body
    assert "sign" in body
    assert body["card"]["header"]["template"] == "orange"


@patch("engine.channels.feishu_v2.feishu.request.urlopen")
def test_send_webhook_business_error(
    mock_urlopen: MagicMock, webhook_config: dict, payload: ChannelPayload
) -> None:
    mock_urlopen.return_value = _ok_response(b'{"code":19001,"msg":"invalid token"}')
    ch = FeishuChannel(webhook_config)
    result = ch.send(payload)
    assert result.ok is False
    assert "feishu error" in result.message


@patch("engine.channels.feishu_v2.feishu.request.urlopen")
def test_send_webhook_url_error(
    mock_urlopen: MagicMock, webhook_config: dict, payload: ChannelPayload
) -> None:
    mock_urlopen.side_effect = error.URLError("network down")
    ch = FeishuChannel(webhook_config)
    result = ch.send(payload)
    assert result.ok is False
    assert "URLError" in result.message


@patch("engine.channels.feishu_v2.feishu.request.urlopen")
def test_send_webhook_unexpected_exception(
    mock_urlopen: MagicMock, webhook_config: dict, payload: ChannelPayload
) -> None:
    mock_urlopen.side_effect = RuntimeError("boom")
    ch = FeishuChannel(webhook_config)
    result = ch.send(payload)
    assert result.ok is False
    assert "boom" in result.message


@patch("engine.channels.feishu_v2.feishu.request.urlopen")
def test_send_webhook_no_secret_omits_sign(
    mock_urlopen: MagicMock, webhook_config: dict, payload: ChannelPayload
) -> None:
    webhook_config["secret"] = ""
    mock_urlopen.return_value = _ok_response()
    ch = FeishuChannel(webhook_config)
    ch.send(payload)
    req = mock_urlopen.call_args[0][0]
    body = json.loads(req.data.decode("utf-8"))
    assert "timestamp" not in body
    assert "sign" not in body


# ---------- send (App 模式) ----------

@patch("engine.channels.feishu_v2.feishu.request.urlopen")
def test_send_app_success(
    mock_urlopen: MagicMock, app_config: dict, payload: ChannelPayload
) -> None:
    # 第一次 urlopen: 获取 token; 第二次: 发消息
    mock_urlopen.side_effect = [
        _ok_response(b'{"code":0,"tenant_access_token":"t-abc","expire":7200}'),
        _ok_response(b'{"code":0,"msg":"ok","data":{"message_id":"m_1"}}'),
    ]
    ch = FeishuChannel(app_config)
    result = ch.send(payload)
    assert result.ok is True
    assert result.message == "feishu app ok"
    # token 应被缓存
    assert ch._token == "t-abc"
    assert ch._token_expire > 0


@patch("engine.channels.feishu_v2.feishu.request.urlopen")
def test_send_app_token_failure(
    mock_urlopen: MagicMock, app_config: dict, payload: ChannelPayload
) -> None:
    mock_urlopen.return_value = _ok_response(b'{"code":99991663,"msg":"app secret invalid"}')
    ch = FeishuChannel(app_config)
    result = ch.send(payload)
    assert result.ok is False
    assert "app secret invalid" in result.message or "99991663" in result.message


@patch("engine.channels.feishu_v2.feishu.request.urlopen")
def test_send_app_message_business_error(
    mock_urlopen: MagicMock, app_config: dict, payload: ChannelPayload
) -> None:
    mock_urlopen.side_effect = [
        _ok_response(b'{"code":0,"tenant_access_token":"t-abc","expire":7200}'),
        _ok_response(b'{"code":230002,"msg":"user not found"}'),
    ]
    ch = FeishuChannel(app_config)
    result = ch.send(payload)
    assert result.ok is False
    assert "230002" in result.message


@patch("engine.channels.feishu_v2.feishu.request.urlopen")
def test_send_app_network_error(
    mock_urlopen: MagicMock, app_config: dict, payload: ChannelPayload
) -> None:
    mock_urlopen.side_effect = error.URLError("dns fail")
    ch = FeishuChannel(app_config)
    result = ch.send(payload)
    assert result.ok is False
    assert "URLError" in result.message


@patch("engine.channels.feishu_v2.feishu.request.urlopen")
def test_send_app_uses_cached_token(
    mock_urlopen: MagicMock, app_config: dict, payload: ChannelPayload
) -> None:
    """第二次发送应直接复用缓存 token,不重新请求 _TOKEN_URL。"""
    # 第一次: 拿 token + 发消息
    mock_urlopen.side_effect = [
        _ok_response(b'{"code":0,"tenant_access_token":"t-abc","expire":7200}'),
        _ok_response(b'{"code":0,"msg":"ok"}'),
    ]
    ch = FeishuChannel(app_config)
    ch.send(payload)
    # 第二次: 应只调用 1 次 urlopen (发消息)
    mock_urlopen.reset_mock()
    mock_urlopen.side_effect = [_ok_response(b'{"code":0,"msg":"ok"}')]
    result = ch.send(payload)
    assert result.ok is True
    assert mock_urlopen.call_count == 1


def test_send_app_disabled_returns_skipped(app_config: dict) -> None:
    app_config["enabled"] = False
    ch = FeishuChannel(app_config)
    result = ch.send(ChannelPayload(content="x"))
    assert result.ok is False
    assert "disabled" in result.message


def test_send_app_missing_config() -> None:
    ch = FeishuChannel({"enabled": True, "app_id": "x"})
    # 没有 app_secret 也没有 receive_id
    result = ch.send(ChannelPayload(content="x"))
    assert result.ok is False
    assert "app_secret" in result.message or "receive_id" in result.message