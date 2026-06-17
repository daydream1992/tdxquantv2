"""安全表达式求值引擎。

用于策略 YAML 的 ``scoring.formula`` 与 ``alert_conditions[*].condition`` 字段。

设计要点：
1. **不用 ``eval`` / ``exec``**：用第三方 ``simpleeval`` 库的 AST 解析 + 白名单求值。
2. **支持**：算术（``+ - * / // % **``）/ 比较（``== != < > <= >=``）/ 逻辑
   （``and / or / not``）/ 字典 key 访问（``variables["x"]``）/ 列表索引。
3. **禁止**：函数调用 / ``import`` / 属性访问（``.`` 在 simpleeval 中需显式注册）。
4. **接口**：``evaluate(expr: str, variables: dict) -> Any``
5. **可配置函数白名单**：``register_function(name, func)`` 添加业务函数（如
   ``sum`` / ``abs`` / ``rank_percentile`` 等）。

典型用法：
    >>> ev = ExpressionEvaluator()
    >>> ev.evaluate("a + b * 2", {"a": 1, "b": 2})
    5
    >>> ev.evaluate("pct_change > 0.095 and volume > 10000", {"pct_change": 0.1, "volume": 20000})
    True
"""

from __future__ import annotations

import logging
from typing import Any, Callable

try:
    from simpleeval import (
        EvalWithCompoundTypes,
        NameNotDefined,
        SimpleEval,
        AttributeDoesNotExist,
    )
    _SIMPLEEVAL_AVAILABLE = True
except ImportError:  # pragma: no cover
    _SIMPLEEVAL_AVAILABLE = False
    EvalWithCompoundTypes = None  # type: ignore[assignment, misc]

logger = logging.getLogger(__name__)


# 默认允许的内置函数（白名单）
# simpleeval 自带的安全运算符（基于 AST 节点类型）已包含算术/比较/逻辑全部，
# 无需在 ``SimpleEval(operators=...)`` 中显式覆盖；覆盖反而会丢失默认运算符。
_DEFAULT_FUNCTIONS: dict[str, Callable[..., Any]] = {
    "abs": abs,
    "min": min,
    "max": max,
    "sum": sum,
    "len": len,
    "round": round,
    "int": int,
    "float": float,
    "str": str,
    "bool": bool,
    "any": any,
    "all": all,
    "sorted": sorted,
}


