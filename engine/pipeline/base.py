"""选股流水线核心抽象。

定义 :class:`PipelineContext`（步骤间共享数据的上下文）、
:class:`PipelineStep`（步骤抽象基类）、
:class:`SelectionPipeline`（流水线执行器）。

P1-3 依赖
----------
本模块依赖 P1-3 子代理创建的:
- :class:`engine.data_adapter.base.BaseDataAdapter`  - 数据适配器
- :class:`engine.storage.duckdb_store.DuckDBStore`    - DuckDB 存储
- :class:`engine.config.loader.ConfigLoader`          - 配置加载器

P1-3 尚未完成时，使用 try/except 兜底类型别名，保证模块可导入。
"""
from __future__ import annotations

import logging
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

import pandas as pd

# P1-3 依赖: 用 try/except 兜底类型别名，保证模块可独立导入。
# 单独导入每个模块, 任一失败不影响其他模块的导入。
try:  # pragma: no cover - P1-3 完成后此分支生效
    from engine.data_adapter.base import BaseDataAdapter  # type: ignore
except (ImportError, AttributeError, Exception):  # pragma: no cover - P1-3 未完成时此分支生效
    class BaseDataAdapter:  # type: ignore[no-redef]
        """P1-3 占位基类，等真实 BaseDataAdapter 实现后自动覆盖。"""
        # TODO: 待 P1-3 完成


try:  # pragma: no cover
    from engine.storage.duckdb_store import DuckDBStore  # type: ignore
except (ImportError, AttributeError, Exception):  # pragma: no cover
    class DuckDBStore:  # type: ignore[no-redef]
        """P1-3 占位基类，等真实 DuckDBStore 实现后自动覆盖。"""
        # TODO: 待 P1-3 完成


_P1_3_READY = True  # 标记: 单独模块各自就绪


if TYPE_CHECKING:  # 仅用于类型注解，运行时不导入
    pass

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------
class PipelineError(Exception):
    """流水线异常基类。"""


class StepExecutionError(PipelineError):
    """步骤执行异常。"""

    def __init__(self, step_id: str, message: str, cause: Exception | None = None) -> None:
        self.step_id = step_id
        self.cause = cause
        super().__init__(f"[step={step_id}] {message}")


# ---------------------------------------------------------------------------
# 上下文
# ---------------------------------------------------------------------------
@dataclass
class PipelineContext:
    """流水线上下文，在步骤间传递数据。

    设计原则
    --------
    - **单一职责**: 只负责数据存储与简单派生，不含业务逻辑。
    - **可序列化**: 主要字段（data/factors/scores）均为 pandas 对象，便于持久化。
    - **可追溯**: ``metadata`` 记录每步执行耗时、跳过原因等。
    """

    strategy_id: str
    """策略 ID，对应策略 YAML ``strategy_id``。"""

    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    """本次运行的唯一标识，默认用 12 位 uuid 短码。"""

    data: dict[str, pd.DataFrame] = field(default_factory=dict)
    """各类原始/派生数据。

    常用 key:
    - ``snapshot`` - 全市场 L2 快照
    - ``kline``    - K 线数据（多周期/多日合并）
    - ``financial``- 财务数据
    - ``universe`` - 经过 universe 过滤后的股票池
    - ``cleaned``  - 清洗后的合并 DataFrame（给因子计算用）
    """

    factors: dict[str, pd.Series] = field(default_factory=dict)
    """因子计算结果。key=factor_id, value=每只股票的因子值。"""

    scores: pd.DataFrame | None = None
    """评分结果 DataFrame，包含各因子分项得分与 ``total_score``。"""

    final: pd.DataFrame | None = None
    """最终输出 DataFrame（filter_sort 之后）。"""

    config: dict[str, Any] = field(default_factory=dict)
    """策略配置（来自 YAML，只读副本）。"""

    started_at: datetime = field(default_factory=datetime.now)
    """流水线开始时间。"""

    finished_at: datetime | None = None
    """流水线结束时间（run() 结束时设置）。"""

    metadata: dict[str, Any] = field(default_factory=dict)
    """元数据，记录每步耗时、跳过原因、警告等。"""

    # ---- 便捷方法 ----
    def mark_step_done(self, step_id: str, duration_sec: float, **extra: Any) -> None:
        """记录某步骤执行完成。"""
        steps = self.metadata.setdefault("steps", [])
        steps.append({"step_id": step_id, "duration_sec": duration_sec, **extra})

    def add_warning(self, step_id: str, message: str) -> None:
        warnings = self.metadata.setdefault("warnings", [])
        warnings.append({"step_id": step_id, "message": message})

    @property
    def duration_sec(self) -> float | None:
        if self.finished_at is None:
            return None
        return (self.finished_at - self.started_at).total_seconds()

    def to_summary(self) -> dict[str, Any]:
        """返回可序列化的运行摘要（不含 DataFrame）。"""
        n_final = 0 if self.final is None else len(self.final)
        return {
            "strategy_id": self.strategy_id,
            "run_id": self.run_id,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "duration_sec": self.duration_sec,
            "n_factors": len(self.factors),
            "n_final_stocks": n_final,
            "data_keys": list(self.data.keys()),
            "factor_ids": list(self.factors.keys()),
            "metadata": self.metadata,
        }


