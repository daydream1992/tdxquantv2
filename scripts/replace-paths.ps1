# ====================================================================
# 路径占位符一键替换脚本 (Windows PowerShell 版)
#
# 用途:
#   把项目里 {{VENV_PYTHON}} {{PROJECT_ROOT}} {{LOG_DIR}}
#   {{TMP_DIR}} {{NULL_DEV}} 占位符, 根据 scripts/paths.yaml
#   的 active_env (或 -Env 参数) 替换成对应环境的实际路径。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts\replace-paths.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\replace-paths.ps1 -Env windows
#   powershell -ExecutionPolicy Bypass -File scripts\replace-paths.ps1 -Env linux
#   powershell -ExecutionPolicy Bypass -File scripts\replace-paths.ps1 -DryRun
#   powershell -ExecutionPolicy Bypass -File scripts\replace-paths.ps1 -Env windows -DryRun
#
# 说明:
#   - 只替换 {{...}} 占位符, 不会动已有的硬编码路径 (避免误伤)
#   - 默认扫描目录: scripts\ docs\ engine\ config\
#   - 跳过: 二进制 \ __pycache__ \ node_modules \ data\ \ logs\ \ .git\
# ====================================================================
[CmdletBinding()]
param(
    [ValidateSet('linux','windows')]
    [string]$Env,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ---------- 配置 ----------
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PathsYaml   = Join-Path $ProjectRoot 'scripts\paths.yaml'
$ScanDirs    = @('scripts','docs','engine','config')
$SkipDirs    = @('node_modules','__pycache__','.git','.next','data','logs','tool-results','upload','download')
$SkipExts    = @('.png','.jpg','.jpeg','.gif','.ico','.svg','.zip','.7z','.xlsx','.csv','.db','.db.bak','.wal','.pyc','.lock')
$SkipFiles   = @('replace-paths.sh','replace-paths.ps1','paths.yaml','setup-env.sh','setup-env.ps1','PATH_REPLACEMENT_GUIDE.md')

# ---------- 依赖检查 ----------
if (-not (Get-Command python -ErrorAction SilentlyContinue) -and
    -not (Get-Command python3 -ErrorAction SilentlyContinue)) {
    Write-Error "[ERROR] 需要 python / python3 来解析 paths.yaml"
    exit 1
}
if (-not (Test-Path $PathsYaml)) {
    Write-Error "[ERROR] 找不到配置文件: $PathsYaml"
    exit 1
}

# 选 python 解释器
$Python = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { 'python3' }

# ---------- 读 YAML ----------
#   返回 [PSCustomObject]@{
#       ActiveEnv = 'linux'|'windows'
#       Map = @(@{Placeholder='{{X}}'; Value='...'}, ...)
#   }
function Read-PathsYaml {
    param([string]$YamlPath, [string]$EnvOverride)

    $py = $Python
    $code = @"
import sys, re, json
path = sys.argv[1]
env_override = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
with open(path, encoding='utf-8') as f:
    text = f.read()

# active_env
m = re.search(r'^active_env:\s*\"?(\w+)\"?\s*$', text, re.M)
active = env_override or (m.group(1) if m else 'linux')

# placeholders 块
m = re.search(r'^placeholders:\s*\n((?:\s{2,}.*\n|\s*\n)+)', text, re.M)
block = m.group(1) if m else ''
entries = re.findall(
    r'\"(\{\{[^\"}]+\}\})\":\s*\n((?:[ \t]+(?:linux|windows):\s*.*\n)+)',
    block,
)
out = []
for key, body in entries:
    val = None
    if active:
        m2 = re.search(r'^[ \t]+' + active + r':\s*\"?(.*?)\"?\s*$', body, re.M)
        if m2:
            val = m2.group(1)
    if val is None:
        m2 = re.search(r'^[ \t]+(?:linux|windows):\s*\"?(.*?)\"?\s*$', body, re.M)
        val = m2.group(1) if m2 else ''
    out.append({'placeholder': key, 'value': val})
print(json.dumps({'active_env': active, 'map': out}))
"@
    $argList = @('-c', $code, $YamlPath)
    if ($EnvOverride) { $argList += $EnvOverride }
    $out = & $py @argList
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[ERROR] 解析 paths.yaml 失败: $out"
        exit 1
    }
    return ConvertFrom-Json $out
}

