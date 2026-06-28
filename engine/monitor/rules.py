"""告警规则加载与求值（RuleSet）。

职责：
1. 从 ``config/monitor.yaml`` 的 ``alert_templates`` 段加载所有规则模板（类级缓存）。
2. 提供 :meth:`RuleSet.evaluate` —— 把一条行情快照映射成表达式变量后逐条求值。
3. 提供 :meth:`RuleSet.render_condition` —— 把占位符 ``{pct_threshold}`` 用 params 渲染。
4. 配置 reload 时调 :meth:`RuleSet.invalidate` 清缓存，下次 load 重新读 YAML。

向后兼容：老的无占位符 condition（如 ``"volume_ratio > 3"``）``str.format()`` 不会报错。

变量映射（snap 字段 → 表达式变量，PLAN §6.3）：

| 表达式变量     | snap 来源（任一）                           | 缺省 |
|---------------|---------------------------------------------|------|
| pct_change    | ``pct_change`` / ``ZAF`` (÷100)             | 0    |
| volume_ratio  | ``volume_ratio`` / ``Wtb``                  | 0    |
| main_inflow   | ``main_inflow`` / ``Zjl``                   | 0    |
| auction_pct   | ``auction_pct`` / ``VOpenZAF`` (÷100)       | 0    |
| last          | ``last`` / ``Now`` / ``MA5Value``           | 0    |
| volume        | ``volume`` / ``Volume``                     | 0    |
| amount        | ``amount`` / ``Amount``                     | 0    |
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from engine.config.loader import ConfigLoader
from engine.expression.evaluator import ExpressionEvaluator, ExpressionError

logger = logging.getLogger(__name__)


@dataclass
class AlertRule:
    """单条告警模板（对应 ``alert_templates`` 的一项）。"""

    alert_type: str
    """预警类型 ID（全局唯一，如 ``limit_up`` / ``rzq_ignite``）。"""

    condition: str
    """触发条件表达式（可能含 ``{param}`` 占位符）。"""

    channels: list[str] = field(default_factory=list)
    """默认推送通道列表。"""

    priority: str = "medium"
    """优先级 high/medium/low。"""

    description: str = ""
    """人类可读描述。"""

    default_params: dict[str, Any] = field(default_factory=dict)
    """默认参数（match 不覆盖时用这套渲染 condition）。"""


class RuleSet:
    """告警模板加载与求值（类级缓存，热加载时调 :meth:`invalidate`）。"""

    _cache: list[AlertRule] | None = None
    """类级缓存：alert_templates → AlertRule 列表。"""

    _templates_raw: dict[str, dict[str, Any]] | None = None
    """类级缓存：原始 alert_templates dict（match_registry 引用 default_params 时用）。"""

    # ------------------------------------------------------------------
    # 加载 / 缓存
    # ------------------------------------------------------------------

    @classmethod
    def load(cls) -> list[AlertRule]:
        """加载所有 alert_templates，返回 AlertRule 列表（带缓存）。"""
        if cls._cache is not None:
            return cls._cache
        cfg = ConfigLoader()
        templates = cfg.get("alert_templates", {}) or {}
        if not isinstance(templates, dict):
            templates = {}
        cls._templates_raw = templates
        rules: list[AlertRule] = []
        for key, body in templates.items():
            if not isinstance(body, dict):
                continue
            try:
                rules.append(
                    AlertRule(
                        alert_type=str(body.get("alert_type", key)),
                        condition=str(body.get("condition", "false")),
                        channels=list(body.get("channels", []) or []),
                        priority=str(body.get("priority", "medium")),
                        description=str(body.get("description", "")),
                        default_params=dict(body.get("default_params", {}) or {}),
                    )
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("加载 alert_template %s 失败: %s", key, exc)
        cls._cache = rules
        logger.info("RuleSet 已加载 %d 条 alert_templates", len(rules))
        return rules

    @classmethod
    def get_template(cls, alert_type: str) -> dict[str, Any] | None:
        """返回原始模板 dict（含 default_params），未找到返回 None。"""
        templates = cls._templates_raw
        if templates is None:
            cfg = ConfigLoader()
            templates = cfg.get("alert_templates", {}) or {}
            cls._templates_raw = templates
        return templates.get(alert_type)

    @classmethod
    def invalidate(cls) -> None:
        """清缓存，配置 reload 时调。"""
        cls._cache = None
        cls._templates_raw = None

    # ------------------------------------------------------------------
    # 求值
    # ------------------------------------------------------------------

    @classmethod
    def evaluate(cls, snap: dict[str, Any]) -> list[AlertRule]:
        """对一条行情快照求值所有规则，返回命中列表（无参数渲染，用默认）。"""
        ev = ExpressionEvaluator()
        variables = cls.snap_to_variables(snap)
        hits: list[AlertRule] = []
        for rule in cls.load():
            # 无 match 场景：用 default_params 渲染
            condition = cls.render_condition(
                rule.condition, params={}, defaults=rule.default_params
            )
            try:
                if ev.evaluate(condition, variables):
                    hits.append(rule)
            except ExpressionError as exc:
                logger.debug("规则 %s 求值失败 expr=%r err=%s", rule.alert_type, condition, exc)
            except Exception as exc:  # noqa: BLE001
                logger.debug("规则 %s 求值异常: %s", rule.alert_type, exc)
        return hits

    # ------------------------------------------------------------------
    # 工具
    # ------------------------------------------------------------------

    @staticmethod
    def render_condition(
        template: str,
        params: dict[str, Any] | None,
        defaults: dict[str, Any] | None,
    ) -> str:
        """把 ``{param}`` 占位符渲染为实际值。

        - ``params`` 覆盖 ``defaults``（match params > template defaults）。
        - 缺参时退回 defaults；仍缺则保留原占位符（求值会抛 NameNotDefined，上层捕获）。
        - 老 condition 无占位符 → ``str.format()`` 原样返回（向后兼容）。
        """
        if not template:
            return "false"
        merged: dict[str, Any] = dict(defaults or {})
        if params:
            merged.update(params)
        if not merged:
            return template
        try:
            return template.format(**merged)
        except (KeyError, IndexError):
            # 退回 defaults
            try:
                return template.format(**dict(defaults or {}))
            except (KeyError, IndexError):
                return template
        except Exception:
            return template

    @staticmethod
    def snap_to_variables(snap: dict[str, Any]) -> dict[str, Any]:
        """把行情快照 dict 映射成表达式变量字典。

        字段缺失时给默认值 0，不报错（PLAN §6.3）。

        R14 形态预警扩展变量（基于 V8 快照 HisHigh/HisLow/OpenZAF/MA5Value）：
          - his_high            历史最高价
          - his_low             历史最低价
          - open_pct            开盘涨跌幅（OpenZAF/100）
          - ma5                 5 日均价
          - last_vs_high_pct    距前高的距离 (his_high - last) / his_high
                                 正值=还有空间到前高, 0=在前高, 负值=已破前高
          - last_vs_low_pct     距前低的距离 (last - his_low) / his_low
                                 正值=高于前低, 0=在前低, 负值=破前低
          - last_vs_open_pct    盘中相对开盘的涨跌 (ZAF - OpenZAF) / 100
                                 正值=盘中拉回(开盘低于现价), 负值=盘中回落
        """
        if not isinstance(snap, dict):
            return {}

        def _num(*keys: str, default: float = 0.0) -> float:
            for k in keys:
                v = snap.get(k)
                if v is None or v == "":
                    continue
                try:
                    f = float(v)
                    if f == f:  # NaN 检测
                        return f
                except (TypeError, ValueError):
                    continue
            return default

        # ZAF 在 V8 快照里是百分数（如 -1.21 表示 -1.21%），需 ÷100 转小数
        zaf = _num("ZAF")
        pct_change = _num("pct_change", default=zaf / 100 if zaf else 0.0)
        # 优先用显式 pct_change；否则用 ZAF/100
        if not snap.get("pct_change") and zaf:
            pct_change = zaf / 100

        vopen_zaf = _num("VOpenZAF")
        auction_pct = _num("auction_pct", default=vopen_zaf / 100 if vopen_zaf else 0.0)
        if not snap.get("auction_pct") and vopen_zaf:
            auction_pct = vopen_zaf / 100

        # R14 形态预警扩展变量
        his_high = _num("HisHigh")
        his_low = _num("HisLow")
        open_zaf = _num("OpenZAF", "VOpenZAF")
        open_pct = open_zaf / 100 if open_zaf else 0.0
        ma5 = _num("MA5Value")
        last = _num("last", "Now", "MA5Value")

        # 距前高/前低/开盘的距离（避免除零）
        last_vs_high_pct = (his_high - last) / his_high if his_high > 0 else 0.0
        last_vs_low_pct = (last - his_low) / his_low if his_low > 0 else 0.0
        # 盘中相对开盘的涨跌 = 当前涨跌 - 开盘涨跌 (单位:小数)
        # 正值=盘中拉回(现价高于开盘), 负值=盘中回落(现价低于开盘)
        last_vs_open_pct = (zaf - open_zaf) / 100.0 if (zaf or open_zaf) else 0.0

        return {
            "pct_change": pct_change,
            "volume_ratio": _num("volume_ratio", "Wtb"),
            "main_inflow": _num("main_inflow", "Zjl"),
            "auction_pct": auction_pct,
            "last": last,
            "volume": _num("volume", "Volume"),
            "amount": _num("amount", "Amount"),
            # R14 形态预警扩展
            "his_high": his_high,
            "his_low": his_low,
            "open_pct": open_pct,
            "ma5": ma5,
            "last_vs_high_pct": last_vs_high_pct,
            "last_vs_low_pct": last_vs_low_pct,
            "last_vs_open_pct": last_vs_open_pct,
        }
