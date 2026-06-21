"""YAML 配置加载器。

特性：
1. **单例**：``ConfigLoader()`` 多次实例化返回同一对象。
2. **热加载**：``reload()`` 主动重载；后台线程监听 ``config/*.yaml`` 与
   ``strategies/*.yaml`` 文件变更（基于 mtime 轮询，无需 watchdog 依赖）。
3. **点路径访问**：``get("app.adapter_mode")`` / ``get("paths.duckdb", default)``。
4. **schema 解析**：``app_config()`` / ``theme_config()`` / ``strategies()`` 返回强类型对象。
5. **零硬编码**：所有路径都来自 ``config/app.yaml``，找不到则回退项目根。

典型用法：
    >>> from engine.config.loader import ConfigLoader
    >>> cfg = ConfigLoader()
    >>> cfg.get("app.adapter_mode")
    'mock'
    >>> cfg.app_config().server.port
    8000
"""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

import yaml

from engine.config.schema import (
    AppConfigRoot,
    StrategyConfig,
    ThemeConfig,
)

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------------
# 路径辅助
# ----------------------------------------------------------------------------


def _project_root() -> Path:
    """返回项目根目录（engine/ 的父目录）。

    本文件位于 ``<root>/engine/config/loader.py``，向上两级即根。
    """
    return Path(__file__).resolve().parent.parent.parent


# ----------------------------------------------------------------------------
# ConfigLoader 单例
# ----------------------------------------------------------------------------


