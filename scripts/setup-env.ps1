# ====================================================================
# 环境一键初始化脚本 (Windows PowerShell 版)
#
# 完成新环境搭建的 6 步:
#   1. 检查 python / bun / caddy (缺失则警告, 不强制中止)
#   2. 创建数据目录 (data\logs data\csv data\excel)
#   3. 安装 Python 依赖 (pip install -r requirements.txt)
#   4. 安装前端依赖 (bun install)
#   5. 初始化数据库 (python scripts\init_db.py)
#   6. 运行路径替换 (powershell scripts\replace-paths.ps1 -Env windows)
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-env.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\setup-env.ps1 -Env linux
#
# 完成后提示: 用 powershell scripts\start_all.ps1 启动服务
# ====================================================================
[CmdletBinding()]
param(
    [ValidateSet('linux','windows')]
    [string]$Env = 'windows'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectRoot

Write-Host "=============================================="
Write-Host " TdxQuant 环境初始化 (env=$Env)"
Write-Host "  ProjectRoot: $ProjectRoot"
Write-Host "=============================================="

# ---------- 1. 依赖检查 ----------
Write-Host ""
Write-Host "[1/6] 检查依赖..."
$Missing = @()
$Python = $null
foreach ($c in @('python','python3')) {
    if (Get-Command $c -ErrorAction SilentlyContinue) {
        $Python = $c
        Write-Host ("  [OK] {0}: {1}" -f $c, (& $c --version 2>&1))
        break
    }
}
if (-not $Python) {
    Write-Host "  [MISSING] python / python3"
    $Missing += 'python'
}
if (Get-Command bun -ErrorAction SilentlyContinue) {
    Write-Host ("  [OK] bun: {0}" -f (& bun --version 2>&1))
} else {
    Write-Host "  [MISSING] bun (前端构建)"
    $Missing += 'bun'
}
if (Get-Command caddy -ErrorAction SilentlyContinue) {
    Write-Host ("  [OK] caddy: {0}" -f ((& caddy version 2>&1) -split "`n")[0])
} else {
    Write-Host "  [WARN] caddy 未安装 (反向代理, 不影响核心功能)"
}
if ($Missing.Count -gt 0) {
    Write-Host ""
    Write-Host ("[WARN] 缺失依赖: {0}" -f ($Missing -join ' '))
    Write-Host "       Python: https://www.python.org/downloads/"
    Write-Host "       Bun:    https://bun.sh/"
    Write-Host "       继续 5/6 步可能失败, 建议先安装"
}

# ---------- 2. 数据目录 ----------
Write-Host ""
Write-Host "[2/6] 创建数据目录..."
foreach ($d in @('data\logs','data\csv','data\excel','data\duckdb')) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Host "  [NEW] $d"
    } else {
        Write-Host "  [SKIP] $d 已存在"
    }
}

# ---------- 3. Python 依赖 ----------
Write-Host ""
Write-Host "[3/6] 安装 Python 依赖..."
if ($Python) {
    & $Python -m pip install -r requirements.txt
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] Python 依赖已安装"
    } else {
        Write-Host "  [WARN] pip install 失败"
    }
} else {
    Write-Host "  [SKIP] 未找到 python, 跳过"
}

# ---------- 4. 前端依赖 ----------
Write-Host ""
Write-Host "[4/6] 安装前端依赖 (bun install)..."
if (Get-Command bun -ErrorAction SilentlyContinue) {
    & bun install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] 前端依赖已安装"
    } else {
        Write-Host "  [WARN] bun install 失败"
    }
} else {
    Write-Host "  [SKIP] 未找到 bun, 跳过 (可用 npm install 替代)"
}

# ---------- 5. 数据库初始化 ----------
Write-Host ""
Write-Host "[5/6] 初始化 DuckDB 数据库..."
if ($Python) {
    & $Python scripts\init_db.py
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] 数据库已就绪"
    } else {
        Write-Host "  [WARN] init_db.py 失败 (检查 duckdb 是否在 requirements.txt 中)"
    }
} else {
    Write-Host "  [SKIP] 未找到 python, 跳过"
}

# ---------- 6. 路径替换 ----------
Write-Host ""
Write-Host "[6/6] 运行路径替换 (env=$Env)..."
if (Test-Path scripts\replace-paths.ps1) {
    & powershell -ExecutionPolicy Bypass -File scripts\replace-paths.ps1 -Env $Env
} elseif (Test-Path scripts\replace-paths.sh) {
    & bash scripts\replace-paths.sh --env $Env
} else {
    Write-Host "  [SKIP] 路径替换脚本不存在"
}

# ---------- 完成 ----------
Write-Host ""
Write-Host "=============================================="
Write-Host " 环境就绪!"
Write-Host "  下一步: powershell scripts\start_all.ps1 启动服务"
Write-Host "  (Linux: bash scripts/start_all.sh)"
Write-Host "=============================================="
