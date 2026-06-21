# PowerShell 启动 TdxQuant 全栈服务 (Windows 版, 功能等价于 start_all.sh)
# 用法: powershell -ExecutionPolicy Bypass -File scripts\start_all.ps1
# 2 个进程: FastAPI(8000) + Next.js(3000)

$ErrorActionPreference = 'Continue'

# 项目根目录 = 脚本所在目录的上一级
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $ProjectRoot

# 确保日志目录存在
$LogDir = Join-Path $ProjectRoot 'data\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 1. 停旧进程: 匹配项目目录下的 python/node/bun 进程
#    用 Get-CimInstance 而不是 Get-Process, 因为前者带 CommandLine
Write-Host "[1/3] 停旧进程 ..."
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
Write-Host "[2/3] 启动 FastAPI (port 8000) ..."
$FastApiLog = Join-Path $LogDir 'fastapi.log'
$FastApiErr = Join-Path $LogDir 'fastapi.err.log'
Start-Process -FilePath "python" `
    -ArgumentList "-m","uvicorn","engine.api.main:app","--host","0.0.0.0","--port","8000","--log-level","warning" `
    -NoNewWindow `
    -RedirectStandardOutput $FastApiLog `
    -RedirectStandardError  $FastApiErr

# 3. 启动 Next.js (端口 3000)
Write-Host "[3/3] 启动 Next.js (port 3000) ..."
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
            Write-Host "Next.js ready ($($i*2)s)"
            $Ready = $true
            break
        }
    } catch {
        # 还没起来, 继续等
    }
}
if (-not $Ready) { Write-Host "[WARN] Next.js 40s 内未就绪, 请检查 dev.log / dev.err.log" }

# FastAPI 健康检查
try {
    $h = Invoke-WebRequest -Uri 'http://localhost:8000/health' -UseBasicParsing -TimeoutSec 2
    Write-Host "FastAPI health: $($h.StatusCode)"
} catch {
    Write-Host "FastAPI health: FAIL ($($_.Exception.Message))"
}

Write-Host "Done. Logs:"
Write-Host "  FastAPI: $FastApiLog / $FastApiErr"
Write-Host "  Next.js : $NextLog / $NextErr"
