#!/usr/bin/env bash
# ====================================================================
# 环境一键初始化脚本 (Linux/macOS 版)
#
# 完成新环境搭建的 6 步:
#   1. 检查 python / bun / caddy (缺失则警告, 不强制中止)
#   2. 创建数据目录 (data/logs data/csv data/excel)
#   3. 安装 Python 依赖 (pip install -r requirements.txt)
#   4. 安装前端依赖 (bun install)
#   5. 初始化数据库 (python scripts/init_db.py)
#   6. 运行路径替换 (bash scripts/replace-paths.sh --env linux)
#
# 用法:
#   bash scripts/setup-env.sh
#   bash scripts/setup-env.sh --env windows   # 切换占位符到 windows
#
# 完成后提示: 用 scripts/start_all.sh 启动服务
# ====================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# 参数: --env linux|windows
SETUP_ENV="linux"
for arg in "$@"; do
  case "$arg" in
    --env=*) SETUP_ENV="${arg#--env=}" ;;
    --env)   shift_next=1 ;;
    *)
      if [[ "${shift_next:-0}" = "1" ]]; then
        SETUP_ENV="$arg"; shift_next=0
      fi ;;
  esac
done
if [[ "$SETUP_ENV" != "linux" && "$SETUP_ENV" != "windows" ]]; then
  echo "[ERROR] --env 仅支持 linux / windows" >&2
  exit 1
fi

echo "=============================================="
echo " TdxQuant 环境初始化 (env=$SETUP_ENV)"
echo "  ProjectRoot: $PROJECT_ROOT"
echo "=============================================="

# ---------- 1. 依赖检查 ----------
echo ""
echo "[1/6] 检查依赖..."
MISSING=()
if command -v python3 >/dev/null 2>&1; then
  echo "  [OK] python3: $(python3 --version 2>&1)"
elif command -v python >/dev/null 2>&1; then
  echo "  [OK] python: $(python --version 2>&1)"
else
  echo "  [MISSING] python3 / python"
  MISSING+=("python3")
fi
if command -v bun >/dev/null 2>&1; then
  echo "  [OK] bun: $(bun --version 2>&1)"
else
  echo "  [MISSING] bun (前端构建)"
  MISSING+=("bun")
fi
if command -v caddy >/dev/null 2>&1; then
  echo "  [OK] caddy: $(caddy version 2>&1 | head -1)"
else
  echo "  [WARN] caddy 未安装 (反向代理, 不影响核心功能)"
fi
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo ""
  echo "[WARN] 缺失依赖: ${MISSING[*]}"
  echo "       Python: https://www.python.org/downloads/"
  echo "       Bun:    https://bun.sh/"
  echo "       继续 5/6 步可能失败, 建议先安装"
fi

# ---------- 2. 数据目录 ----------
echo ""
echo "[2/6] 创建数据目录..."
for d in data/logs data/csv data/excel data/duckdb; do
  if [[ ! -d "$d" ]]; then
    mkdir -p "$d"
    echo "  [NEW] $d"
  else
    echo "  [SKIP] $d 已存在"
  fi
done

# ---------- 3. Python 依赖 ----------
echo ""
echo "[3/6] 安装 Python 依赖..."
PYBIN="python3"
command -v python3 >/dev/null 2>&1 || PYBIN="python"
if command -v "$PYBIN" >/dev/null 2>&1; then
  if "$PYBIN" -m pip install -r requirements.txt; then
    echo "  [OK] Python 依赖已安装"
  else
    echo "  [WARN] pip install 失败 (可能权限问题, 试 python -m pip install --user -r requirements.txt)"
  fi
else
  echo "  [SKIP] 未找到 $PYBIN, 跳过"
fi

# ---------- 4. 前端依赖 ----------
echo ""
echo "[4/6] 安装前端依赖 (bun install)..."
if command -v bun >/dev/null 2>&1; then
  if bun install; then
    echo "  [OK] 前端依赖已安装"
  else
    echo "  [WARN] bun install 失败"
  fi
else
  echo "  [SKIP] 未找到 bun, 跳过 (可用 npm install 替代)"
fi

# ---------- 5. 数据库初始化 ----------
echo ""
echo "[5/6] 初始化 DuckDB 数据库..."
if command -v "$PYBIN" >/dev/null 2>&1; then
  if "$PYBIN" scripts/init_db.py; then
    echo "  [OK] 数据库已就绪"
  else
    echo "  [WARN] init_db.py 失败 (检查 duckdb 是否在 requirements.txt 中)"
  fi
else
  echo "  [SKIP] 未找到 $PYBIN, 跳过"
fi

# ---------- 6. 路径替换 ----------
echo ""
echo "[6/6] 运行路径替换 (env=$SETUP_ENV)..."
if [[ -f scripts/replace-paths.sh ]]; then
  bash scripts/replace-paths.sh --env "$SETUP_ENV"
else
  echo "  [SKIP] scripts/replace-paths.sh 不存在"
fi

# ---------- 完成 ----------
echo ""
echo "=============================================="
echo " 环境就绪!"
echo "  下一步: bash scripts/start_all.sh 启动服务"
echo "  (Windows: powershell scripts\\start_all.ps1)"
echo "=============================================="
