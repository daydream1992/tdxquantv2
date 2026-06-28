"""``/api/monitor/sector-heatmap`` 路由 - 监控池概念热度聚合。

- ``GET /api/monitor/sector-heatmap`` - 遍历监控池调 get_relation，聚合 Top N 概念/行业板块

设计要点
--------
1. **开关**: ``config/app.yaml`` 的 ``monitor.sector_heatmap.enabled``，关闭返回
   ``{enabled: False, items: [], total_stocks: 0, ...}``，前端据此隐藏整个卡片。
2. **限流保护**: 受 R14-2 令牌桶保护（Real 模式 qps=10），Mock 模式不限流
   （mock_adapter 不调 acquire_or_skip，开发体验优先）。
3. **缓存**: 60s LRU（TTL 来自配置），key 固定 ``"heatmap_v1"``，
   避免高频轮询时反复扫描监控池。
4. **并发安全**: 模块级 ``threading.Lock`` 保护缓存读写。
5. **降级**: 单股 ``get_relation`` 失败不阻断，跳过该股；整体 30s 超时返回部分结果。
6. **Mock 模式优化**: Mock 模式监控池可能有 30+ 只，全部调 ``get_relation`` 会触发
   30+ 次 CSV 过滤。整体超时保护 + 进度日志，避免阻塞 FastAPI 主线程。

数据源
------
- ``state.list_subscriptions()`` 返回 ``[{stock_code, strategy_id, ...}]``
- ``adapter.get_relation(code)`` 返回 ``[{BlockCode, BlockName, BlockType, GPNume}]``
- BlockType 归一化（中文 → 英文）：复用 ``_TYPE_MAP``，与 R14-1 保持一致
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from engine.api.deps import get_adapter, get_config, get_state

logger = logging.getLogger(__name__)

router = APIRouter(tags=["monitor"])


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


class HeatmapItem(BaseModel):
    """板块热度单条。"""

    code: str  # 板块代码 (BlockCode)
    name: str  # 板块名 (BlockName)
    type: str  # concept / industry
    count: int  # 监控池中属于该板块的股票数
    stocks: list[str] = Field(default_factory=list)  # 股票代码列表（最多 5 个示例）


class SectorHeatmapResponse(BaseModel):
    """监控池概念热度响应。

    - ``enabled`` False 表示功能关闭，前端隐藏整个卡片
    - ``total_stocks`` 监控池总数
    - ``scanned_stocks`` 实际扫描成功数（失败的跳过）
    - ``from_cache`` True 表示本次命中 LRU 缓存
    - ``duration_ms`` 本次扫描总耗时（缓存命中时为 0）
    """

    enabled: bool
    items: list[HeatmapItem] = Field(default_factory=list)
    total_stocks: int = 0
    scanned_stocks: int = 0
    from_cache: bool = False
    fetched_at: str = ""
    duration_ms: float = 0.0


# ============================================================================
# 模块级 LRU 缓存（key 固定 "heatmap_v1"，TTL 来自配置，容量 1）
# ============================================================================

_CACHE_KEY: str = "heatmap_v1"
_cache: "OrderedDict[str, tuple[float, SectorHeatmapResponse]]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_get(ttl: int) -> SectorHeatmapResponse | None:
    """命中且未过期 → 返回缓存副本 (from_cache=True); 否则 None。"""
    now = time.time()
    with _cache_lock:
        entry = _cache.get(_CACHE_KEY)
        if entry is None:
            return None
        ts, resp = entry
        if now - ts > ttl:
            _cache.pop(_CACHE_KEY, None)
            return None
        return resp.model_copy(update={"from_cache": True})


def _cache_put(resp: SectorHeatmapResponse) -> None:
    """写入缓存（覆盖旧值）。"""
    now = time.time()
    with _cache_lock:
        _cache[_CACHE_KEY] = (now, resp)
        _cache.move_to_end(_CACHE_KEY)


def _cache_clear() -> None:
    """清空缓存（配置变更/调试用）。"""
    with _cache_lock:
        _cache.clear()


# ============================================================================
# 路由
# ============================================================================


@router.get(
    "/sector-heatmap",
    response_model=SectorHeatmapResponse,
    summary="监控池概念热度 Top N（R14-3 方案 B）",
)
async def get_sector_heatmap(
    state: Any = Depends(get_state),
    adapter: Any = Depends(get_adapter),
    cfg: Any = Depends(get_config),
) -> SectorHeatmapResponse:
    """遍历监控池调 ``adapter.get_relation(code)``，聚合概念/行业板块 Top N。

    **开关**: ``monitor.sector_heatmap.enabled`` 为 False 时返回空响应（前端隐藏卡片）。

    **缓存**: TTL 来自 ``monitor.sector_heatmap.cache_ttl``（默认 60s），
    key 固定 ``heatmap_v1``；命中返回 ``from_cache=True``。

    **超时保护**: 整体扫描超时来自 ``monitor.sector_heatmap.scan_timeout``
    （默认 30s），超时返回已扫描到的部分结果。

    **降级**: 单股 ``get_relation`` 异常或被令牌桶拒绝（Real 模式 RateLimitError）
    不阻断，跳过该股。
    """
    # 1. 读配置
    enabled = bool(cfg.get("monitor.sector_heatmap.enabled", False))
    if not enabled:
        return SectorHeatmapResponse(enabled=False, fetched_at=_now_iso())

    top_n = int(cfg.get("monitor.sector_heatmap.top_n", 10) or 10)
    cache_ttl = int(cfg.get("monitor.sector_heatmap.cache_ttl", 60) or 60)
    scan_timeout = float(cfg.get("monitor.sector_heatmap.scan_timeout", 30) or 30)

    # 2. 缓存命中
    cached = _cache_get(cache_ttl)
    if cached is not None:
        return cached

    # 3. 取监控池
    subs = state.list_subscriptions() or []
    codes: list[str] = []
    seen: set[str] = set()
    for s in subs:
        c = str(s.get("stock_code") or "").strip()
        if c and c not in seen:
            seen.add(c)
            codes.append(c)
    total_stocks = len(codes)

    # 4. 遍历扫描，聚合板块计数
    start_ts = time.time()
    # board_code -> {name, type, count, stocks: list[str]}
    board_map: dict[str, dict[str, Any]] = {}
    scanned = 0
    deadline = start_ts + scan_timeout

    for i, code in enumerate(codes):
        # 超时保护：到达 deadline 立即停止，返回部分结果
        if time.time() > deadline:
            logger.warning(
                "sector-heatmap 扫描超时 %.0fs，已扫描 %d/%d 只",
                scan_timeout, i, total_stocks,
            )
            break

        try:
            raw_list = adapter.get_relation(code)
        except Exception as exc:  # noqa: BLE001
            # Real 模式可能抛 RateLimitError；Mock 模式异常也兜底
            logger.debug("get_relation(%s) 失败，跳过: %s", code, exc)
            continue

        if not raw_list:
            continue

        scanned += 1
        for row in raw_list:
            block_code = str(row.get("BlockCode", "") or "")
            block_name = str(row.get("BlockName", "") or "")
            type_raw = str(row.get("BlockType", "") or "")
            type_en = _TYPE_MAP.get(type_raw)
            if type_en is None:
                type_en = type_raw.lower() or "unknown"
            # 只统计 concept / industry 两类
            if type_en not in ("concept", "industry"):
                continue
            if not block_code:
                continue
            entry = board_map.get(block_code)
            if entry is None:
                entry = {
                    "name": block_name,
                    "type": type_en,
                    "count": 0,
                    "stocks": [],
                }
                board_map[block_code] = entry
            entry["count"] += 1
            if len(entry["stocks"]) < 5:
                entry["stocks"].append(code)

    duration_ms = (time.time() - start_ts) * 1000.0

    # 5. 按 count 降序取 Top N（同 count 按 name 排序保持稳定）
    sorted_boards = sorted(
        board_map.items(),
        key=lambda kv: (-kv[1]["count"], kv[1]["name"]),
    )[:top_n]
    items = [
        HeatmapItem(
            code=bc,
            name=bd["name"],
            type=bd["type"],
            count=int(bd["count"]),
            stocks=list(bd["stocks"]),
        )
        for bc, bd in sorted_boards
    ]

    resp = SectorHeatmapResponse(
        enabled=True,
        items=items,
        total_stocks=total_stocks,
        scanned_stocks=scanned,
        from_cache=False,
        fetched_at=_now_iso(),
        duration_ms=round(duration_ms, 2),
    )
    _cache_put(resp)
    logger.info(
        "sector-heatmap 扫描完成: total=%d scanned=%d boards=%d top=%d %.0fms",
        total_stocks, scanned, len(board_map), len(items), duration_ms,
    )
    return resp


# ============================================================================
# 内部
# ============================================================================


def _now_iso() -> str:
    """当前 ISO-8601 UTC 时间戳。"""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
