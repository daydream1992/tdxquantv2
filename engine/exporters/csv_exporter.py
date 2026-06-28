"""CSV 导出器。

特性
----
- 路径来自 ``config/export.yaml`` 的 ``csv.output_dir``
- 文件名格式来自 ``csv.filename_pattern``，支持占位符:
  - ``{strategy_id}`` - 策略 ID
  - ``{date}``        - 当前日期 (YYYYMMDD)
  - ``{run_id}``      - 流水线 run_id
- 字段映射来自 ``csv.field_mapping``，与 V8 CSV 列名兼容
- 编码 ``csv.encoding``，默认 ``utf-8-sig`` (BOM, Excel 兼容)
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from engine.exporters.base import DataExporter, ExporterError
from engine.pipeline.base import PipelineContext

logger = logging.getLogger(__name__)


class CsvExporter(DataExporter):
    """CSV 导出器。"""

    exporter_id = "csv"
    exporter_name = "CSV 导出"

    def export(self, context: PipelineContext) -> str:
        output_dir = Path(self.config.get("output_dir", "./data/csv"))
        output_dir.mkdir(parents=True, exist_ok=True)

        pattern = self.config.get(
            "filename_pattern", "{strategy_id}_{date}_{run_id}.csv"
        )
        today = datetime.now().strftime("%Y%m%d")
        filename = pattern.format(
            strategy_id=context.strategy_id,
            date=today,
            run_id=context.run_id,
        )
        path = output_dir / filename

        df = context.final if context.final is not None else pd.DataFrame()
        df = self._apply_field_mapping(df)

        encoding = self.config.get("encoding", "utf-8-sig")
        df.to_csv(path, index=False, encoding=encoding)
        self.logger.info("CSV 导出: %s (%d 行, 编码 %s)", path, len(df), encoding)
        return str(path)

    def _apply_field_mapping(self, df: pd.DataFrame) -> pd.DataFrame:
        """按 field_mapping 重命名列（与 V8 CSV 列名兼容）。"""
        mapping: dict[str, str] = self.config.get("field_mapping", {}) or {}
        if not mapping or df.empty:
            return df
        rename_map = {k: v for k, v in mapping.items() if k in df.columns}
        if rename_map:
            df = df.rename(columns=rename_map)
        return df
