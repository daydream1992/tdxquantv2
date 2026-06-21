"""``/api/stocks`` 路由 - 个股信息查询。

- ``GET /api/stocks/{code}/sectors`` - 个股所属板块（概念/行业/地区分组）

数据源
-----
- ``adapter.get_relation(code)`` 返回 ``[{BlockCode, BlockName, BlockType, GPNume}]``
- BlockType 中文取值: ``地区 / 指数 / 概念 / 系统定义 / 自定义 / 行业 / 风格``
- Mock 模式从 ``stock_block_relation.csv`` 过滤；Real 模式调 tqcenter。

简化说明
--------
不调 ``get_stock_list('18')`` 缓存翻译行业名，因为：
  1. Mock 模式 BlockName 已是中文名（"白酒" / "煤炭" / "酿酒" 等）
  2. Real 模式 BlockName 同样是名字，无需二次翻译
  3. 减少不必要的适配器调用，降低 Real 模式下网络开销
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from engine.api.deps import get_adapter
from engine.utils.stock_code import normalize

logger = logging.getLogger(__name__)

router = APIRouter(tags=["stocks"])


# ============================================================================
# Schemas
# ============================================================================


class StockSectorItem(BaseModel):
    """个股所属板块单条。"""

    code: str  # BlockCode
    name: str  # BlockName
    type: str  # 归一化后的英文 type (concept/industry/region/index/style/system/custom/...)
    type_raw: str  # 原始 BlockType (中文)
    gp_num: str = ""  # GPNume, 板块成份股数 (字符串, 保持原样)


class StockSectorsResponse(BaseModel):
    """个股所属板块响应。

    - ``concept`` / ``industry`` / ``region`` 三组对前端最常用的板块分类
    - ``other`` 兜底 index/style/system/custom 等其它类型 (含未识别的 BlockType)
    - ``total`` = concept+industry+region+other 的总和
    - ``from_cache`` True 表示本次命中 LRU 缓存
    - ``fetched_at`` ISO-8601 UTC 时间戳
    """

    stock_code: str
    concept: list[StockSectorItem] = Field(default_factory=list)
    industry: list[StockSectorItem] = Field(default_factory=list)
    region: list[StockSectorItem] = Field(default_factory=list)
    other: list[StockSectorItem] = Field(default_factory=list)
    total: int = 0
    from_cache: bool = False
    fetched_at: str = ""


# ============================================================================
# BlockType 中文 → 英文 枚举映射
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
# 模块级 LRU 缓存 (TTL=60s, 容量上限 1000)
# ============================================================================

_CACHE_TTL_SECONDS: int = 60
_CACHE_MAX_SIZE: int = 1000

# code -> (unix_ts, response)
_cache: "OrderedDict[str, tuple[float, StockSectorsResponse]]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_get(code: str) -> StockSectorsResponse | None:
    """命中且未过期 → 返回缓存副本 (标记 from_cache=True); 否则 None。

    LRU: 命中时 move_to_end。过期时主动淘汰。
    """
    now = datetime.now(timezone.utc).timestamp()
    with _cache_lock:
        entry = _cache.get(code)
        if entry is None:
            return None
        ts, resp = entry
        if now - ts > _CACHE_TTL_SECONDS:
            _cache.pop(code, None)
            return None
        _cache.move_to_end(code)
        # 返回副本, from_cache=True, 不污染缓存原对象
        return resp.model_copy(update={"from_cache": True})


def _cache_put(code: str, resp: StockSectorsResponse) -> None:
    """写入缓存, 容量超限时淘汰最旧 (FIFO)。"""
    with _cache_lock:
        _cache[code] = (datetime.now(timezone.utc).timestamp(), resp)
        _cache.move_to_end(code)
        while len(_cache) > _CACHE_MAX_SIZE:
            _cache.popitem(last=False)


def _cache_clear() -> None:
    """(测试/调试用) 清空缓存。"""
    with _cache_lock:
        _cache.clear()


# ============================================================================
# 路由
# ============================================================================


@router.get(
    "/{code}/sectors",
    response_model=StockSectorsResponse,
    summary="个股所属板块 (概念/行业/地区分组)",
)
async def get_stock_sectors(
    code: str,
    adapter: Any = Depends(get_adapter),
) -> StockSectorsResponse:
    """查询个股所属全部板块, 按 concept/industry/region/other 分组返回。

    **数据源**: ``adapter.get_relation(code)`` → ``[{BlockCode, BlockName, BlockType, GPNume}]``

    **BlockType 归一化**: 中文 → 英文枚举, 见 ``_TYPE_MAP``;
    未知类型 lowercase 后归入 ``other`` 分组。

    **缓存**: 模块级 LRU, key=归一化后 code, TTL=60s, 容量上限 1000;
    命中返回 ``from_cache=True``。

    **错误**:
      - 422: code 非法 (normalize 抛 ValueError)
      - 502: adapter 调用异常
      - 空结果: 正常 200, 各组列表为空, total=0
    """
    # 1. 代码归一化
    try:
        ncode = normalize(code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"非法代码: {code}") from exc

    # 2. 缓存命中
    cached = _cache_get(ncode)
    if cached is not None:
        return cached

    # 3. 调适配器拉原始板块列表
    try:
        raw_list = adapter.get_relation(ncode)
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_relation(%s) 调用失败: %s", ncode, exc)
        raise HTTPException(
            status_code=502,
            detail=f"查询板块归属失败: {exc}",
        ) from exc

    # 4. 归一化 BlockType + 分组
    resp = _build_response(ncode, raw_list)

    # 5. 写缓存 (from_cache=False, 新数据)
    _cache_put(ncode, resp)
    return resp


# ============================================================================
# 内部
# ============================================================================


def _build_response(
    ncode: str, raw_list: list[dict[str, Any]]
) -> StockSectorsResponse:
    """把 adapter.get_relation() 返回的原始 dict 列表分组归一化。"""
    concept: list[StockSectorItem] = []
    industry: list[StockSectorItem] = []
    region: list[StockSectorItem] = []
    other: list[StockSectorItem] = []

    for row in raw_list or []:
        block_code = str(row.get("BlockCode", "") or "")
        block_name = str(row.get("BlockName", "") or "")
        type_raw = str(row.get("BlockType", "") or "")
        gp_num = str(row.get("GPNume", "") or "")

        type_en = _TYPE_MAP.get(type_raw)
        if type_en is None:
            # 未知 BlockType: lowercase 后塞 other
            type_en = type_raw.lower() or "unknown"

        item = StockSectorItem(
            code=block_code,
            name=block_name,
            type=type_en,
            type_raw=type_raw,
            gp_num=gp_num,
        )

        if type_en == "concept":
            concept.append(item)
        elif type_en == "industry":
            industry.append(item)
        elif type_en == "region":
            region.append(item)
        else:
            # index / style / system / custom / unknown 全归 other
            other.append(item)

    total = len(concept) + len(industry) + len(region) + len(other)
    return StockSectorsResponse(
        stock_code=ncode,
        concept=concept,
        industry=industry,
        region=region,
        other=other,
        total=total,
        from_cache=False,
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )
