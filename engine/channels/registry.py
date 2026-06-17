"""通道注册中心 + 配置持久化。

配置文件: ``config/channels.yaml``（首次访问自动创建，含默认模板）。

API:
- :func:`get_registry` — 单例 :class:`ChannelRegistry`
- :func:`reload_channel_config` — 热加载（前端 PUT /api/channels 后调用）
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

import yaml

from engine.channels.base import BaseChannel, ChannelPayload, ChannelResult
from engine.channels.csv_log import CsvLogChannel
from engine.channels.feishu import FeishuChannel
from engine.channels.tdx_warn import TdxWarnChannel
from engine.channels.websocket import WebSocketChannel

logger = logging.getLogger(__name__)

# 通道类注册表：name → class
_CHANNEL_CLASSES: dict[str, type[BaseChannel]] = {
    "csv_log": CsvLogChannel,
    "websocket": WebSocketChannel,
    "tdx_warn": TdxWarnChannel,
    "feishu": FeishuChannel,
}

# 默认 channels.yaml 模板
_DEFAULT_CONFIG: dict[str, Any] = {
    "csv_log": {"enabled": True, "path": ""},
    "websocket": {"enabled": True},
    "tdx_warn": {"enabled": False, "duration_ms": 8000, "sound_level": 1},
    "feishu": {
        "enabled": False,
        "webhook_url": "",
        "secret": "",
        "at_users": [],
        "at_all": False,
    },
}

# 配置文件路径（相对当前工作目录）
_CONFIG_PATH = Path("config") / "channels.yaml"


def _config_path() -> Path:
    return _CONFIG_PATH


def _ensure_default_config() -> None:
    """若 channels.yaml 不存在，写入默认模板。"""
    p = _config_path()
    if p.exists():
        return
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", encoding="utf-8") as f:
            yaml.safe_dump(
                _DEFAULT_CONFIG,
                f,
                allow_unicode=True,
                sort_keys=False,
                default_flow_style=False,
            )
        logger.info("已生成默认 channels.yaml: %s", p)
    except OSError as exc:
        logger.warning("写入默认 channels.yaml 失败: %s", exc)


def _load_config() -> dict[str, Any]:
    """加载 channels.yaml，缺失字段用默认值补全。"""
    _ensure_default_config()
    p = _config_path()
    cfg: dict[str, Any] = {}
    try:
        with p.open("r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
    except (OSError, yaml.YAMLError) as exc:
        logger.warning("加载 channels.yaml 失败，使用默认: %s", exc)
        cfg = {}
    # 合并默认值
    merged: dict[str, Any] = {}
    for name, default in _DEFAULT_CONFIG.items():
        merged[name] = {**default, **(cfg.get(name) or {})}
    return merged


class ChannelRegistry:
    """通道注册中心（线程安全单例）。

    - 持有所有通道实例
    - 提供 :meth:`dispatch` 批量分发
    - 提供 :meth:`list_channels` 状态查询
    - 提供 :meth:`update_config` 持久化配置
    """

    _instance: "ChannelRegistry | None" = None
    _instance_lock = threading.Lock()

    def __new__(cls) -> "ChannelRegistry":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self) -> None:
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self._lock = threading.RLock()
        self._channels: dict[str, BaseChannel] = {}
        self._reload()

    def _reload(self) -> None:
        """根据 channels.yaml 重新实例化所有通道。"""
        cfg = _load_config()
        with self._lock:
            self._channels.clear()
            for name, klass in _CHANNEL_CLASSES.items():
                c = cfg.get(name, {})
                try:
                    self._channels[name] = klass(c)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("通道 %s 初始化失败: %s", name, exc)

    def dispatch(
        self, payload: ChannelPayload, channels: list[str] | None = None
    ) -> list[ChannelResult]:
        """向指定通道列表分发消息。

        - ``channels=None`` → 发送给所有 ``enabled=True`` 的通道
        - ``channels=["feishu"]`` → 只发给 feishu（即便 enabled=False 也尝试发送，便于手动测试）
        """
        with self._lock:
            instances = dict(self._channels)

        targets: list[str] = []
        if channels is None:
            targets = [n for n, c in instances.items() if c.enabled]
        else:
            targets = list(channels)

        results: list[ChannelResult] = []
        for name in targets:
            ch = instances.get(name)
            if ch is None:
                results.append(
                    ChannelResult(
                        channel=name,
                        ok=False,
                        message=f"channel '{name}' not registered",
                    )
                )
                continue
            try:
                results.append(ch.send(payload))
            except Exception as exc:  # noqa: BLE001
                logger.warning("通道 %s 异常: %s", name, exc)
                results.append(ChannelResult(channel=name, ok=False, message=str(exc)))
        return results

    def list_channels(self) -> list[dict[str, Any]]:
        """返回所有通道状态。"""
        with self._lock:
            return [c.status() for c in self._channels.values()]

    def get_channel(self, name: str) -> BaseChannel | None:
        with self._lock:
            return self._channels.get(name)

    def update_config(self, new_cfg: dict[str, Any]) -> list[str]:
        """持久化新配置并热重载。返回各通道校验错误列表。"""
        # 校验
        errors: list[str] = []
        for name, cfg in new_cfg.items():
            klass = _CHANNEL_CLASSES.get(name)
            if klass is None:
                errors.append(f"未知通道: {name}")
                continue
            try:
                tmp = klass(cfg)
                errs = tmp.validate_config()
                errors.extend(f"{name}: {e}" for e in errs)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{name}: 初始化失败 {exc}")
        if errors:
            return errors

        # 写文件
        p = _config_path()
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            with p.open("w", encoding="utf-8") as f:
                yaml.safe_dump(
                    new_cfg,
                    f,
                    allow_unicode=True,
                    sort_keys=False,
                    default_flow_style=False,
                )
        except OSError as exc:
            return [f"写入配置失败: {exc}"]

        self._reload()
        return []

    def test_channel(self, name: str) -> ChannelResult:
        """发送一条测试消息到指定通道。"""
        payload = ChannelPayload(
            signal_id="test-" + str(int(__import__("time").time())),
            signal_type="system",
            title=f"【测试】{name} 通道连通性",
            content=f"这是一条测试消息，验证 {name} 通道是否能正常工作。",
            severity="info",
            priority="low",
        )
        with self._lock:
            ch = self._channels.get(name)
        if ch is None:
            return ChannelResult(channel=name, ok=False, message="通道未注册")
        try:
            return ch.send(payload)
        except Exception as exc:  # noqa: BLE001
            return ChannelResult(channel=name, ok=False, message=str(exc))


# ----------------------------------------------------------------------------
# 单例访问
# ----------------------------------------------------------------------------


def get_registry() -> ChannelRegistry:
    """返回 :class:`ChannelRegistry` 单例。"""
    return ChannelRegistry()


def reload_channel_config() -> None:
    """强制重新加载 channels.yaml。"""
    get_registry()._reload()
