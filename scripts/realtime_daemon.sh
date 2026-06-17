#!/bin/bash
# Realtime Service 守护脚本 - 进程退出后自动重启
# 用法: nohup bash scripts/realtime_daemon.sh > /tmp/realtime_daemon.log 2>&1 &

cd /home/z/my-project/mini-services/realtime-service

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting realtime-service..."
  bun index.ts > /tmp/realtime.log 2>&1
  EXIT_CODE=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] realtime-service exited with code $EXIT_CODE, restarting in 3s..."
  sleep 3
done
