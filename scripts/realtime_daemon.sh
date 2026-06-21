#!/bin/bash
# Realtime Service 守护脚本 - 进程退出后自动重启
# 注意: mini-services/realtime-service 当前为空, 此脚本为模板/备用
# 用法: nohup bash scripts/realtime_daemon.sh > data/logs/realtime_daemon.log 2>&1 &

cd "$(dirname "$0")/../mini-services/realtime-service" 2>/dev/null || {
  echo "[ERROR] mini-services/realtime-service 不存在" >&2
  exit 1
}
mkdir -p ../data/logs

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting realtime-service..."
  bun index.ts > ../data/logs/realtime.log 2>&1
  EXIT_CODE=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] realtime-service exited with code $EXIT_CODE, restarting in 3s..."
  sleep 3
done