# ---------- 解析配置 ----------
$config = Read-PathsYaml -YamlPath $PathsYaml -EnvOverride $Env
$ActiveEnv = $config.active_env
if ($DryRun) {
    Write-Host "[INFO] 模式: DRY-RUN (不写文件)"
} else {
    Write-Host "[INFO] 模式: 实际写入"
}
Write-Host "[INFO] 激活环境: $ActiveEnv"
Write-Host "[INFO] 扫描目录: $($ScanDirs -join ' ')"
Write-Host "----------------------------------------"

Write-Host "[INFO] 占位符映射表 ($ActiveEnv):"
foreach ($e in $config.map) {
    Write-Host ("    {0}  ->  {1}" -f $e.placeholder, $e.value)
}
Write-Host "----------------------------------------"

# ---------- 跳过判断 ----------
function Test-Skip {
    param([string]$File)
    $rel = $File.Substring($ProjectRoot.Length).TrimStart('\','/')
    foreach ($d in $SkipDirs) {
        if ($rel -match "(^|[/\\])$([regex]::Escape($d))([/\\]|$)") { return $true }
    }
    $ext = [System.IO.Path]::GetExtension($File)
    if ($SkipExts -contains $ext.ToLower()) { return $true }
    $base = Split-Path $File -Leaf
    if ($SkipFiles -contains $base) { return $true }
    # 二进制检测: 读前 4KB 看是否有 NUL
    try {
        $bytes = [System.IO.File]::ReadAllBytes($File)[0..4095]
        foreach ($b in $bytes) { if ($b -eq 0) { return $true } }
    } catch {
        # 读不出来就跳过
        return $true
    }
    return $false
}

# ---------- 替换单文件 ----------
# 返回替换次数 (0 = 无变更)
function Replace-InFile {
    param([string]$File, [object[]]$Map, [bool]$Write)

    $content = Get-Content $File -Raw -Encoding UTF8
    if ($null -eq $content) { return 0 }
    $count = 0
    foreach ($e in $Map) {
        if ($content -like "*$($e.placeholder)*") {
            # 统计
            $phEsc = [regex]::Escape($e.placeholder)
            $matches = [regex]::Matches($content, $phEsc)
            $count += $matches.Count
            # 用 .Replace 字面替换 (避免正则转义问题, \ 路径分隔符安全)
            $content = $content.Replace($e.placeholder, $e.value)
        }
    }
    if ($count -gt 0 -and $Write) {
        # UTF-8 不带 BOM
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($File, $content, $utf8NoBom)
    }
    return $count
}

# ---------- 遍历 ----------
$TotalFiles = 0
$ChangedFiles = 0
$TotalReplacements = 0

foreach ($dir in $ScanDirs) {
    $full = Join-Path $ProjectRoot $dir
    if (-not (Test-Path $full)) { continue }
    $files = Get-ChildItem -Path $full -Recurse -File -Force
    foreach ($f in $files) {
        if (Test-Skip -File $f.FullName) { continue }
        $TotalFiles++
        $n = Replace-InFile -File $f.FullName -Map $config.map -Write (-not $DryRun)
        if ($n -gt 0) {
            $ChangedFiles++
            $TotalReplacements += $n
            if ($DryRun) {
                Write-Host ("  [DRY] {0}  ({1} 处)" -f $f.FullName.Substring($ProjectRoot.Length+1), $n)
            } else {
                Write-Host ("  [OK]  {0}  ({1} 处)" -f $f.FullName.Substring($ProjectRoot.Length+1), $n)
            }
        }
    }
}

Write-Host "----------------------------------------"
Write-Host "[DONE] 扫描文件数: $TotalFiles"
Write-Host "[DONE] 修改文件数: $ChangedFiles"
Write-Host "[DONE] 替换总处数: $TotalReplacements"
if ($DryRun) {
    Write-Host "[DONE] (DRY-RUN, 未实际写入)"
} else {
    Write-Host "[DONE] 已写入磁盘"
}
