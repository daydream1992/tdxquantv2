#!/usr/bin/env bash
# ====================================================================
# 路径占位符一键替换脚本 (Linux/macOS 版)
#
# 用途:
#   把项目里 {{VENV_PYTHON}} {{PROJECT_ROOT}} {{LOG_DIR}}
#   {{TMP_DIR}} {{NULL_DEV}} 占位符, 根据 scripts/paths.yaml
#   的 active_env (或 --env 参数) 替换成对应环境的实际路径。
#
# 用法:
#   bash scripts/replace-paths.sh                    # 用 paths.yaml 的 active_env
#   bash scripts/replace-paths.sh --env windows      # 临时切换到 windows
#   bash scripts/replace-paths.sh --env linux        # 临时切换到 linux
#   bash scripts/replace-paths.sh --dry-run          # 只预览不写文件
#   bash scripts/replace-paths.sh --env windows --dry-run
#
# 说明:
#   - 只替换 {{...}} 占位符, 不会动已有的硬编码路径 (避免误伤)
#   - 默认扫描目录: scripts/ docs/ engine/ config/
#   - 跳过: 二进制 / __pycache__ / node_modules / data/ / logs/ / .git/
# ====================================================================
set -euo pipefail

# ---------- 配置 ----------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATHS_YAML="${PROJECT_ROOT}/scripts/paths.yaml"
SCAN_DIRS=(scripts docs engine config)
SKIP_DIRS=(node_modules __pycache__ .git .next data logs tool-results upload download)
SKIP_EXT=(.png .jpg .jpeg .gif .ico .svg .zip .7z .xlsx .csv .db .db.bak .wal .pyc .lock)

# ---------- 参数解析 ----------
ENV_OVERRIDE=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --env)
      shift_next=1
      ;;
    --env=*)
      ENV_OVERRIDE="${arg#--env=}"
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      if [[ "${shift_next:-0}" = "1" ]]; then
        ENV_OVERRIDE="$arg"
        shift_next=0
      fi
      ;;
  esac
done

# ---------- 依赖检查 ----------
if ! command -v python3 >/dev/null 2>&1; then
  echo "[ERROR] 需要 python3 来解析 paths.yaml" >&2
  exit 1
fi
if [[ ! -f "$PATHS_YAML" ]]; then
  echo "[ERROR] 找不到配置文件: $PATHS_YAML" >&2
  exit 1
fi

# ---------- 读 YAML, 输出 "占位符<TAB>替换值" 行 ----------
#   只用标准库, 避免 PyYAML 依赖
read_yaml_map() {
  local env="$1"
  python3 - "$PATHS_YAML" "$env" <<'PYEOF'
import sys, json, re

path, env = sys.argv[1], sys.argv[2]

# 极简 YAML 解析 (本配置表结构简单, 不引入 PyYAML)
with open(path, encoding='utf-8') as f:
    text = f.read()

# 取出 placeholders: 块
m = re.search(r'^placeholders:\s*\n((?:\s{2,}.*\n|\s*\n)+)', text, re.M)
if not m:
    sys.exit("[ERROR] placeholders 块未找到")
block = m.group(1)

# 匹配每个 "  {{KEY}}:"  行 + 后续 "    linux: ..." / "    windows: ..."
entries = re.findall(
    r'"(\{\{[^"}]+\}\})":\s*\n((?:[ \t]+(?:linux|windows):\s*.*\n)+)',
    block,
)

for key, body in entries:
    val = None
    for env_key in (env,):  # 只取目标环境
        m2 = re.search(rf'^[ \t]+{env_key}:\s*"?(.*?)"?\s*$', body, re.M)
        if m2:
            val = m2.group(1)
            break
    if val is None:
        # 兜底: 取第一个出现的 linux/windows
        m2 = re.search(r'^[ \t]+(?:linux|windows):\s*"?(.*?)"?\s*$', body, re.M)
        val = m2.group(1) if m2 else ''
    # 用 \t 分隔, \n 行尾 (值中不会有 \t)
    sys.stdout.write(f"{key}\t{val}\n")
PYEOF
}

# 读 active_env
read_active_env() {
  python3 - "$PATHS_YAML" <<'PYEOF'
import sys, re
with open(sys.argv[1], encoding='utf-8') as f:
    text = f.read()
m = re.search(r'^active_env:\s*"?(\w+)"?\s*$', text, re.M)
print(m.group(1) if m else 'linux')
PYEOF
}

ACTIVE_ENV="${ENV_OVERRIDE:-$(read_active_env)}"
if [[ "$ACTIVE_ENV" != "linux" && "$ACTIVE_ENV" != "windows" ]]; then
  echo "[ERROR] 无效环境: $ACTIVE_ENV (仅支持 linux / windows)" >&2
  exit 1
fi