class ConfigLoader:
    """全局配置加载器（单例 + 热加载）。

    单例实现：覆盖 ``__new__``，所有 ``ConfigLoader()`` 共享同一实例。
    线程安全：``_lock`` 保护 ``_data`` 读写。
    """

    _instance: "ConfigLoader | None" = None
    _instance_lock = threading.Lock()

    def __new__(cls, *args: Any, **kwargs: Any) -> "ConfigLoader":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                # 仅在首次创建时初始化
                cls._instance._initialized = False
            return cls._instance

    def __init__(self, config_dir: str | os.PathLike | None = None) -> None:
        # 单例：避免重复初始化
        if getattr(self, "_initialized", False):
            return
        self._initialized = True

        self._root = _project_root()
        self._config_dir = (
            Path(config_dir).resolve()
            if config_dir is not None
            else self._root / "config"
        )
        self._strategies_dir: Path = self._config_dir.parent / "strategies"

        self._data: dict[str, Any] = {}
        self._file_mtimes: dict[str, float] = {}
        self._lock = threading.RLock()
        self._watcher_thread: threading.Thread | None = None
        self._watcher_stop = threading.Event()
        self._watcher_interval: float = 2.0  # 秒
        self._listeners: list = []  # 变更回调

        # 首次加载
        self.reload()

    # ------------------------------------------------------------------
    # 加载
    # ------------------------------------------------------------------

    def reload(self) -> None:
        """主动重载所有 YAML 配置。

        重新读取 ``config/*.yaml`` 与 ``strategies/*.yaml``，合并到 ``_data``。
        策略 YAML 以 ``strategy_id`` 为 key 放入 ``_data["strategies"]``。
        """
        with self._lock:
            new_data: dict[str, Any] = {}
            new_mtimes: dict[str, float] = {}

            # 1) config/*.yaml
            for yaml_path in sorted(self._config_dir.glob("*.yaml")):
                try:
                    with open(yaml_path, "r", encoding="utf-8") as fp:
                        doc = yaml.safe_load(fp) or {}
                    if isinstance(doc, dict):
                        new_data.update(doc)
                    new_mtimes[str(yaml_path)] = yaml_path.stat().st_mtime
                except Exception as exc:  # noqa: BLE001
                    logger.error("加载配置失败 %s: %s", yaml_path, exc)

            # 2) strategies/*.yaml
            strategies_dir = Path(
                new_data.get("paths", {}).get("strategies_dir", "")
                or self._strategies_dir
            )
            if not strategies_dir.is_absolute():
                strategies_dir = self._root / strategies_dir
            strategies_map: dict[str, dict[str, Any]] = {}
            if strategies_dir.exists():
                for yaml_path in sorted(strategies_dir.glob("*.yaml")):
                    # 跳过模板
                    if yaml_path.name.startswith("_template"):
                        continue
                    try:
                        with open(yaml_path, "r", encoding="utf-8") as fp:
                            doc = yaml.safe_load(fp) or {}
                        if isinstance(doc, dict) and doc.get("strategy_id"):
                            doc["yaml_path"] = str(yaml_path.relative_to(self._root))
                            strategies_map[doc["strategy_id"]] = doc
                            new_mtimes[str(yaml_path)] = yaml_path.stat().st_mtime
                    except Exception as exc:  # noqa: BLE001
                        logger.error("加载策略 %s 失败: %s", yaml_path, exc)
            new_data["strategies"] = strategies_map

            # 3) schema 校验
            try:
                AppConfigRoot.from_dict(new_data).validate()
            except Exception as exc:  # noqa: BLE001
                logger.warning("app.yaml 校验警告: %s", exc)
            try:
                ThemeConfig.from_dict(new_data).validate()
            except Exception as exc:  # noqa: BLE001
                logger.warning("theme.yaml 校验警告: %s", exc)

            self._data = new_data
            self._file_mtimes = new_mtimes
            logger.info(
                "ConfigLoader reload 完成: %d 个配置文件 + %d 个策略",
                len(new_mtimes) - len(strategies_map),
                len(strategies_map),
            )

        # 通知监听器（RuleSet / MatchRegistry 等缓存类）reload 完成，清各自的缓存
        # 放在 lock 外，避免与各模块的 lock 嵌套
        self._notify_reload()

    # ------------------------------------------------------------------
    # 访问
    # ------------------------------------------------------------------

    def get(self, key: str, default: Any = None) -> Any:
        """点路径取值。

        Args:
            key: 形如 ``"app.adapter_mode"`` / ``"paths.duckdb"``。
            default: 路径不存在时返回。

        Returns:
            值或 default。
        """
        with self._lock:
            cur: Any = self._data
            for part in key.split("."):
                if isinstance(cur, dict) and part in cur:
                    cur = cur[part]
                else:
                    return default
            return cur

    def set(self, key: str, value: Any) -> None:
        """点路径设值（仅内存，不持久化到 YAML）。

        主要用于测试和运行时覆盖。
        """
        with self._lock:
            parts = key.split(".")
            cur = self._data
            for part in parts[:-1]:
                cur = cur.setdefault(part, {})
            cur[parts[-1]] = value

    def all(self) -> dict[str, Any]:
        """返回配置的深拷贝快照（防止外部修改内部状态）。"""
        with self._lock:
            return _deep_copy_dict(self._data)

    # ------------------------------------------------------------------
    # 强类型访问
    # ------------------------------------------------------------------

    def app_config(self) -> AppConfigRoot:
        """返回 ``config/app.yaml`` 对应的 ``AppConfigRoot`` 对象。"""
        with self._lock:
            return AppConfigRoot.from_dict(self._data)

    def theme_config(self) -> ThemeConfig:
        """返回 ``config/theme.yaml`` 对应的 ``ThemeConfig`` 对象。"""
        with self._lock:
            return ThemeConfig.from_dict(self._data)

    def strategies(self) -> dict[str, StrategyConfig]:
        """返回所有策略 ``StrategyConfig`` 字典（key=strategy_id）。"""
        with self._lock:
            raw = self._data.get("strategies", {}) or {}
            out: dict[str, StrategyConfig] = {}
            for sid, payload in raw.items():
                try:
                    out[sid] = _strategy_from_dict(payload)
                except Exception as exc:  # noqa: BLE001
                    logger.error("策略 %s 解析失败: %s", sid, exc)
            return out

    def strategy(self, strategy_id: str) -> StrategyConfig | None:
        """返回单个策略配置。"""
        return self.strategies().get(strategy_id)

    # ------------------------------------------------------------------
    # 文件监听（热加载）
    # ------------------------------------------------------------------

    def start_watcher(self, interval: float | None = None) -> None:
        """启动后台文件监听线程。

        Args:
            interval: 轮询间隔（秒），默认 2.0。
        """
        if self._watcher_thread and self._watcher_thread.is_alive():
            logger.debug("watcher 已在运行")
            return
        if interval is not None:
            self._watcher_interval = float(interval)
        self._watcher_stop.clear()
        self._watcher_thread = threading.Thread(
            target=self._watch_loop,
            name="ConfigLoader-Watcher",
            daemon=True,
        )
        self._watcher_thread.start()
        logger.info("ConfigLoader watcher 已启动 (interval=%.1fs)", self._watcher_interval)

    def stop_watcher(self) -> None:
        """停止后台监听线程。"""
        self._watcher_stop.set()
        if self._watcher_thread:
            self._watcher_thread.join(timeout=5)
            self._watcher_thread = None
        logger.info("ConfigLoader watcher 已停止")

    def add_listener(self, callback) -> None:
        """注册配置变更回调 ``callback(changed_paths: list[str])``。"""
        self._listeners.append(callback)

    def _notify_reload(self) -> None:
        """reload 完成后通知各缓存类（RuleSet / MatchRegistry 等）清缓存。

        采用惰性导入 + try-except，避免循环依赖与异常传染。
        """
        # RuleSet 缓存清
        try:
            from engine.monitor.rules import RuleSet

            RuleSet.invalidate()
        except Exception as exc:  # noqa: BLE001
            logger.debug("RuleSet.invalidate 失败（可忽略）: %s", exc)
        # MatchRegistry 缓存清
        try:
            from engine.monitor.match_registry import MatchRegistry

            MatchRegistry.invalidate()
        except Exception as exc:  # noqa: BLE001
            # Step 8 前模块不存在，可忽略
            logger.debug("MatchRegistry.invalidate 失败（可忽略）: %s", exc)
        # ChannelRegistry 重载（Task R10-3：改 channels.yaml 后 reload 即生效，
        # 无需重启或单独调 PUT /api/channels）
        try:
            from engine.channels.registry import reload_channel_config

            reload_channel_config()
        except Exception as exc:  # noqa: BLE001
            logger.debug("reload_channel_config 失败（可忽略）: %s", exc)

    def _watch_loop(self) -> None:
        """轮询 mtime，发现变化则触发 ``reload()`` 与监听回调。"""
        while not self._watcher_stop.is_set():
            try:
                changed = self._detect_changes()
                if changed:
                    logger.info("检测到配置变更: %s", changed)
                    self.reload()
                    for cb in list(self._listeners):
                        try:
                            cb(changed)
                        except Exception as exc:  # noqa: BLE001
                            logger.error("配置变更回调异常: %s", exc)
            except Exception as exc:  # noqa: BLE001
                logger.error("watcher 循环异常: %s", exc)
            self._watcher_stop.wait(self._watcher_interval)

    def _detect_changes(self) -> list[str]:
        """扫描已知配置文件，返回 mtime 变更的路径列表。"""
        changed: list[str] = []
        # 重新扫描 config / strategies 目录
        candidates: list[Path] = []
        if self._config_dir.exists():
            candidates.extend(self._config_dir.glob("*.yaml"))
        sd = self._strategies_dir
        if sd.exists():
            candidates.extend(sd.glob("*.yaml"))
        # 同时保留旧路径（防止文件被删）
        all_paths = set(candidates) | {Path(p) for p in self._file_mtimes}
        for p in all_paths:
            sp = str(p)
            if not p.exists():
                if sp in self._file_mtimes:
                    changed.append(sp)
                continue
            try:
                mtime = p.stat().st_mtime
            except OSError:
                continue
            if self._file_mtimes.get(sp) != mtime:
                changed.append(sp)
        return changed

    # ------------------------------------------------------------------
    # 兼容 dict-like
    # ------------------------------------------------------------------

    def __getitem__(self, key: str) -> Any:
        v = self.get(key, _SENTINEL)
        if v is _SENTINEL:
            raise KeyError(key)
        return v

    def __contains__(self, key: str) -> bool:
        return self.get(key, _SENTINEL) is not _SENTINEL

    def __repr__(self) -> str:
        return f"<ConfigLoader files={len(self._file_mtimes)} strategies={len(self._data.get('strategies', {}))}>"


