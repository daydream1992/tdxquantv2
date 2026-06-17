#!/usr/bin/env python3
"""启动 TdxQuant FastAPI 引擎。

用法
----
    python scripts/start_engine.py            # 默认配置（host=0.0.0.0, port=8000）
    python scripts/start_engine.py --reload   # 开发模式（自动重载）
    python scripts/start_engine.py --port 9000

端口/主机来自 ``config/app.yaml`` 的 ``server.host`` / ``server.port``，
命令行参数可覆盖。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# 让脚本独立运行时也能 import engine.* 包
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(description="启动 TdxQuant FastAPI 引擎")
    parser.add_argument("--host", default=None, help="监听地址（默认 config/server.host）")
    parser.add_argument("--port", type=int, default=None, help="监听端口（默认 config/server.port）")
    parser.add_argument("--reload", action="store_true", help="开发模式：文件变更自动重载")
    parser.add_argument("--log-level", default=None, help="日志级别（debug/info/warning/error）")
    args = parser.parse_args()

    # 配置优先级：命令行 > config/app.yaml > 默认
    try:
        from engine.config.loader import ConfigLoader

        cfg = ConfigLoader()
        host = args.host or cfg.get("server.host", "0.0.0.0")
        port = args.port or int(cfg.get("server.port", 8000))
        log_level = args.log_level or cfg.get("app.log_level", "INFO").lower()
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] 读取配置失败，使用默认值: {exc}", file=sys.stderr)
        host = args.host or "0.0.0.0"
        port = args.port or 8000
        log_level = args.log_level or "info"

    # 初始化日志（与引擎共用同一份配置）
    try:
        from engine.utils.logger import setup_logging

        setup_logging(level=log_level.upper())
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] 初始化日志失败: {exc}", file=sys.stderr)

    print(f"启动 TdxQuant 引擎: http://{host}:{port}")
    print(f"  API 文档: http://{host}:{port}/docs")
    print(f"  健康检查: http://{host}:{port}/health")
    print(f"  reload={args.reload}, log_level={log_level}")

    try:
        import uvicorn
    except ImportError as exc:
        print(f"[ERROR] uvicorn 未安装: {exc}", file=sys.stderr)
        print("请运行: pip install 'uvicorn[standard]'", file=sys.stderr)
        sys.exit(1)

    uvicorn.run(
        "engine.api.main:app",
        host=host,
        port=port,
        reload=args.reload,
        log_level=log_level,
    )


if __name__ == "__main__":
    main()
