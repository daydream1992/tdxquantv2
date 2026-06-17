"""涨停类因子。

V8 选股中涨停/封板相关字段:
- ``FCb``              - 封成比
- ``FCAmo``            - 封单额(万元)
- ``fLianB``           - V8.1 重定义为连板数（原 ConZAFDateNum）
- ``封板强度系数``       - V8.1 新增（原 fLianB 值，封板强度参考）
- ``ZAF``              - 当日涨幅(%)
- ``YearZTDay``        - 年涨停天数
- ``VOpenZAF`` / ``OpenZAF`` / ``FzAmo`` - 竞价/开盘/尾盘相关

本模块提供以下因子:
- ``seal_ratio``        - 封成比 (FCb)
- ``seal_amount``       - 封单额 (FCAmo)
- ``consecutive_limit`` - 连板数 (fLianB，V8.1 重新定义)
- ``seal_strength``     - 封板强度系数 (原 fLianB)
- ``year_limit_days``   - 年涨停天数

TODO(P1-2): 待 STRATEGY_LOGIC.md 确认涨停判定阈值（9.8/19.5/29.5 三档区分板块）。
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from engine.factors.base import Factor


class SealRatioFactor(Factor):
    factor_id = "seal_ratio"
    factor_name = "封成比"
    factor_category = "limit_up"
    factor_description = "封成比，取 FCb 字段。V8 已对负值清洗为 0。"

    def get_required_fields(self) -> list[str]:
        return ["FCb"]

    def get_default_params(self) -> dict[str, Any]:
        return {"field": "FCb", "clip_min": 0.0}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        field = params["field"]
        if field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        fcb = pd.to_numeric(df[field], errors="coerce")
        if params.get("clip_min") is not None:
            fcb = fcb.where(fcb >= params["clip_min"], params["clip_min"])
        return fcb


class SealAmountFactor(Factor):
    factor_id = "seal_amount"
    factor_name = "封单额"
    factor_category = "limit_up"
    factor_description = "封单额(万元)，取 FCAmo 字段。"

    def get_required_fields(self) -> list[str]:
        return ["FCAmo"]

    def get_default_params(self) -> dict[str, Any]:
        return {"field": "FCAmo", "clip_min": 0.0}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        field = params["field"]
        if field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        fcamo = pd.to_numeric(df[field], errors="coerce")
        if params.get("clip_min") is not None:
            fcamo = fcamo.where(fcamo >= params["clip_min"], params["clip_min"])
        return fcamo


class ConsecutiveLimitFactor(Factor):
    factor_id = "consecutive_limit"
    factor_name = "连板数"
    factor_category = "limit_up"
    factor_description = (
        "连板数。V8.1 修复 Bug: 改用 ConZAFDateNum，原 fLianB 字段语义改为封板强度系数。"
        "本因子读取清洗后的 fLianB 字段（数据清洗步骤已重定义）。"
    )

    def get_required_fields(self) -> list[str]:
        return ["fLianB", "是否涨停"]

    def get_default_params(self) -> dict[str, Any]:
        return {"field": "fLianB", "zt_field": "是否涨停"}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        field = params["field"]
        zt_field = params["zt_field"]
        if field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        lianb = pd.to_numeric(df[field], errors="coerce").fillna(0).astype(int)
        # 非涨停股连板数置 0（V8.1 Bug4 修复）
        if zt_field in df.columns:
            zt = df[zt_field].astype(bool)
            lianb = lianb.where(zt, 0)
        return lianb.astype(float)


class SealStrengthFactor(Factor):
    factor_id = "seal_strength"
    factor_name = "封板强度系数"
    factor_category = "limit_up"
    factor_description = "封板强度系数，取清洗后的 ``封板强度系数`` 字段（V8.1 原 fLianB 值）。"

    def get_required_fields(self) -> list[str]:
        return ["封板强度系数"]

    def get_default_params(self) -> dict[str, Any]:
        return {"field": "封板强度系数"}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        field = params["field"]
        if field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        return pd.to_numeric(df[field], errors="coerce").fillna(0.0)


class YearLimitDaysFactor(Factor):
    factor_id = "year_limit_days"
    factor_name = "年涨停天数"
    factor_category = "limit_up"
    factor_description = "近一年涨停天数，取 YearZTDay 字段。用于股性活跃度评估。"

    def get_required_fields(self) -> list[str]:
        return ["YearZTDay"]

    def get_default_params(self) -> dict[str, Any]:
        return {"field": "YearZTDay"}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        field = params["field"]
        if field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        return pd.to_numeric(df[field], errors="coerce").fillna(0).astype(float)
