"""估值类因子。

V8 选股中估值相关:
- ``Zsz`` - 总市值(亿)
- 估值字段（PE/PB/PCF/股息率）需通过 ``get_financial_data`` 拉取

本模块提供以下因子:
- ``market_cap`` - 总市值（亿元，取 Zsz）
- ``pe_ttm``     - 滚动市盈率（占位，待财务数据接入）
- ``pb_ratio``   - 市净率（占位）

TODO(P1-2): 待 STRATEGY_LOGIC.md 确认估值因子的取数口径（静态/动态/TTM）。
TODO(P1-3): 待 ``engine.data_adapter.base.BaseDataAdapter.get_financial_data`` 接口实现。
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from engine.factors.base import Factor


class MarketCapFactor(Factor):
    factor_id = "market_cap"
    factor_name = "总市值"
    factor_category = "valuation"
    factor_description = "总市值(亿元)，直接读取 Zsz 字段。"

    def get_required_fields(self) -> list[str]:
        return ["Zsz"]

    def get_default_params(self) -> dict[str, Any]:
        return {"field": "Zsz", "log_transform": False}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        field = params["field"]
        if field not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        cap = pd.to_numeric(df[field], errors="coerce")
        if params["log_transform"]:
            import numpy as np
            return np.log(cap.where(cap > 0))
        return cap


class PETTMFactor(Factor):
    factor_id = "pe_ttm"
    factor_name = "市盈率TTM"
    factor_category = "valuation"
    factor_description = "滚动12个月市盈率。需从财务数据接口拉取。"

    def get_required_fields(self) -> list[str]:
        # TODO(P1-3): 待 data_adapter.get_financial_data 实现后补全字段
        return ["pe_ttm"]

    def get_default_params(self) -> dict[str, Any]:
        return {"negative_to_nan": True}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        if "pe_ttm" not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        pe = pd.to_numeric(df["pe_ttm"], errors="coerce")
        if params["negative_to_nan"]:
            pe = pe.where(pe > 0)
        return pe


class PBRatioFactor(Factor):
    factor_id = "pb_ratio"
    factor_name = "市净率"
    factor_category = "valuation"
    factor_description = "市净率。需从财务数据接口拉取。"

    def get_required_fields(self) -> list[str]:
        return ["pb_ratio"]

    def get_default_params(self) -> dict[str, Any]:
        return {"negative_to_nan": True}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        if "pb_ratio" not in df.columns:
            return pd.Series(float("nan"), index=df.index, dtype=float)
        pb = pd.to_numeric(df["pb_ratio"], errors="coerce")
        if params["negative_to_nan"]:
            pb = pb.where(pb > 0)
        return pb
