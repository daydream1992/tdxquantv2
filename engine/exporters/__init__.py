"""数据导出插件包 (L3 组件抽象层)。

每个导出器一个独立 ``.py`` 文件，实现 :class:`engine.exporters.base.DataExporter` 接口。
``engine/pipeline/steps/export.py`` 在导出步骤中按 ``config/export.yaml`` 配置
依次调用启用的导出器。

内置导出器:
- :class:`engine.exporters.csv_exporter.CsvExporter`     - CSV 导出
- :class:`engine.exporters.excel_exporter.ExcelExporter` - Excel 多 Sheet 导出（V8 兼容）
- :class:`engine.exporters.duckdb_exporter.DuckDBExporter` - DuckDB 持久化
- :class:`engine.exporters.sector_exporter.SectorExporter`  - 通达信板块回写

新增导出器只需在 ``engine/exporters/`` 加文件实现 ``DataExporter`` 接口，
然后在 ``config/export.yaml`` 添加对应节并设 ``enabled: true``。
"""
from engine.exporters.base import DataExporter, ExporterError

__all__ = ["DataExporter", "ExporterError"]
