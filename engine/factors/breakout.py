"""突破类因子。

V8 选股中突破相关:
- 突破 MA20: ``close > KL_MA20``
- 平台突破: 近 N 日高点突破
- 布林上轨突破: ``close > KL_BOLL_UP``

本模块提供以下因子:
- ``breakout_ma20``    - 收盘价突破 MA20
- ``breakout_platform`` - 平台突破 (N 日新高)

TODO(P1-2): 待 STRATEGY_LOGIC.md 确认突破定义与阈值（如是否需要量能配合）。
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from engine.factors.base import Factor


class BreakoutMA20Factor(Factor):
    factor_id = "breakout_ma20"
    factor_name = "突破MA20"
    factor_category = "breakout"
    factor_description = "最新收盘价相对 MA20 的偏离度。值>0 表示站上 MA20。"

    def get_required_fields(self) -> list[str]:
        return ["KL_MA20", "close", "最新价"]

    def get_default_params(self) -> dict[str, Any]:
        return {"ma_field": "KL_MA20", "price_field": "最新价"}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        ma_field = params["ma_field"]
        price_field = params["price_field"]
        # 优先用合并后的 K 线 MA20
        if ma_field in df.columns and price_field in df.columns:
            ma = pd.to_numeric(df[ma_field], errors="coerce")
            price = pd.to_numeric(df[price_field], errors="coerce")
            return (price - ma) / ma.where(ma != 0)
        # 兜底: 用 close 与 close.rolling(20).mean()
        if "close" in df.columns:
            close = pd.to_numeric(df["close"], errors="coerce")
            # TODO(P1-2): 待确认是否需要 groupby code 计算滚动 MA
            ma20 = close.rolling(20, min_periods=1).mean()
            return (close - ma20) / ma20.where(ma20 != 0)
        return pd.Series(float("nan"), index=df.index, dtype=float)


class BreakoutPlatformFactor(Factor):
    factor_id = "breakout_platform"
    factor_name = "平台突破"
    factor_category = "breakout"
    factor_description = "最新收盘价是否突破近 N 日最高价。返回 1/0 二值。"

    def get_required_fields(self) -> list[str]:
        return ["high", "close"]

    def get_default_params(self) -> dict[str, Any]:
        return {"window": 20, "tolerance": 0.0}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        if "high" not in df.columns or "close" not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        high = pd.to_numeric(df["high"], errors="coerce")
        close = pd.to_numeric(df["close"], errors="coerce")
        # TODO(P1-2): 待 STRATEGY_LOGIC.md 确认是否需要 groupby code 计算 rolling max
        rolling_high = high.rolling(params["window"], min_periods=1).max()
        # 突破: 当前 close >= rolling_high - tolerance
        tolerance = params["tolerance"]
        return (close >= rolling_high - tolerance).astype(float).where(close.notna())
