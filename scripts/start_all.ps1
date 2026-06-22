# Thin wrapper → python scripts/dev.py start (legacy compat, 18→1 脚本统一)
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
python scripts/dev.py start $args
