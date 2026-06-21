# PowerShell TdxQuant 服务守护脚本 (Windows 版, 功能等价于 daemon.sh)
# 5 秒轮询, 若 FastAPI / Next.js 进程消失则自动重启
# 用法:
#   前台运行: powershell -ExecutionPolicy Bypass -File scripts\daemon.ps1
#   后台运行: Start-Process powershell -ArgumentList "-ExecutionPolicy","Bypass","-File","scripts\daemon.ps1" -WindowStyle Hidden
# 退出: Ctrl+C (子进程会继续运行, 需用 start_all.ps1 或 stop.ps1 单独停止)

$ErrorActionPreference = 'Continue'

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $ProjectRoot

# 确保日志目录存在
$LogDir = Join-Path $ProjectRoot 'data\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Start-FastApi {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 启动 FastAPI"
    $log = Join-Path $LogDir 'fastapi.log'
    $err = Join-Path $LogDir 'fastapi.err.log'
    Start-Process -FilePath "python" `
        -ArgumentList "-m","uvicorn","engine.api.main:app","--host","0.0.0.0","--port","8000","--log-level","warning" `
        -NoNewWindow `
        -RedirectStandardOutput $log `
        -RedirectStandardError  $err
}

function Start-NextJs {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 启动 Next.js"
    $log = Join-Path $ProjectRoot 'dev.log'
    $err = Join-Path $ProjectRoot 'dev.err.log'
    Start-Process -FilePath "bun" `
        -ArgumentList "run","dev" `
        -NoNewWindow `
        -RedirectStandardOutput $log `
        -RedirectStandardError  $err
}

function Find-Process {
    # Get-Process 的 CommandLine 属性不可靠, 用 Get-CimInstance Win32_Process
    param([string]$Pattern)
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $Pattern } |
        Select-Object -First 1
}

Write-Host "守护启动, 项目根: $ProjectRoot"
Write-Host "Ctrl+C 退出守护 (子进程会继续运行)"

while ($true) {
    if (-not (Find-Process 'uvicorn')) {
        Start-FastApi
        Start-Sleep -Seconds 3
    }
    if (-not (Find-Process 'next-server')) {
        Start-NextJs
        Start-Sleep -Seconds 5
    }
    Start-Sleep -Seconds 5
}
