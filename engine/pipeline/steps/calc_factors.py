"""因子计算步骤。

遍历策略 ``factors`` 列表，从 :class:`FactorRegistry` 获取因子插件，
调用 ``factor.calculate(df, params)`` 计算每个因子，结果存入 ``context.factors``。

输入: ``context.data["cleaned"]`` (清洗后的 DataFrame)
输出: ``context.factors`` (dict[factor_id, pd.Series])
      ``context.data["factor_matrix"]`` (因子矩阵 DataFrame, 行=股票, 列=factor_id)
"""
from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from engine.factors.base import Factor, FactorError
from engine.factors.registry import FactorNotFoundError, FactorRegistry
from engine.pipeline.base import PipelineContext, PipelineStep, StepExecutionError

logger = logging.getLogger(__name__)


class CalcFactorsStep(PipelineStep):
    """因子计算步骤。"""

    step_id = "calc_factors"
    step_name = "因子计算"

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        adapter: Any | None = None,
        storage: Any | None = None,
        registry: FactorRegistry | None = None,
    ) -> None:
        super().__init__(config=config, adapter=adapter, storage=storage)
        # 注入或懒加载 FactorRegistry
        self._registry: FactorRegistry | None = registry

    @property
    def registry(self) -> FactorRegistry:
        if self._registry is None:
            self._registry = FactorRegistry()
        return self._registry

    def execute(self, context: PipelineContext) -> PipelineContext:
        factors_cfg: list[dict[str, Any]] = self.config.get("factors", []) or []
        if not factors_cfg:
            self.logger.warning("策略未配置 factors，跳过因子计算")
            context.data["factor_matrix"] = pd.DataFrame()
            return context

        cleaned_df = context.data.get("cleaned")
        if cleaned_df is None or cleaned_df.empty:
            self.logger.warning("cleaned 数据为空，跳过因子计算")
            context.data["factor_matrix"] = pd.DataFrame()
            return context

        factor_matrix: dict[str, pd.Series] = {}
        for factor_cfg in factors_cfg:
            factor_id = factor_cfg.get("factor_id")
            if not factor_id:
                self.logger.warning("因子配置缺少 factor_id，跳过: %s", factor_cfg)
                continue
            weight = factor_cfg.get("weight", 1.0)
            params = factor_cfg.get("params", {}) or {}

            try:
                factor: Factor = self.registry.get_factor(factor_id)
            except FactorNotFoundError as exc:
                self.logger.error("因子 %s 未注册: %s", factor_id, exc)
                context.add_warning(self.step_id, f"因子 {factor_id} 未注册，跳过")
                continue

            # 合并默认参数 + 策略参数
            full_params = {**factor.get_default_params(), **params}
            try:
                series = factor.calculate(cleaned_df, full_params)
                if series is None:
                    series = pd.Series(float("nan"), index=cleaned_df.index)
                # 保证 index 对齐
                series = series.reindex(cleaned_df.index)
                factor_matrix[factor_id] = series
                self.logger.debug(
                    "因子 %s 计算完成 weight=%s 非空=%d",
                    factor_id, weight, series.notna().sum(),
                )
            except FactorError as exc:
                self.logger.error("因子 %s 计算异常: %s", factor_id, exc)
                context.add_warning(self.step_id, f"因子 {factor_id} 计算异常: {exc}")
            except Exception as exc:  # noqa: BLE001
                self.logger.exception("因子 %s 计算未捕获异常", factor_id)
                context.add_warning(self.step_id, f"因子 {factor_id} 未捕获异常: {exc}")

        # 存入 context
        context.factors = factor_matrix
        # 构建因子矩阵
        if factor_matrix:
            matrix = pd.DataFrame(factor_matrix)
            matrix.index = cleaned_df.index
            # 把 code 列附加（便于后续合并）
            if "code" in cleaned_df.columns:
                matrix.insert(0, "code", cleaned_df["code"].values)
            context.data["factor_matrix"] = matrix
        else:
            context.data["factor_matrix"] = pd.DataFrame()

        self.logger.info(
            "因子计算完成: %d/%d 个因子成功, 矩阵 shape=%s",
            len(factor_matrix), len(factors_cfg),
            context.data["factor_matrix"].shape,
        )
        return context
