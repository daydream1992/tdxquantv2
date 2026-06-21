#!/bin/bash
# TdxQuant 服务守护脚本 - 持续保持 FastAPI + Next.js 运行
# Windows 版见 daemon.ps1
cd "$(dirname "$0")/.."
mkdir -p data/logs

while true; do
  # 检查 FastAPI
  if ! pgrep -f "uvicorn engine.api" > /dev/null; then
    echo "[$(date +%H:%M:%S)] 启动 FastAPI"
    python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --log-level warning >> data/logs/fastapi.log 2>&1 &
    sleep 3
  fi
  # 检查 Next.js
  if ! pgrep -f "next-server" > /dev/null; then
    echo "[$(date +%H:%M:%S)] 启动 Next.js"
    ./node_modules/.bin/next dev -H 127.0.0.1 -p 3000 >> dev.log 2>&1 &
    sleep 5
  fi
  sleep 5
done
