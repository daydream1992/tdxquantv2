"""流水线运行器 - 加载策略 YAML、构建 Pipeline、执行、记录 strategy_runs。

用法
----
>>> from engine.pipeline.runner import StrategyRunner
>>> runner = StrategyRunner(adapter=..., storage=...)
>>> context = runner.run_strategy("dbqzt")

P1-3 依赖
----------
- ``engine.config.loader.ConfigLoader``  - 加载策略 YAML
- ``engine.data_adapter.base.BaseDataAdapter`` - 数据适配器
- ``engine.storage.duckdb_store.DuckDBStore``   - DuckDB 存储（记录 strategy_runs）
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import pandas as pd

# P1-3 依赖: 分开导入, 每个模块独立兜底
try:  # pragma: no cover
    from engine.config.loader import ConfigLoader  # type: ignore
    _CONFIG_LOADER_READY = True
except (ImportError, AttributeError, Exception):  # noqa: BLE001
    _CONFIG_LOADER_READY = False

    class ConfigLoader:  # type: ignore[no-redef]
        """P1-3 占位 ConfigLoader。"""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def get(self, key: str, default: Any = None) -> Any:
            return default

        def all(self) -> dict[str, Any]:
            return {}

        def strategy(self, strategy_id: str) -> Any:
            return None

        @staticmethod
        def load(path: str) -> dict[str, Any]:
            # TODO: 待 P1-3 完成
            import yaml
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}


try:  # pragma: no cover
    from engine.data_adapter.base import BaseDataAdapter  # type: ignore
    _ADAPTER_READY = True
except (ImportError, AttributeError, Exception):  # noqa: BLE001
    _ADAPTER_READY = False

    class BaseDataAdapter:  # type: ignore[no-redef]
        """P1-3 占位基类。"""
        # TODO: 待 P1-3 完成


try:  # pragma: no cover
    from engine.storage.duckdb_store import DuckDBStore  # type: ignore
    _STORAGE_READY = True
except (ImportError, AttributeError, Exception):  # noqa: BLE001
    _STORAGE_READY = False

    class DuckDBStore:  # type: ignore[no-redef]
        """P1-3 占位基类。"""
        # TODO: 待 P1-3 完成


# R18-A: QuestDB 无 SEQUENCE，应用层生成 id（monitor_subscriptions 表需要）
try:
    from engine.storage.questdb_store import _gen_id  # type: ignore
except (ImportError, AttributeError, Exception):  # noqa: BLE001
    def _gen_id() -> int:  # type: ignore[no-redef]
        """占位 _gen_id（questdb_store 不可用时兜底）。"""
        import time as _time
        import random as _random
        return int(_time.time() * 1000) * 10000 + _random.randint(0, 9999)


# 兼容旧代码: P1-3 整体就绪标志
_P1_3_READY = _CONFIG_LOADER_READY and _ADAPTER_READY and _STORAGE_READY


from engine.pipeline.base import (
    PipelineContext,
    PipelineError,
    SelectionPipeline,
    StepExecutionError,
)
from engine.pipeline.steps.calc_factors import CalcFactorsStep
from engine.pipeline.steps.clean_data import CleanDataStep
from engine.pipeline.steps.export import ExportStep
from engine.pipeline.steps.filter_sort import FilterSortStep
from engine.pipeline.steps.load_data import LoadDataStep
from engine.pipeline.steps.score import ScoreStep

logger = logging.getLogger(__name__)


class StrategyRunner:
    """策略运行器。

    Parameters
    ----------
    adapter:
        数据适配器实例。
    storage:
        DuckDB 存储实例。
    strategies_dir:
        策略 YAML 目录，默认 ``strategies/``。
    factor_registry:
        可选的 FactorRegistry 实例（默认懒加载）。
    """

    def __init__(
        self,
        adapter: BaseDataAdapter | None = None,
        storage: DuckDBStore | None = None,
        strategies_dir: str | Path = "strategies",
        factor_registry: Any | None = None,
    ) -> None:
        self.adapter = adapter
        self.storage = storage
        self.strategies_dir = Path(strategies_dir)
        self._factor_registry = factor_registry
        self.logger = logging.getLogger("engine.pipeline.StrategyRunner")

    # ---- 公共 API ----
    def run_strategy(self, strategy_id: str) -> PipelineContext:
        """加载策略 YAML → 构建流水线 → 执行 → 记录 strategy_runs。"""
        self.logger.info("启动策略: %s", strategy_id)
        strategy_config = self._load_strategy(strategy_id)
        if not strategy_config.get("enabled", True):
            self.logger.warning("策略 %s 已禁用，跳过", strategy_id)
            raise PipelineError(f"策略 {strategy_id} 已禁用")

        pipeline = self._build_pipeline(strategy_config)
        context = pipeline.run()

        # 记录 strategy_runs
        self._record_run(context)

        # §15.7 冷启动自动注入订阅：选股完成后主动 upsert_subscription 带 strategy_id
        # 让监控引擎启动即有股票可盯，snap.strategy_id 正确填充
        self._inject_monitor_subscriptions(context)

        return context

    def list_strategies(self) -> list[str]:
        """列出 strategies/ 目录下所有 strategy_id。"""
        if not self.strategies_dir.is_dir():
            return []
        ids: list[str] = []
        for p in self.strategies_dir.glob("strategy_*.yaml"):
            # 文件名格式: strategy_<id>.yaml
            stem = p.stem  # strategy_dbqzt
            if stem.startswith("strategy_"):
                ids.append(stem[len("strategy_"):])
        return sorted(ids)

    # ---- 内部方法 ----
    def _load_strategy(self, strategy_id: str) -> dict[str, Any]:
        """加载策略 YAML。

        优先用真实 P1-3 ``ConfigLoader().strategy(id)`` (返回 StrategyConfig dataclass)，
        兜底用 yaml 直接读 ``strategies/strategy_<id>.yaml``。
        """
        # 1. 优先用 ConfigLoader 实例
        if _P1_3_READY:
            try:
                loader = ConfigLoader()
                # P1-3 真实接口: strategy(id) 返回 StrategyConfig dataclass 或 None
                strat = loader.strategy(strategy_id)  # type: ignore[attr-defined]
                if strat is not None:
                    # dataclass → dict (递归)
                    return _strategy_to_dict(strat)
                # 也尝试从 all() 取原始 dict
                all_strategies = loader.get("strategies", {}) or {}  # type: ignore[attr-defined]
                if isinstance(all_strategies, dict) and strategy_id in all_strategies:
                    return all_strategies[strategy_id]
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("ConfigLoader 取策略 %s 失败, 兜底直接读 yaml: %s", strategy_id, exc)

        # 2. 兜底: 直接读 strategies/strategy_<id>.yaml
        path = self.strategies_dir / f"strategy_{strategy_id}.yaml"
        if not path.exists():
            raise PipelineError(f"策略 YAML 不存在: {path}")
        try:
            if hasattr(ConfigLoader, "load"):
                config = ConfigLoader.load(str(path))  # type: ignore[attr-defined]
            else:
                import yaml
                with open(path, "r", encoding="utf-8") as f:
                    config = yaml.safe_load(f) or {}
        except Exception as exc:  # noqa: BLE001
            raise PipelineError(f"加载策略 {path} 失败: {exc}") from exc
        if config.get("strategy_id") != strategy_id:
            self.logger.warning(
                "策略 YAML strategy_id=%s 与请求 %s 不一致",
                config.get("strategy_id"), strategy_id,
            )
        return config

    def _build_pipeline(self, strategy_config: dict[str, Any]) -> SelectionPipeline:
        """构建流水线。"""
        steps = [
            LoadDataStep(
                config=strategy_config,
                adapter=self.adapter,
                storage=self.storage,
            ),
            CleanDataStep(
                config=strategy_config,
                adapter=self.adapter,
                storage=self.storage,
            ),
            CalcFactorsStep(
                config=strategy_config,
                adapter=self.adapter,
                storage=self.storage,
                registry=self._factor_registry,
            ),
            ScoreStep(
                config=strategy_config,
                adapter=self.adapter,
                storage=self.storage,
            ),
            FilterSortStep(
                config=strategy_config,
                adapter=self.adapter,
                storage=self.storage,
            ),
            ExportStep(
                config=strategy_config,
                adapter=self.adapter,
                storage=self.storage,
            ),
        ]
        return SelectionPipeline(
            strategy_config=strategy_config,
            steps=steps,
            adapter=self.adapter,
            storage=self.storage,
        )

    def _record_run(self, context: PipelineContext) -> None:
        """记录 strategy_runs 到 DuckDB。

        P1-3 DuckDBStore 接口未稳定时，仅记录日志。
        """
        if self.storage is None:
            self.logger.info("未注入 storage，跳过 strategy_runs 记录")
            return
        import json
        from datetime import datetime
        record = {
            "run_id": context.run_id,
            "strategy_id": context.strategy_id,
            "run_date": context.started_at.date(),
            "status": "completed",
            "started_at": context.started_at,
            "finished_at": context.finished_at or datetime.now(),
            "duration_ms": int((context.duration_sec or 0) * 1000),
            "universe_count": int(context.metadata.get("universe_count", 0)),
            "result_count": 0 if context.final is None else len(context.final),
            "error_message": "",
            "context": json.dumps({"metadata": str(context.metadata)[:1000]}, ensure_ascii=False),
        }
        try:
            # 真实 P1-3 DuckDBStore 已有 execute / executemany / table_exists
            # strategy_runs 表有 11 列（schema.sql），用显式列名 INSERT 避免列数不匹配
            if hasattr(self.storage, "execute"):
                self.storage.execute(  # type: ignore[attr-defined]
                    """INSERT INTO strategy_runs
                    (run_id, strategy_id, run_date, status, started_at, finished_at,
                     duration_ms, universe_count, result_count, error_message, context)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [
                        record["run_id"], record["strategy_id"], record["run_date"],
                        record["status"], record["started_at"], record["finished_at"],
                        record["duration_ms"], record["universe_count"],
                        record["result_count"], record["error_message"], record["context"],
                    ],
                )
                self.logger.info("strategy_runs 已记录: run_id=%s", record["run_id"])
            elif hasattr(self.storage, "insert_strategy_run"):
                self.storage.insert_strategy_run(record)  # type: ignore[attr-defined]
            else:
                self.logger.info("DuckDBStore 无可用写入方法，跳过 strategy_runs 记录: %s", record)
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("记录 strategy_runs 失败 (可能 schema 字段不匹配): %s", exc)

    def _inject_monitor_subscriptions(self, context: PipelineContext) -> None:
        """§15.7 冷启动自动注入订阅：把选股结果主动写入监控订阅。

        - 调 ``EngineState.upsert_subscription(code, strategy_id=context.strategy_id,
          subscriber="pipeline_auto")`` 让 ``MonitorEngine`` 启动即有股票可盯
        - 同时写 ``monitor_subscriptions`` 表持久化（跨重启订阅不丢）
        - 异常 try-except 不阻断选股主流程

        股票来源：``context.final`` DataFrame 的 ``code`` / ``stock_code`` 列。
        """
        if context.final is None or context.final.empty:
            self.logger.info("选股结果为空，跳过监控订阅注入: %s", context.strategy_id)
            return
        try:
            from engine.api.state import EngineState
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("导入 EngineState 失败，跳过订阅注入: %s", exc)
            return

        # 收集 stock_code（兼容 code / stock_code 两种列名）
        codes: list[str] = []
        for col in ("code", "stock_code"):
            if col in context.final.columns:
                codes = [str(v).strip() for v in context.final[col].tolist() if v]
                break
        if not codes:
            self.logger.info("选股结果无 code/stock_code 列，跳过订阅注入")
            return

        state = EngineState()
        sid = str(context.strategy_id or "")
        injected = 0
        for i, code in enumerate(codes):
            if not code:
                continue
            batch_no = (i // 50) + 1
            try:
                state.upsert_subscription(
                    code,
                    strategy_id=sid,
                    subscriber="pipeline_auto",
                    batch_no=batch_no,
                )
                self._persist_subscription(code, sid, "pipeline_auto", batch_no)
                injected += 1
            except Exception as exc:  # noqa: BLE001
                self.logger.debug("upsert_subscription %s 失败: %s", code, exc)
        self.logger.info(
            "监控订阅自动注入完成: strategy=%s, %d/%d 只股票",
            sid, injected, len(codes),
        )

    def _persist_subscription(
        self,
        code: str,
        strategy_id: str,
        subscriber: str,
        batch_no: int,
    ) -> None:
        """写 monitor_subscriptions 表持久化订阅（跨重启不丢）。

        注：用 DELETE+INSERT 而非 UPDATE，规避 DuckDB 索引下 UPDATE 的
        "Failed to delete all rows from index" bug。
        """
        if self.storage is None or not hasattr(self.storage, "table_exists"):
            return
        try:
            if not self.storage.table_exists("monitor_subscriptions"):
                return
            # 同 stock_code 旧 active 记录先软删除（QuestDB 无 DELETE，用 UPDATE 归档）
            self.storage.execute(  # type: ignore[attr-defined]
                "UPDATE monitor_subscriptions SET active = false, unsubscribed_at = now() "
                "WHERE stock_code = ? AND active = true",
                [code],
            )
            self.storage.execute(  # type: ignore[attr-defined]
                """
                INSERT INTO monitor_subscriptions
                    (id, strategy_id, stock_code, subscriber, subscribed_at, active, batch_no)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, true, ?)
                """,
                [_gen_id(), strategy_id, code, subscriber, batch_no],
            )
        except Exception as exc:  # noqa: BLE001
            self.logger.debug("写 monitor_subscriptions 失败（可忽略）: %s", exc)


# 模块级辅助函数
def _strategy_to_dict(strategy: Any) -> dict[str, Any]:
    """把 P1-3 StrategyConfig dataclass 递归转为 dict。"""
    import dataclasses
    if dataclasses.is_dataclass(strategy):
        result: dict[str, Any] = {}
        for f in dataclasses.fields(strategy):
            val = getattr(strategy, f.name)
            result[f.name] = _strategy_to_dict(val)
        return result
    if isinstance(strategy, list):
        return [_strategy_to_dict(x) for x in strategy]
    if isinstance(strategy, dict):
        return {k: _strategy_to_dict(v) for k, v in strategy.items()}
    return strategy
