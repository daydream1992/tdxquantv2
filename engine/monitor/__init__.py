"""监控循环引擎模块（L2 核心引擎层）。

导出：
- :class:`MonitorEngine` —— daemon 线程主循环，订阅行情 → 求值规则 → 落库 → 推送
- :class:`RuleSet` —— alert_templates 加载与求值（参数化、可热加载）
- :class:`MatchRegistry` —— 匹配策略层（绑定 strategy_id + scope + params + alerts）

详见 ``docs/MONITOR_ENGINE_PLAN.md`` 第四章 / 第十四章。

注：用 try/except 包导入，允许部分子模块未就绪时仍能导入其他子模块
（开发期分步实现，避免循环依赖或文件未创建时整体崩）。
"""
from __future__ import annotations

from engine.monitor.rules import AlertRule, RuleSet

__all__ = ["MonitorEngine", "RuleSet", "AlertRule", "MatchRegistry"]

try:  # Step 3+ 后才存在
    from engine.monitor.engine import MonitorEngine  # noqa: F401
except ImportError:  # pragma: no cover
    MonitorEngine = None  # type: ignore[assignment, misc]

try:  # Step 8+ 后才存在
    from engine.monitor.match_registry import MatchRegistry  # noqa: F401
except ImportError:  # pragma: no cover
    MatchRegistry = None  # type: ignore[assignment, misc]
