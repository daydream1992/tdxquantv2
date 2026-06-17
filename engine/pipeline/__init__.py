"""选股流水线框架 (L2 核心引擎层)。

设计目标
--------
1. **配置驱动**: 流水线步骤从策略 YAML 读取参数，不硬编码。
2. **可插拔步骤**: 每个步骤是独立的 :class:`PipelineStep`，可单独替换/扩展。
3. **上下文传递**: :class:`PipelineContext` 在步骤间共享数据，避免步骤间耦合。
4. **可观测**: 每步执行前后记录日志、耗时、异常，便于排查。
5. **可重放**: ``run_id`` 唯一标识一次执行，配合 DuckDB 持久化可回放。

典型流程
--------
1. ``LoadDataStep``    - 加载全市场股票 + K线 + 快照 + 财务数据
2. ``CleanDataStep``   - 应用 cleaning_rules.yaml 与策略 custom_rules
3. ``CalcFactorsStep`` - 调用因子插件计算各因子
4. ``ScoreStep``       - 表达式引擎求值 scoring.formula，应用归一化与惩罚
5. ``FilterSortStep``  - 按 min_score 过滤 + sort_by 排序 + top_n 截断
6. ``ExportStep``      - 调用所有启用的 Exporter 导出结果
"""
from engine.pipeline.base import (
    PipelineContext,
    PipelineStep,
    SelectionPipeline,
    PipelineError,
    StepExecutionError,
)

__all__ = [
    "PipelineContext",
    "PipelineStep",
    "SelectionPipeline",
    "PipelineError",
    "StepExecutionError",
]
