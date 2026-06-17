"""``/api/search`` 路由 - 全局搜索 (跨策略 / 股票 / 信号)。

- ``GET /api/search?q=<kw>`` - 跨策略 / 股票 / 信号搜索

数据源
-----
- 策略: 从 ``ConfigLoader.strategies()`` 匹配 ``strategy_name`` / ``strategy_id``
- 股票: 从 ``selection_results`` 表匹配 ``stock_code`` / ``stock_name`` (DISTINCT)
- 信号: 从 ``signal_events`` 表匹配 ``condition_expr`` / ``stock_name`` (最近 ``limit`` 条)
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from engine.api.deps import get_config, get_storage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["search"])


# ============================================================================
# Schemas
# ============================================================================


class SearchStrategyItem(BaseModel):
    """搜索结果 - 策略组单条。"""

    strategy_id: str
    strategy_name: str
    strategy_emoji: str = ""
    description: str = ""
    sector_code: str = ""
    enabled: bool = True


class SearchStockItem(BaseModel):
    """搜索结果 - 股票组单条。"""

    stock_code: str
    stock_name: str = ""
    strategy_id: str = ""
    strategy_name: str = ""
    score: float = 0.0
    run_date: str = ""


class SearchSignalItem(BaseModel):
    """搜索结果 - 信号组单条。"""

    id: str
    time: str
    type: str = "system"
    strategy_id: str | None = None
    strategy_name: str | None = None
    stock_code: str | None = None
    stock_name: str | None = None
    content: str = ""


class SearchResponse(BaseModel):
    """全局搜索响应。"""

    q: str
    strategies: list[SearchStrategyItem] = Field(default_factory=list)
    stocks: list[SearchStockItem] = Field(default_factory=list)
    signals: list[SearchSignalItem] = Field(default_factory=list)
    total: int = 0


# ============================================================================
# 路由
# ============================================================================


@router.get(
    "",
    response_model=SearchResponse,
    summary="全局搜索 (策略 / 股票 / 信号)",
)
async def global_search(
    q: str = Query(..., min_length=1, description="搜索关键词"),
    storage: Any = Depends(get_storage),
    cfg: Any = Depends(get_config),
    limit: int = Query(20, ge=1, le=100, description="每组最大返回数"),
) -> SearchResponse:
    """跨策略/股票/信号搜索。

    - 策略: 从 cfg.strategies() 匹配 ``strategy_name`` / ``strategy_id``
    - 股票: 从 ``selection_results`` 表匹配 ``stock_code`` / ``stock_name`` (DISTINCT)
    - 信号: 从 ``signal_events`` 表匹配 ``condition_expr`` / ``stock_name`` (最近 ``limit`` 条)
    """
    kw = (q or "").strip().lower()
    if not kw:
        return SearchResponse(q=q, total=0)

    strategies = _search_strategies(cfg, kw, limit)
    stocks = _search_stocks(storage, cfg, kw, limit)
    signals = _search_signals(storage, cfg, kw, limit)

    total = len(strategies) + len(stocks) + len(signals)
    return SearchResponse(
        q=q,
        strategies=strategies,
        stocks=stocks,
        signals=signals,
        total=total,
    )


# ============================================================================
# 内部
# ============================================================================


def _search_strategies(cfg: Any, kw: str, limit: int) -> list[SearchStrategyItem]:
    """从 ConfigLoader.strategies() 匹配策略名 / ID。"""
    out: list[SearchStrategyItem] = []
    if cfg is None:
        return out
    try:
        strategies = cfg.strategies() or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("搜索策略失败: %s", exc)
        return out

    for sid, sc in strategies.items():
        name = (getattr(sc, "strategy_name", "") or sid).lower()
        sid_l = sid.lower()
        emoji = getattr(sc, "strategy_emoji", "") or ""
        description = getattr(sc, "description", "") or ""
        sector_code = ""
        sector = getattr(sc, "sector", None)
        if sector is not None:
            sector_code = getattr(sector, "code", "") or ""
        # 也匹配描述 (前端可显示次要信息)
        desc_l = (description or "").lower()
        if kw in name or kw in sid_l or kw in desc_l:
            out.append(
                SearchStrategyItem(
                    strategy_id=sid,
                    strategy_name=getattr(sc, "strategy_name", "") or sid,
                    strategy_emoji=emoji,
                    description=description,
                    sector_code=sector_code,
                    enabled=bool(getattr(sc, "enabled", True)),
                )
            )
        if len(out) >= limit:
            break
    return out


def _search_stocks(
    storage: Any,
    cfg: Any,
    kw: str,
    limit: int,
) -> list[SearchStockItem]:
    """从 selection_results 表匹配股票代码 / 名称 (DISTINCT)。"""
    if not _table_exists(storage, "selection_results"):
        return []
    # ILIKE 在 DuckDB 中支持大小写不敏感匹配
    pattern = f"%{kw}%"
    sql = (
        "SELECT DISTINCT stock_code, stock_name, strategy_id, "
        "       MAX(total_score) AS best_score, MAX(run_date) AS last_run_date "
        "FROM selection_results "
        "WHERE LOWER(stock_code) LIKE ? OR LOWER(stock_name) LIKE ? "
        "GROUP BY stock_code, stock_name, strategy_id "
        "ORDER BY best_score DESC "
        "LIMIT ?"
    )
    try:
        df = storage.query(sql, [pattern, pattern, int(limit)])
    except Exception as exc:  # noqa: BLE001
        logger.warning("搜索股票失败: %s", exc)
        return []
    if df.empty:
        return []

    # 预构建 strategy_id → name 映射 (best-effort)
    smap: dict[str, str] = {}
    if cfg is not None:
        try:
            for sid, sc in (cfg.strategies() or {}).items():
                smap[sid] = getattr(sc, "strategy_name", "") or sid
        except Exception:  # noqa: BLE001
            pass

    out: list[SearchStockItem] = []
    for _, row in df.iterrows():
        sid = str(row.get("strategy_id", "") or "")
        run_date = _to_str(row.get("last_run_date")) or ""
        if run_date and len(run_date) >= 10:
            run_date = run_date[:10]
        out.append(
            SearchStockItem(
                stock_code=str(row.get("stock_code", "") or ""),
                stock_name=str(row.get("stock_name", "") or ""),
                strategy_id=sid,
                strategy_name=smap.get(sid, sid),
                score=float(row.get("best_score") or 0.0),
                run_date=run_date,
            )
        )
    return out


def _search_signals(
    storage: Any,
    cfg: Any,
    kw: str,
    limit: int,
) -> list[SearchSignalItem]:
    """从 signal_events 表匹配 condition_expr / stock_name (最近 limit 条)。"""
    if not _table_exists(storage, "signal_events"):
        return []
    pattern = f"%{kw}%"
    sql = (
        "SELECT event_id, strategy_id, stock_code, stock_name, "
        "       alert_type, condition_expr, triggered_at "
        "FROM signal_events "
        "WHERE LOWER(condition_expr) LIKE ? "
        "   OR LOWER(stock_name) LIKE ? "
        "   OR LOWER(stock_code) LIKE ? "
        "   OR LOWER(alert_type) LIKE ? "
        "ORDER BY triggered_at DESC LIMIT ?"
    )
    try:
        df = storage.query(sql, [pattern, pattern, pattern, pattern, int(limit)])
    except Exception as exc:  # noqa: BLE001
        logger.warning("搜索信号失败: %s", exc)
        return []
    if df.empty:
        return []

    # 预构建 strategy_id → (name, emoji) 映射
    smap: dict[str, dict[str, str]] = {}
    if cfg is not None:
        try:
            for sid, sc in (cfg.strategies() or {}).items():
                smap[sid] = {
                    "name": getattr(sc, "strategy_name", "") or sid,
                    "emoji": getattr(sc, "strategy_emoji", "") or "",
                }
        except Exception:  # noqa: BLE001
            pass

    out: list[SearchSignalItem] = []
    for _, row in df.iterrows():
        sid_raw = row.get("strategy_id")
        sid = str(sid_raw) if sid_raw else None
        sname: str | None = None
        if sid and sid in smap:
            sname = smap[sid]["name"] or sid
        alert_type = str(row.get("alert_type", "system") or "system")
        # 前端 type 取值: limit_up|drop_alert|breakout|selection|system
        if alert_type not in ("limit_up", "drop_alert", "breakout", "selection", "system"):
            alert_type = "system"
        out.append(
            SearchSignalItem(
                id=str(row.get("event_id", "") or ""),
                time=_to_str(row.get("triggered_at")) or "",
                type=alert_type,
                strategy_id=sid,
                strategy_name=sname,
                stock_code=str(row.get("stock_code") or "") or None,
                stock_name=str(row.get("stock_name") or "") or None,
                content=str(row.get("condition_expr", "") or alert_type),
            )
        )
    return out


# ============================================================================
# 工具
# ============================================================================


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
