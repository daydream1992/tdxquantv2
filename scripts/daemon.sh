#!/bin/bash
# TdxQuant 服务守护脚本 - 持续保持 FastAPI + Next.js 运行
cd /home/z/my-project

while true; do
  # 检查 FastAPI
  if ! pgrep -f "uvicorn engine.api" > /dev/null; then
    echo "[$(date +%H:%M:%S)] 启动 FastAPI"
    /home/z/.venv/bin/python3 -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --log-level warning >> /tmp/fastapi.log 2>&1 &
    sleep 3
  fi
  # 检查 Next.js
  if ! pgrep -f "next-server" > /dev/null; then
    echo "[$(date +%H:%M:%S)] 启动 Next.js"
    ./node_modules/.bin/next dev -H 127.0.0.1 -p 3000 >> /home/z/my-project/dev.log 2>&1 &
    sleep 5
  fi
  sleep 5
done