# ---------------------------------------------------------------------------
# 步骤抽象
# ---------------------------------------------------------------------------
class PipelineStep(ABC):
    """选股流水线步骤基类。

    子类需设置 ``step_id`` 类属性并实现 :meth:`execute`。

    构造参数
    ---------
    config:
        步骤配置（通常是策略 YAML 中的某个子节，如 ``cleaning`` / ``factors``）。
    adapter:
        数据适配器实例，用于拉取行情/财务数据。
    storage:
        DuckDB 存储实例，用于持久化中间结果。
    """

    step_id: str = ""
    """步骤唯一标识，用于日志与 metadata 追踪。"""

    step_name: str = ""
    """步骤中文名，用于日志。"""

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        adapter: BaseDataAdapter | None = None,
        storage: DuckDBStore | None = None,
    ) -> None:
        if not self.step_id:
            raise ValueError(f"{type(self).__name__} 必须设置 step_id 类属性")
        self.config: dict[str, Any] = config or {}
        self.adapter: BaseDataAdapter | None = adapter
        self.storage: DuckDBStore | None = storage
        self.logger = logging.getLogger(f"engine.pipeline.step.{self.step_id}")

    @abstractmethod
    def execute(self, context: PipelineContext) -> PipelineContext:
        """执行步骤，返回更新后的 context。

        实现要点:
        - 不修改入参 context 的不可变字段（如 strategy_id）。
        - 在 context.data/factors/scores 上原地或拷贝更新。
        - 出错时抛 :class:`StepExecutionError`，由上层捕获。
        """
        raise NotImplementedError

    # ---- 内部工具 ----
    def _require_adapter(self) -> BaseDataAdapter:
        if self.adapter is None:
            raise StepExecutionError(self.step_id, "数据适配器未注入")
        return self.adapter

    def _require_storage(self) -> DuckDBStore:
        if self.storage is None:
            raise StepExecutionError(self.step_id, "DuckDB 存储未注入")
        return self.storage

    def __repr__(self) -> str:
        return f"<PipelineStep {self.step_id} name={self.step_name!r}>"


# ---------------------------------------------------------------------------
# 流水线执行器
# ---------------------------------------------------------------------------
class SelectionPipeline:
    """选股流水线执行器。

    Parameters
    ----------
    strategy_config:
        策略 YAML 解析后的字典。
    steps:
        有序步骤列表，按顺序执行。
    adapter:
        数据适配器（注入到每个 step）。
    storage:
        DuckDB 存储（注入到每个 step）。
    """

    def __init__(
        self,
        strategy_config: dict[str, Any],
        steps: list[PipelineStep],
        adapter: BaseDataAdapter | None = None,
        storage: DuckDBStore | None = None,
    ) -> None:
        if not strategy_config.get("strategy_id"):
            raise PipelineError("strategy_config 必须包含 strategy_id")
        self.strategy_config = strategy_config
        self.steps = steps
        self.adapter = adapter
        self.storage = storage
        self.logger = logging.getLogger("engine.pipeline.SelectionPipeline")

    def run(self) -> PipelineContext:
        """依次执行所有步骤，返回最终 context。

        异常处理
        --------
        - 单步异常默认向上抛出（fail-fast）。
        - 步骤可通过 ``config["continue_on_error"]=True`` 标记为非致命，
          此时异常被记录到 context.metadata，流水线继续。
        """
        context = PipelineContext(
            strategy_id=self.strategy_config["strategy_id"],
            config=self.strategy_config,
        )
        self.logger.info(
            "Pipeline 启动 strategy_id=%s run_id=%s steps=%s",
            context.strategy_id, context.run_id,
            [s.step_id for s in self.steps],
        )

        for step in self.steps:
            step_start = time.time()
            try:
                self.logger.info("→ [%s] %s 开始", step.step_id, step.step_name)
                context = step.execute(context)
                duration = time.time() - step_start
                context.mark_step_done(step.step_id, duration, status="ok")
                self.logger.info("✓ [%s] %s 完成 %.2fs", step.step_id, step.step_name, duration)
            except StepExecutionError as exc:
                duration = time.time() - step_start
                context.mark_step_done(
                    step.step_id, duration, status="error", error=str(exc)
                )
                self.logger.exception("✗ [%s] %s 失败: %s", step.step_id, step.step_name, exc)
                if not step.config.get("continue_on_error", False):
                    context.finished_at = datetime.now()
                    raise
                context.add_warning(step.step_id, f"步骤异常被吞掉: {exc}")
            except Exception as exc:  # noqa: BLE001
                duration = time.time() - step_start
                wrapped = StepExecutionError(step.step_id, f"未捕获异常: {exc}", exc)
                context.mark_step_done(
                    step.step_id, duration, status="error", error=str(wrapped)
                )
                self.logger.exception("✗ [%s] %s 未捕获异常", step.step_id, step.step_name)
                if not step.config.get("continue_on_error", False):
                    context.finished_at = datetime.now()
                    raise wrapped
                context.add_warning(step.step_id, f"未捕获异常被吞掉: {wrapped}")

        context.finished_at = datetime.now()
        self.logger.info(
            "Pipeline 完成 strategy_id=%s run_id=%s duration=%.2fs n_final=%d",
            context.strategy_id,
            context.run_id,
            context.duration_sec or 0.0,
            0 if context.final is None else len(context.final),
        )
        return context

    def __repr__(self) -> str:
        return (
            f"<SelectionPipeline strategy_id={self.strategy_config.get('strategy_id')!r} "
            f"steps={[s.step_id for s in self.steps]}>"
        )
