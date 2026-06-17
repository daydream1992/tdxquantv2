"""评分步骤。

输入: ``context.factors`` (各因子 Series)
      ``context.data["cleaned"]`` (清洗后数据，用于惩罚条件)
输出: ``context.scores`` (DataFrame, 含各因子分项 + ``total_score``)

评分流程
--------
1. **归一化**: 对每个因子应用 ``normalization`` (rank_percentile/zscore/minmax)
2. **加权求和**: 按 ``factors[].weight`` 加权求和得到基础分
3. **应用惩罚**: 遍历 ``scoring.penalties``，命中条件则乘以 ``multiplier``
4. **表达式公式**: 可选，用 ``scoring.formula`` 表达式覆盖加权求和（高级用法）
5. **total_score**: 最终得分

P1-3 依赖
----------
- ``engine.expression.evaluator.ExpressionEvaluator`` 用于 formula 求值与 penalty 条件判断
"""
from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

# P1-3 依赖
try:  # pragma: no cover
    from engine.expression.evaluator import ExpressionEvaluator  # type: ignore
    _EVALUATOR_READY = True
except (ImportError, AttributeError, Exception):  # noqa: BLE001
    _EVALUATOR_READY = False

    class ExpressionEvaluator:  # type: ignore[no-redef]
        """P1-3 占位。"""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def evaluate(self, formula: str, df: pd.DataFrame) -> pd.Series:
            # TODO: 待 P1-3 完成
            return df.eval(formula)


from engine.pipeline.base import PipelineContext, PipelineStep

logger = logging.getLogger(__name__)


