"""FastAPI 依赖注入工具。

每个 ``Depends(get_xxx)`` 都返回单例（或工厂单例），保证：
- ``ConfigLoader`` / ``DuckDBStore`` 复用同一实例（已在各自模块实现单例）
- ``BaseDataAdapter`` 通过工厂函数缓存
- ``SectorManager`` / ``StrategyRunner`` 基于 adapter/storage 构造一次

为避免在 ``import engine.api.deps`` 时就触发各组件初始化（影响测试隔离），
所有 ``get_xxx`` 都使用懒加载（首次调用才构造）。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Depends, HTTPException

from engine.api.state import EngineState, get_engine_state

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------------
# ConfigLoader
# ----------------------------------------------------------------------------


def get_config() -> Any:
    """返回 :class:`engine.config.loader.ConfigLoader` 单例。"""
    from engine.config.loader import ConfigLoader

    return ConfigLoader()


# ----------------------------------------------------------------------------
# DuckDBStore
# ----------------------------------------------------------------------------


def get_storage() -> Any:
    """返回 :class:`engine.storage.duckdb_store.DuckDBStore` 单例。

    失败时返回 503（数据库不可用，整个引擎不可用）。
    """
    try:
        from engine.storage.duckdb_store import DuckDBStore

        return DuckDBStore()
    except Exception as exc:  # noqa: BLE001
        logger.exception("DuckDBStore 初始化失败")
        raise HTTPException(
            status_code=503,
            detail=f"DuckDB 存储不可用: {exc}",
        ) from exc


# ----------------------------------------------------------------------------
# BaseDataAdapter
# ----------------------------------------------------------------------------


def get_adapter() -> Any:
    """返回当前模式对应的 :class:`BaseDataAdapter` 单例。"""
    try:
        from engine.data_adapter.factory import get_adapter as _get_adapter

        return _get_adapter()
    except Exception as exc:  # noqa: BLE001
        logger.exception("数据适配器初始化失败")
        raise HTTPException(
            status_code=503,
            detail=f"数据适配器不可用: {exc}",
        ) from exc


# ----------------------------------------------------------------------------
# SectorManager
# ----------------------------------------------------------------------------


def get_sector_manager(adapter: Any = Depends(get_adapter)) -> Any:
    """返回 :class:`engine.sector.manager.SectorManager`。"""
    from engine.sector.manager import SectorManager

    return SectorManager(adapter)


# ----------------------------------------------------------------------------
# StrategyRunner
# ----------------------------------------------------------------------------


def get_runner(
    adapter: Any = Depends(get_adapter),
    storage: Any = Depends(get_storage),
    config: Any = Depends(get_config),
) -> Any:
    """返回 :class:`engine.pipeline.runner.StrategyRunner`。

    会注入 adapter / storage / strategies_dir（来自配置）。
    """
    from engine.pipeline.runner import StrategyRunner

    strategies_dir = config.get("paths.strategies_dir", "./strategies")
    runner = StrategyRunner(
        adapter=adapter,
        storage=storage,
        strategies_dir=strategies_dir,
    )
    return runner


# ----------------------------------------------------------------------------
# EngineState
# ----------------------------------------------------------------------------


def get_state() -> EngineState:
    """返回引擎运行时状态单例。"""
    return get_engine_state()
