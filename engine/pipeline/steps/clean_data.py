"""数据清洗步骤。

应用 ``cleaning.rules_file`` 引用的通用规则 + 策略 ``custom_rules``。

支持的 rule_type:
- ``filter_negative``  - 过滤负值（drop 或 set_nan）
- ``rename_field``     - 字段重命名
- ``cast_numeric``     - 数值字段统一转 numeric
- ``drop_na``          - 删除空值行
- ``apply_formula``    - 用表达式引擎求值新字段（V8 卖撤率公式重写）

规则从 YAML 读取，不硬编码。规则文件路径来自策略 ``cleaning.rules_file``，
默认 ``cleaning_rules.yaml``。

P1-3 依赖
----------
- ``engine.expression.evaluator.ExpressionEvaluator`` 用于 ``apply_formula`` 规则
- ``engine.config.loader.ConfigLoader`` 用于加载 cleaning_rules.yaml

P1-3 接口未稳定时，``apply_formula`` 用 ``pd.eval`` 兜底，配置加载用 ``yaml.safe_load``。
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import pandas as pd

# P1-3 依赖: try/except 兜底
try:  # pragma: no cover
    from engine.config.loader import ConfigLoader  # type: ignore
    _CONFIG_LOADER_READY = True
except (ImportError, AttributeError, Exception):  # noqa: BLE001
    _CONFIG_LOADER_READY = False

    class ConfigLoader:  # type: ignore[no-redef]
        """P1-3 占位，等真实 ConfigLoader 实现后自动覆盖。"""
        # TODO: 待 P1-3 完成

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self._data: dict[str, Any] = {}

        def get(self, key: str, default: Any = None) -> Any:
            return default

        def all(self) -> dict[str, Any]:
            return self._data

        @staticmethod
        def load(path: str | Path) -> dict[str, Any]:
            import yaml
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}

try:  # pragma: no cover
    from engine.expression.evaluator import ExpressionEvaluator  # type: ignore
    _EVALUATOR_READY = True
except (ImportError, AttributeError, Exception) as _exc:  # noqa: BLE001
    _EVALUATOR_READY = False
    _EVALUATOR_IMPORT_ERROR = _exc

    class ExpressionEvaluator:  # type: ignore[no-redef]
        """P1-3 占位，等真实 ExpressionEvaluator 实现后自动覆盖。"""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def evaluate(self, formula: str, df: pd.DataFrame) -> pd.Series:
            # 兜底实现：用 pandas eval（功能受限，仅供占位）
            # TODO: 待 P1-3 完成
            try:
                return df.eval(formula)
            except Exception as exc:  # noqa: BLE001
                raise ValueError(f"公式求值失败: {formula}: {exc}") from exc


from engine.pipeline.base import PipelineContext, PipelineStep, StepExecutionError

logger = logging.getLogger(__name__)


class CleanDataStep(PipelineStep):
    """数据清洗步骤。

    输入: ``context.data["universe"]`` (经过 universe 过滤的快照)
          ``context.data["kline"]`` (K 线数据)
    输出: ``context.data["cleaned"]`` (清洗后的合并 DataFrame，供因子计算使用)
    """

    step_id = "clean_data"
    step_name = "数据清洗"

    def execute(self, context: PipelineContext) -> PipelineContext:
        cleaning_cfg: dict[str, Any] = self.config.get("cleaning", {}) or {}
        rules_file = cleaning_cfg.get("rules_file", "cleaning_rules.yaml")
        custom_rules = cleaning_cfg.get("custom_rules", []) or []

        # 1. 加载通用清洗规则
        rules: list[dict[str, Any]] = []
        if rules_file:
            rules.extend(self._load_rules_file(rules_file))
        rules.extend(custom_rules)

        # 2. 取出待清洗数据
        universe_df = context.data.get("universe")
        if universe_df is None or universe_df.empty:
            self.logger.warning("universe 为空，跳过清洗")
            context.data["cleaned"] = pd.DataFrame()
            return context

        df = universe_df.copy()

        # 3. 逐条应用规则
        applied: list[str] = []
        for rule in rules:
            rule_id = rule.get("rule_id") or rule.get("rule", f"<rule_{len(applied)+1}>")
            try:
                df = self._apply_rule(df, rule)
                applied.append(rule_id)
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("规则 %s 应用失败: %s", rule_id, exc)
                context.add_warning(self.step_id, f"规则 {rule_id} 应用失败: {exc}")

        # 4. 应用 old_filter (老登过滤)
        old_filter_cfg = cleaning_cfg.get("old_filter", {}) or {}
        if old_filter_cfg.get("enabled", False):
            df = self._apply_old_filter(df, old_filter_cfg, context)

        # 4.5 应用策略 pool 表达式（如 dbqzt: is_limit_up or ZAF >= 7）
        pool_cfg = self.config.get("pool", {}) or {}
        pool_expr = pool_cfg.get("expression")
        if pool_expr:
            df = self._apply_pool(df, pool_expr, context)

        # 5. 合并 K 线技术指标（如可用）
        kline_df = context.data.get("kline")
        if kline_df is not None and not kline_df.empty:
            df = self._merge_kline_indicators(df, kline_df)

        context.data["cleaned"] = df
        self.logger.info(
            "清洗完成: 应用 %d 条规则, 剩余 %d 只, 列数 %d",
            len(applied), len(df), len(df.columns),
        )
        return context

    # ---- 规则加载 ----
    def _load_rules_file(self, rules_file: str) -> list[dict[str, Any]]:
        """加载通用清洗规则文件。

        优先用 P1-3 ``ConfigLoader().all()`` (已合并 config/*.yaml)，
        兜底用 yaml.safe_load。
        """
        # 1. 优先用真实 ConfigLoader (P1-3)
        if _CONFIG_LOADER_READY:
            try:
                loader = ConfigLoader()
                data = loader.all()  # type: ignore[attr-defined]
                rules = data.get("rules", []) or []
                old_filter = data.get("old_filter", {}) or {}
                limit_up = data.get("limit_up_thresholds", {}) or {}
                if rules:
                    self.logger.debug(
                        "从 ConfigLoader 加载清洗规则: %d 条 + old_filter(enabled=%s) + limit_up_thresholds",
                        len(rules), old_filter.get("enabled", False),
                    )
                    return rules
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("ConfigLoader.all() 加载清洗规则失败: %s", exc)

        # 2. 兜底: 直接读 YAML 文件
        candidates = [
            Path("config") / rules_file,
            Path(rules_file),
        ]
        import yaml
        for path in candidates:
            if path.exists():
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = yaml.safe_load(f) or {}
                    return data.get("rules", []) or []
                except Exception as exc:  # noqa: BLE001
                    self.logger.warning("yaml 加载 %s 失败: %s", path, exc)
        self.logger.warning("清洗规则文件 %s 未找到", rules_file)
        return []

    # ---- 单条规则应用 ----
    def _apply_rule(self, df: pd.DataFrame, rule: dict[str, Any]) -> pd.DataFrame:
        rule_type = rule.get("rule_type") or rule.get("rule", "")
        if rule_type == "filter_negative":
            return self._rule_filter_negative(df, rule)
        elif rule_type == "rename_field":
            return self._rule_rename_field(df, rule)
        elif rule_type == "cast_numeric":
            return self._rule_cast_numeric(df, rule)
        elif rule_type == "drop_na":
            return self._rule_drop_na(df, rule)
        elif rule_type == "apply_formula":
            return self._rule_apply_formula(df, rule)
        else:
            self.logger.debug("未知 rule_type %s，跳过", rule_type)
            return df

    def _rule_filter_negative(self, df: pd.DataFrame, rule: dict[str, Any]) -> pd.DataFrame:
        field = rule["field"]
        if field not in df.columns:
            return df
        action = rule.get("action", "drop")
        values = pd.to_numeric(df[field], errors="coerce")
        neg_mask = values < 0
        # V8: Wtb 负值与 0 都置 NaN；FCb/FCAmo 负值置 0
        zero_mask = rule.get("also_zero", False) and (values == 0)
        invalid_mask = neg_mask | zero_mask
        if action == "drop":
            df = df[~invalid_mask].copy()
        elif action == "set_nan":
            df.loc[invalid_mask, field] = float("nan")
        elif action == "set_zero":
            df.loc[neg_mask, field] = 0
        return df

    def _rule_rename_field(self, df: pd.DataFrame, rule: dict[str, Any]) -> pd.DataFrame:
        from_field = rule["from"]
        to_field = rule["to"]
        if from_field not in df.columns:
            return df
        return df.rename(columns={from_field: to_field})

    def _rule_cast_numeric(self, df: pd.DataFrame, rule: dict[str, Any]) -> pd.DataFrame:
        fields = rule.get("fields", [])
        for f in fields:
            if f in df.columns:
                df[f] = pd.to_numeric(df[f], errors="coerce")
        return df

    def _rule_drop_na(self, df: pd.DataFrame, rule: dict[str, Any]) -> pd.DataFrame:
        fields = rule.get("fields", [])
        existing = [f for f in fields if f in df.columns]
        if existing:
            return df.dropna(subset=existing)
        return df

    def _rule_apply_formula(self, df: pd.DataFrame, rule: dict[str, Any]) -> pd.DataFrame:
        field = rule["field"]
        formula = rule["formula"]
        # P1-3 真实 ExpressionEvaluator 不接受 safe 参数, 用 try/except 兜底
        try:
            evaluator = ExpressionEvaluator()
        except TypeError:
            try:
                evaluator = ExpressionEvaluator(safe=True)
            except Exception:
                evaluator = None
        if evaluator is not None:
            try:
                # P1-3 真实接口: evaluate(formula, variables_dict)
                # 此处公式可能引用 df 列, 用 df 列构造 variables
                # tqcenter 部分字段（如 SCancel）声明为 str 但参与算术公式，
                # 统一 to_numeric 归一，避免 str+int 拼接报 "can only concatenate
                # str (not int) to str"；errors='coerce' 保留非数值列原样
                variables = {}
                for col in df.columns:
                    if col == field:
                        continue
                    s = df[col]
                    if s.dtype == object:
                        s = pd.to_numeric(s, errors="coerce")
                    variables[col] = s
                result = evaluator.evaluate(formula, variables)
                if isinstance(result, pd.Series):
                    df[field] = result
                else:
                    # 标量结果, 广播到所有行
                    df[field] = result
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("公式 %s 求值失败，跳过: %s", formula, exc)
        return df

    # ---- 老登过滤 ----
    def _apply_old_filter(
        self,
        df: pd.DataFrame,
        old_filter_cfg: dict[str, Any],
        context: PipelineContext,
    ) -> pd.DataFrame:
        """老登过滤: 排除年涨停数为0 + 换手率低 + Beta值低 的"老登股"。

        V8: YearZTDay==0 & fHSL<1 & BetaValue<0.8
        阈值从配置读取，不硬编码。
        """
        conditions = old_filter_cfg.get("conditions", []) or []
        if not conditions:
            return df
        # 简单条件解析: "field op value"
        import re
        mask = pd.Series(False, index=df.index)
        for cond in conditions:
            m = re.match(r"(\w+)\s*(>=|<=|==|!=|>|<)\s*([\d.]+)", cond.strip())
            if not m:
                continue
            field, op, value = m.group(1), m.group(2), float(m.group(3))
            if field not in df.columns:
                continue
            series = pd.to_numeric(df[field], errors="coerce")
            cond_mask = {
                ">=": series >= value,
                "<=": series <= value,
                "==": series == value,
                "!=": series != value,
                ">": series > value,
                "<": series < value,
            }[op]
            # AND 逻辑：所有条件同时满足才标记为"老登"
            if mask.sum() == 0:
                mask = cond_mask.fillna(False)
            else:
                mask = mask & cond_mask.fillna(False)
        df = df[~mask].copy()
        self.logger.info("老登过滤剔除 %d 只", mask.sum())
        return df

    # ---- 策略 pool 表达式过滤 ----
    def _apply_pool(self, df: pd.DataFrame, expr: str, context: PipelineContext) -> pd.DataFrame:
        """应用策略 pool 表达式（如 ``is_limit_up or ZAF >= 7``）。

        用 pandas.eval 求值，支持 and/or/not/比较/算术。
        表达式引用 df 列名。求值结果为布尔 Series，True 保留。

        V8 兼容: pool 是策略专属的"进入选股池"条件，在 universe 基础上进一步过滤。
        """
        if not expr or df.empty:
            return df
        try:
            # 把 is_limit_up / 是否涨停 等布尔列确保为 bool
            for bool_col in ("is_limit_up", "是否涨停", "是否ST", "is_st"):
                if bool_col in df.columns:
                    df[bool_col] = df[bool_col].astype(bool)
            # 用 pandas eval 求值（支持 and/or/not/比较）
            mask = df.eval(expr)
            # 处理可能的全 NaN（列不存在时）
            if mask.isna().all():
                self.logger.warning("pool 表达式 %s 求值全 NaN（列可能缺失），跳过 pool", expr)
                context.add_warning(self.step_id, f"pool 表达式 {expr} 求值全 NaN")
                return df
            n_before = len(df)
            df = df[mask.fillna(False)].copy()
            self.logger.info("pool 过滤 [%s]: %d -> %d 只", expr, n_before, len(df))
            return df
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("pool 表达式 %s 求值失败，跳过: %s", expr, exc)
            context.add_warning(self.step_id, f"pool 表达式 {expr} 求值失败: {exc}")
            return df

    # ---- K 线技术指标合并 ----
    def _merge_kline_indicators(self, df: pd.DataFrame, kline_df: pd.DataFrame) -> pd.DataFrame:
        """合并 K 线最新一日的技术指标 (MA5/MA10/MA20/DIF/DEA/MACD_BAR/BOLL_UP)。

        V8 兼容: 列名加 KL_ 前缀避免冲突。
        """
        if kline_df.empty or "code" not in kline_df.columns or "date" not in kline_df.columns:
            return df
        try:
            latest_date = kline_df["date"].max()
            kline_latest = kline_df[kline_df["date"] == latest_date].set_index("code")
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("K 线最新日提取失败: %s", exc)
            return df

        tech_cols = ["MA5", "MA10", "MA20", "DIF", "DEA", "MACD_BAR", "BOLL_UP", "high", "close"]
        available = [c for c in tech_cols if c in kline_latest.columns]
        if not available:
            return df
        kline_tech = kline_latest[available].copy()
        kline_tech.columns = [f"KL_{c}" for c in available]
        # 与 df 按 code 合并
        if "code" in df.columns:
            return df.merge(kline_tech, left_on="code", right_index=True, how="left")
        return df
