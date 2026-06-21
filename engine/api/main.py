"""TdxQuant FastAPI 引擎主入口。

启动
----
``uvicorn engine.api.main:app --host 0.0.0.0 --port 8000``
或 ``python scripts/start_engine.py``（带 reload）。

CORS
----
允许所有源跨域（前端通过 ``XTransformPort=8000`` 转发到本端口）。

生命周期
--------
``startup`` 事件中初始化 DuckDB / 适配器 / SectorManager（全部单例），
并启动 ``ConfigLoader`` 的 mtime 监听器；``shutdown`` 时优雅关闭。
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from engine.api import state as engine_state_mod
from engine.api.routes import (
    backtest as backtest_routes,
    channels as channels_routes,
    config as config_routes,
    match_strategy as match_strategy_routes,
    monitor as monitor_routes,
    sectors as sectors_routes,
    search as search_routes,
    selection as selection_routes,
    signals as signals_routes,
    strategies as strategies_routes,
    theme as theme_routes,
    watchlist as watchlist_routes,
)

logger = logging.getLogger(__name__)


# ============================================================================
# 生命周期
# ============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """FastAPI 生命周期：启动 / 关闭钩子。"""
    state = engine_state_mod.get_engine_state()
    state.heartbeat()
    logger.info("TdxQuant FastAPI 启动中...")

    # 1. ConfigLoader 单例（含首次 reload）
    try:
        from engine.config.loader import ConfigLoader

        cfg = ConfigLoader()
        logger.info(
            "ConfigLoader 已就绪: %s",
            f"adapter_mode={cfg.get('app.adapter_mode')}, "
            f"strategies={len(cfg.get('strategies', {}) or {})}",
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("ConfigLoader 初始化失败: %s", exc)

    # 2. DuckDBStore 单例（自动 init_db）
    try:
        from engine.storage.duckdb_store import DuckDBStore

        store = DuckDBStore()
        tables = store.list_tables()
        logger.info("DuckDBStore 已就绪: tables=%s", tables)
    except Exception as exc:  # noqa: BLE001
        logger.exception("DuckDBStore 初始化失败: %s", exc)

    # 3. 数据适配器（Mock / Real）
    try:
        from engine.data_adapter.factory import get_adapter

        adapter = get_adapter()
        logger.info("数据适配器已就绪: %r", adapter)
    except Exception as exc:  # noqa: BLE001
        logger.exception("数据适配器初始化失败: %s", exc)

    # 4. 配置文件 mtime 监听器（2s 间隔）
    try:
        cfg = ConfigLoader()  # type: ignore[name-defined]
        if hasattr(cfg, "start_watcher"):
            cfg.start_watcher()
            logger.info("ConfigLoader watcher 已启动")
    except Exception as exc:  # noqa: BLE001
        logger.warning("ConfigLoader watcher 启动失败: %s", exc)

    # 5. ★ MonitorEngine 启动（PLAN §9，daemon 线程，异常不阻断主流程）
    # ★ 先从 DuckDB monitor_subscriptions 表冷启动加载 active=true 订阅到 EngineState
    #   内存，否则重启后所有 strategy_id 绑定丢失（bug R9-3 #1）
    try:
        from engine.storage.duckdb_store import DuckDBStore

        store = DuckDBStore()
        if store.table_exists("monitor_subscriptions"):
            df = store.query(
                "SELECT strategy_id, stock_code, subscriber, batch_no "
                "FROM monitor_subscriptions WHERE active = true"
            )
            n = 0
            for _, row in df.iterrows():
                code = str(row.get("stock_code") or "").strip()
                if not code:
                    continue
                state.upsert_subscription(
                    code,
                    strategy_id=str(row.get("strategy_id") or ""),
                    subscriber=str(row.get("subscriber") or "engine"),
                    batch_no=int(row.get("batch_no") or 0),
                )
                n += 1
            logger.info("冷启动: 从 monitor_subscriptions 加载 %d 条 active 订阅", n)
    except Exception as exc:  # noqa: BLE001
        logger.warning("冷启动加载 monitor_subscriptions 失败（不阻断）: %s", exc)

    monitor_engine = None
    try:
        from engine.monitor import MonitorEngine

        monitor_engine = MonitorEngine()
        monitor_engine.start()
    except Exception as exc:  # noqa: BLE001
        logger.warning("MonitorEngine 启动失败（不阻断主流程）: %s", exc)

    state.heartbeat()
    logger.info("TdxQuant FastAPI 已启动，监听 :%s", _get_port())

    yield

    # 关闭
    logger.info("TdxQuant FastAPI 关闭中...")

    # ★ MonitorEngine 停止
    try:
        if monitor_engine is not None:
            monitor_engine.stop()
    except Exception as exc:  # noqa: BLE001
        logger.warning("MonitorEngine 停止失败: %s", exc)

    try:
        from engine.config.loader import ConfigLoader

        cfg = ConfigLoader()
        if hasattr(cfg, "stop_watcher"):
            cfg.stop_watcher()
    except Exception:  # noqa: BLE001
        pass

    try:
        from engine.data_adapter.factory import reset_adapter

        reset_adapter()
    except Exception:  # noqa: BLE001
        pass

    logger.info("TdxQuant FastAPI 已关闭")


# ============================================================================
# 应用工厂
# ============================================================================


def create_app() -> FastAPI:
    """构造 FastAPI 应用实例。

    分离工厂函数便于测试（``TestClient(create_app())``）与多实例部署。
    """
    app = FastAPI(
        title="TdxQuant Engine",
        version="1.0.0",
        description=(
            "通达信量化交易系统 FastAPI 服务层。"
            "对内对接 P1-3/P1-4 的 ConfigLoader / DuckDB / Adapter / Runner，"
            "对外与 Next.js 前端 ``src/app/api/*`` 一一对应。"
        ),
        lifespan=lifespan,
    )

    # CORS：允许所有源（前端通过 XTransformPort 转发）
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    # 请求日志中间件
    @app.middleware("http")
    async def _log_requests(request: Request, call_next):
        start = time.time()
        # 跳过健康检查的日志
        path = request.url.path
        try:
            response = await call_next(request)
        except Exception as exc:  # noqa: BLE001
            duration = (time.time() - start) * 1000
            logger.warning(
                "REQ %s %s 500 %.1fms ERR=%s",
                request.method, path, duration, exc,
            )
            return JSONResponse(
                status_code=500,
                content={"error": "internal_server_error", "detail": str(exc)},
            )
        duration = (time.time() - start) * 1000
        # 仅记录非 2xx 或慢请求（>500ms）的详细日志
        if response.status_code >= 400 or duration > 500:
            logger.info(
                "REQ %s %s %d %.1fms",
                request.method, path, response.status_code, duration,
            )
        else:
            logger.debug(
                "REQ %s %s %d %.1fms",
                request.method, path, response.status_code, duration,
            )
        return response

    # 健康检查
    @app.get("/health", tags=["health"], summary="健康检查")
    async def _health() -> dict[str, Any]:
        state = engine_state_mod.get_engine_state()
        return {
            "status": "ok",
            "uptime_seconds": state.uptime_seconds(),
            "last_hb": state.last_hb,
        }

    @app.get("/", tags=["root"], summary="根路径")
    async def _root() -> dict[str, str]:
        return {
            "name": "TdxQuant Engine",
            "version": "1.0.0",
            "docs": "/docs",
            "openapi": "/openapi.json",
            "health": "/health",
        }

    # 注册路由（与前端 src/app/api/* 一一对应）
    app.include_router(strategies_routes.router, prefix="/api/strategies")
    app.include_router(selection_routes.router, prefix="/api/selections")
    app.include_router(monitor_routes.router, prefix="/api/monitor")
    app.include_router(
        match_strategy_routes.router, prefix="/api/monitor/match-strategies"
    )
    app.include_router(watchlist_routes.router, prefix="/api/monitor/watchlist")
    app.include_router(sectors_routes.router, prefix="/api/sectors")
    app.include_router(signals_routes.router, prefix="/api/signals")
    app.include_router(config_routes.router, prefix="/api/config")
    app.include_router(theme_routes.router, prefix="/api/theme")
    app.include_router(channels_routes.router, prefix="/api/channels")
    app.include_router(backtest_routes.router, prefix="/api/backtest")
    app.include_router(search_routes.router, prefix="/api/search")

    return app


# ============================================================================
# 模块级单例（uvicorn "engine.api.main:app" 入口）
# ============================================================================


app = create_app()


def _get_port() -> int:
    """从 ConfigLoader 读端口，失败回退 8000。"""
    try:
        from engine.config.loader import ConfigLoader

        return int(ConfigLoader().get("server.port", 8000))
    except Exception:  # noqa: BLE001
        return 8000


if __name__ == "__main__":
    import uvicorn

    port = _get_port()
    uvicorn.run("engine.api.main:app", host="0.0.0.0", port=port, reload=False)
