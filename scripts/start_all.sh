#!/bin/bash
# 启动 TdxQuant 全栈服务
cd /home/z/my-project
pkill -9 -f "next-server" 2>/dev/null
pkill -9 -f "bun run" 2>/dev/null
pkill -9 -f "uvicorn" 2>/dev/null
sleep 2
# 启动 FastAPI
setsid /home/z/.venv/bin/python3 -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --log-level warning > /tmp/fastapi.log 2>&1 < /dev/null &
disown
echo "FastAPI started"
# 启动 Next.js
setsid bun run dev > /home/z/my-project/dev.log 2>&1 < /dev/null &
disown
echo "Next.js started"
# 等待就绪
for i in $(seq 1 20); do
  sleep 1
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null)
  [ "$CODE" = "200" ] && { echo "Next.js ready (${i}s)"; break; }
done
FAPI=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health 2>/dev/null)
echo "FastAPI health: $FAPI"
echo "Next.js: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)"
