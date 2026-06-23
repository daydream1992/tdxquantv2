# 部署指南

> 涵盖沙箱开发、Windows 生产、Linux 生产三种环境的部署流程。
>
> **R18 起 DuckDB 已替换为 QuestDB** (服务端架构, 无文件锁)。详见下方「QuestDB 数据库」章节。

---

## 📋 环境要求

| 组件 | 版本 | 说明 |
|---|---|---|
| Python | 3.13+ | 后端引擎 |
| Node.js | 18+ | 前端构建 |
| bun | latest | 包管理 + 开发服务器 |
| 通达信金融终端 | 任意 | **仅生产环境**需要，必须预启动并登录 |
| QuestDB | latest | R18 起替代 DuckDB; Docker / 原生二进制均可 |
| psycopg2-binary | 2.9+ | QuestDB PG wire 连接 (pip 装) |
| requests | 2.28+ | QuestDB HTTP /exec (pip 装) |

---

## 🗄️ QuestDB 数据库 (R18 替代 DuckDB)

R18 起 DuckDB 单文件存储已替换为 **QuestDB** (服务端时序数据库, 彻底解决文件锁问题)。

### 为什么迁移

| 痛点 | DuckDB | QuestDB |
|---|---|---|
| 并发写 | 单写锁, 多 FastAPI 实例必冲突 `database is locked` | 无文件锁, PG wire 多连接并发写 |
| 时序优化 | 无 | 原生 `timestamp(ts)` + 自动分区 + 列存压缩 |
| 高频写入 | 锁争用严重, R12 限流仅缓解 | 服务端架构, 天生支持高频写入 |
| Web 运维 | 无 | HTTP 9000 控制台 (查表/执行 SQL/看分区) |

### 安装与启动

**方式 A: Docker (推荐, 跨平台一致)**

```bash
# 启动 (后台运行, 含 PG wire 8812 / HTTP 9000 / ILP 9009)
docker compose -f docker/questdb/docker-compose.yml up -d

# 验证
curl http://127.0.0.1:9000/      # Web 控制台 (应返回 200)
docker logs tdxquant-questdb --tail 20

# 停止
docker compose -f docker/questdb/docker-compose.yml down
```

**方式 B: 原生二进制 (无 Docker 时用)**

```bash
# Linux
wget https://github.com/questdb/questdb/releases/latest/download/questdb-no-jre-linux-amd64.tar.gz
tar xzf questdb-no-jre-linux-amd64.tar.gz -C /opt/questdb
/opt/questdb/questdb start -d /opt/questdb/data

# Windows: 下载 questdb-windows-amd64.zip 解压后
K:\questdb\questdb.exe start -d K:\questdb\data
```

### 配置 (config/app.yaml 的 questdb 段)

```yaml
questdb:
  host: 127.0.0.1
  pg_port: 8812          # PG wire (查询/写入, psycopg2 连接)
  http_port: 9000        # HTTP (DDL / Web 控制台)
  username: admin
  password: quest        # 生产环境建议改
  database: qdb
  connect_timeout: 5
  auto_init: true        # 启动时自动建表 (config/questdb_schema.sql)
```

环境变量覆盖 (见 `.env.example`):
`QUESTDB_HOST` / `QUESTDB_PG_PORT` / `QUESTDB_HTTP_PORT` / `QUESTDB_USERNAME` / `QUESTDB_PASSWORD` / `QUESTDB_DATABASE`

### 数据持久化