echo "[INFO] 激活环境: $ACTIVE_ENV"
if [[ "$DRY_RUN" = "1" ]]; then
  echo "[INFO] 模式: DRY-RUN (不写文件)"
else
  echo "[INFO] 模式: 实际写入"
fi
echo "[INFO] 扫描目录: ${SCAN_DIRS[*]}"
echo "----------------------------------------"

# ---------- 构建占位符 -> 替换值的关联数组 ----------
declare -a PLACEHOLDERS=()
declare -a VALUES=()
while IFS=$'\t' read -r k v; do
  PLACEHOLDERS+=("$k")
  VALUES+=("$v")
done < <(read_yaml_map "$ACTIVE_ENV")

if [[ ${#PLACEHOLDERS[@]} -eq 0 ]]; then
  echo "[ERROR] 未从 paths.yaml 读到任何占位符" >&2
  exit 1
fi

echo "[INFO] 占位符映射表 ($ACTIVE_ENV):"
for i in "${!PLACEHOLDERS[@]}"; do
  printf "    %s  ->  %s\n" "${PLACEHOLDERS[$i]}" "${VALUES[$i]}"
done
echo "----------------------------------------"

# ---------- 跳过判断 ----------
should_skip() {
  local f="$1"
  local base="$(basename "$f")"
  # 跳过目录 (调用方已处理, 这里是文件级保险)
  for d in "${SKIP_DIRS[@]}"; do
    if [[ "$f" == *"/$d/"* ]] || [[ "$f" == *"/$d" ]]; then
      return 0
    fi
  done
  # 跳过扩展名
  local ext="${f##*.}"
  for e in "${SKIP_EXT[@]}"; do
    if [[ ".$ext" == "$e" ]]; then
      return 0
    fi
  done
  # 跳过自身
  case "$base" in
    replace-paths.sh|replace-paths.ps1|paths.yaml|setup-env.sh|setup-env.ps1)
      return 0 ;;
  esac
  # 跳过说明文档 (含占位符示例, 不能被替换)
  case "$f" in
    */docs/PATH_REPLACEMENT_GUIDE.md) return 0 ;;
  esac
  # 跳过非文本 (粗判: file 命令识别为 binary)
  #   兜底: 若 file 命令不存在, 用 head+od 检测 NUL 字节
  if command -v file >/dev/null 2>&1; then
    if file -b --mime "$f" 2>/dev/null | grep -qi 'charset=binary'; then
      return 0
    fi
  else
    if head -c 4096 "$f" 2>/dev/null | LC_ALL=C od -c | grep -q '\\0'; then
      return 0
    fi
  fi
  return 1
}

# ---------- 替换单文件 ----------
# 返回: 替换次数 (0 = 无变更)
replace_in_file() {
  local f="$1"
  local content
  content="$(<"$f")"
  local count=0
  for i in "${!PLACEHOLDERS[@]}"; do
    local ph="${PLACEHOLDERS[$i]}"
    local val="${VALUES[$i]}"
    # 统计出现次数 (bash ${//} 没有计数, 用 grep -o)
    if [[ "$content" == *"$ph"* ]]; then
      local n
      n=$(printf '%s' "$content" | grep -oF "$ph" | wc -l)
      count=$((count + n))
      content="${content//"$ph"/$val}"
    fi
  done
  if [[ $count -gt 0 ]]; then
    if [[ "$DRY_RUN" = "0" ]]; then
      printf '%s' "$content" > "$f"
    fi
  fi
  echo "$count"
}

# ---------- 遍历 ----------
TOTAL_FILES=0
TOTAL_REPLACEMENTS=0
CHANGED_FILES=0

for dir in "${SCAN_DIRS[@]}"; do
  full="${PROJECT_ROOT}/${dir}"
  [[ -d "$full" ]] || continue
  while IFS= read -r -d '' f; do
    if should_skip "$f"; then continue; fi
    TOTAL_FILES=$((TOTAL_FILES + 1))
    n="$(replace_in_file "$f")"
    if [[ "$n" -gt 0 ]]; then
      CHANGED_FILES=$((CHANGED_FILES + 1))
      TOTAL_REPLACEMENTS=$((TOTAL_REPLACEMENTS + n))
      if [[ "$DRY_RUN" = "1" ]]; then
        echo "  [DRY] $f  ($n 处)"
      else
        echo "  [OK]  $f  ($n 处)"
      fi
    fi
  done < <(find "$full" -type f -print0)
done

echo "----------------------------------------"
echo "[DONE] 扫描文件数: $TOTAL_FILES"
echo "[DONE] 修改文件数: $CHANGED_FILES"
echo "[DONE] 替换总处数: $TOTAL_REPLACEMENTS"
if [[ "$DRY_RUN" = "1" ]]; then
  echo "[DONE] (DRY-RUN, 未实际写入)"
else
  echo "[DONE] 已写入磁盘"
fi