class ScoreStep(PipelineStep):
    """评分步骤。"""

    step_id = "score"
    step_name = "评分"

    def execute(self, context: PipelineContext) -> PipelineContext:
        scoring_cfg: dict[str, Any] = self.config.get("scoring", {}) or {}
        factors_cfg: list[dict[str, Any]] = self.config.get("factors", []) or []

        if not context.factors:
            self.logger.warning("无因子结果，跳过评分")
            context.scores = pd.DataFrame()
            return context

        # 1. 构建因子 DataFrame
        factor_df = pd.DataFrame(context.factors)
        cleaned_df = context.data.get("cleaned", pd.DataFrame())
        if not cleaned_df.empty:
            factor_df.index = cleaned_df.index

        # 2. 归一化
        normalization = scoring_cfg.get("normalization", "rank_percentile")
        normalized = self._normalize(factor_df, normalization)

        # 3. 加权求和
        weights = {f["factor_id"]: float(f.get("weight", 0.0)) for f in factors_cfg if "factor_id" in f}
        weighted = self._weighted_sum(normalized, weights)
        scores = normalized.copy()
        scores["base_score"] = weighted

        # 4. 应用表达式公式（可选，覆盖 base_score）
        formula = scoring_cfg.get("formula")
        if formula:
            try:
                # P1-3 真实 ExpressionEvaluator 不接受 safe 参数
                try:
                    evaluator = ExpressionEvaluator()
                except TypeError:
                    evaluator = ExpressionEvaluator(safe=True)
                # P1-3 真实接口: evaluate(formula, variables_dict)
                variables = {col: scores[col] for col in scores.columns if col != "formula_score"}
                formula_result = evaluator.evaluate(formula, variables)
                if isinstance(formula_result, pd.Series):
                    scores["formula_score"] = formula_result
                    scores["base_score"] = formula_result  # 公式覆盖
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("评分公式 %s 求值失败，仅用加权求和: %s", formula, exc)
                context.add_warning(self.step_id, f"评分公式求值失败: {exc}")

        # 5. 应用惩罚
        penalties = scoring_cfg.get("penalties", []) or []
        total = scores["base_score"].copy()
        penalty_log: list[dict[str, Any]] = []
        for pen in penalties:
            condition = pen.get("condition")
            multiplier = float(pen.get("multiplier", 1.0))
            reason = pen.get("reason", "")
            if not condition:
                continue
            try:
                # 合并 cleaned 字段供条件求值
                eval_df = cleaned_df.copy() if not cleaned_df.empty else pd.DataFrame(index=factor_df.index)
                for col in scores.columns:
                    eval_df[col] = scores[col]
                # P1-3 真实 ExpressionEvaluator 接口
                try:
                    evaluator = ExpressionEvaluator()
                except TypeError:
                    evaluator = ExpressionEvaluator(safe=True)
                # P1-3 真实接口: evaluate(formula, variables_dict)
                # 对每行求值: 用 df.iterrows() 慢但兼容, 简单表达式可用 df.eval
                # 这里用 pandas eval 兜底, 因 P1-3 evaluator 的 variables 只接受标量
                try:
                    cond_series = eval_df.eval(condition)
                except Exception:
                    # 兜底: 逐行求值
                    cond_results = []
                    for _, row in eval_df.iterrows():
                        try:
                            variables = {col: row[col] for col in eval_df.columns if pd.notna(row[col])}
                            cond_results.append(bool(evaluator.evaluate(condition, variables)))
                        except Exception:
                            cond_results.append(False)
                    cond_series = pd.Series(cond_results, index=eval_df.index)
                if not isinstance(cond_series, pd.Series):
                    continue
                hit_mask = cond_series.astype(bool).fillna(False)
                if hit_mask.any():
                    total = total.where(~hit_mask, total * multiplier)
                    penalty_log.append({
                        "reason": reason,
                        "multiplier": multiplier,
                        "hit_count": int(hit_mask.sum()),
                    })
                    self.logger.debug("惩罚命中: %s × %.2f, 命中 %d 只", reason, multiplier, hit_mask.sum())
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("惩罚条件 %s 求值失败: %s", condition, exc)

        scores["total_score"] = total
        scores["penalty_log"] = str(penalty_log) if penalty_log else ""

        # 附加 code 列便于后续合并
        if not cleaned_df.empty and "code" in cleaned_df.columns:
            scores.insert(0, "code", cleaned_df["code"].values)

        context.scores = scores
        self.logger.info(
            "评分完成: shape=%s, total_score 范围 [%.2f, %.2f], 惩罚命中 %d 条",
            scores.shape, float(scores["total_score"].min()), float(scores["total_score"].max()),
            len(penalty_log),
        )
        return context

    # ---- 归一化 ----
    def _normalize(self, factor_df: pd.DataFrame, method: str) -> pd.DataFrame:
        """对每列应用归一化。"""
        if method == "none" or method is None:
            return factor_df.copy()
        result = pd.DataFrame(index=factor_df.index)
        for col in factor_df.columns:
            series = factor_df[col]
            if method == "rank_percentile":
                result[col] = series.rank(pct=True, method="average")
            elif method == "zscore":
                mean = series.mean()
                std = series.std(ddof=0)
                result[col] = (series - mean) / std if std and std != 0 else series * 0
            elif method == "minmax":
                mn, mx = series.min(), series.max()
                rng = mx - mn
                result[col] = (series - mn) / rng if rng and rng != 0 else series * 0
            else:
                self.logger.warning("未知归一化方法 %s, 跳过列 %s", method, col)
                result[col] = series
        return result

    # ---- 加权求和 ----
    def _weighted_sum(self, normalized: pd.DataFrame, weights: dict[str, float]) -> pd.Series:
        """按权重加权求和。缺失因子按 0 计入，权重不重新归一化（便于跨策略对比）。"""
        total = pd.Series(0.0, index=normalized.index)
        for factor_id, weight in weights.items():
            if factor_id in normalized.columns:
                total = total + normalized[factor_id].fillna(0) * weight
            else:
                self.logger.warning("因子 %s 未在归一化矩阵中, 跳过其权重 %s", factor_id, weight)
        return total
