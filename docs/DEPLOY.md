# 部署指南

> 涵盖沙箱开发、Windows 生产、Linux 生产三种环境的部署流程。

---

## 📋 环境要求

| 组件 | 版本 | 说明 |
|---|---|---|
| Python | 3.13+ | 后端引擎 |
| Node.js | 18+ | 前端构建 |
| bun | latest | 包管理 + 开发服务器 |
| 通达信金融终端 | 任意 | **仅生产环境**需要，必须预启动并登录 |
| DuckDB | 1.0+ | 单文件数据库，pip 装即用 |

---

## 🏗 沙箱开发环境（Linux + Mock）

### 1. 装依赖
```bash
pip install -r requirements.txt
bun install
```

### 2. 初始化数据库
```bash
python scripts/init_db.py
```

### 3. 启动
```bash
python scripts/dev.py start
# 或: bash scripts/start_all.sh
```

脚本会启动 FastAPI(:8000) + Next.js(:3000) + 健康检查轮询 20×2s。

### 4. 验证
```bash
curl http://127.0.0.1:8000/health                    # → 200
curl http://127.0.0.1:8000/api/strategies            # → 5 个策略
curl http://127.0.0.1:8000/api/monitor/health         # → 含 api_stats + rate_limit
```

打开 `http://localhost:3000` 看 5 Tab。

### 5. 停止
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

#### 4. 切换适配器模式
编辑 `config/app.yaml`：
```yaml
app:
  adapter_mode: real    # mock → real
```
> ⚠️ 适配器模式不支持热加载，必须重启 FastAPI。

#### 5. 启动
```powershell
python scripts/dev.py start
# 或兼容用法: powershell -File scripts\start_all.ps1
```

#### 6. 验证 tqcenter 连通
```powershell
curl http://127.0.0.1:8000/api/monitor?action=status
# 应返回 {"adapter":"real", "subscribed":N, ...}
```

#### 7. 触发一次选股
```powershell
curl -X POST http://127.0.0.1:8000/api/strategies/dbqzt/run
# 等 30s（Real 模式需调 tqcenter 拉数据）
curl http://127.0.0.1:8000/api/selections?strategy_id=dbqzt
# 验证 stock_name 是真实股票名
```

### Windows 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| `ModuleNotFoundError: tqcenter` | 未装 | `pip install tqcenter` 或从通达信终端路径安装 |
| `tq.initialize()` 报「终端未连接」 | 终端未启动 | 启动通达信并登录，保持前台 |
| `database is locked` | 多 FastAPI 实例 | `taskkill /F /IM python.exe` 后重启 |
| 端口 8000/3000 占用 | 旧进程 | `netstat -ano | findstr :8000` + `taskkill /PID <pid> /F` |
| YAML 路径反斜杠 | 单 `\` 转义 | 用 `/` 或 `\\` |
| 飞书推送不生效 | webhook 没配 | 编辑 `config/channels.yaml` + 重启 |

---

## 🐧 Linux 生产部署

### 步骤

```bash
# 1. 装依赖
pip install -r requirements.txt
bun install

# 2. 初始化
python scripts/init_db.py

# 3. 路径替换（如需）
python scripts/dev.py paths --env linux

# 4. 改配置
# 编辑 config/app.yaml: adapter_mode: real
# 编辑 config/channels.yaml: 你的 webhook

# 5. 启动
python scripts/dev.py start

# 6. 守护进程模式（可选，生产推荐）
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
5. **DuckDB 单写锁**，不要开多个 FastAPI 实例
