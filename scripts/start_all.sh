#!/bin/bash
# 启动 TdxQuant 全栈服务
# 2 个进程: FastAPI(8000) + Next.js(3000, 内置 SSE 实时流)
cd /home/z/my-project
pkill -9 -f "next-server" 2>/dev/null
pkill -9 -f "bun run" 2>/dev/null
pkill -9 -f "uvicorn" 2>/dev/null
pkill -9 -f "realtime-service" 2>/dev/null
sleep 2
# 1. 启动 FastAPI
setsid /home/z/.venv/bin/python3 -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --log-level warning > /tmp/fastapi.log 2>&1 < /dev/null &
disown
echo "FastAPI started (port 8000)"
# 2. 启动 Next.js (内置 SSE /api/realtime/stream)
#    绑定 127.0.0.1 避免 IPv6/IPv4 切换导致 agent-browser 连接中断
setsid ./node_modules/.bin/next dev -H 127.0.0.1 -p 3000 > /home/z/my-project/dev.log 2>&1 < /dev/null &
disown
echo "Next.js started (port 3000, bound to 127.0.0.1)"
# 等待就绪
for i in $(seq 1 20); do
  sleep 1
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null)
  [ "$CODE" = "200" ] && { echo "Next.js ready (${i}s)"; break; }
done
FAPI=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health 2>/dev/null)
echo "FastAPI health: $FAPI"
echo "Next.js: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)"