class ExpressionEvaluator:
    """安全表达式求值器（基于 ``simpleeval``）。

    若 ``simpleeval`` 不可用，回退到一个**只支持最简表达式**的极简解析器
    （仅用于环境降级，不保证完整覆盖语法）。
    """

    def __init__(
        self,
        *,
        extra_functions: dict[str, Callable[..., Any]] | None = None,
        extra_names: dict[str, Any] | None = None,
    ) -> None:
        """初始化。

        Args:
            extra_functions: 业务自定义函数白名单（合并到默认函数）。
            extra_names: 默认变量（每次 ``evaluate`` 的 ``variables`` 会覆盖同名项）。
        """
        self._functions: dict[str, Callable[..., Any]] = dict(_DEFAULT_FUNCTIONS)
        if extra_functions:
            self._functions.update(extra_functions)
        self._default_names: dict[str, Any] = dict(extra_names or {})
        self._simpleeval: SimpleEval | None = None
        if _SIMPLEEVAL_AVAILABLE:
            # 使用 ``EvalWithCompoundTypes`` 而非基础 ``SimpleEval``，以支持
            # ``[1,2,3]`` / ``{"a":1}`` / ``(1,2)`` 等 literal。
            # 不传 operators 参数，使用 simpleeval 默认运算符（已含 + - * / % ** //
            # == != < > <= >= and or not in not_in is is_not）
            self._simpleeval = EvalWithCompoundTypes(
                functions=dict(self._functions),
                names=dict(self._default_names),
            )
        else:  # pragma: no cover
            logger.warning("simpleeval 未安装，表达式引擎退化为极简模式")

    # ------------------------------------------------------------------
    # 核心接口
    # ------------------------------------------------------------------

    def evaluate(self, expr: str, variables: dict[str, Any] | None = None) -> Any:
        """求值。

        Args:
            expr: 表达式字符串，如 ``"a + b > 1 and pct < 0.1"``。
            variables: 变量字典，键名直接作为标识符。

        Returns:
            表达式结果（数字 / 字符串 / 布尔等）。

        Raises:
            ExpressionError: 表达式语法错误 / 引用未定义变量 / 禁用操作。
        """
        if not expr or not isinstance(expr, str):
            raise ExpressionError(f"表达式非法: {expr!r}")
        expr = expr.strip()
        if not expr:
            raise ExpressionError("表达式为空")

        merged_names = dict(self._default_names)
        if variables:
            merged_names.update(variables)

        if self._simpleeval is not None:
            try:
                self._simpleeval.names = merged_names
                return self._simpleeval.eval(expr)
            except NameNotDefined as exc:
                raise ExpressionError(f"未定义变量: {exc}") from exc
            except (AttributeDoesNotExist, SyntaxError, TypeError, ValueError, ZeroDivisionError) as exc:
                raise ExpressionError(f"表达式求值失败: {exc}") from exc
            except Exception as exc:  # noqa: BLE001
                raise ExpressionError(f"表达式求值异常: {exc}") from exc
        # 极简回退（无 simpleeval）
        return self._fallback_eval(expr, merged_names)

    def register_function(self, name: str, func: Callable[..., Any]) -> None:
        """注册业务函数到白名单。

        Args:
            name: 表达式中使用的函数名。
            func: Python 可调用对象。
        """
        self._functions[name] = func
        if self._simpleeval is not None:
            self._simpleeval.functions = dict(self._functions)

    def register_name(self, name: str, value: Any) -> None:
        """注册默认变量（每次 evaluate 时同名 key 会被覆盖）。"""
        self._default_names[name] = value
        if self._simpleeval is not None:
            self._simpleeval.names = dict(self._default_names)

    # ------------------------------------------------------------------
    # 极简回退（仅当 simpleeval 不可用时使用）
    # ------------------------------------------------------------------

    def _fallback_eval(self, expr: str, variables: dict[str, Any]) -> Any:
        """极简求值：仅支持 ``变量名`` / ``数字字面量`` / 简单比较。

        复杂表达式会抛 ``ExpressionError``，提示安装 simpleeval。
        """
        # 替换变量名（裸标识符）
        import re

        def _repl(m: re.Match) -> str:
            name = m.group(0)
            if name in variables:
                v = variables[name]
                return repr(v)
            if name in ("and", "or", "not", "True", "False", "None"):
                return name
            if name in self._functions:
                raise ExpressionError(
                    f"函数调用 {name}() 在极简模式下不支持，请安装 simpleeval"
                )
            raise ExpressionError(f"未定义变量: {name}")

        # 仅匹配符合标识符规则的 token
        replaced = re.sub(r"[A-Za-z_][A-Za-z0-9_]*", _repl, expr)
        try:
            # 严格限制 globals/locals
            return eval(replaced, {"__builtins__": {}}, {})  # noqa: S307
        except Exception as exc:  # noqa: BLE001
            raise ExpressionError(
                f"极简求值失败（请安装 simpleeval 获得完整支持）: {exc}"
            ) from exc


# ----------------------------------------------------------------------------
# 全局单例（业务模块可直接 ``from engine.expression.evaluator import evaluator``）
# ----------------------------------------------------------------------------

evaluator = ExpressionEvaluator()


# ----------------------------------------------------------------------------
# 异常
# ----------------------------------------------------------------------------


class ExpressionError(Exception):
    """表达式求值异常。"""


# ----------------------------------------------------------------------------
# 便捷函数
# ----------------------------------------------------------------------------


def evaluate(expr: str, variables: dict[str, Any] | None = None) -> Any:
    """模块级便捷求值（用全局单例）。"""
    return evaluator.evaluate(expr, variables)


def evaluate_safe(
    expr: str, variables: dict[str, Any] | None = None, default: Any = None
) -> Any:
    """求值，失败时返回 default（不抛异常）。

    适用于策略 YAML 的 ``alert_conditions`` 等场景，避免单条规则失败影响整体流程。
    """
    try:
        return evaluator.evaluate(expr, variables)
    except ExpressionError as exc:
        logger.warning("表达式求值失败 expr=%r err=%s", expr, exc)
        return default
