# 路径替换指南 (Path Replacement Guide)

> 一键替换 Windows / Linux 路径占位符, 让项目跨平台可移植。

## 1. 为什么要路径替换?

本项目是 TdxQuant 量化交易系统, 在 Windows / Linux 两个环境之间切换部署时, 以下硬编码路径需要手动改:

| 用途 | Linux | Windows |
|------|-------|---------|
| Python 解释器 | `python` 或 `/home/z/.venv/bin/python3` | `python` 或 `.venv\Scripts\python.exe` |
| 项目根 | `.` 或 `/home/z/my-project` | `.` 或 `C:\proj\my-project` |
| 日志目录 | `data/logs` | `data\logs` |
| 临时目录 | `/tmp` | `$env:TEMP` |
| 空设备 | `/dev/null` | `NUL` |

手动改 7+ 个文件 × 5 处路径 = 35 处替换, 容易漏改、错改。

**方案**: 把所有路径改成 `{{VENV_PYTHON}}` 等占位符, 配合 `scripts/paths.yaml` 配置表 + `scripts/replace-paths.{sh,ps1}` 一键替换脚本, 切换环境只需一行命令。

## 2. 占位符列表 (5 个)

全部定义在 [`scripts/paths.yaml`](../scripts/paths.yaml):

| 占位符 | 用途 | Linux 值 | Windows 值 |
|--------|------|----------|------------|
| `{{VENV_PYTHON}}` | Python 解释器 | `python` | `python` |
| `{{PROJECT_ROOT}}` | 项目根目录 | `.` | `.` |
| `{{LOG_DIR}}` | 日志目录 | `data/logs` | `data\logs` |
| `{{TMP_DIR}}` | 临时目录 | `/tmp` | `$env:TEMP` |
| `{{NULL_DEV}}` | 空设备 | `/dev/null` | `NUL` |

> 默认值偏保守: `{{VENV_PYTHON}}` 用 `python` (依赖 PATH 里有 venv 的 python)。如需指定绝对路径, 编辑 `paths.yaml` 的 `placeholders` 段。

## 3. 使用方法

### 3.1 切换环境 (推荐: 用参数)

```bash
# Linux 上切到 Windows (代码迁移到 Windows 前预替换)
bash scripts/replace-paths.sh --env windows

# Windows 上切到 Linux
powershell scripts\replace-paths.ps1 -Env linux
```

### 3.2 切换环境 (备用: 改配置)

1. 编辑 `scripts/paths.yaml`, 把 `active_env: linux` 改成 `active_env: windows`
2. 运行 `bash scripts/replace-paths.sh` (不带 `--env`, 自动读 `active_env`)

### 3.3 预览不写 (`--dry-run` / `-DryRun`)

```bash
bash scripts/replace-paths.sh --dry-run
bash scripts/replace-paths.sh --env windows --dry-run
```

输出示例:
```
[INFO] 激活环境: linux
[INFO] 占位符映射表 (linux):
    {{VENV_PYTHON}}  ->  python
    {{PROJECT_ROOT}}  ->  .
    {{LOG_DIR}}  ->  data/logs
    {{TMP_DIR}}  ->  /tmp
    {{NULL_DEV}}  ->  /dev/null
----------------------------------------
  [DRY] scripts/start_all.sh  (5 处)
  [DRY] scripts/daemon.sh  (3 处)
----------------------------------------
[DONE] 扫描文件数: 171
[DONE] 修改文件数: 2
[DONE] 替换总处数: 8
[DONE] (DRY-RUN, 未实际写入)
```

### 3.4 替换范围

| 扫描目录 | `scripts/` `docs/` `engine/` `config/` |
|----------|---------------------------------------|
| 跳过目录 | `node_modules` `__pycache__` `.git` `.next` `data` `logs` `tool-results` `upload` `download` |
| 跳过扩展名 | `.png .jpg .jpeg .gif .ico .svg .zip .7z .xlsx .csv .db .db.bak .wal .pyc .lock` |
| 跳过文件 | `replace-paths.sh/ps1` `paths.yaml` `setup-env.sh/ps1` (避免自替换) |
| 跳过二进制 | 自动检测 NUL 字节, 跳过二进制文件 |

**重要**: 只替换 `{{...}}` 占位符, 不会动已有的硬编码路径 (避免误伤)。

## 4. 新环境初始化

`scripts/setup-env.sh` / `scripts/setup-env.ps1` 一键完成 6 步初始化:

| 步骤 | 操作 |
|------|------|
| 1 | 检查 `python` / `bun` / `caddy` 是否安装 |
| 2 | 创建 `data/logs` `data/csv` `data/excel` `data/duckdb` 目录 |
| 3 | `pip install -r requirements.txt` |
| 4 | `bun install` |
| 5 | `python scripts/init_db.py` 初始化数据库 |
| 6 | 运行路径替换 (`replace-paths.sh/ps1 --env <环境>`) |

