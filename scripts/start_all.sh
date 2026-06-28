#!/bin/bash
# Thin wrapper → python scripts/dev.py start (legacy compat, 18→1 脚本统一)
cd "$(dirname "$0")/.." && exec python scripts/dev.py start "$@"
