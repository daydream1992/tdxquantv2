"""趋势类因子。

V8 趋势主升浪策略核心:
- ``KL_MA5`` / ``KL_MA10`` / ``KL_MA20`` - K 线均线
- ``KL_DIF`` / ``KL_DEA`` / ``KL_MACD_BAR`` - MACD 指标
- ``Zjl`` - 主力净流入(万元)
- ``大买占比`` = TotalBVol / (TotalBVol + TotalSVol)

本模块提供以下因子:
- ``ma_alignment``     - 均线多头排列度 (0/22/35)
- ``macd_direction``   - MACD 方向评分 (0-20)
- ``main_inflow``      - 主力净流入(万元)
- ``big_buy_ratio``    - 大买占比

TODO(P1-2): 待 STRATEGY_LOGIC.md 确认均线容差、量能底线等阈值。
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from engine.factors.base import Factor


class MAAlignmentFactor(Factor):
    factor_id = "ma_alignment"
    factor_name = "均线多头排列"
    factor_category = "trend"
    factor_description = (
        "均线多头排列评分。V8 趋势策略: MA5>MA10>MA20=35, MA5>MA10(短期多头)=22, "
        "无 K 线时按 ZAFPre5/ZAFPre10 兜底给 20/8。"
    )

    def get_required_fields(self) -> list[str]:
        return ["KL_MA5", "KL_MA10", "KL_MA20", "ZAFPre5", "ZAFPre10"]

    def get_default_params(self) -> dict[str, Any]:
        return {
            "ma5_field": "KL_MA5",
            "ma10_field": "KL_MA10",
            "ma20_field": "KL_MA20",
            "r5_field": "ZAFPre5",
            "r10_field": "ZAFPre10",
            "full_bull_score": 35.0,
            "short_bull_score": 22.0,
            "no_kline_full_score": 20.0,
            "no_kline_half_score": 8.0,
        }

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        ma5 = pd.to_numeric(df.get(params["ma5_field"]), errors="coerce") if params["ma5_field"] in df.columns else None
        ma10 = pd.to_numeric(df.get(params["ma10_field"]), errors="coerce") if params["ma10_field"] in df.columns else None
        ma20 = pd.to_numeric(df.get(params["ma20_field"]), errors="coerce") if params["ma20_field"] in df.columns else None
        r5 = pd.to_numeric(df.get(params["r5_field"]), errors="coerce") if params["r5_field"] in df.columns else None
        r10 = pd.to_numeric(df.get(params["r10_field"]), errors="coerce") if params["r10_field"] in df.columns else None

        scores = pd.Series(0.0, index=df.index)

        if ma5 is not None and ma10 is not None and ma20 is not None:
            has_kline = ma5.notna() & ma10.notna() & ma20.notna()
            full_bull = has_kline & (ma5 > ma10) & (ma10 > ma20)
            short_bull = has_kline & (ma5 > ma10) & (ma10 <= ma20)
            scores = scores.mask(full_bull, params["full_bull_score"])
            scores = scores.mask(short_bull, params["short_bull_score"])
            # 无 K 线兜底
            if r5 is not None and r10 is not None:
                no_kline = ~has_kline
                no_kline_full = no_kline & (r5 > 0) & (r10 > 0)
                no_kline_half = no_kline & (r5 > 0) & (r10 <= 0)
                scores = scores.mask(no_kline_full, params["no_kline_full_score"])
                scores = scores.mask(no_kline_half, params["no_kline_half_score"])
        return scores


class MACDDirectionFactor(Factor):
    factor_id = "macd_direction"
    factor_name = "MACD方向"
    factor_category = "trend"
    factor_description = (
        "MACD 方向评分 (0-20)。V8: DIF>0 & DIF>DEA=20, DIF>0 & DIF<=DEA=12, "
        "DIF<=0 & DIF>DEA=10。"
    )

    def get_required_fields(self) -> list[str]:
        return ["KL_DIF", "KL_DEA", "ZAFPre5"]

    def get_default_params(self) -> dict[str, Any]:
        return {
            "dif_field": "KL_DIF",
            "dea_field": "KL_DEA",
            "r5_field": "ZAFPre5",
        }

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        dif = pd.to_numeric(df.get(params["dif_field"]), errors="coerce") if params["dif_field"] in df.columns else None
        dea = pd.to_numeric(df.get(params["dea_field"]), errors="coerce") if params["dea_field"] in df.columns else None
        r5 = pd.to_numeric(df.get(params["r5_field"]), errors="coerce") if params["r5_field"] in df.columns else None

        scores = pd.Series(0.0, index=df.index)
        if dif is not None and dea is not None:
            has_macd = dif.notna() & dea.notna()
            scores = scores.mask(has_macd & (dif > 0) & (dif > dea), 20.0)
            scores = scores.mask(has_macd & (dif > 0) & (dif <= dea), 12.0)
            scores = scores.mask(has_macd & (dif <= 0) & (dif > dea), 10.0)
            if r5 is not None:
                no_macd = ~has_macd
                scores = scores.mask(no_macd & (r5 > 3), 14.0)
                scores = scores.mask(no_macd & (r5 > 0) & (r5 <= 3), 8.0)
        return scores


class MainInflowFactor(Factor):
    factor_id = "main_inflow"
    factor_name = "主力净流入"
    factor_category = "trend"
    factor_description = "主力净流入(万元)，取 Zjl 字段。"

    def get_required_fields(self) -> list[str]:
        return ["Zjl"]

    def get_default_params(self) -> dict[str, Any]:
        return {"field": "Zjl"}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        field = params["field"]
        if field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        return pd.to_numeric(df[field], errors="coerce")


class BigBuyRatioFactor(Factor):
    factor_id = "big_buy_ratio"
    factor_name = "大买占比"
    factor_category = "trend"
    factor_description = (
        "大买占比 = TotalBVol / (TotalBVol + TotalSVol)。V8 中用于趋势策略大单流入评分、"
        "错杀低吸承接力度、强转弱反抽信号。"
    )

    def get_required_fields(self) -> list[str]:
        return ["TotalBVol", "TotalSVol"]

    def get_default_params(self) -> dict[str, Any]:
        return {"buy_field": "TotalBVol", "sell_field": "TotalSVol", "field": "大买占比"}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        # 优先用清洗后的派生字段
        if params["field"] in df.columns:
            return pd.to_numeric(df[params["field"]], errors="coerce")
        buy_field = params["buy_field"]
        sell_field = params["sell_field"]
        if buy_field not in df.columns or sell_field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        buy = pd.to_numeric(df[buy_field], errors="coerce")
        sell = pd.to_numeric(df[sell_field], errors="coerce")
        return buy / (buy + sell + 1)
