"""换手类因子。

V8 选股中换手相关字段:
- ``fHSL`` - 当日换手率(%)
- ``turnover`` - 派生换手率

本模块提供以下因子:
- ``turnover_rate``   - 当日换手率（直接取 fHSL）
- ``turnover_momentum`` - 换手放量比（当日换手 / 近5日平均换手）

TODO(P1-2): 待 STRATEGY_LOGIC.md 确认换手率计算口径与异常处理。
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from engine.factors.base import Factor


class TurnoverRateFactor(Factor):
    factor_id = "turnover_rate"
    factor_name = "换手率"
    factor_category = "turnover"
    factor_description = "当日换手率(%)，直接读取 fHSL 字段。"

    def get_required_fields(self) -> list[str]:
        return ["fHSL"]

    def get_default_params(self) -> dict[str, Any]:
        return {"field": "fHSL"}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        field = params["field"]
        if field in df.columns:
            return pd.to_numeric(df[field], errors="coerce")
        # 兜底: 用 vol / 流通股本（如有）
        if "vol" in df.columns and "circ_mv" in df.columns:
            vol = pd.to_numeric(df["vol"], errors="coerce")
            circ_mv = pd.to_numeric(df["circ_mv"], errors="coerce")
            return vol / circ_mv.where(circ_mv != 0) * 100
        return pd.Series(float("nan"), index=df.index, dtype=float)


class TurnoverMomentumFactor(Factor):
    factor_id = "turnover_momentum"
    factor_name = "换手放量比"
    factor_category = "turnover"
    factor_description = "当日换手率 / 近5日平均换手率。值>1 表示放量。"

    def get_required_fields(self) -> list[str]:
        return ["fHSL"]

    def get_default_params(self) -> dict[str, Any]:
        return {"window": 5, "field": "fHSL"}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        field = params["field"]
        if field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        hsl = pd.to_numeric(df[field], errors="coerce")
        # TODO(P1-2): 待确认是否需要 groupby code 计算滚动均值
        rolling_mean = hsl.rolling(params["window"], min_periods=1).mean()
        return hsl / rolling_mean.where(rolling_mean != 0)
