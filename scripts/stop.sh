#!/bin/bash
# ====================================================================
# 停止 TdxQuant 全栈服务 (Linux/macOS 版)
#
# 用法:
#   bash scripts/stop.sh
# ====================================================================
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

echo "=============================================="
echo " 停止 TdxQuant 服务"
echo "  ProjectRoot: $PROJECT_ROOT"
echo "=============================================="

STOPPED=0
# 按端口精准停 (避免误杀其他项目)
for PORT in 8000 3000 3003; do
    PID=$(lsof -ti :$PORT 2>/dev/null || ss -tlnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | head -1)
    if [[ -n "$PID" ]]; then
        kill -9 $PID 2>/dev/null
        echo "  [OK] 停止端口 $PORT PID $PID"
        STOPPED=$((STOPPED+1))
    fi
done
# 补充: 按进程名匹配项目目录
for PATTERN in "uvicorn engine.api" "next-server" "realtime-service"; do
    PIDS=$(pgrep -f "$PATTERN" 2>/dev/null | head -10)
    if [[ -n "$PIDS" ]]; then
        for PID in $PIDS; do
            kill -9 $PID 2>/dev/null
            echo "  [OK] 停止 PID $PID ($PATTERN)"
            STOPPED=$((STOPPED+1))
        done
    fi
done

echo "=============================================="
echo " 停止 $STOPPED 个进程"
echo "=============================================="
