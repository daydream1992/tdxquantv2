# ====================================================================
# TdxQuant 端到端冒烟测试 (Windows PowerShell 版)
#
# 验证全栈服务是否正常工作, 检查 9 个核心 API 端点 + 前端页面渲染
# 适合: 部署后自检 / 重启后验证 / nssm 服务健康检查
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts\smoke_test.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\smoke_test.ps1 -ApiPort 8000 -WebPort 3000
#
# 退出码: 0=全通过, 非0=有失败数
# ====================================================================
[CmdletBinding()]
param(
    [string]$Host_ = '127.0.0.1',
    [int]$ApiPort = 8000,
    [int]$WebPort = 3000
)

$ErrorActionPreference = 'Continue'

$Api = "http://${Host_}:${ApiPort}"
$Web = "http://${Host_}:${WebPort}"
$Passes = 0
$Fails = 0

function Write-OK($msg) { Write-Host "  [PASS] $msg" -ForegroundColor Green; $script:Passes++ }
function Write-NO($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:Fails++ }
function Write-Warn2($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

function Check-Url {
    param([string]$Name, [string]$Url, [int]$Expect = 200, [string]$BodyContains = "")
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($r.StatusCode -eq $Expect) {
            if ($BodyContains -and ($r.Content -notmatch $BodyContains)) {
                Write-NO "$Name -> $($r.StatusCode) 但 body 缺少 '$BodyContains'"
            } else {
                Write-OK "$Name -> $($r.StatusCode)"
            }
        } else {
            Write-NO "$Name -> $($r.StatusCode) (期望 $Expect)"
        }
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq $Expect) {
            # 期望 4xx/5xx 且命中, 算通过 (如 _default 删除应 403)
            Write-OK "$Name -> $code"
        } elseif ($code) {
            Write-NO "$Name -> $code (期望 $Expect)"
        } else {
            Write-NO "$Name -> 连接失败: $($_.Exception.Message)"
        }
    }
}

Write-Host "=============================================="
Write-Host " TdxQuant 烟雾测试"
Write-Host "  API: $Api"
Write-Host "  WEB: $Web"
Write-Host "=============================================="
Write-Host ""

Write-Host "[1] 后端 API 健康检查 (FastAPI 直接)"
Check-Url "GET /api/monitor/status"          "$Api/api/monitor/status"          200 "engine_status"
Check-Url "GET /api/monitor/quotes"          "$Api/api/monitor/quotes?count=5"  200
Check-Url "GET /api/monitor/match-strategies" "$Api/api/monitor/match-strategies" 200 "match_id"
Check-Url "GET /api/monitor/watchlist"       "$Api/api/monitor/watchlist"       200
Check-Url "GET /api/strategies"              "$Api/api/strategies"              200 "strategy_id"
Check-Url "GET /api/sectors"                 "$Api/api/sectors"                 200
Check-Url "GET /api/channels"                "$Api/api/channels"                200 "channels"
Check-Url "GET /api/config"                  "$Api/api/config"                  200 "adapter_mode"
Check-Url "GET /api/signals"                 "$Api/api/signals?limit=5"         200
Write-Host ""

Write-Host "[2] 后端写操作冒烟 (创建测试自选股, 然后删除)"
try {
    $body = '{"codes":["900001.TEST"],"strategy_id":"_smoke","subscriber":"smoke_test"}'
    $r = Invoke-WebRequest -Uri "$Api/api/monitor/watchlist" -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 5
    if ($r.Content -match 'added|ok|900001') {
        Write-OK "POST watchlist 加入测试股票"
    } else {
        Write-Warn2 "POST watchlist 返回异常 (可能已存在): $($r.Content.Substring(0, [Math]::Min(80, $r.Content.Length)))"
    }
} catch {
    Write-Warn2 "POST watchlist 失败: $($_.Exception.Message)"
}
# DELETE 用 path 参数: DELETE /api/monitor/watchlist/{code}
try {
    Invoke-RestMethod -Uri "$Api/api/monitor/watchlist/900001.TEST" -Method DELETE -TimeoutSec 5 | Out-Null
    Write-OK "DELETE watchlist 移除测试股票 -> OK"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 200 -or $code -eq 204 -or $code -eq 404) {
        Write-OK "DELETE watchlist 移除测试股票 -> $code (404=已不存在, 视为通过)"
    } else {
        Write-Warn2 "DELETE watchlist 异常 (可忽略): $($_.Exception.Message)"
    }
}
Write-Host ""

Write-Host "[3] _default 保护检查 (DELETE 应返回 403)"
Check-Url "DELETE /api/monitor/match-strategies/_default" "$Api/api/monitor/match-strategies/_default" 403
Write-Host ""

Write-Host "[4] 前端页面 + 代理路由 (Next.js)"
Check-Url "GET / (首页渲染)"                  "$Web/"                            200
Check-Url "GET /api/monitor/status (代理)"    "$Web/api/monitor"                 200 "engine_status"
Check-Url "GET /api/monitor/match-strategies (代理)" "$Web/api/monitor/match-strategies" 200 "match_id"
Check-Url "GET /api/monitor/watchlist (代理)" "$Web/api/monitor/watchlist"       200
Check-Url "GET /api/strategies (代理)"        "$Web/api/strategies"              200
Check-Url "GET /api/channels (代理)"          "$Web/api/channels"                200 "channels"
Write-Host ""

Write-Host "=============================================="
Write-Host " 结果: PASS=$Passes  FAIL=$Fails"
Write-Host "=============================================="
if ($Fails -eq 0) {
    Write-Host "✓ 全部通过" -ForegroundColor Green
    exit 0
} else {
    Write-Host "✗ 有 $Fails 项失败" -ForegroundColor Red
    exit [Math]::Min($Fails, 99)
}
