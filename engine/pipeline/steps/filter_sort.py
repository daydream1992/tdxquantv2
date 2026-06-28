"""筛选排序步骤。

输入: ``context.scores`` (评分 DataFrame, 含 ``total_score``)
输出: ``context.final`` (筛选+排序+截断后的最终结果 DataFrame)

配置 (策略 YAML ``output``):
- ``min_score``  - 最低得分门槛
- ``sort_by``    - 排序字段 (默认 ``total_score``)
- ``sort_order`` - ``desc`` / ``asc`` (默认 ``desc``)
- ``top_n``      - 取前 N 只 (默认 20)
"""
from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from engine.pipeline.base import PipelineContext, PipelineStep

logger = logging.getLogger(__name__)


class FilterSortStep(PipelineStep):
    """筛选排序步骤。"""

    step_id = "filter_sort"
    step_name = "筛选排序"

    def execute(self, context: PipelineContext) -> PipelineContext:
        output_cfg: dict[str, Any] = self.config.get("output", {}) or {}
        if context.scores is None or context.scores.empty:
            self.logger.warning("scores 为空，跳过筛选排序")
            context.final = pd.DataFrame()
            return context

        df = context.scores.copy()
        if "total_score" not in df.columns:
            self.logger.warning("scores 缺少 total_score 列")
            context.final = df
            return context

        # 1. min_score 过滤
        min_score = output_cfg.get("min_score")
        if min_score is not None:
            df = df[df["total_score"] >= min_score]
            self.logger.info("min_score=%.2f 过滤后: %d 只", min_score, len(df))

        # 2. 排序
        sort_by = output_cfg.get("sort_by", "total_score")
        sort_order = output_cfg.get("sort_order", "desc")
        if sort_by in df.columns:
            df = df.sort_values(sort_by, ascending=(sort_order != "desc"))

        # 3. top_n 截断
        top_n = output_cfg.get("top_n")
        if top_n is not None and isinstance(top_n, int) and top_n > 0:
            df = df.head(top_n)

        # 4. 合并 cleaned_df 的 code/name/stock_name 等展示字段（scores 可能只有因子列）
        cleaned_df = context.data.get("cleaned")
        if cleaned_df is not None and not cleaned_df.empty and "code" in cleaned_df.columns:
            # scores 的 index 与 cleaned_df 对齐
            for name_col in ("code", "name", "stock_name", "股票名称"):
                if name_col in cleaned_df.columns and name_col not in df.columns:
                    df[name_col] = cleaned_df.loc[df.index, name_col].values

        # 5. 重置索引 + 添加排名列
        df = df.reset_index(drop=True)
        if "rank" not in df.columns:
            df.insert(0, "rank", range(1, len(df) + 1))

        context.final = df
        self.logger.info("筛选排序完成: 最终 %d 只", len(df))
        return context
