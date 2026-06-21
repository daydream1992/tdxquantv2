# PowerShell 启动 TdxQuant 全栈服务 (Windows 版, 功能等价于 start_all.sh)
# 用法: powershell -ExecutionPolicy Bypass -File scripts\start_all.ps1
# 2 个进程: FastAPI(8000) + Next.js(3000)
#
# 增强功能 (R10-4):
#   - 自动探测 python / python3
#   - 启动后自动跑 smoke_test.ps1 验证
#   - 失败时打印日志路径方便排查

$ErrorActionPreference = 'Continue'

# 项目根目录 = 脚本所在目录的上一级
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $ProjectRoot

# 确保日志目录存在
$LogDir = Join-Path $ProjectRoot 'data\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 探测 python 可执行文件
$Python = $null
foreach ($c in @('python','python3','py')) {
    if (Get-Command $c -ErrorAction SilentlyContinue) {
        $Python = $c
        break
    }
}
if (-not $Python) {
    Write-Host "[ERROR] 未找到 python / python3 / py, 请先安装 Python 3.10+" -ForegroundColor Red
    exit 1
}
Write-Host "[0/4] 使用 Python: $Python ($(& $Python --version 2>&1))"

# 探测 bun
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] 未找到 bun, 请先安装: https://bun.sh" -ForegroundColor Red
    exit 1
}

# 1. 停旧进程: 匹配项目目录下的 python/node/bun 进程
Write-Host "[1/4] 停旧进程 ..."
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match 'python|node|bun|uvicorn|next-server' -and
        $_.CommandLine -match ([regex]::Escape($ProjectRoot))
    } |
    ForEach-Object {
        Write-Host "  停止 PID $($_.ProcessId) ($($_.Name))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Start-Sleep -Seconds 2

# 2. 启动 FastAPI (端口 8000)
Write-Host "[2/4] 启动 FastAPI (port 8000) ..."
$FastApiLog = Join-Path $LogDir 'fastapi.log'
$FastApiErr = Join-Path $LogDir 'fastapi.err.log'
Start-Process -FilePath $Python `
    -ArgumentList "-m","uvicorn","engine.api.main:app","--host","0.0.0.0","--port","8000","--log-level","warning" `
    -NoNewWindow `
    -RedirectStandardOutput $FastApiLog `
    -RedirectStandardError  $FastApiErr

# 3. 启动 Next.js (端口 3000)
Write-Host "[3/4] 启动 Next.js (port 3000) ..."
$NextLog = Join-Path $ProjectRoot 'dev.log'
$NextErr = Join-Path $ProjectRoot 'dev.err.log'
Start-Process -FilePath "bun" `
    -ArgumentList "run","dev" `
    -NoNewWindow `
    -RedirectStandardOutput $NextLog `
    -RedirectStandardError  $NextErr

# 等待 Next.js 就绪 (最多 40 秒 = 20 次 * 2 秒)
$Ready = $false
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) {
            Write-Host "  Next.js ready ($($i*2)s)" -ForegroundColor Green
            $Ready = $true
            break
        }
    } catch {
        # 还没起来, 继续等
    }
}
if (-not $Ready) {
    Write-Host "  [WARN] Next.js 40s 内未就绪" -ForegroundColor Yellow
    Write-Host "  请检查: $NextLog / $NextErr" -ForegroundColor Yellow
}

# FastAPI 健康检查
$ApiReady = $false
for ($i = 1; $i -le 10; $i++) {
    try {
        $h = Invoke-WebRequest -Uri 'http://localhost:8000/api/monitor/status' -UseBasicParsing -TimeoutSec 2
        if ($h.StatusCode -eq 200) {
            Write-Host "  FastAPI ready ($($i*2)s)" -ForegroundColor Green
            $ApiReady = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $ApiReady) {
    Write-Host "  [WARN] FastAPI 20s 内未就绪" -ForegroundColor Yellow
    Write-Host "  请检查: $FastApiLog / $FastApiErr" -ForegroundColor Yellow
}

# 4. 自动 smoke test (如果 FastAPI 和 Next.js 都就绪)
Write-Host "[4/4] 端到端冒烟测试 ..."
if ($ApiReady -and $Ready) {
    $SmokeScript = Join-Path $PSScriptRoot 'smoke_test.ps1'
    if (Test-Path $SmokeScript) {
        & $SmokeScript
    } else {
        Write-Host "  smoke_test.ps1 不存在, 跳过" -ForegroundColor Yellow
    }
} else {
    Write-Host "  服务未就绪, 跳过 smoke test" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Logs:"
Write-Host "  FastAPI: $FastApiLog / $FastApiErr"
Write-Host "  Next.js : $NextLog / $NextErr"
Write-Host ""
Write-Host "停止服务: powershell -File scripts\stop.ps1"
