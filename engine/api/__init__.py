"""TdxQuant FastAPI 服务层。

对内：基于 P1-3/P1-4 已实现的 ``ConfigLoader`` / ``DuckDBStore`` /
``BaseDataAdapter`` / ``SectorManager`` / ``StrategyRunner`` 暴露 REST API。

对外：与前端 ``src/app/api/*`` 路由一一对应（端口 8000，通过
``XTransformPort=8000`` 转发）。

子模块：
- ``main``     - FastAPI 应用入口
- ``deps``     - Depends 工具（注入 config/adapter/storage/runner）
- ``schemas``  - Pydantic 请求/响应模型
- ``state``    - 引擎运行时状态（启动时间 / 信号计数 / 心跳）
- ``routes``   - 7 个路由模块（strategies/selection/monitor/sectors/signals/config/theme）
"""

from __future__ import annotations

__all__ = ["app", "create_app"]


def create_app():
    """工厂函数：创建 FastAPI 应用实例。

    延迟导入 ``main`` 以避免循环依赖（main 自身 import 本包）。
    """
    from engine.api.main import create_app as _create

    return _create()


def _get_app():
    """模块属性 ``app`` 的懒加载入口（uvicorn ``engine.api.main:app`` 直接可用）。"""
    from engine.api.main import app as _app

    return _app