- **Docker**: `docker/questdb/questdb-data/` (相对项目根)
- **原生 Linux**: `/opt/questdb/data/`
- **原生 Windows**: `K:\questdb\data\`

升级/迁移时直接 zip 整个数据目录即可备份; 重建时解压回去即可。

### 沙箱/Mock 模式降级

无 QuestDB 服务时, `QuestDBStore._connect()` 失败仅记 WARNING, 不抛异常:
- Mock 模式不依赖 DB (数据从 `data/v8-samples/` CSV 读), 可正常运行
- Real 模式必须先启动 QuestDB (否则 `precheck.py` 报 FAIL)
- `precheck.py` 中 `questdb` 检查项在 mock 模式标 WARN, real 模式标 FAIL

---

## 🏗 沙箱开发环境（Linux + Mock）

### 1. 装依赖
```bash
pip install -r requirements.txt
bun install
```

### 2. (可选) 启动 QuestDB
```bash
docker compose -f docker/questdb/docker-compose.yml up -d
```
> 沙箱默认 mock 模式, 不启动 QuestDB 也能跑; 启动后可验证 real 模式数据写入。

### 3. 初始化数据库
```bash
python scripts/init_db.py
# 沙箱无 QuestDB 时会输出 [WARN] 并跳过建表, 不影响 mock 模式运行
```

### 4. 启动
```bash
python scripts/dev.py start
# 或: bash scripts/start_all.sh
```

脚本会启动 FastAPI(:8000) + Next.js(:3000) + 健康检查轮询 20×2s。

### 5. 验证
```bash
curl http://127.0.0.1:8000/health                    # → 200
curl http://127.0.0.1:8000/api/strategies            # → 5 个策略
curl http://127.0.0.1:8000/api/monitor/health         # → 含 api_stats + rate_limit
```

打开 `http://localhost:3000` 看 5 Tab。

### 6. 停止
```bash
python scripts/dev.py stop
```

---

## 🪟 Windows 生产部署

> 🚀 **新手开箱即用**：先看根目录 [`WINDOWS_README.md`](../WINDOWS_README.md)（5 分钟图文教程），有困难再回到本节。
>
> 一键安装: 双击 `install.bat` ｜ 启动: `start.bat` ｜ 静默后台: `tdxquant-launcher.vbs`

### 前置检查
- 通达信金融终端已启动并登录（保持前台，不要最小化到托盘）
- Python 3.13+ 已装（`python --version`）
- bun 已装（`bun --version`，未装: `powershell -c "irm bun.sh/install.ps1 | iex"`）
- QuestDB 已启动 (见上方「QuestDB 数据库」章节, `docker compose up -d` 或 `questdb.exe start`)

### 步骤

#### 1. 获取代码 + 装依赖
```powershell
cd D:\tdxquant
pip install -r requirements.txt
bun install
```

> requirements.txt 已拆分 uvloop/httptools（Windows 不装），不会失败。

#### 2. 路径占位符替换
```powershell
python scripts/dev.py paths --env windows --dry-run   # 预览
python scripts/dev.py paths --env windows             # 执行
```

#### 3. 一键初始化环境
```powershell
python scripts/dev.py setup
# 等价于: venv + pip install + bun install + init_db
```

#### 4. 启动 QuestDB
```powershell
# Docker
docker compose -f docker\questdb\docker-compose.yml up -d

# 或原生 questdb.exe
K:\questdb\questdb.exe start -d K:\questdb\data

# 验证
curl http://127.0.0.1:9000/   # Web 控制台
```

#### 5. 切换适配器模式
编辑 `config/app.yaml`：
```yaml
app:
  adapter_mode: real    # mock → real
```
> ⚠️ 适配器模式不支持热加载，必须重启 FastAPI。

#### 6. 启动
```powershell
python scripts/dev.py start
# 或兼容用法: powershell -File scripts\start_all.ps1
```

#### 7. 验证 tqcenter 连通
```powershell
curl http://127.0.0.1:8000/api/monitor?action=status
# 应返回 {"adapter":"real", "subscribed":N, ...}
```

#### 8. 触发一次选股
```powershell
curl -X POST http://127.0.0.1:8000/api/strategies/dbqzt/run
# 等 30s（Real 模式需调 tqcenter 拉数据）
curl http://127.0.0.1:8000/api/selections?strategy_id=dbqzt
# 验证 stock_name 是真实股票名
```

