# ====================================================================
# 停止 TdxQuant 全栈服务 (Windows PowerShell 版)
#
# 等价于 Linux: pkill -f "uvicorn|next-server|bun run"
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\stop.ps1 -WhatIf  (只显示不执行)
# ====================================================================
[CmdletBinding()]
param(
    [switch]$WhatIf
)

$ErrorActionPreference = 'Continue'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Host "=============================================="
Write-Host " 停止 TdxQuant 服务"
Write-Host "  ProjectRoot: $ProjectRoot"
if ($WhatIf) { Write-Host "  [WhatIf 模式: 只显示, 不执行]" }
Write-Host "=============================================="

# 匹配项目目录下的 python/node/bun 进程
$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match 'python|node|bun|uvicorn|next-server|realtime-service' -and
        $_.CommandLine -match ([regex]::Escape($ProjectRoot))
    }

if (-not $procs) {
    Write-Host "  没有找到运行中的 TdxQuant 进程" -ForegroundColor Yellow
    exit 0
}

$stopped = 0
foreach ($p in $procs) {
    $cmdShort = $p.CommandLine.Substring(0, [Math]::Min(80, $p.CommandLine.Length))
    if ($WhatIf) {
        Write-Host "  [WhatIf] 将停止 PID $($p.ProcessId) ($($p.Name)): $cmdShort" -ForegroundColor Cyan
    } else {
        try {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
            Write-Host "  [OK] 停止 PID $($p.ProcessId) ($($p.Name))" -ForegroundColor Green
            $stopped++
        } catch {
            Write-Host "  [FAIL] 停止 PID $($p.ProcessId) 失败: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "=============================================="
if ($WhatIf) {
    Write-Host " WhatIf: 共 $($procs.Count) 个进程将被停止"
} else {
    Write-Host " 停止 $stopped/$($procs.Count) 个进程"
}
Write-Host "=============================================="
