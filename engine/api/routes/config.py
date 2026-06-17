"""``/api/config`` 路由 - 配置热加载与策略 YAML 在线编辑。

- ``POST /api/config/reload``           - 触发 ``ConfigLoader.reload()``
- ``GET  /api/config/strategies``       - 列出策略 YAML 文件（含原文）
- ``PUT  /api/config/strategies/{id}``  - 在线更新策略 YAML
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException

from engine.api.deps import get_config
from engine.api.schemas import (
    ConfigReloadResponse,
    StrategyConfigFileItem,
    StrategyConfigUpdateRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["config"])


@router.post(
    "/reload",
    response_model=ConfigReloadResponse,
    summary="热加载全部 YAML 配置",
)
async def reload_config(cfg: Any = Depends(get_config)) -> ConfigReloadResponse:
    """重新扫描 ``config/*.yaml`` 与 ``strategies/*.yaml``。

    返回本次重载涉及的文件清单（按 mtime 排序）与策略总数。
    """
    before_paths = set()
    try:
        before_paths = {str(p) for p in cfg._file_mtimes.keys()}  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

    try:
        cfg.reload()
    except Exception as exc:  # noqa: BLE001
        logger.exception("配置重载失败")
        raise HTTPException(status_code=500, detail=f"reload 失败: {exc}") from exc

    after_paths = set()
    try:
        after_paths = {str(p) for p in cfg._file_mtimes.keys()}  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

    reloaded = sorted(after_paths)
    strategies_count = len(cfg.get("strategies", {}) or {})

    return ConfigReloadResponse(
        ok=True,
        reloaded=reloaded,
        strategies_count=strategies_count,
        message=f"重载完成：{len(reloaded)} 个文件，{strategies_count} 个策略",
    )


@router.get(
    "/strategies",
    response_model=list[StrategyConfigFileItem],
    summary="列出策略配置文件",
)
async def list_strategy_configs(
    cfg: Any = Depends(get_config),
) -> list[StrategyConfigFileItem]:
    """枚举 ``strategies/*.yaml``（跳过 ``_template.yaml``），含原文。"""
    strategies_dir = _resolve_strategies_dir(cfg)
    if not strategies_dir.exists():
        return []

    out: list[StrategyConfigFileItem] = []
    for path in sorted(strategies_dir.glob("*.yaml")):
        if path.name.startswith("_template"):
            continue
        try:
            text = path.read_text(encoding="utf-8")
            doc = yaml.safe_load(text) or {}
        except Exception as exc:  # noqa: BLE001
            logger.warning("读取策略 YAML 失败 %s: %s", path, exc)
            continue
        if not isinstance(doc, dict):
            continue
        out.append(
            StrategyConfigFileItem(
                strategy_id=str(doc.get("strategy_id", path.stem)),
                strategy_name=str(doc.get("strategy_name", "")),
                enabled=bool(doc.get("enabled", True)),
                yaml_path=str(path),
                yaml_content=text,
            )
        )
    return out


@router.put(
    "/strategies/{strategy_id}",
    response_model=StrategyConfigFileItem,
    summary="在线更新策略 YAML",
)
async def update_strategy_config(
    strategy_id: str,
    body: StrategyConfigUpdateRequest,
    cfg: Any = Depends(get_config),
) -> StrategyConfigFileItem:
    """直接覆写 ``strategies/strategy_<id>.yaml``。

    校验：YAML 必须能解析、``strategy_id`` 字段必须与 URL 一致。
    写入后自动 ``cfg.reload()``。
    """
    strategies_dir = _resolve_strategies_dir(cfg)
    target = strategies_dir / f"strategy_{strategy_id}.yaml"
    if not target.exists():
        raise HTTPException(
            status_code=404,
            detail=f"策略 YAML 不存在: {target.name}",
        )

    # 解析新内容校验
    try:
        doc = yaml.safe_load(body.yaml_content) or {}
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=422, detail=f"YAML 解析失败: {exc}") from exc
    if not isinstance(doc, dict):
        raise HTTPException(status_code=422, detail="YAML 顶层必须是 mapping")
    if str(doc.get("strategy_id", "")) != strategy_id:
        raise HTTPException(
            status_code=422,
            detail=f"YAML 中 strategy_id={doc.get('strategy_id')!r} 与 URL {strategy_id!r} 不一致",
        )

    # 如需切换 enabled，原地修改 doc
    if body.enabled is not None:
        doc["enabled"] = bool(body.enabled)
    new_text = yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, default_flow_style=False)

    try:
        target.write_text(new_text, encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"写入失败: {exc}") from exc

    try:
        cfg.reload()
    except Exception as exc:  # noqa: BLE001
        logger.warning("写入后重载失败: %s", exc)

    return StrategyConfigFileItem(
        strategy_id=strategy_id,
        strategy_name=str(doc.get("strategy_name", "")),
        enabled=bool(doc.get("enabled", True)),
        yaml_path=str(target),
        yaml_content=new_text,
    )


# ----------------------------------------------------------------------------
# 辅助
# ----------------------------------------------------------------------------


def _resolve_strategies_dir(cfg: Any) -> Path:
    """从配置读取 strategies_dir，相对路径以项目根解析。"""
    rel = cfg.get("paths.strategies_dir", "./strategies")
    p = Path(str(rel))
    if not p.is_absolute():
        # 项目根 = engine/ 的父目录
        root = Path(__file__).resolve().parent.parent.parent.parent
        p = root / p
    return p
