"""反转类因子。

V8 错杀低吸策略核心:
- ``ZAF`` / ``ZAFPre20`` / ``ZAFPre60`` - 当日/20日/60日跌幅
- ``恐慌量`` = fHSL * |ZAF|
- ``大买占比`` - 承接力度
- ``行业涨停率`` - 催化剂
- ``Wtb`` - 量比（底部放量）

本模块提供以下因子:
- ``panic_depth``    - 恐慌深度评分 (0-30)
- ``panic_volume``   - 恐慌量 = fHSL * |ZAF|
- ``support_strength`` - 承接力度评分 (0-30)
- ``catalyst_score`` - 催化剂评分 (0-20)

TODO(P1-2): 待 STRATEGY_LOGIC.md 确认错杀低吸 pool 阈值与评分分档。
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from engine.factors.base import Factor


class PanicDepthFactor(Factor):
    factor_id = "panic_depth"
    factor_name = "恐慌深度"
    factor_category = "reversal"
    factor_description = (
        "恐慌深度评分 (0-30)。V8 错杀低吸策略: "
        "当日 ZAF≤-7=15, -7<ZAF≤-5=12, -5<ZAF≤-3=8, -3<ZAF≤-1=3; "
        "ZAFPre60≤-25=+10, -25<ZAFPre60≤-15=+7; ZAFPre20≤-15=+8, -15<ZAFPre20≤-8=+5。"
    )

    def get_required_fields(self) -> list[str]:
        return ["ZAF", "ZAFPre20", "ZAFPre60"]

    def get_default_params(self) -> dict[str, Any]:
        return {
            "zaf_field": "ZAF",
            "zaf20_field": "ZAFPre20",
            "zaf60_field": "ZAFPre60",
            "max_score": 30.0,
        }

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        zaf = pd.to_numeric(df.get(params["zaf_field"]), errors="coerce") if params["zaf_field"] in df.columns else None
        zaf20 = pd.to_numeric(df.get(params["zaf20_field"]), errors="coerce") if params["zaf20_field"] in df.columns else None
        zaf60 = pd.to_numeric(df.get(params["zaf60_field"]), errors="coerce") if params["zaf60_field"] in df.columns else None

        scores = pd.Series(0.0, index=df.index)
        if zaf is not None:
            scores = scores.mask(zaf <= -7, 15.0)
            scores = scores.mask((zaf > -7) & (zaf <= -5), 12.0)
            scores = scores.mask((zaf > -5) & (zaf <= -3), 8.0)
            scores = scores.mask((zaf > -3) & (zaf <= -1), 3.0)
        if zaf60 is not None:
            scores = scores.mask(zaf60 <= -25, scores + 10.0)
            scores = scores.mask((zaf60 > -25) & (zaf60 <= -15), scores + 7.0)
        if zaf20 is not None:
            scores = scores.mask(zaf20 <= -15, scores + 8.0)
            scores = scores.mask((zaf20 > -15) & (zaf20 <= -8), scores + 5.0)
        return scores.clip(upper=params["max_score"])


class PanicVolumeFactor(Factor):
    factor_id = "panic_volume"
    factor_name = "恐慌量"
    factor_category = "reversal"
    factor_description = "恐慌量 = 换手率 × |涨幅|，反映恐慌放量的剧烈程度。"

    def get_required_fields(self) -> list[str]:
        return ["fHSL", "ZAF"]

    def get_default_params(self) -> dict[str, Any]:
        return {"hsl_field": "fHSL", "zaf_field": "ZAF", "field": "恐慌量"}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        # 优先用清洗后的派生字段
        if params["field"] in df.columns:
            return pd.to_numeric(df[params["field"]], errors="coerce")
        hsl_field = params["hsl_field"]
        zaf_field = params["zaf_field"]
        if hsl_field not in df.columns or zaf_field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        hsl = pd.to_numeric(df[hsl_field], errors="coerce")
        zaf = pd.to_numeric(df[zaf_field], errors="coerce")
        return hsl * zaf.abs()


class SupportStrengthFactor(Factor):
    factor_id = "support_strength"
    factor_name = "承接力度"
    factor_category = "reversal"
    factor_description = (
        "承接力度评分 (0-30)。V8 错杀低吸策略: "
        "大买占比≥0.5=18, 0.4-0.5=14, 0.3-0.4=8; "
        "主力净流入≥5000万=+12, 1000-5000万=+8, 0-1000万=+3。"
    )

    def get_required_fields(self) -> list[str]:
        return ["大买占比", "Zjl"]

    def get_default_params(self) -> dict[str, Any]:
        return {
            "ratio_field": "大买占比",
            "inflow_field": "Zjl",
            "max_score": 30.0,
        }

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        ratio = pd.to_numeric(df.get(params["ratio_field"]), errors="coerce") if params["ratio_field"] in df.columns else None
        inflow = pd.to_numeric(df.get(params["inflow_field"]), errors="coerce") if params["inflow_field"] in df.columns else None

        scores = pd.Series(0.0, index=df.index)
        if ratio is not None:
            scores = scores.mask(ratio >= 0.5, 18.0)
            scores = scores.mask((ratio >= 0.4) & (ratio < 0.5), 14.0)
            scores = scores.mask((ratio >= 0.3) & (ratio < 0.4), 8.0)
        if inflow is not None:
            scores = scores.mask(inflow >= 5000, scores + 12.0)
            scores = scores.mask((inflow >= 1000) & (inflow < 5000), scores + 8.0)
            scores = scores.mask((inflow >= 0) & (inflow < 1000), scores + 3.0)
        return scores.clip(upper=params["max_score"])


class CatalystScoreFactor(Factor):
    factor_id = "catalyst_score"
    factor_name = "催化剂评分"
    factor_category = "reversal"
    factor_description = (
        "催化剂评分 (0-20)。V8 错杀低吸策略: "
        "行业涨停率≥5=12, 2-5=8, 1-2=3; 量比≥3=+8, 2-3=+5。"
    )

    def get_required_fields(self) -> list[str]:
        return ["行业涨停率", "Wtb"]

    def get_default_params(self) -> dict[str, Any]:
        return {
            "ind_zt_rate_field": "行业涨停率",
            "wtb_field": "Wtb",
            "max_score": 20.0,
        }

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        ind_rate = pd.to_numeric(df.get(params["ind_zt_rate_field"]), errors="coerce") if params["ind_zt_rate_field"] in df.columns else None
        wtb = pd.to_numeric(df.get(params["wtb_field"]), errors="coerce") if params["wtb_field"] in df.columns else None

        scores = pd.Series(0.0, index=df.index)
        if ind_rate is not None:
            scores = scores.mask(ind_rate >= 5, 12.0)
            scores = scores.mask((ind_rate >= 2) & (ind_rate < 5), 8.0)
            scores = scores.mask((ind_rate >= 1) & (ind_rate < 2), 3.0)
        if wtb is not None:
            scores = scores.mask(wtb >= 3, scores + 8.0)
            scores = scores.mask((wtb >= 2) & (wtb < 3), scores + 5.0)
        return scores.clip(upper=params["max_score"])
