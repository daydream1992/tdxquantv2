"""``/api/sectors`` 路由 - 板块管理。

- ``GET  /api/sectors``                       - 列出所有板块（从策略 YAML sector 段 + tqcenter 查询）
- ``GET  /api/sectors/{code}/stocks``         - 获取板块成份股
- ``POST /api/sectors/{code}/refresh``        - 刷新板块（重新执行选股并回写）
- ``POST /api/sectors``                       - 占位（创建/更新板块，未实现具体逻辑）
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from engine.api.deps import get_config, get_runner, get_sector_manager, get_storage
from engine.api.schemas import (
    OkResponse,
    SectorInfoResponse,
    SectorRefreshResponse,
    SectorStockResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sectors"])


@router.get(
    "",
    response_model=list[SectorInfoResponse],
    summary="列出所有板块",
)
async def list_sectors(
    cfg: Any = Depends(get_config),
    storage: Any = Depends(get_storage),
) -> list[SectorInfoResponse]:
    """合并两个来源：

    1. 策略 YAML 中 ``sector`` 段（``ZD_*`` 自定义板块，与策略一一对应）
    2. DuckDB ``sector_snapshots`` 表中最新的板块快照（含 stock_count）
    """
    snapshots = _query_latest_snapshots(storage)

    out: list[SectorInfoResponse] = []
    strategies = cfg.strategies() or {}
    seen: set[str] = set()
    for sid, sc in strategies.items():
        sector_obj = getattr(sc, "sector", None)
        if sector_obj is None:
            continue
        code = getattr(sector_obj, "code", "")
        if not code or code in seen:
            continue
        seen.add(code)
        snap = snapshots.get(code, {})
        out.append(
            SectorInfoResponse(
                code=code,
                name=getattr(sector_obj, "name", ""),
                strategy_id=sid,
                strategy_name=getattr(sc, "strategy_name", ""),
                stock_count=int(snap.get("stock_count", 0) or 0),
                auto_update=bool(getattr(sector_obj, "auto_update", True)),
                update_mode=str(getattr(sector_obj, "update_mode", "replace")),
                last_update=snap.get("snapshot_at"),
            )
        )
    out.sort(key=lambda s: s.code)
    return out


@router.post(
    "",
    response_model=OkResponse,
    summary="占位：创建/更新板块",
)
async def create_or_update_sector(
    sector_manager: Any = Depends(get_sector_manager),
) -> OkResponse:
    """前端 ``POST /api/sectors`` 的占位实现。

    实际创建需指定 code/name/stocks，本端点保留接口形态返回 ``{ok:true}``。
    """
    return OkResponse(ok=True, message="板块批量创建请走 /api/sectors/{code}/refresh")


@router.get(
    "/{code}/stocks",
    response_model=list[SectorStockResponse],
    summary="获取板块成份股",
)
async def get_sector_stocks(
    code: str,
    sector_manager: Any = Depends(get_sector_manager),
    storage: Any = Depends(get_storage),
) -> list[SectorStockResponse]:
    """优先查 ``sector_snapshots`` 表的最近快照，找不到再调适配器 ``get_user_sector``。"""
    snap_rows = _query_snapshot_stocks(storage, code)
    if snap_rows:
        return snap_rows

    # 兜底：调适配器
    try:
        stocks = sector_manager.get_stocks(code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_stocks(%s) 失败: %s", code, exc)
        return []

    out: list[SectorStockResponse] = []
    for i, c in enumerate(stocks, start=1):
        out.append(
            SectorStockResponse(
                stock_code=c,
                stock_name="",
                added_at="",
                score=round(max(0.0, 1.0 - i * 0.02), 3),
            )
        )
    return out


@router.post(
    "/{code}/refresh",
    response_model=SectorRefreshResponse,
    summary="刷新板块成份股",
)
async def refresh_sector(
    code: str,
    cfg: Any = Depends(get_config),
    runner: Any = Depends(get_runner),
    sector_manager: Any = Depends(get_sector_manager),
    storage: Any = Depends(get_storage),
) -> SectorRefreshResponse:
    """重新执行该板块对应策略的选股，并把结果回写到通达信自定义板块。

    流程：
    1. 根据 ``code`` 反查策略 ID（从 ``cfg.strategies()`` 中匹配 ``sector.code``）
    2. 调 ``runner.run_strategy(sid)`` 触发选股（DuckDB / CSV / 板块导出由流水线自动完成）
    3. 把 ``ctx.final`` 中的 stock_code 列表调 ``sector_manager.update_stocks`` 原子回写
    """
    sid = _find_strategy_by_sector(cfg, code)
    if sid is None:
        raise HTTPException(
            status_code=404,
            detail=f"板块 {code} 未在 strategies/*.yaml 的 sector.code 中找到映射",
        )

    sc = cfg.strategy(sid)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"策略 {sid} 不存在")
    if not getattr(sc, "enabled", True):
        raise HTTPException(status_code=400, detail=f"策略 {sid} 已禁用，无法刷新板块 {code}")

    try:
        ctx = runner.run_strategy(sid)
    except Exception as exc:  # noqa: BLE001
        logger.exception("刷新板块 %s 失败：策略 %s 执行异常", code, sid)
        return SectorRefreshResponse(
            ok=False, code=code, count=0, message=f"策略执行失败: {exc}"
        )

    # 提取选股结果中的代码列表
    stocks: list[str] = []
    if ctx.final is not None and not ctx.final.empty:
        for col in ("stock_code", "code", "Code"):
            if col in ctx.final.columns:
                stocks = [str(x) for x in ctx.final[col].tolist() if x]
                break

    if not stocks:
        return SectorRefreshResponse(
            ok=True, code=code, count=0, message=f"策略 {sid} 选出 0 只，板块未更新"
        )

    # 原子回写：clear + send_user_block（Mock 模式下 noop）
    try:
        ok = sector_manager.update_stocks(code, stocks)
    except Exception as exc:  # noqa: BLE001
        logger.exception("update_stocks(%s) 失败", code)
        return SectorRefreshResponse(
            ok=False, code=code, count=len(stocks), message=f"回写失败: {exc}"
        )

    return SectorRefreshResponse(
        ok=ok,
        code=code,
        count=len(stocks),
        message=f"策略 {sid} 选出 {len(stocks)} 只，已回写板块 {code}",
    )


# ============================================================================
# 内部
# ============================================================================


def _find_strategy_by_sector(cfg: Any, code: str) -> str | None:
    """根据板块代码反查 strategy_id。"""
    strategies = cfg.strategies() or {}
    for sid, sc in strategies.items():
        sector_obj = getattr(sc, "sector", None)
        if sector_obj and getattr(sector_obj, "code", "") == code:
            return sid
    return None


def _query_latest_snapshots(storage: Any) -> dict[str, dict[str, Any]]:
    """取每个 sector_code 最近一次 snapshot。"""
    if not _table_exists(storage, "sector_snapshots"):
        return {}
    sql = (
        "SELECT s.sector_code, s.sector_name, s.strategy_id, s.stock_count, "
        "       s.snapshot_at "
        "FROM sector_snapshots s "
        "INNER JOIN ("
        "  SELECT sector_code, MAX(snapshot_at) AS max_ts "
        "  FROM sector_snapshots GROUP BY sector_code"
        ") m ON s.sector_code = m.sector_code AND s.snapshot_at = m.max_ts"
    )
    try:
        df = storage.query(sql)
    except Exception as exc:  # noqa: BLE001
        logger.warning("查询 sector_snapshots 失败: %s", exc)
        return {}
    out: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        code = str(row.get("sector_code", ""))
        if not code:
            continue
        out[code] = {
            "stock_count": _to_int(row.get("stock_count")),
            "snapshot_at": _to_str(row.get("snapshot_at")),
        }
    return out


def _query_snapshot_stocks(storage: Any, code: str) -> list[SectorStockResponse]:
    """从最近一次 ``sector_snapshots`` 取 ``stock_list`` (JSON 数组)。"""
    import json

    if not _table_exists(storage, "sector_snapshots"):
        return []
    try:
        row = storage.fetchone(
            "SELECT stock_list, snapshot_at FROM sector_snapshots "
            "WHERE sector_code = ? ORDER BY snapshot_at DESC LIMIT 1",
            (code,),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("查询 sector_snapshots(%s) 失败: %s", code, exc)
        return []
    if not row:
        return []
    raw_list = row[0]
    snap_at = _to_str(row[1]) if len(row) > 1 else None
    try:
        codes = json.loads(str(raw_list)) if raw_list else []
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    out: list[SectorStockResponse] = []
    for i, c in enumerate(codes, start=1):
        out.append(
            SectorStockResponse(
                stock_code=str(c),
                stock_name="",
                added_at=snap_at or "",
                score=round(max(0.0, 1.0 - i * 0.02), 3),
            )
        )
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
        if v is None or (isinstance(v, float) and v != v):
            return 0
        return int(v)
    except (TypeError, ValueError):
        return 0