### Linux / macOS

```bash
cd /path/to/my-project
bash scripts/setup-env.sh
# 或指定 Windows 模式
bash scripts/setup-env.sh --env windows
```

### Windows

```powershell
cd C:\path\to\my-project
powershell -ExecutionPolicy Bypass -File scripts\setup-env.ps1
# 或指定 Linux 模式
powershell -ExecutionPolicy Bypass -File scripts\setup-env.ps1 -Env linux
```

完成后提示: `环境就绪! 下一步: bash scripts/start_all.sh 启动服务`

## 5. 自定义路径

编辑 [`scripts/paths.yaml`](../scripts/paths.yaml) 的 `placeholders` 段:

```yaml
placeholders:
  "{{VENV_PYTHON}}":
    linux: "/home/z/myuser/.venv/bin/python3"   # ← 改这里
    windows: "C:\proj\my-project\.venv\Scripts\python.exe"
  "{{PROJECT_ROOT}}":
    linux: "/home/z/myuser/projects/tdx-quant"
    windows: "C:\proj\tdx-quant"
  # ... 其余 3 个同理
```

改完运行 `bash scripts/replace-paths.sh` 重新应用。

## 6. FAQ

### Q1: 跑了脚本但替换总处数 = 0, 是不是没生效?

是的。当前项目代码里可能还没有 `{{...}}` 占位符 (只有硬编码路径)。脚本只替换占位符, 不会动已有的硬编码路径 (避免误伤)。需要手动把硬编码路径改成占位符:

```bash
# Before (硬编码)
/home/z/.venv/bin/python3 -m uvicorn engine.api.main:app
> /tmp/fastapi.log 2>&1 < /dev/null &

# After (占位符)
{{VENV_PYTHON}} -m uvicorn engine.api.main:app
> {{TMP_DIR}}/fastapi.log 2>&1 < {{NULL_DEV}} &
```

改完再跑 `bash scripts/replace-paths.sh --env linux` 才会替换。

### Q2: 能不能加新占位符?

可以。两步:

1. 在 `scripts/paths.yaml` 的 `placeholders` 段加一项:
   ```yaml
   placeholders:
     # ... 已有 5 个 ...
     "{{DB_PATH}}":
       linux: "data/duckdb/quant.db"
       windows: "data\\duckdb\\quant.db"
   ```
2. 在代码里用 `{{DB_PATH}}` 引用, 跑替换脚本即可。无需改脚本本身 — `replace-paths.sh/ps1` 自动读取所有 `placeholders`。

### Q3: 替换后中文乱码?

`replace-paths.ps1` 写文件用 UTF-8 不带 BOM 编码。Linux 版 `replace-paths.sh` 用 `printf '%s'` 写, 保持原编码。如果遇到乱码, 检查原文件是否 UTF-8。

### Q4: 替换后 `\` 在 Windows 上变成 `\\`?

不会。`replace-paths.ps1` 用 `String.Replace` (字面替换), 不走正则, `\` 字符安全。Linux 版 `replace-paths.sh` 用 bash `${content//"$ph"/$val}` 也是字面替换。

### Q5: PowerShell 跑脚本报 "execution of scripts is disabled"?

加 `-ExecutionPolicy Bypass`:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\replace-paths.ps1 -DryRun
```

### Q6: 跑 `setup-env.sh` 提示 `pip install` 权限不足?

试 `--user` 模式:
```bash
python3 -m pip install --user -r requirements.txt
```
或直接用 venv:
```bash
python3 -m venv .venv
source .venv/bin/activate    # Linux
.\.venv\Scripts\Activate.ps1 # Windows
pip install -r requirements.txt
```
然后改 `paths.yaml` 的 `{{VENV_PYTHON}}` 指向 venv 里的 python。

## 7. 文件清单

| 文件 | 用途 |
|------|------|
| `scripts/paths.yaml` | 路径配置表 (5 占位符 + active_env) |
| `scripts/replace-paths.sh` | Linux/macOS 替换脚本 |
| `scripts/replace-paths.ps1` | Windows PowerShell 替换脚本 |
| `scripts/setup-env.sh` | Linux/macOS 环境初始化 (6 步) |
| `scripts/setup-env.ps1` | Windows 环境初始化 (6 步) |

## 8. 跨平台迁移速查

| 场景 | 命令 |
|------|------|
| Windows 代码搬到 Linux | `bash scripts/replace-paths.sh --env linux` |
| Linux 代码搬到 Windows | `powershell scripts\replace-paths.ps1 -Env windows` |
| 想看会改什么 | `--dry-run` / `-DryRun` |
| 全新环境初始化 | `bash scripts/setup-env.sh` 或 `powershell scripts\setup-env.ps1` |
| 启动服务 | `bash scripts/start_all.sh` 或 `powershell scripts\start_all.ps1` |
