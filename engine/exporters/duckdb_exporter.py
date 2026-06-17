"""DuckDB 持久化导出器。

将选股结果写入 ``selection_results`` 表，便于 Web 前端查询、回测对比、历史回放。

写入字段:
- ``run_id``         - 流水线 run_id
- ``strategy_id``    - 策略 ID
- ``trade_date``     - 交易日 (YYYYMMDD)
- ``stock_code``     - 股票代码
- ``stock_name``     - 股票名称
- ``total_score``    - 总分
- ``factor_scores``  - 各因子分项 (JSON 字符串)
- ``rank``           - 排名
- ``created_at``     - 写入时间
- ``metadata``       - 元数据 (JSON 字符串)

P1-3 依赖
----------
- ``engine.storage.duckdb_store.DuckDBStore`` 提供 ``execute`` / ``executemany`` 接口
- 表 schema 由 ``config/duckdb_schema.sql`` 定义 (P1-3 负责)

P1-3 接口未稳定时，本导出器对 storage 缺失/接口不可用做兜底处理，记录警告但不抛出。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import pandas as pd

from engine.exporters.base import DataExporter, ExporterError
from engine.pipeline.base import PipelineContext

logger = logging.getLogger(__name__)


class DuckDBExporter(DataExporter):
    """DuckDB 持久化导出器。"""

    exporter_id = "duckdb"
    exporter_name = "DuckDB 持久化"

    TABLE_NAME = "selection_results"

    def export(self, context: PipelineContext) -> str:
        if self.storage is None:
            self.logger.warning("未注入 DuckDB storage，跳过 DuckDB 导出")
            return ""

        df = context.final if context.final is not None else pd.DataFrame()
        records = self._build_records(df, context)
        if not records:
            self.logger.info("无选股结果，跳过 DuckDB 写入")
            return f"{self.TABLE_NAME}(empty)"

        try:
            self._ensure_table()
            self._insert_records(records)
            self.logger.info("DuckDB 写入完成: %d 条", len(records))
            return f"{self.TABLE_NAME}:{context.run_id}"
        except Exception as exc:  # noqa: BLE001
            self.logger.exception("DuckDB 写入失败")
            raise ExporterError(f"DuckDB 写入失败: {exc}") from exc

    # ---- 记录构建 ----
    def _build_records(self, df: pd.DataFrame, context: PipelineContext) -> list[dict[str, Any]]:
        if df.empty:
            return []
        trade_date = datetime.now().strftime("%Y%m%d")
        records: list[dict[str, Any]] = []
        for _, row in df.iterrows():
            # 收集因子分项（除 code/total_score/rank 之外）
            factor_scores = {}
            for col in df.columns:
                if col in ("code", "stock_code", "total_score", "rank", "rank "):
                    continue
                val = row.get(col)
                if pd.isna(val):
                    continue
                if isinstance(val, (int, float)):
                    factor_scores[col] = float(val)
                else:
                    factor_scores[col] = str(val)

            stock_code = (
                row.get("code") or row.get("stock_code") or ""
            )
            stock_name = (
                row.get("stock_name")
                or row.get("股票名称")
                or row.get("name")
                or ""
            )
            total_score = row.get("total_score")
            if pd.isna(total_score):
                total_score = None
            else:
                total_score = float(total_score)
            rank = row.get("rank")
            if pd.isna(rank):
                rank = None
            else:
                rank = int(rank)

            records.append({
                "run_id": context.run_id,
                "strategy_id": context.strategy_id,
                "run_date": datetime.now().strftime("%Y-%m-%d"),
                "stock_code": str(stock_code),
                "stock_name": str(stock_name),
                "total_score": total_score,
                "factor_scores": json.dumps(factor_scores, ensure_ascii=False),
                "rank": rank,
                "extra_data": json.dumps({
                    "started_at": context.started_at.isoformat(),
                    "duration_sec": context.duration_sec,
                }, ensure_ascii=False),
            })
        return records

    # ---- 表操作 ----
    def _ensure_table(self) -> None:
        """确保 selection_results 表存在。

        TODO(P1-3): 待 DuckDBStore 提供 ensure_schema 或 migrations 后对接。
        保守起见，本方法尝试 CREATE TABLE IF NOT EXISTS，若 storage 不支持则忽略。
        """
        ddl = """
        CREATE TABLE IF NOT EXISTS selection_results (
            id BIGINT PRIMARY KEY,
            run_id VARCHAR NOT NULL,
            strategy_id VARCHAR NOT NULL,
            run_date DATE NOT NULL,
            stock_code VARCHAR NOT NULL,
            stock_name VARCHAR DEFAULT '',
            total_score DOUBLE DEFAULT 0.0,
            factor_scores VARCHAR DEFAULT '{}',
            rank INTEGER DEFAULT 0,
            extra_data VARCHAR DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
        try:
            if hasattr(self.storage, "execute"):
                self.storage.execute(ddl)  # type: ignore[attr-defined]
            elif hasattr(self.storage, "ensure_table"):
                self.storage.ensure_table(self.TABLE_NAME, ddl)  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("ensure_table 失败 (可能已存在): %s", exc)

    def _insert_records(self, records: list[dict[str, Any]]) -> None:
        """批量写入记录。"""
        columns = list(records[0].keys())
        placeholders = ", ".join(["?"] * len(columns))
        sql = f"INSERT INTO {self.TABLE_NAME} ({', '.join(columns)}) VALUES ({placeholders})"
        rows = [tuple(r[c] for c in columns) for r in records]
        try:
            if hasattr(self.storage, "executemany"):
                self.storage.executemany(sql, rows)  # type: ignore[attr-defined]
            elif hasattr(self.storage, "execute"):
                for row in rows:
                    self.storage.execute(sql, list(row))  # type: ignore[attr-defined]
            else:
                raise ExporterError("DuckDBStorage 无可用写入方法 (execute/executemany)")
        except Exception as exc:  # noqa: BLE001
            raise ExporterError(f"批量写入失败: {exc}") from exc
