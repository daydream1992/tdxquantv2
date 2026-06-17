"""数据适配器工厂。

根据 ``config/app.yaml`` 的 ``app.adapter_mode`` 切换 Mock / Real 实例。
工厂函数缓存单例，避免重复创建（MockAdapter 会预加载 CSV，重复实例化开销大）。
"""

from __future__ import annotations

import logging
import threading

from engine.config.loader import ConfigLoader
from engine.data_adapter.base import BaseDataAdapter

logger = logging.getLogger(__name__)


_ADAPTER_LOCK = threading.Lock()
_ADAPTER_INSTANCE: BaseDataAdapter | None = None
_ADAPTER_MODE: str | None = None


def get_adapter(force_reload: bool = False) -> BaseDataAdapter:
    """获取当前模式对应的数据适配器单例。

    Args:
        force_reload: 强制重新创建（用于配置热加载后切换模式）。

    Returns:
        ``MockAdapter`` 或 ``RealAdapter`` 实例。

    Raises:
        ValueError: ``app.adapter_mode`` 配置非法。
    """
    global _ADAPTER_INSTANCE, _ADAPTER_MODE

    cfg = ConfigLoader()
    mode = cfg.get("app.adapter_mode", "mock")

    with _ADAPTER_LOCK:
        if _ADAPTER_INSTANCE is not None and not force_reload and _ADAPTER_MODE == mode:
            return _ADAPTER_INSTANCE

        # 模式切换：先关闭旧实例
        if _ADAPTER_INSTANCE is not None and (_ADAPTER_MODE != mode or force_reload):
            try:
                _ADAPTER_INSTANCE.close()
            except Exception as exc:  # noqa: BLE001
                logger.warning("关闭旧适配器异常: %s", exc)
            _ADAPTER_INSTANCE = None

        if mode == "mock":
            from engine.data_adapter.mock_adapter import MockAdapter

            adapter = MockAdapter()
        elif mode == "real":
            from engine.data_adapter.real_adapter import RealAdapter

            adapter = RealAdapter()
        else:
            raise ValueError(
                f"app.adapter_mode 必须为 mock/real，当前: {mode!r}"
            )

        if not adapter.initialize():
            logger.error("适配器初始化失败 (mode=%s)", mode)
        _ADAPTER_INSTANCE = adapter
        _ADAPTER_MODE = mode
        logger.info("数据适配器已切换为 %s 模式", mode)
        return _ADAPTER_INSTANCE


def reset_adapter() -> None:
    """重置单例（测试用）。"""
    global _ADAPTER_INSTANCE, _ADAPTER_MODE
    with _ADAPTER_LOCK:
        if _ADAPTER_INSTANCE is not None:
            try:
                _ADAPTER_INSTANCE.close()
            except Exception:  # noqa: BLE001
                pass
        _ADAPTER_INSTANCE = None
        _ADAPTER_MODE = None
