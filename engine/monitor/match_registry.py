"""匹配策略层（MatchRegistry）。

三层模型（PLAN §14.2）：
    L1 alert_templates  → 零件库（在 ``monitor_rules.yaml``，``RuleSet`` 加载）
    L2 match_strategies → 装配单（在 ``match_strategies.yaml``，本类加载）
    L3 MonitorEngine    → 执行手（``on_quote`` 按 ``snap.strategy_id`` 取 match）

本类职责：
1. 加载 ``config/match_strategies.yaml``（类级缓存，热加载时调 :meth:`invalidate`）。
2. :meth:`get_applicable` —— 按 ``strategy_id`` 取匹配套餐列表（含 ``_default`` 兜底）。
3. :meth:`evaluate` —— 对一条快照求值 match.alerts，返回命中列表。
4. CRUD 持久化（``create/update/delete``）—— 写时加 ``Lock`` + 临时文件原子 rename。
5. :meth:`invalidate` —— 配置 reload 时清缓存。

scope 过滤（``_in_scope``）本轮不求高精度（PLAN §14.6）：
- 白名单 / 市场前缀 / 黑名单生效
- ST / 停牌用 snap 字段兜底（缺省 False），不做精确 ST 名单
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from engine.config.loader import ConfigLoader
from engine.expression.evaluator import ExpressionEvaluator, ExpressionError
from engine.monitor.rules import RuleSet

logger = logging.getLogger(__name__)


# ============================================================================
# 数据结构
# ============================================================================


@dataclass
class AlertRef:
    """match 内对 alert_template 的引用（含参数覆盖）。"""

    alert_type: str
    """引用 ``alert_templates`` 的 key。"""

    params: dict[str, Any] = field(default_factory=dict)
    """覆盖默认参数（render 进 condition）。"""

    channels: list[str] = field(default_factory=list)
    """覆盖模板通道；空列表表示用模板默认。"""

    priority: str = "medium"


@dataclass
class MatchStrategy:
    """单条匹配策略（对应 ``match_strategies`` 列表的一项）。"""

    match_id: str
    name: str = ""
    enabled: bool = True
    strategy_id: str = ""
    """绑定选股策略；空串=兜底套餐。"""

    scope: dict[str, Any] = field(default_factory=dict)
    alerts: list[AlertRef] = field(default_factory=list)
    debounce_override: int | None = None
    trading_hours_override: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """转 dict 用于持久化 YAML。"""
        return {
            "match_id": self.match_id,
            "name": self.name,
            "enabled": self.enabled,
            "strategy_id": self.strategy_id,
            "scope": dict(self.scope or {}),
            "alerts": [
                {
                    "alert_type": a.alert_type,
                    "params": dict(a.params or {}),
                    "channels": list(a.channels or []),
                    "priority": a.priority,
                }
                for a in self.alerts
            ],
            "debounce_override": self.debounce_override,
            "trading_hours_override": self.trading_hours_override,
        }


# ============================================================================
# MatchRegistry
# ============================================================================


class MatchRegistry:
    """匹配策略注册中心（线程安全 + 类级缓存）。"""

    _cache: list[MatchStrategy] | None = None
    """类级缓存：match_strategies → MatchStrategy 列表。"""

    _lock = threading.Lock()
    """持久化写文件用锁（保证原子性）。"""

    # ------------------------------------------------------------------
    # 加载 / 缓存
    # ------------------------------------------------------------------

    @classmethod
    def load(cls) -> list[MatchStrategy]:
        """加载所有 match_strategies（带缓存）。"""
        if cls._cache is not None:
            return cls._cache
        path = cls._config_path()
        strategies: list[MatchStrategy] = []
        if path.exists():
            try:
                with path.open("r", encoding="utf-8") as f:
                    doc = yaml.safe_load(f) or {}
                raw_list = doc.get("match_strategies", []) or []
                for item in raw_list:
                    if not isinstance(item, dict):
                        continue
                    try:
                        strategies.append(_parse_match(item))
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("解析 match %s 失败: %s", item.get("match_id"), exc)
            except Exception as exc:  # noqa: BLE001
                logger.warning("加载 match_strategies.yaml 失败: %s", exc)
        cls._cache = strategies
        logger.info("MatchRegistry 已加载 %d 条 match_strategies", len(strategies))
        return strategies

    @classmethod
    def invalidate(cls) -> None:
        """清缓存，配置 reload 时调。"""
        cls._cache = None

    @classmethod
    def _config_path(cls) -> Path:
        """``config/match_strategies.yaml`` 项目根绝对路径。"""
        cfg = ConfigLoader()
        rel = cfg.get("paths.match_strategies", "./config/match_strategies.yaml")
        p = Path(str(rel))
        if not p.is_absolute():
            root = Path(__file__).resolve().parent.parent.parent
            p = root / p
        return p

    # ------------------------------------------------------------------
    # 求值
    # ------------------------------------------------------------------

    @classmethod
    def get_applicable(
        cls, strategy_id: str, code: str
    ) -> list[MatchStrategy]:
        """返回适用于该股票的所有 match（按 strategy_id 精确匹配 + 所有兜底 match）。

        - 先找所有 ``enabled=True`` 且 ``strategy_id`` 精确匹配的 match
        - 再附加所有 ``strategy_id=""`` 的 enabled match 作为兜底
          （不只 ``_default``；用户自定义的空 strategy_id 兜底 match 也参与求值）
        - 调用方负责再过 scope（``_in_scope``）
        """
        out: list[MatchStrategy] = []
        fallback_matches: list[MatchStrategy] = []
        sid = (strategy_id or "").strip()
        for m in cls.load():
            if not m.enabled:
                continue
            if not m.strategy_id:
                # 兜底（所有 strategy_id="" 的 enabled match 都视为兜底）
                fallback_matches.append(m)
                continue
            if m.strategy_id == sid:
                out.append(m)
        out.extend(fallback_matches)
        return out

    @classmethod
    def evaluate(
        cls, snap: dict[str, Any]
    ) -> list[tuple[MatchStrategy, AlertRef, str]]:
        """对一条快照求值所有适用 match 的 alerts。

        返回 ``[(match, alert_ref, rendered_condition), ...]``，调用方根据
        ``alert_ref.channels`` 推送（空列表时用模板默认通道）。

        scope 过滤在本方法内做（按 ``snap.code``）。
        """
        code = str(snap.get("code", ""))
        strategy_id = str(snap.get("strategy_id", ""))
        matches = cls.get_applicable(strategy_id, code)

        ev = ExpressionEvaluator()
        variables = RuleSet.snap_to_variables(snap)
        hits: list[tuple[MatchStrategy, AlertRef, str]] = []

        for match in matches:
            if not cls._in_scope(code, match.scope, snap):
                continue
            for alert_ref in match.alerts:
                template = RuleSet.get_template(alert_ref.alert_type)
                if template is None:
                    logger.debug(
                        "match %s 引用了不存在的 alert_type %s",
                        match.match_id, alert_ref.alert_type,
                    )
                    continue
                raw_condition = str(template.get("condition", "false"))
                defaults = template.get("default_params", {}) or {}
                condition = RuleSet.render_condition(
                    raw_condition, alert_ref.params, defaults
                )
                try:
                    if ev.evaluate(condition, variables):
                        hits.append((match, alert_ref, condition))
                except ExpressionError as exc:
                    logger.debug(
                        "match %s alert %s 求值失败 expr=%r err=%s",
                        match.match_id, alert_ref.alert_type, condition, exc,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.debug("match 求值异常: %s", exc)
        return hits

    # ------------------------------------------------------------------
    # scope 过滤（本轮不求高精度，PLAN §14.6）
    # ------------------------------------------------------------------

    @staticmethod
    def _in_scope(
        code: str, scope: dict[str, Any] | None, snap: dict[str, Any]
    ) -> bool:
        """检查 code 是否在 match.scope 内。"""
        if not scope:
            return True
        # 白名单优先
        include_only = scope.get("include_only") or []
        if include_only and code not in set(include_only):
            return False
        # 市场前缀（A 股代码格式 ``<digits>.<SH|SZ|BJ>``，市场在 ``.`` 后）
        # 兼容两种写法：``600519.SH`` / ``SH600519``
        markets = scope.get("markets") or []
        if markets:
            market_set = {str(m).upper() for m in markets}
            suffix = code.rsplit(".", 1)[-1].upper() if "." in code else ""
            prefix = "".join(c for c in code[:2] if c.isalpha()).upper()
            if suffix not in market_set and prefix not in market_set:
                return False
        # 黑名单
        if code in set(scope.get("exclude_codes") or []):
            return False
        # ST / 停牌：用 snap 字段兜底（缺省 False）
        if scope.get("exclude_st") and snap.get("is_st"):
            return False
        if scope.get("exclude_suspended") and snap.get("is_suspended"):
            return False
        return True

    # ------------------------------------------------------------------
    # CRUD 持久化（API 调用）
    # ------------------------------------------------------------------

    @classmethod
    def list_all(cls) -> list[dict[str, Any]]:
        """列出所有 match（dict 形式，给 GET API 用）。"""
        return [m.to_dict() for m in cls.load()]

    @classmethod
    def get(cls, match_id: str) -> MatchStrategy | None:
        for m in cls.load():
            if m.match_id == match_id:
                return m
        return None

    @classmethod
    def create(cls, match: MatchStrategy) -> tuple[bool, str]:
        """新增一个 match（写 YAML）。

        Returns:
            (ok, message)
        """
        with cls._lock:
            existing = cls.load()
            if any(m.match_id == match.match_id for m in existing):
                return False, f"match_id {match.match_id!r} 已存在"
            new_list = existing + [match]
            ok, msg = cls._write_yaml(new_list)
            if ok:
                cls.invalidate()
                return True, f"已创建 {match.match_id}"
            return False, msg

    @classmethod
    def update(
        cls, match_id: str, updates: dict[str, Any]
    ) -> tuple[bool, str]:
        """更新一个 match（部分字段）。

        ``updates`` 仅含要改的字段（name/enabled/strategy_id/scope/alerts/
        debounce_override/trading_hours_override）。
        """
        with cls._lock:
            existing = cls.load()
            target = next((m for m in existing if m.match_id == match_id), None)
            if target is None:
                return False, f"match_id {match_id!r} 不存在"
            # 应用更新
            if "name" in updates:
                target.name = str(updates["name"])
            if "enabled" in updates:
                target.enabled = bool(updates["enabled"])
            if "strategy_id" in updates:
                target.strategy_id = str(updates["strategy_id"] or "")
            if "scope" in updates:
                target.scope = dict(updates["scope"] or {})
            if "alerts" in updates:
                target.alerts = [
                    AlertRef(
                        alert_type=str(a.get("alert_type", "")),
                        params=dict(a.get("params", {}) or {}),
                        channels=list(a.get("channels", []) or []),
                        priority=str(a.get("priority", "medium")),
                    )
                    for a in (updates["alerts"] or [])
                    if isinstance(a, dict)
                ]
            if "debounce_override" in updates:
                v = updates["debounce_override"]
                target.debounce_override = int(v) if v is not None else None
            if "trading_hours_override" in updates:
                v = updates["trading_hours_override"]
                target.trading_hours_override = dict(v) if v else None

            ok, msg = cls._write_yaml(existing)
            if ok:
                cls.invalidate()
                return True, f"已更新 {match_id}"
            return False, msg

    @classmethod
    def delete(cls, match_id: str) -> tuple[bool, str]:
        """删除一个 match。

        ``_default`` 兜底套餐禁止删除（防止系统失去兜底预警能力）。
        """
        if match_id == "_default":
            return False, "不允许删除兜底套餐 _default"
        with cls._lock:
            existing = cls.load()
            new_list = [m for m in existing if m.match_id != match_id]
            if len(new_list) == len(existing):
                return False, f"match_id {match_id!r} 不存在"
            ok, msg = cls._write_yaml(new_list)
            if ok:
                cls.invalidate()
                return True, f"已删除 {match_id}"
            return False, msg

    @classmethod
    def _write_yaml(cls, matches: list[MatchStrategy]) -> tuple[bool, str]:
        """原子写 YAML：临时文件 + rename（避免半写状态被读）。"""
        path = cls._config_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "match_strategies": [m.to_dict() for m in matches],
            }
            text = yaml.safe_dump(
                data,
                allow_unicode=True,
                sort_keys=False,
                default_flow_style=False,
            )
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(path)  # 原子 rename
            return True, "ok"
        except Exception as exc:  # noqa: BLE001
            logger.error("写 match_strategies.yaml 失败: %s", exc)
            return False, str(exc)


# ============================================================================
# 内部
# ============================================================================


def _parse_match(item: dict[str, Any]) -> MatchStrategy:
    """从 dict 构造 MatchStrategy。"""
    alerts: list[AlertRef] = []
    for a in item.get("alerts", []) or []:
        if not isinstance(a, dict):
            continue
        alerts.append(
            AlertRef(
                alert_type=str(a.get("alert_type", "")),
                params=dict(a.get("params", {}) or {}),
                channels=list(a.get("channels", []) or []),
                priority=str(a.get("priority", "medium")),
            )
        )
    return MatchStrategy(
        match_id=str(item.get("match_id", "")),
        name=str(item.get("name", "")),
        enabled=bool(item.get("enabled", True)),
        strategy_id=str(item.get("strategy_id", "") or ""),
        scope=dict(item.get("scope", {}) or {}),
        alerts=alerts,
        debounce_override=(
            int(item["debounce_override"])
            if item.get("debounce_override") is not None
            else None
        ),
        trading_hours_override=(
            dict(item.get("trading_hours_override") or {})
            if item.get("trading_hours_override")
            else None
        ),
    )