### Windows 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| `ModuleNotFoundError: tqcenter` | 未装 | tqcenter 不是 pip 包, 用 `python scripts\install_tqcenter.py` 配置路径 |
| `tq.initialize()` 报「终端未连接」 | 终端未启动 | 启动通达信并登录，保持前台 |
| `database is locked` | (R18 后 QuestDB 无此问题) 旧 DuckDB 遗留 | 升级到 R18 用 QuestDB; 或重启 FastAPI |
| `[WARN] QuestDB 连接不可达` | QuestDB 未启动 | `docker compose -f docker\questdb\docker-compose.yml up -d` |
| 端口 8812/9000 占用 | 旧 QuestDB 进程 | `netstat -ano \| findstr :8812` + `taskkill /PID <pid> /F` |
| 端口 8000/3000 占用 | 旧进程 | `netstat -ano \| findstr :8000` + `taskkill /PID <pid> /F` |
| YAML 路径反斜杠 | 单 `\` 转义 | 用 `/` 或 `\\` |
| 飞书推送不生效 | webhook 没配 | 编辑 `config/channels.yaml` + 重启 |

---

## 🐧 Linux 生产部署

### 步骤

```bash
# 1. 装依赖
pip install -r requirements.txt
bun install

# 2. 启动 QuestDB (real 模式必须)
docker compose -f docker/questdb/docker-compose.yml up -d

# 3. 初始化数据库 (建表)
python scripts/init_db.py

# 4. 路径替换（如需）
python scripts/dev.py paths --env linux

# 5. 改配置
# 编辑 config/app.yaml: adapter_mode: real
# 编辑 config/channels.yaml: 你的 webhook

# 6. 启动
python scripts/dev.py start

# 7. 守护进程模式（可选，生产推荐）
python scripts/dev.py daemon
```

### systemd 服务（可选）

如需开机自启，可写 systemd unit：

```ini
# /etc/systemd/system/tdxquant.service
[Unit]
Description=TdxQuant Engine
After=network.target

[Service]
Type=simple
User=tdxquant
WorkingDirectory=/opt/tdxquant
ExecStart=/opt/tdxquant/.venv/bin/python scripts/dev.py daemon
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable tdxquant
sudo systemctl start tdxquant
```

---

## 🔄 升级流程

### 从更新包升级

```bash
# 1. 备份（必做！）
tar -czf tdxquant.backup.tar.gz tdxquant

# 2. 停服务
python scripts/dev.py stop

# 3. 解压覆盖
cd /opt/tdxquant
tar -xzf /path/to/tdxquant-R13-update.tar.gz

# 4. 恢复本地配置（合并 config/app.yaml + config/channels.yaml）

# 5. 装新依赖
pip install -r requirements.txt
bun install

# 6. 升级 DB schema
python scripts/init_db.py

# 7. 启动 + 验证
python scripts/dev.py start
python scripts/dev.py test --smoke
```

详见 `UPDATE_GUIDE.md`。

---

## 🛑 回滚

```bash
python scripts/dev.py stop
cd /opt
rm -rf tdxquant
tar -xzf tdxquant.backup.tar.gz
python scripts/dev.py start
```

---

## 📊 健康检查

| 端点 | 用途 |
|---|---|
| `GET /health` | FastAPI 存活 |
| `GET /api/monitor/health` | 引擎状态 + API 统计 + 限流状态（R12 新增）|
| `GET /api/monitor?action=status` | 监控引擎状态 |
| `GET /api/strategies` | 策略列表 |

`python scripts/dev.py test --smoke` 自动跑 8 个端点。

---

## ⚠️ 重要提醒

1. **Windows 不需要 Caddy**，直接访问 `:3000`
2. **不要在 Windows 跑 `bun run build`**（除非要生产提速，且已验证 standalone 输出）
3. **不要硬编码路径**，用 `pathlib.Path` 或 YAML 配置
4. **适配器模式切换必须重启**，不支持热加载
5. **R18 起 QuestDB 替代 DuckDB**，多 FastAPI 实例并发写无锁; mock 模式无 QuestDB 自动降级
