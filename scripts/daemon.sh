#!/bin/bash
# TdxQuant 服务守护脚本 - 持续保持 FastAPI + Next.js 运行
# 用法: nohup bash scripts/daemon.sh > /tmp/daemon.log 2>&1 &

cd /home/z/my-project

while true; do
  # 检查 FastAPI
  if ! pgrep -f "uvicorn engine.api" > /dev/null; then
    echo "[$(date +%H:%M:%S)] 启动 FastAPI"
    /home/z/.venv/bin/python3 -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --log-level warning >> /tmp/fastapi.log 2>&1 &
    echo $! > /tmp/fastapi.pid
    sleep 3
  fi
  # 检查 Next.js
  if ! pgrep -f "next-server" > /dev/null; then
    echo "[$(date +%H:%M:%S)] 启动 Next.js"
    bun run dev >> /home/z/my-project/dev.log 2>&1 &
    echo $! > /tmp/next.pid
    sleep 5
  fi
  sleep 10
done
