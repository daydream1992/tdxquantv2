"""``/api/signals/{id}/related`` 路由 - 信号同板块联动查询（R14-3 方案 C）。

- ``GET /api/signals/{signal_id}/related`` - 查信号触发股的同概念板块联动股

设计要点
--------
1. **开关**: ``config/app.yaml`` 的 ``monitor.sector_linkage.enabled``，关闭返回
   ``{enabled: False, items: [], signal_id: id}``，前端隐藏"联动"按钮。
2. **数据源**: 从 ``signal_events`` 取 ``stock_code`` → ``adapter.get_relation`` →
   取概念板块 → 遍历板块成份股 → 过滤掉自身 + 过滤掉非监控池。
3. **缓存**: 30s LRU（TTL 来自配置），key=stock_code，板块归属变更不频繁。
4. **限流保护**: 受 R14-2 令牌桶保护（Real 模式 qps=10）。
5. **降级**: 单板块查询失败跳过；信号不存在返回 404；表不存在返回 404。
6. **pct 字段**: EngineState 当前**不缓存**实时行情（无 ``_quotes`` 字段），
   故本端点 ``pct`` 一律返回 ``0.0``，注释说明，前端按 0 渲染。
   后续若 EngineState 加行情缓存可补全。

数据流
------
``signal_events.stock_code`` → ``adapter.get_relation(code)`` → 概念板块列表
→ 对每个板块调 ``adapter.get_stock_list_in_sector(block_code)`` → 成份股列表
→ 去掉自身 + 只保留在 ``state.list_subscriptions()`` 监控池中的股
→ 按板块聚合，每个板块最多 ``top_n`` 只联动股
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from engine.api.deps import get_adapter, get_config, get_state, get_storage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["signals"])


# ============================================================================
# BlockType 中文 → 英文 枚举映射（与 R14-1 stocks.py 保持一致）
# ============================================================================

_TYPE_MAP: dict[str, str] = {
    "概念": "concept",
    "行业": "industry",
    "地区": "region",
    "指数": "index",
    "风格": "style",
    "系统定义": "system",
    "自定义": "custom",
}


# ============================================================================
# Schemas
# ============================================================================


class RelatedStockItem(BaseModel):
    """同板块联动股单条。"""

    code: str
    name: str = ""
    pct: float = 0.0  # 当前涨跌幅（从 EngineState 缓存取，无则 0）


class RelatedSectorItem(BaseModel):
    """联动板块单条（含该板块内的联动股列表）。"""

    sector_code: str
    sector_name: str
    sector_type: str = "concept"
    stocks: list[RelatedStockItem] = Field(default_factory=list)


class SectorLinkageResponse(BaseModel):
    """信号同板块联动响应。

    - ``enabled`` False 表示功能关闭，前端隐藏"联动"按钮
    - ``stock_code`` 触发信号股票代码
    - ``stock_name`` 触发信号股票名称（来自 signal_events）
    - ``items`` 概念板块列表，每板块含最多 ``top_n`` 只联动股
    - ``from_cache`` True 表示本次命中 LRU 缓存
    """

    enabled: bool
    signal_id: str
    stock_code: str
    stock_name: str = ""
    items: list[RelatedSectorItem] = Field(default_factory=list)
    from_cache: bool = False
    fetched_at: str = ""


# ============================================================================
# 模块级 LRU 缓存（key=stock_code，TTL 来自配置，容量 200）
# ============================================================================

_CACHE_MAX_SIZE: int = 200
_cache: "OrderedDict[str, tuple[float, SectorLinkageResponse]]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_get(stock_code: str, ttl: int) -> SectorLinkageResponse | None:
    """命中且未过期 → 返回缓存副本 (from_cache=True); 否则 None。"""
    now = time.time()
    with _cache_lock:
        entry = _cache.get(stock_code)
        if entry is None:
            return None
        ts, resp = entry
        if now - ts > ttl:
            _cache.pop(stock_code, None)
            return None
        _cache.move_to_end(stock_code)
        return resp.model_copy(update={"from_cache": True})


def _cache_put(stock_code: str, resp: SectorLinkageResponse) -> None:
    """写入缓存，容量超限 FIFO 淘汰。"""
    now = time.time()
    with _cache_lock:
        _cache[stock_code] = (now, resp)
        _cache.move_to_end(stock_code)
        while len(_cache) > _CACHE_MAX_SIZE:
            _cache.popitem(last=False)


def _cache_clear() -> None:
    """清空缓存（配置变更/调试用）。"""
    with _cache_lock:
        _cache.clear()


# ============================================================================
# 路由
# ============================================================================


@router.get(
    "/{signal_id}/related",
    response_model=SectorLinkageResponse,
    summary="信号同板块联动股（R14-3 方案 C）",
)
async def get_signal_related(
    signal_id: str,
    storage: Any = Depends(get_storage),
    adapter: Any = Depends(get_adapter),
    cfg: Any = Depends(get_config),
    state: Any = Depends(get_state),
) -> SectorLinkageResponse:
    """查信号触发股的同概念板块联动股（限监控池内）。

    **开关**: ``monitor.sector_linkage.enabled`` 为 False 时返回空响应
    （前端隐藏"联动"按钮）。

    **缓存**: TTL 来自 ``monitor.sector_linkage.cache_ttl``（默认 30s），
    key=stock_code；命中返回 ``from_cache=True``。

    **限流**: Real 模式下 ``adapter.get_relation`` 和 ``get_stock_list_in_sector``
    均受 R14-2 令牌桶保护（qps=10）；Mock 模式不限流。

    **错误**:
      - 404: signal_events 表不存在 / 信号不存在
      - 200 空列表: 信号无 stock_code / 该股无概念板块 / 联动股不在监控池
    """
    # 1. 读配置
    enabled = bool(cfg.get("monitor.sector_linkage.enabled", False))
    if not enabled:
        return SectorLinkageResponse(
            enabled=False, signal_id=signal_id, stock_code="", fetched_at=_now_iso()
        )

    top_n = int(cfg.get("monitor.sector_linkage.top_n", 5) or 5)
    cache_ttl = int(cfg.get("monitor.sector_linkage.cache_ttl", 30) or 30)

    # 2. 查 signal_events 取 stock_code + stock_name
    stock_code, stock_name = _lookup_signal_stock(storage, signal_id)
    if not stock_code:
        raise HTTPException(
            status_code=404,
            detail=f"信号 {signal_id} 不存在或无 stock_code",
        )

    # 3. 缓存命中
    cached = _cache_get(stock_code, cache_ttl)
    if cached is not None:
        # 缓存里 stock_code/stock_name 是首次扫描时的值，重写 signal_id 保持一致
        return cached.model_copy(update={"signal_id": signal_id})

    # 4. 调 adapter.get_relation 取概念板块
    try:
        raw_list = adapter.get_relation(stock_code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_relation(%s) 失败: %s", stock_code, exc)
        raw_list = []

    concept_boards: list[tuple[str, str]] = []  # (block_code, block_name)
    for row in raw_list or []:
        block_code = str(row.get("BlockCode", "") or "")
        block_name = str(row.get("BlockName", "") or "")
        type_raw = str(row.get("BlockType", "") or "")
        type_en = _TYPE_MAP.get(type_raw)
        if type_en is None:
            type_en = type_raw.lower() or "unknown"
        if type_en == "concept" and block_code:
            concept_boards.append((block_code, block_name))

    # 5. 监控池 codes 集合（用于过滤联动股）
    subs = state.list_subscriptions() or []
    watch_codes: set[str] = {
        str(s.get("stock_code") or "").strip() for s in subs
    }
    watch_codes.discard("")

    # 6. 遍历概念板块，调 get_stock_list_in_sector 拿成份股
    items: list[RelatedSectorItem] = []
    for block_code, block_name in concept_boards:
        try:
            members = adapter.get_stock_list_in_sector(block_code, list_type="1")
        except Exception as exc:  # noqa: BLE001
            logger.debug(
                "get_stock_list_in_sector(%s) 失败，跳过: %s", block_code, exc
            )
            continue

        related_stocks: list[RelatedStockItem] = []
        for m in members or []:
            code = str(m.get("Code") or m.get("code") or "").strip()
            if not code:
                continue
            if code == stock_code:
                continue  # 去掉自身
            if code not in watch_codes:
                continue  # 只保留监控池内
            name = str(m.get("Name") or m.get("name") or "")
            # pct 字段：EngineState 当前不缓存实时行情，统一返回 0.0
            # （后续若加 _quotes 缓存可从 state 取最新 pct）
            related_stocks.append(RelatedStockItem(code=code, name=name, pct=0.0))
            if len(related_stocks) >= top_n:
                break

        if related_stocks:
            items.append(
                RelatedSectorItem(
                    sector_code=block_code,
                    sector_name=block_name,
                    sector_type="concept",
                    stocks=related_stocks,
                )
            )

    resp = SectorLinkageResponse(
        enabled=True,
        signal_id=signal_id,
        stock_code=stock_code,
        stock_name=stock_name,
        items=items,
        from_cache=False,
        fetched_at=_now_iso(),
    )
    _cache_put(stock_code, resp)
    logger.info(
        "sector-linkage 查询完成: signal=%s stock=%s boards=%d items=%d",
        signal_id, stock_code, len(concept_boards), len(items),
    )
    return resp


# ============================================================================
# 内部
# ============================================================================


def _lookup_signal_stock(
    storage: Any, signal_id: str
) -> tuple[str, str]:
    """从 signal_events 查 stock_code + stock_name。

    表不存在 / 信号不存在 / 无 stock_code 都返回 ("", "")。
    """
    if storage is None or not hasattr(storage, "table_exists"):
        return ("", "")
    try:
        if not storage.table_exists("signal_events"):
            return ("", "")
    except Exception:  # noqa: BLE001
        return ("", "")

    try:
        df = storage.query(
            "SELECT stock_code, stock_name FROM signal_events "
            "WHERE event_id = ? LIMIT 1",
            (signal_id,),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("查询 signal_events(%s) 失败: %s", signal_id, exc)
        return ("", "")

    if df is None or df.empty:
        return ("", "")
    row = df.iloc[0]
    code = str(row.get("stock_code") or "").strip()
    name = str(row.get("stock_name") or "").strip()
    return (code, name)


def _now_iso() -> str:
    """当前 ISO-8601 UTC 时间戳。"""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
