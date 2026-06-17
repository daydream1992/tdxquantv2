"""量价类因子。

V8 选股中量价相关字段:
- ``Wtb``  - 量比
- ``ZAF``  - 当日涨幅(%)
- ``vol`` / ``amount`` - 成交量/成交额

本模块提供以下因子:
- ``volume_ratio``   - 量比（取 Wtb）
- ``volume_amount``  - 成交额（亿元）
- ``price_volume_score`` - 量价配合度（涨+量比>1.5=高分，参考 V8 趋势策略）

TODO(P1-2): 待 STRATEGY_LOGIC.md 确认量价评分阈值（V8 中: zaf>0 & wtb>1.5=25分 等）。
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from engine.factors.base import Factor


class VolumeRatioFactor(Factor):
    factor_id = "volume_ratio"
    factor_name = "量比"
    factor_category = "volume_price"
    factor_description = "当日量比，取 Wtb 字段。V8 已对负值/0 做置 NaN 清洗。"

    def get_required_fields(self) -> list[str]:
        return ["Wtb"]

    def get_default_params(self) -> dict[str, Any]:
        return {"field": "Wtb", "invalid_to_nan": True}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        field = params["field"]
        if field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        wtb = pd.to_numeric(df[field], errors="coerce")
        if params["invalid_to_nan"]:
            wtb = wtb.where(wtb > 0)
        return wtb


class VolumeAmountFactor(Factor):
    factor_id = "volume_amount"
    factor_name = "成交额"
    factor_category = "volume_price"
    factor_description = "当日成交额（元）。优先用 amount，缺失时用 Zjl*10000 兜底。"

    def get_required_fields(self) -> list[str]:
        return ["amount"]

    def get_default_params(self) -> dict[str, Any]:
        return {"unit": "yuan"}  # yuan | billion

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        if "amount" not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        amount = pd.to_numeric(df["amount"], errors="coerce")
        if params["unit"] == "billion":
            return amount / 1e8
        return amount


class PriceVolumeScoreFactor(Factor):
    factor_id = "price_volume_score"
    factor_name = "量价配合度"
    factor_category = "volume_price"
    factor_description = (
        "量价配合度评分 (0-25)。V8 趋势策略逻辑: "
        "zaf>0 & wtb>1.5=25, zaf>0 & wtb>1=18, zaf>0 & wtb>0.8=10, zaf>0 & wtb<=0.8=4。"
    )

    def get_required_fields(self) -> list[str]:
        return ["ZAF", "Wtb"]

    def get_default_params(self) -> dict[str, Any]:
        # 阈值不硬编码，可被策略 YAML 覆盖
        return {
            "zaf_field": "ZAF",
            "wtb_field": "Wtb",
            "tiers": [
                {"zaf_min": 0.0, "wtb_min": 1.5, "score": 25.0},
                {"zaf_min": 0.0, "wtb_min": 1.0, "score": 18.0},
                {"zaf_min": 0.0, "wtb_min": 0.8, "score": 10.0},
                {"zaf_min": 0.0, "wtb_min": 0.0, "score": 4.0},
            ],
        }

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        zaf_field = params["zaf_field"]
        wtb_field = params["wtb_field"]
        if zaf_field not in df.columns or wtb_field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        zaf = pd.to_numeric(df[zaf_field], errors="coerce")
        wtb = pd.to_numeric(df[wtb_field], errors="coerce")
        scores = pd.Series(0.0, index=df.index)
        # 从严到松逐层覆盖
        for tier in sorted(params["tiers"], key=lambda t: -t["score"]):
            mask = (zaf > tier["zaf_min"]) & (wtb > tier["wtb_min"])
            scores = scores.mask(mask, tier["score"])
        # 涨幅为负/缺失 -> 0 分
        scores = scores.where(zaf.notna() & wtb.notna(), float("nan"))
        return scores
