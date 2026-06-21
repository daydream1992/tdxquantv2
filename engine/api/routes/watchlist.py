"""``/api/monitor/watchlist`` 路由 - 监控股票池动态管理。

PLAN §15.1 P0：补 ``EngineState.upsert_subscription`` 主动调用入口。

路由：
- ``GET    /api/monitor/watchlist``                          列出当前监控池
- ``POST   /api/monitor/watchlist``                          批量加入监控
- ``DELETE /api/monitor/watchlist/{code}``                   移除单只
- ``POST   /api/monitor/watchlist/by-sector/{sector_code}``  按板块批量加入

实现：复用 ``EngineState.upsert_subscription`` / ``remove_subscription``
+ 写 ``monitor_subscriptions`` 表（持久化跨重启）。
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from engine.api.deps import get_state, get_storage
from engine.api.state import EngineState

logger = logging.getLogger(__name__)

router = APIRouter(tags=["monitor-watchlist"])


# ============================================================================
# 请求 / 响应 模型
# ============================================================================


class WatchlistAddRequest(BaseModel):
    """批量加入监控请求。"""

    codes: list[str] = Field(..., min_length=1, description="股票代码列表")
    strategy_id: str = Field(
        "_manual",
        description="绑定选股策略 ID；临时盯盘填 _manual；决定走哪个 match 套餐",
    )
    subscriber: str = Field("api_watchlist", description="订阅方标识")


class WatchlistItem(BaseModel):
    """监控池单项。"""

    stock_code: str
    strategy_id: str = ""
    subscriber: str = ""
    subscribed_at: str = ""
    active: bool = True
    batch_no: int = 0


class WatchlistAddResponse(BaseModel):
    """加入响应。"""

    ok: bool
    added: int
    skipped: int
    message: str


# ============================================================================
# 路由
# ============================================================================


@router.get("", response_model=list[WatchlistItem], summary="列出当前监控池")
async def list_watchlist(
    state: Any = Depends(get_state),
) -> list[WatchlistItem]:
    """列出 ``EngineState`` 中所有活跃订阅（含 strategy_id 归属）。"""
    subs = state.list_subscriptions()
    return [
        WatchlistItem(
            stock_code=str(s.get("stock_code", "")),
            strategy_id=str(s.get("strategy_id", "")),
            subscriber=str(s.get("subscriber", "")),
            subscribed_at=str(s.get("subscribed_at", "")),
            active=bool(s.get("active", True)),
            batch_no=int(s.get("batch_no", 0) or 0),
        )
        for s in subs
    ]


@router.post("", response_model=WatchlistAddResponse, summary="批量加入监控")
async def add_to_watchlist(
    req: WatchlistAddRequest,
    state: Any = Depends(get_state),
    storage: Any = Depends(get_storage),
) -> WatchlistAddResponse:
    """批量加入监控池。

    - 复用 ``EngineState.upsert_subscription``
    - 同时写 ``monitor_subscriptions`` 表持久化（跨重启订阅不丢）
    - ``strategy_id`` 决定走哪个 match 套餐（PLAN §15.1）
    """
    added = 0
    skipped = 0
    batch_no = 1
    for code in req.codes:
        c = (code or "").strip()
        if not c:
            skipped += 1
            continue
        try:
            state.upsert_subscription(
                c,
                strategy_id=req.strategy_id,
                subscriber=req.subscriber,
                batch_no=batch_no,
            )
            _persist_subscription(storage, c, req.strategy_id, req.subscriber, batch_no)
            added += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("upsert_subscription %s 失败: %s", c, exc)
            skipped += 1
    return WatchlistAddResponse(
        ok=True,
        added=added,
        skipped=skipped,
        message=f"已加入 {added} 只，跳过 {skipped} 只",
    )


@router.delete("/{code}", summary="移除单只监控")
async def remove_from_watchlist(
    code: str,
    state: Any = Depends(get_state),
    storage: Any = Depends(get_storage),
) -> dict[str, Any]:
    """从监控池移除单只股票。

    - ``EngineState.remove_subscription`` 清内存
    - ``monitor_subscriptions`` 表对应记录置 active=false
    """
    state.remove_subscription(code)
    _deactivate_subscription(storage, code)
    return {"ok": True, "code": code, "message": f"已移除 {code}"}


@router.post(
    "/by-sector/{sector_code}",
    response_model=WatchlistAddResponse,
    summary="按板块批量加入监控",
)
async def add_by_sector(
    sector_code: str,
    state: Any = Depends(get_state),
    storage: Any = Depends(get_storage),
    strategy_id: str = "_manual",
    subscriber: str = "api_watchlist_sector",
) -> WatchlistAddResponse:
    """按板块代码批量加入监控。

    调 ``SectorManager.get_stocks(sector_code)`` 取板块成分股，
    然后批量 upsert_subscription。

    Mock 模式 / TDX 未连接时，``adapter.get_user_sector`` 返回空列表。
    此时 fallback 读 ``sector_snapshots`` 表（与
    ``/api/sectors/{code}/stocks`` 端点同源），避免"板块不存在"假报错。
    """
    import json as _json

    try:
        from engine.data_adapter.factory import get_adapter
        from engine.sector.manager import SectorManager

        sm = SectorManager(get_adapter())
        stocks = sm.get_stocks(sector_code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("取板块 %s 成分股失败: %s", sector_code, exc)
        raise HTTPException(
            status_code=500, detail=f"取板块成分股失败: {exc}"
        ) from exc

    # Fallback: adapter 未联通（如 mock 模式）时读 sector_snapshots 表
    # (与 /api/sectors/{code}/stocks 同源, 修复 R13-3b mock 模式假 404)
    if not stocks and storage is not None and hasattr(storage, "table_exists"):
        try:
            if storage.table_exists("sector_snapshots"):
                row = storage.fetchone(
                    "SELECT stock_list FROM sector_snapshots "
                    "WHERE sector_code = ? ORDER BY snapshot_at DESC LIMIT 1",
                    (sector_code,),
                )
                if row and row[0]:
                    stocks = list(_json.loads(str(row[0])))
                    logger.info(
                        "by-sector %s: adapter 空, fallback sector_snapshots 取 %d 只",
                        sector_code, len(stocks),
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning("fallback sector_snapshots(%s) 失败: %s", sector_code, exc)

    if not stocks:
        raise HTTPException(
            status_code=404,
            detail=f"板块 {sector_code} 不存在或为空",
        )

    added = 0
    batch_no = 1
    for code in stocks:
        c = (code or "").strip()
        if not c:
            continue
        try:
            state.upsert_subscription(
                c,
                strategy_id=strategy_id,
                subscriber=subscriber,
                batch_no=batch_no,
            )
            _persist_subscription(storage, c, strategy_id, subscriber, batch_no)
            added += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("upsert_subscription %s 失败: %s", c, exc)
    return WatchlistAddResponse(
        ok=True,
        added=added,
        skipped=len(stocks) - added,
        message=f"板块 {sector_code} 已加入 {added}/{len(stocks)} 只",
    )


# ============================================================================
# 内部
# ============================================================================


def _persist_subscription(
    storage: Any,
    code: str,
    strategy_id: str,
    subscriber: str,
    batch_no: int,
) -> None:
    """写 monitor_subscriptions 表（持久化跨重启）。

    注：用 DELETE+INSERT 而非 UPDATE，规避 DuckDB 索引下 UPDATE 的
    "Failed to delete all rows from index" bug。
    """
    if storage is None or not hasattr(storage, "table_exists"):
        return
    try:
        if not storage.table_exists("monitor_subscriptions"):
            return
        # 同 stock_code 旧记录先 DELETE，再插新记录
        storage.execute(
            "DELETE FROM monitor_subscriptions WHERE stock_code = ?",
            [code],
        )
        storage.execute(
            """
            INSERT INTO monitor_subscriptions
                (strategy_id, stock_code, subscriber, subscribed_at, active, batch_no)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, true, ?)
            """,
            [strategy_id, code, subscriber, batch_no],
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("写 monitor_subscriptions 失败（可忽略）: %s", exc)


def _deactivate_subscription(storage: Any, code: str) -> None:
    """移除监控时把 monitor_subscriptions 中该 code 的 active=true 记录置为 active=false。

    保留行做历史归档（unsubscribed_at 标记退订时间），与
    ``engine/monitor/engine.py:_on_new_day`` 的 ``DELETE FROM monitor_subscriptions
    WHERE active = false`` 形成闭环（每日跨日才真正清理归档行）。

    实现采用 DELETE-then-INSERT 而非 UPDATE，规避 DuckDB 索引下 UPDATE 的
    "Failed to delete all rows from index" bug（与 _persist_subscription 同模式）。
    """
    if storage is None or not hasattr(storage, "table_exists"):
        return
    try:
        if not storage.table_exists("monitor_subscriptions"):
            return
        # 读现有 active=true 行（保留 strategy_id/subscriber/subscribed_at）
        df = storage.query(
            "SELECT strategy_id, subscriber, subscribed_at, batch_no "
            "FROM monitor_subscriptions WHERE stock_code = ? AND active = true",
            [code],
        )
        if df.empty:
            return
        # 删旧 active=true 行
        storage.execute(
            "DELETE FROM monitor_subscriptions WHERE stock_code = ? AND active = true",
            [code],
        )
        # 插入 active=false 归档行（保留原订阅信息 + unsubscribed_at）
        for _, row in df.iterrows():
            storage.execute(
                """
                INSERT INTO monitor_subscriptions
                    (strategy_id, stock_code, subscriber, subscribed_at,
                     unsubscribed_at, active, batch_no)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, false, ?)
                """,
                [
                    str(row.get("strategy_id") or ""),
                    code,
                    str(row.get("subscriber") or ""),
                    row.get("subscribed_at"),
                    int(row.get("batch_no") or 0),
                ],
            )
    except Exception as exc:  # noqa: BLE001
        logger.debug("deactivate monitor_subscriptions 失败: %s", exc)
