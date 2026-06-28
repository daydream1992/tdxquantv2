"""``/api/theme`` 路由 - 前端主题配置。

对应 ``config/theme.yaml``，前端通过该端点拿到主色/涨跌色/背景等配置，
修改 YAML 后调 ``POST /api/config/reload`` 即可热生效。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends

from engine.api.deps import get_config
from engine.api.schemas import ThemeResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["theme"])


def _theme_dict(cfg: Any) -> dict[str, Any]:
    """从 ConfigLoader 拿 theme 段 dict，缺失字段走默认值。"""
    raw = cfg.get("theme", {}) or {}
    # 字段补全（与 ThemeConfig dataclass 默认值对齐）
    defaults = {
        "mode": "dark",
        "primary_color": "#f59e0b",
        "up_color": "#ef4444",
        "down_color": "#22c55e",
        "flat_color": "#6b7280",
        "background": "#0a0a0a",
        "card_background": "#171717",
        "border_color": "#262626",
        "font_family": "ui-sans-serif, system-ui",
    }
    out = dict(defaults)
    out.update({k: v for k, v in raw.items() if v is not None})
    return out


@router.get("", response_model=ThemeResponse, summary="获取主题配置")
async def get_theme(cfg: Any = Depends(get_config)) -> ThemeResponse:
    """读取 ``config/theme.yaml`` 的 ``theme`` 段。

    与前端 ``src/lib/mock-data.ts`` 的 ``ThemeConfigDTO`` 字段完全对齐。
    """
    return ThemeResponse(**_theme_dict(cfg))
