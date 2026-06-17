"""导出步骤。

遍历策略 ``export`` 配置中启用的所有 Exporter，调用 ``exporter.export(context)``
导出最终结果。

支持的 Exporter:
- ``csv``     - :class:`engine.exporters.csv_exporter.CsvExporter`
- ``excel``   - :class:`engine.exporters.excel_exporter.ExcelExporter`
- ``duckdb``  - :class:`engine.exporters.duckdb_exporter.DuckDBExporter`
- ``sector``  - :class:`engine.exporters.sector_exporter.SectorExporter`

Exporter 启用开关来自 ``config/export.yaml``，策略 YAML ``export`` 节可覆盖。
"""
from __future__ import annotations

import logging
from typing import Any

import pandas as pd

# P1-3 依赖
try:  # pragma: no cover
    from engine.config.loader import ConfigLoader  # type: ignore
    _CONFIG_LOADER_READY = True
except (ImportError, AttributeError, Exception):  # noqa: BLE001
    _CONFIG_LOADER_READY = False

    class ConfigLoader:  # type: ignore[no-redef]
        """P1-3 占位 ConfigLoader。"""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self._data: dict[str, Any] = {}

        def get(self, key: str, default: Any = None) -> Any:
            return default

        def all(self) -> dict[str, Any]:
            return self._data

        @staticmethod
        def load(path: str) -> dict[str, Any]:
            # TODO: 待 P1-3 完成
            import yaml
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}


from engine.exporters.base import DataExporter
from engine.exporters.csv_exporter import CsvExporter
from engine.exporters.duckdb_exporter import DuckDBExporter
from engine.exporters.excel_exporter import ExcelExporter
from engine.exporters.sector_exporter import SectorExporter
from engine.pipeline.base import PipelineContext, PipelineStep

logger = logging.getLogger(__name__)

_EXPORTER_CLASSES: dict[str, type[DataExporter]] = {
    "csv": CsvExporter,
    "excel": ExcelExporter,
    "duckdb": DuckDBExporter,
    "sector": SectorExporter,
}


class ExportStep(PipelineStep):
    """导出步骤。"""

    step_id = "export"
    step_name = "结果导出"

    def execute(self, context: PipelineContext) -> PipelineContext:
        if context.final is None or context.final.empty:
            self.logger.warning("final 为空，仍执行导出（部分导出器需写空文件/清空板块）")

        # 加载全局 export 配置
        export_cfg = self._load_export_config()
        # 策略 YAML export 节覆盖
        strategy_export_cfg: dict[str, Any] = self.config.get("export", {}) or {}

        results: list[dict[str, Any]] = []
        for exporter_id, exporter_cls in _EXPORTER_CLASSES.items():
            exporter_section = export_cfg.get(exporter_id, {}) or {}
            # 策略覆盖 enabled
            strategy_enabled = strategy_export_cfg.get(exporter_id)
            if isinstance(strategy_enabled, bool):
                exporter_section["enabled"] = strategy_enabled
            elif isinstance(strategy_enabled, dict):
                exporter_section = {**exporter_section, **strategy_enabled}
            if not exporter_section.get("enabled", False):
                self.logger.info("Exporter %s 未启用，跳过", exporter_id)
                continue
            try:
                exporter = exporter_cls(
                    config=exporter_section,
                    storage=self.storage,
                    strategy_config=self.config,
                )
                output = exporter.export(context)
                results.append({
                    "exporter": exporter_id,
                    "output": output,
                    "status": "ok",
                })
                self.logger.info("Exporter %s 导出完成: %s", exporter_id, output)
            except Exception as exc:  # noqa: BLE001
                self.logger.exception("Exporter %s 导出失败", exporter_id)
                context.add_warning(self.step_id, f"Exporter {exporter_id} 失败: {exc}")
                results.append({
                    "exporter": exporter_id,
                    "output": None,
                    "status": "error",
                    "error": str(exc),
                })

        context.metadata["export_results"] = results
        return context

    def _load_export_config(self) -> dict[str, Any]:
        """加载 config/export.yaml。

        优先用真实 ``ConfigLoader().all()`` (P1-3)，它已合并 config/*.yaml 到一个 dict。
        兜底用 ``ConfigLoader.load(path)`` 静态方法或 yaml.safe_load。
        """
        # 1. 优先用真实 ConfigLoader 实例
        if _CONFIG_LOADER_READY:
            try:
                loader = ConfigLoader()
                data = loader.all()  # type: ignore[attr-defined]
                # 提取导出相关 section
                export_keys = {"csv", "excel", "duckdb", "sector"}
                result = {k: data.get(k, {}) for k in export_keys if k in data}
                if any(result.values()):
                    return result
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("ConfigLoader.all() 失败: %s", exc)
        # 2. 兜底: 静态 load
        if hasattr(ConfigLoader, "load"):
            try:
                data = ConfigLoader.load("config/export.yaml")  # type: ignore[attr-defined]
                if data:
                    return data
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("ConfigLoader.load() 失败: %s", exc)
        # 3. 最后兜底: yaml.safe_load
        import yaml
        candidates = ["config/export.yaml", "export.yaml"]
        for path in candidates:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return yaml.safe_load(f) or {}
            except FileNotFoundError:
                continue
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("yaml 加载 %s 失败: %s", path, exc)
                continue
        self.logger.warning("export.yaml 未找到，所有导出器按 disabled 处理")
        return {}
