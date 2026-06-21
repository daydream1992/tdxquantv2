#!/bin/bash
# 启动 FastAPI 并完全脱离会话
cd /home/z/my-project
exec /home/z/.venv/bin/python -m uvicorn engine.api.main:app \
    --host 0.0.0.0 --port 8000 --log-level info \
    > /home/z/my-project/data/logs/fastapi.log 2>&1
