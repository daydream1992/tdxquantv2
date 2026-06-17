"""导出器抽象基类。

所有导出器继承 :class:`DataExporter`，实现 :meth:`export` 即可被
:class:`engine.pipeline.steps.export.ExportStep` 调用。

设计要点
--------
1. **统一接口**: ``export(context) -> str``，返回导出文件路径或标识。
2. **配置驱动**: 路径/文件名/字段映射等都从 ``config/export.yaml`` 读取。
3. **可注入 storage**: DuckDB 导出器需要 storage 实例，其他导出器可选。
4. **不修改 context**: 导出器只读 context，不修改。
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from engine.pipeline.base import PipelineContext

# P1-3 依赖: 用 try/except 兜底
try:  # pragma: no cover
    from engine.storage.duckdb_store import DuckDBStore  # type: ignore
except (ImportError, AttributeError, Exception):  # pragma: no cover
    class DuckDBStore:  # type: ignore[no-redef]
        """P1-3 占位。"""
        # TODO: 待 P1-3 完成


class ExporterError(Exception):
    """导出器异常基类。"""


class DataExporter(ABC):
    """数据导出器抽象基类。

    Parameters
    ----------
    config:
        该导出器在 ``config/export.yaml`` 中的配置节。
    storage:
        DuckDB 存储实例（可选）。
    strategy_config:
        策略 YAML 配置（可选，用于读取策略专属导出设置）。
    """

    exporter_id: str = ""
    """导出器唯一标识，对应 ``export.yaml`` 的 key。"""

    exporter_name: str = ""
    """导出器中文名，用于日志。"""

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        storage: DuckDBStore | None = None,
        strategy_config: dict[str, Any] | None = None,
    ) -> None:
        if not self.exporter_id:
            raise ValueError(f"{type(self).__name__} 必须设置 exporter_id 类属性")
        self.config: dict[str, Any] = config or {}
        self.storage: DuckDBStore | None = storage
        self.strategy_config: dict[str, Any] = strategy_config or {}
        self.logger = logging.getLogger(f"engine.exporters.{self.exporter_id}")

    @abstractmethod
    def export(self, context: PipelineContext) -> str:
        """导出数据。

        Parameters
        ----------
        context:
            流水线上下文，包含 ``context.final`` (最终结果) 等数据。

        Returns
        -------
        str
            导出文件路径或标识（如 DuckDB 表名）。
        """
        raise NotImplementedError

    def __repr__(self) -> str:
        return f"<DataExporter {self.exporter_id} name={self.exporter_name!r}>"
