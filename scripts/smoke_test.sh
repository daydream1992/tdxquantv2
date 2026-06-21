#!/bin/bash
# ====================================================================
# TdxQuant 端到端冒烟测试 (Linux/macOS 版)
#
# 验证全栈服务是否正常工作, 检查 9 个核心 API 端点 + 前端页面渲染
# 适合: 部署后自检 / CI 流水线 / 重启后验证
#
# 用法:
#   bash scripts/smoke_test.sh
#   bash scripts/smoke_test.sh --host 127.0.0.1 --api-port 8000 --web-port 3000
#
# 退出码: 0=全通过, 非0=有失败 (失败数=退出码, 上限 99)
# ====================================================================
set -uo pipefail

HOST="127.0.0.1"
API_PORT=8000
WEB_PORT=3000
FAILS=0
PASSES=0

# 解析参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2;;
    --api-port) API_PORT="$2"; shift 2;;
    --web-port) WEB_PORT="$2"; shift 2;;
    *) echo "未知参数: $1"; exit 1;;
  esac
done

API="http://${HOST}:${API_PORT}"
WEB="http://${HOST}:${WEB_PORT}"

color_ok() { printf "\033[32m%s\033[0m\n" "$1"; }
color_no() { printf "\033[31m%s\033[0m\n" "$1"; }
color_warn() { printf "\033[33m%s\033[0m\n" "$1"; }

# check [name] [url] [expected_status] [optional: jq expression for body check]
check() {
  local name="$1" url="$2" expect="${3:-200}" body_check="${4:-}"
  local code
  code=$(curl -s -m 5 -o /tmp/smoke_body -w "%{http_code}" "$url" 2>/dev/null)
  [[ -z "$code" ]] && code="000"
  if [[ "$code" == "$expect" ]]; then
    if [[ -n "$body_check" ]]; then
      if grep -q "$body_check" /tmp/smoke_body 2>/dev/null; then
        color_ok "  [PASS] $name -> $code"
        PASSES=$((PASSES+1))
      else
        color_no "  [FAIL] $name -> $code 但 body 缺少 '$body_check'"
        FAILS=$((FAILS+1))
      fi
    else
      color_ok "  [PASS] $name -> $code"
      PASSES=$((PASSES+1))
    fi
  else
    color_no "  [FAIL] $name -> $code (期望 $expect)"
    FAILS=$((FAILS+1))
  fi
}

echo "=============================================="
echo " TdxQuant 烟雾测试"
echo "  API: $API"
echo "  WEB: $WEB"
echo "=============================================="
echo ""

echo "[1] 后端 API 健康检查 (FastAPI 直接)"
check "GET /api/monitor/status"          "$API/api/monitor/status"          200 "engine_status"
check "GET /api/monitor/quotes"          "$API/api/monitor/quotes?count=5"  200
check "GET /api/monitor/match-strategies" "$API/api/monitor/match-strategies" 200 "match_id"
check "GET /api/monitor/watchlist"       "$API/api/monitor/watchlist"       200
check "GET /api/strategies"              "$API/api/strategies"              200 "strategy_id"
check "GET /api/sectors"                 "$API/api/sectors"                 200
check "GET /api/channels"                "$API/api/channels"                200 "channels"
check "GET /api/config"                  "$API/api/config"                  200 "adapter_mode"
check "GET /api/signals"                 "$API/api/signals?limit=5"         200
echo ""

echo "[2] 后端写操作冒烟 (创建测试自选股, 然后删除)"
# 加入一只测试股票
ADD_CODE=$(curl -s -m 5 -X POST "$API/api/monitor/watchlist" \
  -H "Content-Type: application/json" \
  -d '{"codes":["900001.TEST"],"strategy_id":"_smoke","subscriber":"smoke_test"}' 2>/dev/null)
if echo "$ADD_CODE" | grep -q "added\|ok\|900001" 2>/dev/null; then
  color_ok "  [PASS] POST watchlist 加入测试股票"
  PASSES=$((PASSES+1))
else
  color_warn "  [WARN] POST watchlist 返回异常 (可能已存在): $(echo "$ADD_CODE" | head -c 80)"
fi
# 删除测试股票 (后端用 path 参数: DELETE /api/monitor/watchlist/{code})
DEL_CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -X DELETE "$API/api/monitor/watchlist/900001.TEST" 2>/dev/null)
[[ -z "$DEL_CODE" ]] && DEL_CODE="000"
if [[ "$DEL_CODE" == "200" || "$DEL_CODE" == "204" ]]; then
  color_ok "  [PASS] DELETE watchlist 移除测试股票 -> $DEL_CODE"
  PASSES=$((PASSES+1))
else
  color_no "  [FAIL] DELETE watchlist -> $DEL_CODE"
  FAILS=$((FAILS+1))
fi
echo ""

echo "[3] _default 保护检查 (DELETE 应返回 403)"
DEL_CODE=$(curl -s -m 5 -o /tmp/smoke_body -w "%{http_code}" -X DELETE "$API/api/monitor/match-strategies/_default" 2>/dev/null)
if [[ "$DEL_CODE" == "403" ]]; then
  color_ok "  [PASS] DELETE /api/monitor/match-strategies/_default -> 403"
  PASSES=$((PASSES+1))
else
  color_no "  [FAIL] DELETE /api/monitor/match-strategies/_default -> $DEL_CODE (期望 403)"
  FAILS=$((FAILS+1))
fi
echo ""

echo "[4] 前端页面 + 代理路由 (Next.js)"
check "GET / (首页渲染)"                  "$WEB/"                            200
check "GET /api/monitor/status (代理)"    "$WEB/api/monitor"                 200 "engine_status"
check "GET /api/monitor/match-strategies (代理)" "$WEB/api/monitor/match-strategies" 200 "match_id"
check "GET /api/monitor/watchlist (代理)" "$WEB/api/monitor/watchlist"       200
check "GET /api/strategies (代理)"        "$WEB/api/strategies"              200
check "GET /api/channels (代理)"          "$WEB/api/channels"                200 "channels"
echo ""

echo "=============================================="
echo " 结果: PASS=$PASSES  FAIL=$FAILS"
echo "=============================================="
if [[ $FAILS -eq 0 ]]; then
  color_ok "✓ 全部通过"
  exit 0
else
  color_no "✗ 有 $FAILS 项失败"
  exit $((FAILS < 99 ? FAILS : 99))
fi
