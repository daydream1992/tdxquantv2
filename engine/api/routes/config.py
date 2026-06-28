"""``/api/config`` 路由 - 配置热加载与策略 YAML 在线编辑。

- ``GET    /api/config``               - 当前配置摘要（不含敏感字段）
- ``POST   /api/config/reload``        - 触发 ``ConfigLoader.reload()``
- ``GET    /api/config/strategies``    - 列出策略 YAML 文件（含原文）
- ``POST   /api/config/strategies``    - 创建/复制策略 YAML 文件
- ``PUT    /api/config/strategies/{id}``  - 在线更新策略 YAML
- ``DELETE /api/config/strategies/{id}``  - 删除策略 YAML 文件
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from engine.api.deps import get_config
from engine.api.schemas import (
    ConfigReloadResponse,
    StrategyConfigFileItem,
    StrategyConfigUpdateRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["config"])


# ----------------------------------------------------------------------------
# 创建策略请求（仅本路由使用，故定义在此）
# ----------------------------------------------------------------------------


_STRATEGY_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_]+$")


class StrategyCreateRequest(BaseModel):
    """创建/复制策略请求。"""

    strategy_id: str = Field(
        ...,
        min_length=2,
        max_length=30,
        description="新策略 ID（英文字母数字下划线，2-30 字符）",
    )
    yaml_content: str = Field(..., description="完整 YAML 内容")
    overwrite: bool = Field(False, description="是否覆盖已存在的文件")


class ConfigSummaryResponse(BaseModel):
    """``GET /api/config`` 配置摘要响应（不含敏感字段）。"""

    app: dict[str, Any] = Field(default_factory=dict)
    server: dict[str, Any] = Field(default_factory=dict)
    paths: dict[str, Any] = Field(default_factory=dict)
    strategies_count: int = 0
    strategies_enabled_count: int = 0
    alert_templates_count: int = 0
    match_strategies_count: int = 0
    channels: list[dict[str, Any]] = Field(default_factory=list)
    config_files: list[str] = Field(default_factory=list)
    last_reload_at: str = ""


@router.get(
    "",
    response_model=ConfigSummaryResponse,
    summary="当前配置摘要（脱敏）",
)
async def get_config_summary(
    cfg: Any = Depends(get_config),
) -> ConfigSummaryResponse:
    """返回当前配置摘要（不返回完整 yaml，避免泄露敏感字段）。

    包含：
    - ``app``: ``app.yaml`` 的 app 段（adapter_mode / log_level 等）
    - ``server``: server 段（host / port）
    - ``paths``: paths 段（duckdb / csv_output 等相对路径）
    - ``strategies_count`` / ``strategies_enabled_count``: 策略总数 / 启用数
    - ``alert_templates_count``: ``config/monitor.yaml`` 中 alert_templates 数量
    - ``match_strategies_count``: ``config/monitor.yaml`` 中 match 数量
    - ``channels``: 各通道的 name + enabled 状态（不含 webhook_url/secret 等）
    - ``config_files``: ConfigLoader 当前加载的 yaml 文件列表
    - ``last_reload_at``: 最近一次 reload 的时间（取最新文件 mtime）
    """
    # ---- app / server / paths ----
    app_seg = {
        "name": cfg.get("app.name", ""),
        "version": cfg.get("app.version", ""),
        "adapter_mode": cfg.get("app.adapter_mode", ""),
        "log_level": cfg.get("app.log_level", ""),
    }
    server_seg = {
        "host": cfg.get("server.host", ""),
        "port": cfg.get("server.port", 0),
    }
    paths_raw = cfg.get("paths", {}) or {}
    # 只保留相对路径，避免泄露绝对路径
    paths_seg = {
        k: v for k, v in paths_raw.items() if isinstance(v, (str, int, bool))
    }

    # ---- 策略 ----
    strategies_map = cfg.get("strategies", {}) or {}
    strategies_count = len(strategies_map)
    strategies_enabled_count = sum(
        1 for s in strategies_map.values()
        if isinstance(s, dict) and bool(s.get("enabled", True))
    )

    # ---- alert_templates / match_strategies ----
    # monitor.yaml 顶层有 alert_templates / dedup / match_strategies / monitor 段，被 ConfigLoader 合并到 _data 顶层
    alert_templates_count = 0
    alert_templates = cfg.get("alert_templates") or {}
    if isinstance(alert_templates, dict):
        alert_templates_count = len(alert_templates)
    elif isinstance(alert_templates, list):
        alert_templates_count = len(alert_templates)

    match_strategies_count = 0
    try:
        from engine.monitor.match_registry import MatchRegistry
        match_strategies_count = len(MatchRegistry.list_all())
    except Exception as exc:  # noqa: BLE001
        logger.debug("取 match_strategies 计数失败: %s", exc)

    # ---- channels ----
    channels_summary: list[dict[str, Any]] = []
    try:
        from engine.channels.registry import get_registry
        for c in get_registry().list_channels():
            channels_summary.append({
                "name": c.get("name", ""),
                "enabled": bool(c.get("enabled", False)),
            })
    except Exception as exc:  # noqa: BLE001
        logger.debug("取 channels 状态失败: %s", exc)

    # ---- config_files + last_reload_at ----
    config_files: list[str] = []
    last_mtime: float = 0.0
    try:
        fm = getattr(cfg, "_file_mtimes", {}) or {}
        for p, m in fm.items():
            config_files.append(p)
            if m and m > last_mtime:
                last_mtime = m
        config_files.sort()
    except Exception:  # noqa: BLE001
        pass
    last_reload_at = ""
    if last_mtime > 0:
        from datetime import datetime
        last_reload_at = datetime.fromtimestamp(last_mtime).astimezone().isoformat(timespec="seconds")

    return ConfigSummaryResponse(
        app=app_seg,
        server=server_seg,
        paths=paths_seg,
        strategies_count=strategies_count,
        strategies_enabled_count=strategies_enabled_count,
        alert_templates_count=alert_templates_count,
        match_strategies_count=match_strategies_count,
        channels=channels_summary,
        config_files=config_files,
        last_reload_at=last_reload_at,
    )


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


@router.post(
    "/strategies",
    response_model=StrategyConfigFileItem,
    summary="创建/复制策略",
)
async def create_strategy(
    req: StrategyCreateRequest,
    cfg: Any = Depends(get_config),
) -> StrategyConfigFileItem:
    """根据 YAML 内容创建新策略文件。

    - ``strategy_id`` 必须是合法文件名（英文字母数字下划线，2-30 字符）
    - 文件路径: ``strategies/strategy_{strategy_id}.yaml``
    - ``overwrite=False`` 时，文件已存在则返回 409
    - 写入后调用 ``cfg.reload()`` 热加载
    """
    # 1. 校验 strategy_id 格式
    sid = (req.strategy_id or "").strip()
    if not sid or not _STRATEGY_ID_PATTERN.match(sid):
        raise HTTPException(
            status_code=400,
            detail="strategy_id 只能包含英文字母、数字与下划线",
        )
    if len(sid) < 2 or len(sid) > 30:
        raise HTTPException(
            status_code=400,
            detail="strategy_id 长度必须在 2-30 字符之间",
        )
    # 禁止使用模板名
    if sid.startswith("_template"):
        raise HTTPException(
            status_code=400,
            detail="strategy_id 不能以 _template 开头",
        )

    # 2. 校验 YAML 合法
    try:
        doc = yaml.safe_load(req.yaml_content) or {}
    except yaml.YAMLError as exc:
        raise HTTPException(
            status_code=400, detail=f"YAML 解析失败: {exc}"
        ) from exc
    if not isinstance(doc, dict):
        raise HTTPException(
            status_code=400, detail="YAML 顶层必须是 mapping"
        )

    # 3. 文件路径与冲突检测
    strategies_dir = _resolve_strategies_dir(cfg)
    try:
        strategies_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"创建策略目录失败: {exc}"
        ) from exc

    target = strategies_dir / f"strategy_{sid}.yaml"
    if target.exists() and not req.overwrite:
        raise HTTPException(
            status_code=409,
            detail=f"策略文件已存在: {target.name}（可设置 overwrite=true 覆盖）",
        )

    # 4. 写入文件
    try:
        target.write_text(req.yaml_content, encoding="utf-8")
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"写入文件失败: {exc}"
        ) from exc

    # 5. 热加载
    try:
        cfg.reload()
    except Exception as exc:  # noqa: BLE001
        logger.warning("创建策略后重载失败: %s", exc)

    return StrategyConfigFileItem(
        strategy_id=sid,
        strategy_name=str(doc.get("strategy_name", "")),
        enabled=bool(doc.get("enabled", True)),
        yaml_path=str(target),
        yaml_content=req.yaml_content,
    )


@router.delete(
    "/strategies/{strategy_id}",
    summary="删除策略",
)
async def delete_strategy(
    strategy_id: str,
    cfg: Any = Depends(get_config),
) -> dict:
    """删除策略 YAML 文件。

    - 不允许删除正在启用的策略（返回 409）
    - 删除后 ``cfg.reload()``
    """
    sid = (strategy_id or "").strip()
    if not sid or not _STRATEGY_ID_PATTERN.match(sid):
        raise HTTPException(
            status_code=400,
            detail="strategy_id 只能包含英文字母、数字与下划线",
        )

    strategies_dir = _resolve_strategies_dir(cfg)
    target = strategies_dir / f"strategy_{sid}.yaml"
    if not target.exists():
        raise HTTPException(
            status_code=404,
            detail=f"策略 YAML 不存在: {target.name}",
        )

    # 不允许删除正在启用的策略
    try:
        sc = cfg.strategy(sid)
        if sc is not None and bool(getattr(sc, "enabled", False)):
            raise HTTPException(
                status_code=409,
                detail=f"策略 {sid} 正在启用中，请先禁用再删除",
            )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("检查策略启用状态失败 %s: %s", sid, exc)

    # 删除文件
    try:
        target.unlink()
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"删除文件失败: {exc}"
        ) from exc

    try:
        cfg.reload()
    except Exception as exc:  # noqa: BLE001
        logger.warning("删除策略后重载失败: %s", exc)

    return {
        "ok": True,
        "strategy_id": sid,
        "deleted": target.name,
        "message": f"策略 {sid} 已删除",
    }


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
