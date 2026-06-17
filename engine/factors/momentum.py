"""动量类因子。

V8 选股中动量相关字段:
- ``ZAFPre5`` / ``ZAFPre10`` / ``ZAFPre20`` / ``ZAFPre60`` - 5/10/20/60 日累计涨幅
- K 线 ``close.pct_change(window)`` - 滚动收益率

本模块提供以下因子:
- ``momentum_5d``  - 5 日动量
- ``momentum_10d`` - 10 日动量
- ``momentum_20d`` - 20 日动量

TODO(P1-2): 待 STRATEGY_LOGIC.md 确认具体动量公式（是否需要去极值/中性化）。
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from engine.factors.base import Factor


class Momentum5DFactor(Factor):
    factor_id = "momentum_5d"
    factor_name = "5日动量"
    factor_category = "momentum"
    factor_description = "近5日累计涨幅，反映短期动量。优先用快照 ZAFPre5，缺失时回退到 K线 pct_change(5)。"

    def get_required_fields(self) -> list[str]:
        return ["ZAFPre5"]

    def get_default_params(self) -> dict[str, Any]:
        return {"window": 5, "kline_close_field": "close"}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        if "ZAFPre5" in df.columns:
            series = pd.to_numeric(df["ZAFPre5"], errors="coerce")
            return series
        # 兜底: 用 K 线 close pct_change
        close_col = params.get("kline_close_field", "close")
        if close_col in df.columns:
            # TODO(P1-2): 待确认是否需要 groupby code 计算滚动收益率
            close = pd.to_numeric(df[close_col], errors="coerce")
            return close.pct_change(params["window"])
        return pd.Series(float("nan"), index=df.index, dtype=float)


class Momentum10DFactor(Factor):
    factor_id = "momentum_10d"
    factor_name = "10日动量"
    factor_category = "momentum"
    factor_description = "近10日累计涨幅。优先用快照 ZAFPre10。"

    def get_required_fields(self) -> list[str]:
        return ["ZAFPre10"]

    def get_default_params(self) -> dict[str, Any]:
        return {"window": 10}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        if "ZAFPre10" in df.columns:
            return pd.to_numeric(df["ZAFPre10"], errors="coerce")
        close_col = "close"
        if close_col in df.columns:
            close = pd.to_numeric(df[close_col], errors="coerce")
            return close.pct_change(params["window"])
        return pd.Series(float("nan"), index=df.index, dtype=float)


class Momentum20DFactor(Factor):
    factor_id = "momentum_20d"
    factor_name = "20日动量"
    factor_category = "momentum"
    factor_description = "近20日累计涨幅。优先用快照 ZAFPre20。"

    def get_required_fields(self) -> list[str]:
        return ["ZAFPre20"]

    def get_default_params(self) -> dict[str, Any]:
        return {"window": 20}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        if "ZAFPre20" in df.columns:
            return pd.to_numeric(df["ZAFPre20"], errors="coerce")
        close_col = "close"
        if close_col in df.columns:
            close = pd.to_numeric(df[close_col], errors="coerce")
            return close.pct_change(params["window"])
        return pd.Series(float("nan"), index=df.index, dtype=float)