_SENTINEL = object()


# ----------------------------------------------------------------------------
# 内部辅助
# ----------------------------------------------------------------------------


def _deep_copy_dict(d: Any) -> Any:
    """简单递归复制 dict/list 标量结构（避免 ``copy.deepcopy`` 的开销）。"""
    if isinstance(d, dict):
        return {k: _deep_copy_dict(v) for k, v in d.items()}
    if isinstance(d, list):
        return [_deep_copy_dict(v) for v in d]
    return d


def _strategy_from_dict(payload: dict[str, Any]) -> StrategyConfig:
    """把策略 YAML 字典解析为 ``StrategyConfig`` dataclass。"""
    from engine.config.schema import (
        StrategyFactorItem,
        StrategyMonitorConfig,
        StrategyScoringConfig,
        StrategySectorConfig,
    )

    sector_raw = payload.get("sector") or {}
    scoring_raw = payload.get("scoring") or {}
    monitor_raw = payload.get("monitor") or {}
    factors_raw = payload.get("factors") or []

    factors = [StrategyFactorItem(**_filter_fields(StrategyFactorItem, f)) for f in factors_raw]
    scoring = StrategyScoringConfig(**_filter_fields(StrategyScoringConfig, scoring_raw))
    monitor = StrategyMonitorConfig(**_filter_fields(StrategyMonitorConfig, monitor_raw))
    sector = StrategySectorConfig(**_filter_fields(StrategySectorConfig, sector_raw))

    return StrategyConfig(
        **_filter_fields(
            StrategyConfig,
            {
                "strategy_id": payload.get("strategy_id", ""),
                "strategy_name": payload.get("strategy_name", ""),
                "strategy_emoji": payload.get("strategy_emoji", ""),
                "version": payload.get("version", "1.0"),
                "enabled": payload.get("enabled", True),
                "sector": sector,
                "universe": payload.get("universe") or {},
                "cleaning": payload.get("cleaning") or {},
                "factors": factors,
                "scoring": scoring,
                "output": payload.get("output") or {},
                "monitor": monitor,
                "export": payload.get("export") or {},
                "yaml_path": payload.get("yaml_path", ""),
            },
        )
    )


def _filter_fields(cls: type, d: dict[str, Any]) -> dict[str, Any]:
    """过滤掉 dataclass 不认识的字段，避免 TypeError。

    Args:
        cls: 目标 dataclass 类型。
        d: 原始字段字典。

    Returns:
        仅包含 ``cls`` 已声明字段的新字典。
    """
    import dataclasses as _dc

    allowed = {f.name for f in _dc.fields(cls)}
    return {k: v for k, v in d.items() if k in allowed}
