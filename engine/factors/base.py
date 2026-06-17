"""因子插件抽象基类。

所有因子插件继承 :class:`Factor`，实现 :meth:`calculate` 即可被
:class:`engine.factors.registry.FactorRegistry` 自动发现注册。

设计要点
--------
1. **纯函数式**: ``calculate`` 接收 DataFrame + 参数字典，返回 Series，
   不修改输入数据，无内部状态，便于并行与缓存。
2. **声明依赖字段**: ``get_required_fields`` 返回因子需要的数据列，
   :class:`engine.pipeline.steps.load_data.LoadDataStep` 据此决定拉取哪些数据。
3. **不硬编码参数**: 所有阈值/窗口/比率必须从 ``params`` 读取，``params`` 由
   策略 YAML 的 ``factors[].params`` 注入。
4. **占位实现**: 本阶段（P1-4）仅提供骨架，具体公式待 P1-2 ``STRATEGY_LOGIC.md``
   产出后填充。骨架实现返回基于公开字段（如 ``ZAF``、``fHSL``）的简单派生值，
   不影响流水线跑通。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import pandas as pd


class Factor(ABC):
    """因子抽象基类。

    子类必须设置类属性 ``factor_id`` / ``factor_name`` / ``factor_category``，
    并实现 :meth:`calculate`。可选覆盖 :meth:`get_required_fields` 声明数据依赖。
    """

    # ---- 子类必须覆盖的类属性 ----
    factor_id: str = ""
    """因子唯一标识，与策略 YAML ``factors[].factor_id`` 对应。"""

    factor_name: str = ""
    """因子中文名，用于日志/UI 显示。"""

    factor_category: str = ""
    """因子分类: momentum/breakout/valuation/volume/limit_up/trend/reversal/turnover。"""

    factor_description: str = ""
    """因子说明（可选）。"""

    # ---- 子类可选覆盖的方法 ----
    @abstractmethod
    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        """计算因子值。

        Parameters
        ----------
        df:
            输入数据 DataFrame，包含 :meth:`get_required_fields` 声明的字段。
            index 通常是股票代码（``code``），也可能是行号；
            因子实现需要自行处理 index 对齐。
        params:
            来自策略 YAML ``factors[].params`` 的参数字典。

        Returns
        -------
        pd.Series
            每只股票的因子值，index 与 ``df.index`` 对齐。
            缺失值用 ``NaN`` 表示。
        """
        raise NotImplementedError

    def get_required_fields(self) -> list[str]:
        """声明该因子需要哪些数据字段。

        默认返回空列表，子类可覆盖。
        :class:`engine.pipeline.steps.load_data.LoadDataStep` 会据此决定拉取哪些字段。
        """
        return []

    def get_default_params(self) -> dict[str, Any]:
        """因子默认参数（可选覆盖）。

        策略 YAML 中未显式给出的参数会用默认值填充。
        """
        return {}

    # ---- 内部工具方法 ----
    def __repr__(self) -> str:
        return (
            f"<Factor {self.factor_id} name={self.factor_name!r} "
            f"category={self.factor_category!r}>"
        )


class FactorError(Exception):
    """因子计算异常基类。"""


class FactorCalculationError(FactorError):
    """因子计算过程异常。"""
