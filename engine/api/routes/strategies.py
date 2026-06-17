"""``/api/strategies`` 路由 - 策略管理。

端点清单
--------
- ``GET    /api/strategies``                       - 列出所有策略
- ``POST   /api/strategies``                       - 批量操作（enable_all/disable_all/run_all）
- ``GET    /api/strategies/{id}``                  - 单个策略详情
- ``POST   /api/strategies/{id}``                  - 启用/禁用（前端兼容入参 ``{enabled: bool}``）
- ``POST   /api/strategies/{id}/enable``           - 启用（任务规范要求）
- ``POST   /api/strategies/{id}/disable``          - 禁用（任务规范要求）
- ``POST   /api/strategies/{id}/run``              - 执行选股（调 StrategyRunner）
- ``GET    /api/strategies/{id}/runs``             - 历史执行记录
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from engine.api.deps import get_config, get_runner, get_state, get_storage
from engine.api.schemas import (
    OkResponse,
    StrategyBatchActionRequest,
    StrategyBatchRunResponse,
    StrategyBatchRunResult,
    StrategyResponse,
    StrategyRunRecord,
    StrategyRunResponse,
    StrategySectorInfo,
    StrategyToggleRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["strategies"])


# ============================================================================
# 列表
# ============================================================================


@router.get(
    "",
    response_model=list[StrategyResponse],
    summary="列出所有策略",
)
async def list_strategies(
    cfg: Any = Depends(get_config),
    storage: Any = Depends(get_storage),
) -> list[StrategyResponse]:
    """从 ``strategies/*.yaml`` 加载所有策略，附加最近一次执行信息。"""
    strategies = cfg.strategies() or {}
    last_runs = _query_last_runs(storage)
    out: list[StrategyResponse] = []
    for sid, sc in strategies.items():
        item = _to_response(sid, sc, last_runs.get(sid))
        out.append(item)
    # 未启用排后
    out.sort(key=lambda s: (not s.enabled, s.strategy_id))
    return out


@router.post(
    "",
    response_model=OkResponse | StrategyBatchRunResponse,
    summary="批量操作（enable_all / disable_all / run_all）",
)
async def batch_action(
    body: StrategyBatchActionRequest,
    cfg: Any = Depends(get_config),
    runner: Any = Depends(get_runner),
) -> Any:
    """支持三种批量动作；非 ``run_all`` 返回 ``OkResponse``。"""
    action = (body.action or "").lower()
    strategies_dir = Path(str(cfg.get("paths.strategies_dir", "./strategies")))

    if action == "enable_all":
        _batch_set_enabled(strategies_dir, cfg, True)
        return OkResponse(ok=True, message="所有策略已启用")
    if action == "disable_all":
        _batch_set_enabled(strategies_dir, cfg, False)
        return OkResponse(ok=True, message="所有策略已禁用")
    if action == "run_all":
        return await _run_all_enabled(cfg, runner)

    raise HTTPException(status_code=400, detail=f"未知 action: {body.action!r}")


# ============================================================================
# 单策略
# ============================================================================


@router.get(
    "/{strategy_id}",
    response_model=StrategyResponse,
    summary="获取单个策略详情",
)
async def get_strategy(
    strategy_id: str,
    cfg: Any = Depends(get_config),
    storage: Any = Depends(get_storage),
) -> StrategyResponse:
    sc = cfg.strategy(strategy_id)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"策略不存在: {strategy_id}")
    last_runs = _query_last_runs(storage)
    return _to_response(strategy_id, sc, last_runs.get(strategy_id))


@router.post(
    "/{strategy_id}",
    response_model=OkResponse,
    summary="启用/禁用策略（前端兼容入参 {enabled: bool}）",
)
async def toggle_strategy(
    strategy_id: str,
    body: StrategyToggleRequest,
    cfg: Any = Depends(get_config),
) -> OkResponse:
    sc = cfg.strategy(strategy_id)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"策略不存在: {strategy_id}")
    _set_enabled(cfg, strategy_id, body.enabled)
    return OkResponse(
        ok=True,
        message=f"策略 {strategy_id} 已{'启用' if body.enabled else '禁用'}",
    )


@router.post(
    "/{strategy_id}/enable",
    response_model=OkResponse,
    summary="启用策略",
)
async def enable_strategy(
    strategy_id: str,
    cfg: Any = Depends(get_config),
) -> OkResponse:
    sc = cfg.strategy(strategy_id)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"策略不存在: {strategy_id}")
    _set_enabled(cfg, strategy_id, True)
    return OkResponse(ok=True, message=f"策略 {strategy_id} 已启用")


@router.post(
    "/{strategy_id}/disable",
    response_model=OkResponse,
    summary="禁用策略",
)
async def disable_strategy(
    strategy_id: str,
    cfg: Any = Depends(get_config),
) -> OkResponse:
    sc = cfg.strategy(strategy_id)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"策略不存在: {strategy_id}")
    _set_enabled(cfg, strategy_id, False)
    return OkResponse(ok=True, message=f"策略 {strategy_id} 已禁用")


@router.post(
    "/{strategy_id}/run",
    response_model=StrategyRunResponse,
    summary="执行选股",
)
async def run_strategy(
    strategy_id: str,
    cfg: Any = Depends(get_config),
    runner: Any = Depends(get_runner),
) -> StrategyRunResponse:
    sc = cfg.strategy(strategy_id)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"策略不存在: {strategy_id}")
    if not getattr(sc, "enabled", True):
        raise HTTPException(status_code=400, detail=f"策略 {strategy_id} 已禁用")

    start = time.time()
    try:
        ctx = runner.run_strategy(strategy_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("策略 %s 执行失败", strategy_id)
        return StrategyRunResponse(
            ok=False,
            run_id="",
            strategy_id=strategy_id,
            count=0,
            duration_sec=round(time.time() - start, 3),
            error=str(exc),
        )

    n_final = 0 if ctx.final is None else len(ctx.final)

    # 副作用：写 selection 信号 + 自动订阅 Top 20 到监控
    try:
        state = get_state()
        _emit_selection_signal(state, ctx, sc)
        _auto_subscribe_top_picks(state, ctx, top_n=20)
    except Exception as exc:  # noqa: BLE001
        logger.warning("策略 %s 后置钩子(信号/订阅)失败: %s", strategy_id, exc)

    return StrategyRunResponse(
        ok=True,
        run_id=ctx.run_id,
        strategy_id=strategy_id,
        count=n_final,
        duration_sec=round(ctx.duration_sec or (time.time() - start), 3),
    )


@router.get(
    "/{strategy_id}/runs",
    response_model=list[StrategyRunRecord],
    summary="策略历史执行记录",
)
async def list_strategy_runs(
    strategy_id: str,
    storage: Any = Depends(get_storage),
    limit: int = 50,
) -> list[StrategyRunRecord]:
    """从 DuckDB ``strategy_runs`` 表查最近 N 条。"""
    if not _table_exists(storage, "strategy_runs"):
        return []
    sql = (
        "SELECT run_id, strategy_id, run_date, status, "
        "       started_at, finished_at, duration_ms, "
        "       universe_count, result_count, error_message "
        "FROM strategy_runs WHERE strategy_id = ? "
        "ORDER BY started_at DESC LIMIT ?"
    )
    try:
        df = storage.query(sql, (strategy_id, int(limit)))
    except Exception as exc:  # noqa: BLE001
        logger.warning("查询 strategy_runs 失败: %s", exc)
        return []
    out: list[StrategyRunRecord] = []
    for _, row in df.iterrows():
        out.append(
            StrategyRunRecord(
                run_id=str(row.get("run_id", "")),
                strategy_id=str(row.get("strategy_id", strategy_id)),
                run_date=_to_str(row.get("run_date")),
                status=str(row.get("status", "pending")),
                started_at=_to_str(row.get("started_at")),
                finished_at=_to_str(row.get("finished_at")),
                duration_ms=_to_int(row.get("duration_ms")),
                universe_count=_to_int(row.get("universe_count")),
                result_count=_to_int(row.get("result_count")),
                error_message=str(row.get("error_message", "") or ""),
            )
        )
    return out


# ============================================================================
# 内部辅助
# ============================================================================


def _to_response(strategy_id: str, sc: Any, last_run: dict[str, Any] | None) -> StrategyResponse:
    """把 ``StrategyConfig`` dataclass 转为 API 响应。"""
    sector_obj = getattr(sc, "sector", None)
    sector_info: StrategySectorInfo | None = None
    if sector_obj is not None:
        sector_info = StrategySectorInfo(
            code=getattr(sector_obj, "code", ""),
            name=getattr(sector_obj, "name", ""),
            auto_update=getattr(sector_obj, "auto_update", True),
            update_mode=getattr(sector_obj, "update_mode", "replace"),
        )

    factors_list = []
    for f in getattr(sc, "factors", []) or []:
        factors_list.append(
            {
                "factor_id": getattr(f, "factor_id", ""),
                "weight": float(getattr(f, "weight", 1.0)),
                "params": dict(getattr(f, "params", {}) or {}),
            }
        )

    yaml_text = _read_yaml_text(getattr(sc, "yaml_path", ""))

    return StrategyResponse(
        strategy_id=strategy_id,
        strategy_name=getattr(sc, "strategy_name", ""),
        strategy_emoji=getattr(sc, "strategy_emoji", ""),
        version=getattr(sc, "version", "1.0"),
        enabled=bool(getattr(sc, "enabled", True)),
        sector_code=getattr(sector_obj, "code", "") if sector_obj else "",
        sector_name=getattr(sector_obj, "name", "") if sector_obj else "",
        sector=sector_info,
        factors=factors_list,
        yaml_path=getattr(sc, "yaml_path", ""),
        yaml_content=yaml_text,
        description=_description_for(strategy_id),
        last_run_at=(last_run or {}).get("started_at"),
        last_run_stocks=int((last_run or {}).get("result_count", 0) or 0),
    )


def _description_for(strategy_id: str) -> str:
    """策略简介（与前端 mock-data 一致的中文文案）。"""
    return {
        "dbqzt": "捕捉涨停板封板资金与换手率匹配的标的，次日溢价概率高",
        "qszsl": "均线多头排列 + 量能放大，捕捉主升浪启动点",
        "cslx": "基本面良好但短期超跌，捕捉均值回归机会",
        "rzq": "连续下跌后首次放量突破，捕捉情绪反转",
        "qzrfc": "强势股首次回调至支撑位，捕捉反抽交易机会",
    }.get(strategy_id, "")


def _read_yaml_text(rel_path: str) -> str:
    if not rel_path:
        return ""
    try:
        root = Path(__file__).resolve().parent.parent.parent.parent
        p = Path(rel_path)
        if not p.is_absolute():
            p = root / p
        if p.exists():
            return p.read_text(encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        logger.warning("读取策略 YAML 原文失败 %s: %s", rel_path, exc)
    return ""


def _set_enabled(cfg: Any, strategy_id: str, enabled: bool) -> None:
    """修改策略 YAML 的 ``enabled`` 字段并触发 reload。"""
    import yaml as _yaml

    sc = cfg.strategy(strategy_id)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"策略不存在: {strategy_id}")
    rel_path = getattr(sc, "yaml_path", "")
    if not rel_path:
        raise HTTPException(status_code=500, detail=f"策略 {strategy_id} 缺少 yaml_path")
    root = Path(__file__).resolve().parent.parent.parent.parent
    p = Path(rel_path)
    if not p.is_absolute():
        p = root / p
    if not p.exists():
        raise HTTPException(status_code=500, detail=f"策略 YAML 文件不存在: {p}")
    try:
        text = p.read_text(encoding="utf-8")
        doc = _yaml.safe_load(text) or {}
        doc["enabled"] = bool(enabled)
        p.write_text(
            _yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, default_flow_style=False),
            encoding="utf-8",
        )
        cfg.reload()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"修改 enabled 失败: {exc}") from exc


def _batch_set_enabled(strategies_dir: Path, cfg: Any, enabled: bool) -> None:
    """批量设置 ``strategies/*.yaml`` 的 ``enabled`` 字段。"""
    import yaml as _yaml

    if not strategies_dir.exists():
        return
    root = Path(__file__).resolve().parent.parent.parent.parent
    if not strategies_dir.is_absolute():
        strategies_dir = root / strategies_dir
    changed = 0
    for path in sorted(strategies_dir.glob("*.yaml")):
        if path.name.startswith("_template"):
            continue
        try:
            text = path.read_text(encoding="utf-8")
            doc = _yaml.safe_load(text) or {}
            if not isinstance(doc, dict):
                continue
            if doc.get("enabled") == enabled:
                continue
            doc["enabled"] = bool(enabled)
            path.write_text(
                _yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, default_flow_style=False),
                encoding="utf-8",
            )
            changed += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("批量修改 %s 失败: %s", path, exc)
    if changed:
        cfg.reload()


async def _run_all_enabled(cfg: Any, runner: Any) -> StrategyBatchRunResponse:
    strategies = cfg.strategies() or {}
    results: list[StrategyBatchRunResult] = []
    state = None
    try:
        state = get_state()
    except Exception:  # noqa: BLE001
        pass
    for sid, sc in strategies.items():
        if not getattr(sc, "enabled", True):
            continue
        try:
            ctx = runner.run_strategy(sid)
            n_final = 0 if ctx.final is None else len(ctx.final)
            # 副作用：写 selection 信号 + 自动订阅 Top 20 到监控
            try:
                if state is not None:
                    _emit_selection_signal(state, ctx, sc)
                    _auto_subscribe_top_picks(state, ctx, top_n=20)
            except Exception as exc:  # noqa: BLE001
                logger.warning("策略 %s 后置钩子失败: %s", sid, exc)
            results.append(
                StrategyBatchRunResult(id=sid, count=n_final, ok=True)
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("策略 %s 批量执行失败: %s", sid, exc)
            results.append(
                StrategyBatchRunResult(id=sid, count=0, ok=False, error=str(exc))
            )
    return StrategyBatchRunResponse(ok=True, results=results)


def _query_last_runs(storage: Any) -> dict[str, dict[str, Any]]:
    """查 ``strategy_runs`` 表，取每个策略最近一次执行。"""
    if not _table_exists(storage, "strategy_runs"):
        return {}
    sql = (
        "SELECT r.run_id, r.strategy_id, r.started_at, r.finished_at, "
        "       r.duration_ms, r.universe_count, r.result_count, r.status "
        "FROM strategy_runs r "
        "INNER JOIN ("
        "  SELECT strategy_id, MAX(started_at) AS max_ts "
        "  FROM strategy_runs GROUP BY strategy_id"
        ") m ON r.strategy_id = m.strategy_id AND r.started_at = m.max_ts"
    )
    try:
        df = storage.query(sql)
    except Exception as exc:  # noqa: BLE001
        logger.warning("查询 last_runs 失败: %s", exc)
        return {}
    out: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        sid = str(row.get("strategy_id", ""))
        if not sid:
            continue
        out[sid] = {
            "run_id": str(row.get("run_id", "")),
            "started_at": _to_str(row.get("started_at")),
            "finished_at": _to_str(row.get("finished_at")),
            "duration_ms": _to_int(row.get("duration_ms")),
            "universe_count": _to_int(row.get("universe_count")),
            "result_count": _to_int(row.get("result_count")),
            "status": str(row.get("status", "")),
        }
    return out


def _table_exists(storage: Any, name: str) -> bool:
    if storage is None:
        return False
    try:
        return storage.table_exists(name)
    except Exception:  # noqa: BLE001
        return False


def _to_str(v: Any) -> str | None:
    if v is None:
        return None
    try:
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return str(v)
    except Exception:  # noqa: BLE001
        return None


def _to_int(v: Any) -> int:
    try:
        if v is None or (isinstance(v, float) and v != v):  # NaN
            return 0
        return int(v)
    except (TypeError, ValueError):
        return 0


# ============================================================================
# 后置钩子：策略选股完成后的副作用
# ============================================================================


def _emit_selection_signal(state: Any, ctx: Any, sc: Any) -> None:
    """策略选股完成后，写一条 ``selection`` 类型信号到 ``signal_events`` 表。

    覆盖场景：
    - 信号中心 Tab 永远有数据可看
    - Dashboard ``today_signals`` 计数累加
    - ``EngineState.record_signal("selection")`` 同步内存计数

    信号内容：策略名 + 选出数量 + Top 3 名股票
    """
    import json
    import uuid

    storage = None
    try:
        storage = get_storage()
    except Exception:  # noqa: BLE001
        pass

    strategy_id = ctx.strategy_id
    strategy_name = getattr(sc, "strategy_name", "") or strategy_id
    final = ctx.final
    n = 0 if final is None else len(final)

    # 取 Top 3 名称做摘要
    top_names: list[str] = []
    if final is not None and not final.empty:
        name_col = None
        for c in ("stock_name", "name", "股票名称"):
            if c in final.columns:
                name_col = c
                break
        code_col = None
        for c in ("stock_code", "code", "Code"):
            if c in final.columns:
                code_col = c
                break
        if name_col and code_col:
            for _, row in final.head(3).iterrows():
                nm = str(row.get(name_col, "") or "").strip()
                cd = str(row.get(code_col, "") or "").strip()
                if nm and cd:
                    top_names.append(f"{nm}({cd})")
                elif cd:
                    top_names.append(cd)

    summary = f"策略「{strategy_name}」选出 {n} 只标的"
    if top_names:
        summary += "，Top3：" + "、".join(top_names)

    event_id = str(uuid.uuid4())
    triggered_at = datetime.now()
    channels = ["websocket", "csv_log"]  # 预留：未来消息总线扩展
    snapshot = {
        "run_id": ctx.run_id,
        "strategy_id": strategy_id,
        "result_count": n,
        "duration_sec": ctx.duration_sec,
        "top_picks": top_names,
    }

    # 写 DuckDB signal_events
    if storage is not None and hasattr(storage, "execute"):
        sql = (
            "INSERT INTO signal_events "
            "(event_id, strategy_id, stock_code, stock_name, alert_type, "
            " condition_expr, snapshot, severity, channels_fired, triggered_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        params = [
            event_id,
            strategy_id,
            "",  # 信号非单股，stock_code 留空
            "",  # stock_name 留空
            "selection",
            summary,
            json.dumps(snapshot, ensure_ascii=False),
            "info",
            json.dumps(channels, ensure_ascii=False),
            triggered_at,
        ]
        try:
            storage.execute(sql, params)
        except Exception as exc:  # noqa: BLE001
            logger.warning("写 signal_events 失败 (非致命): %s", exc)

    # 累加 EngineState 计数（Dashboard 实时显示）
    try:
        state.record_signal("selection")
    except Exception:  # noqa: BLE001
        pass


def _auto_subscribe_top_picks(state: Any, ctx: Any, top_n: int = 20) -> None:
    """把选股结果前 N 只股票加入监控订阅。

    实现要点：
    - ``subscribe_hq`` 上限 100 只（P2 真实模式分批 50 一组）
    - Mock 模式仅写 ``monitor_subscriptions`` 表 + EngineState 内存，便于
      Web 实时大屏 ``GET /api/monitor/quotes`` 立即返回数据
    - 同一 stock_code 重复订阅会被 upsert 覆盖（不累积）
    """
    final = ctx.final
    if final is None or final.empty:
        return
    code_col = None
    for c in ("stock_code", "code", "Code"):
        if c in final.columns:
            code_col = c
            break
    if code_col is None:
        return

    codes: list[str] = []
    for v in final[code_col].astype(str).tolist()[:top_n]:
        v = v.strip()
        if v:
            codes.append(v)
    if not codes:
        return

    # 写 EngineState 内存订阅
    for i, code in enumerate(codes):
        try:
            state.upsert_subscription(
                code,
                strategy_id=ctx.strategy_id,
                subscriber="auto_top_pick",
                batch_no=i // 50 + 1,
            )
        except Exception:  # noqa: BLE001
            pass

    # 同步到 DuckDB monitor_subscriptions 表（持久化）
    storage = None
    try:
        storage = get_storage()
    except Exception:  # noqa: BLE001
        return
    if storage is None or not hasattr(storage, "execute"):
        return
    sql = (
        "INSERT INTO monitor_subscriptions "
        "(stock_code, strategy_id, subscriber, subscribed_at, active, batch_no) "
        "VALUES (?, ?, ?, ?, ?, ?)"
    )
    now = datetime.now()
    rows = [
        (code, ctx.strategy_id, "auto_top_pick", now, True, i // 50 + 1)
        for i, code in enumerate(codes)
    ]
    try:
        storage.executemany(sql, rows)
    except Exception as exc:  # noqa: BLE001
        logger.warning("写 monitor_subscriptions 失败 (非致命): %s", exc)
