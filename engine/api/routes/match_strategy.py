"""``/api/monitor/match-strategies`` 路由 - 匹配策略 CRUD + 热加载 + 调参预览。

匹配策略三层模型（PLAN §14.2）：
    L1 alert_templates  (monitor_rules.yaml)   —— 零件库
    L2 match_strategies (match_strategies.yaml) —— 装配单 ★ 本路由管理
    L3 MonitorEngine                         —— 执行手

路由：
- ``GET    /api/monitor/match-strategies``                    列出所有 match
- ``POST   /api/monitor/match-strategies``                    新增 match（写 YAML）
- ``PUT    /api/monitor/match-strategies/{match_id}``         改参/改 scope/改 alerts
- ``DELETE /api/monitor/match-strategies/{match_id}``         删除
- ``POST   /api/monitor/match-strategies/reload``             热加载（清缓存）
- ``POST   /api/monitor/match-strategies/{match_id}/test``    用快照试跑，返回命中 alert

挂载点：``engine/api/main.py`` 注册到 ``/api/monitor/match-strategies``。
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from engine.monitor.match_registry import (
    AlertRef,
    MatchRegistry,
    MatchStrategy,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["monitor-match-strategy"])


# ============================================================================
# 请求 / 响应 模型
# ============================================================================


class AlertRefModel(BaseModel):
    """match 内对 alert_template 的引用。"""

    alert_type: str = Field(..., description="引用 alert_templates 的 key")
    params: dict[str, Any] = Field(
        default_factory=dict, description="覆盖默认参数（render 进 condition）"
    )
    channels: list[str] = Field(
        default_factory=list, description="覆盖模板通道；空列表表示用模板默认"
    )
    priority: str = Field("medium", description="high / medium / low")


class MatchStrategyModel(BaseModel):
    """match_strategies 列表项。"""

    match_id: str = Field(..., description="全局唯一，CRUD 主键")
    name: str = Field("", description="显示名")
    enabled: bool = Field(True, description="false 时该 match 不参与求值")
    strategy_id: str = Field("", description="绑定选股策略；空串=兜底套餐")
    scope: dict[str, Any] = Field(default_factory=dict, description="股票池过滤")
    alerts: list[AlertRefModel] = Field(default_factory=list)
    debounce_override: int | None = Field(
        None, description="覆盖全局 debounce 秒数；null=用全局"
    )
    trading_hours_override: dict[str, Any] | None = Field(
        None, description="覆盖全局交易时段；null=用全局"
    )


class MatchUpdateModel(BaseModel):
    """PUT 部分更新（只含要改的字段）。"""

    name: str | None = None
    enabled: bool | None = None
    strategy_id: str | None = None
    scope: dict[str, Any] | None = None
    alerts: list[AlertRefModel] | None = None
    debounce_override: int | None = None
    trading_hours_override: dict[str, Any] | None = None


class MatchTestRequest(BaseModel):
    """调参预览请求。

    兼容两种 body 格式：
    1. 扁平: ``{"code": "600519.SH", "pct_change": 0.04, ...}`` （推荐，与 API 文档一致）
    2. 嵌套: ``{"snap": {"code": ..., "pct_change": ...}}`` （旧版前端兼容）

    扁平字段直接放到 model 顶层；嵌套 ``snap`` 通过 ``snap`` 字段传。
    求值时用 ``effective_snap`` 属性取最终快照。
    """

    snap: dict[str, Any] | None = Field(
        default=None,
        description="嵌套格式时的快照（旧版兼容）；扁平格式留空",
    )

    # 允许任意扁平字段透传（Pydantic v2 extra="allow"）
    model_config = {"extra": "allow"}

    @property
    def effective_snap(self) -> dict[str, Any]:
        """取最终用于求值的快照 dict。

        - 若 ``snap`` 字段非空 → 用 snap（旧版嵌套格式）
        - 否则 → 用模型 dump 出的扁平字段（剔除 snap 本身）
        """
        if self.snap:
            return dict(self.snap)
        d = self.model_dump()
        d.pop("snap", None)
        return d


class MatchTestResponse(BaseModel):
    """调参预览响应。"""

    match_id: str
    hits: list[dict[str, Any]] = Field(
        default_factory=list,
        description="命中 alert 列表 [{alert_type, condition, priority, channels}]",
    )


# ============================================================================
# 路由
# ============================================================================


@router.get("", summary="列出所有 match_strategies")
async def list_match_strategies() -> dict[str, Any]:
    """返回所有 match 配置。"""
    return {"items": MatchRegistry.list_all(), "count": len(MatchRegistry.list_all())}


@router.post("", summary="新增 match_strategy")
async def create_match_strategy(req: MatchStrategyModel) -> dict[str, Any]:
    """新增一个 match（写 YAML + 清缓存）。"""
    match = _model_to_strategy(req)
    ok, msg = MatchRegistry.create(match)
    if not ok:
        raise HTTPException(status_code=409, detail=msg)
    return {"ok": True, "match_id": req.match_id, "message": msg}


@router.put("/{match_id}", summary="更新 match_strategy")
async def update_match_strategy(
    match_id: str, req: MatchUpdateModel
) -> dict[str, Any]:
    """更新 match（部分字段，PUT 体内仅含要改的字段）。"""
    updates: dict[str, Any] = {}
    if req.name is not None:
        updates["name"] = req.name
    if req.enabled is not None:
        updates["enabled"] = req.enabled
    if req.strategy_id is not None:
        updates["strategy_id"] = req.strategy_id
    if req.scope is not None:
        updates["scope"] = req.scope
    if req.alerts is not None:
        updates["alerts"] = [a.model_dump() for a in req.alerts]
    if req.debounce_override is not None:
        updates["debounce_override"] = req.debounce_override
    if req.trading_hours_override is not None:
        updates["trading_hours_override"] = req.trading_hours_override

    ok, msg = MatchRegistry.update(match_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail=msg)
    return {"ok": True, "match_id": match_id, "message": msg}


@router.delete("/{match_id}", summary="删除 match_strategy")
async def delete_match_strategy(match_id: str) -> dict[str, Any]:
    """删除一个 match。

    ``_default`` 兜底套餐禁止删除，否则非 rzq/qzrfc 股票将再无任何预警。
    """
    if match_id == "_default":
        raise HTTPException(
            status_code=403, detail="不允许删除兜底套餐 _default"
        )
    ok, msg = MatchRegistry.delete(match_id)
    if not ok:
        raise HTTPException(status_code=404, detail=msg)
    return {"ok": True, "match_id": match_id, "message": msg}


@router.post("/reload", summary="热加载 match_strategies")
async def reload_match_strategies() -> dict[str, Any]:
    """清缓存，下次求值重新读 YAML。"""
    MatchRegistry.invalidate()
    items = MatchRegistry.list_all()
    return {"ok": True, "count": len(items), "message": "match_strategies 已重载"}


@router.post(
    "/{match_id}/test",
    response_model=MatchTestResponse,
    summary="调参预览：用快照试跑 match",
)
async def test_match_strategy(
    match_id: str, req: MatchTestRequest
) -> MatchTestResponse:
    """用一只股票的快照跑指定 match，返回命中的 alert 列表（不实际推送）。

    用于 UI 调参预览：改完 params 后调本接口看是否命中预期 alert。
    """
    match = MatchRegistry.get(match_id)
    if match is None:
        raise HTTPException(status_code=404, detail=f"match {match_id} 不存在")

    from engine.expression.evaluator import ExpressionEvaluator
    from engine.monitor.rules import RuleSet

    snap = dict(req.effective_snap or {})
    code = str(snap.get("code", "TEST.SH"))
    snap.setdefault("code", code)

    # scope 过滤
    if not MatchRegistry._in_scope(code, match.scope, snap):
        return MatchTestResponse(match_id=match_id, hits=[])

    ev = ExpressionEvaluator()
    variables = RuleSet.snap_to_variables(snap)
    hits: list[dict[str, Any]] = []
    for alert_ref in match.alerts:
        tpl = RuleSet.get_template(alert_ref.alert_type)
        if tpl is None:
            hits.append({
                "alert_type": alert_ref.alert_type,
                "condition": "<模板不存在>",
                "hit": False,
                "error": f"alert_type {alert_ref.alert_type} 不在 alert_templates",
            })
            continue
        raw_condition = str(tpl.get("condition", "false"))
        defaults = tpl.get("default_params", {}) or {}
        condition = RuleSet.render_condition(
            raw_condition, alert_ref.params, defaults
        )
        try:
            hit = bool(ev.evaluate(condition, variables))
        except Exception as exc:  # noqa: BLE001
            hits.append({
                "alert_type": alert_ref.alert_type,
                "condition": condition,
                "hit": False,
                "error": str(exc),
                "priority": alert_ref.priority,
                "channels": alert_ref.channels or tpl.get("channels", []),
            })
            continue
        hits.append({
            "alert_type": alert_ref.alert_type,
            "condition": condition,
            "hit": hit,
            "priority": alert_ref.priority,
            "channels": alert_ref.channels or list(tpl.get("channels", []) or []),
        })
    return MatchTestResponse(match_id=match_id, hits=hits)


# ============================================================================
# 内部
# ============================================================================


def _model_to_strategy(req: MatchStrategyModel) -> MatchStrategy:
    """请求模型 → MatchStrategy dataclass。"""
    alerts = [
        AlertRef(
            alert_type=a.alert_type,
            params=dict(a.params or {}),
            channels=list(a.channels or []),
            priority=a.priority,
        )
        for a in req.alerts
    ]
    return MatchStrategy(
        match_id=req.match_id,
        name=req.name,
        enabled=req.enabled,
        strategy_id=req.strategy_id or "",
        scope=dict(req.scope or {}),
        alerts=alerts,
        debounce_override=req.debounce_override,
        trading_hours_override=req.trading_hours_override,
    )
