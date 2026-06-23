# 🪟 TdxQuant Windows 快速入门

> **Windows 5 分钟开箱即用** — 通达信量化系统的本地化部署指南，双击即可启动。

---

## ✅ 前置条件清单

在开始前，请确认下列条件已满足：

- [ ] **Windows 10 / 11 64 位**
- [ ] **Python 3.13+** — 下载: <https://www.python.org/downloads/>
  - ⚠️ 安装时务必勾选 **"Add Python to PATH"**
  - 验证: 打开 cmd 输入 `python --version`，应输出 `Python 3.13.x` 或更高
- [ ] **通达信金融终端已安装并登录一次** — 下载: <https://www.tdx.com.cn>
  - 仅 Real 模式（连真实行情）需要，Mock 模式可跳过
  - 必须先启动并登录一次，让 `tqcenter` 库注册到系统
- [ ] **bun（前端包管理器）** — 一键安装:
  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```
  - 验证: `bun --version`

---

## 🚀 3 步开箱即用

### Step 1 — 解压项目到 `K:\tdxquantv2`

把压缩包解压到 `K:\tdxquantv2`（或其他不含中文/空格的路径）。

> ⚠️ **路径禁忌**: 不要用 `C:\Users\张三\我的文档\tdxquant` 这种含中文/空格的路径，会导致部分脚本失败。
>
> ✅ 推荐: `K:\tdxquantv2`、`D:\tdxquant`、`C:\tdxquant`、`E:\quant\tdxquant`

### Step 2 — 双击 `install.bat`

双击项目根目录的 **`install.bat`**，会自动完成：

| 步骤 | 内容 | 耗时 |
|---|---|---|
| 预检环境 | Python 版本 / pip / 通达信 / 端口可用性 | ~5 秒 |
| 装依赖 | `pip install -r requirements.txt` + `bun install` | 1-3 分钟 |
| 初始化数据库 | QuestDB 建表 (原 DuckDB，R18 替代) + 示例数据 | ~10 秒 |
| 启动 QuestDB | 提示用户启动 (docker compose 或 questdb.exe) | ~5 秒 |
| 配置 tqcenter 路径 | 扫描通达信目录，把 `tqcenter.py` 路径写入 `config\app.yaml` | ~5 秒 |
| 创建快捷方式 | 桌面 `TdxQuant 启动` / `停止` / `大屏.url` | 即时 |
| 最终就绪度报告 | 13 项检查再次输出 | ~5 秒 |

看到 `安装完成!` 即成功。

### Step 3 — 双击 `start.bat` 或桌面快捷方式

双击 **`start.bat`**（或桌面 **"TdxQuant 启动"** 快捷方式）。

---

## 🎯 验证启动成功

启动脚本会自动打开浏览器，访问 `http://127.0.0.1:3000`。

看到 **Dashboard 大屏**（顶部 4 个统计卡片 + 实时行情表格）即表示启动成功 ✅。

如果浏览器没自动打开，手动访问：
- 🖥️ **前端大屏**: <http://127.0.0.1:3000>
- 🔧 **API 健康检查**: <http://127.0.0.1:8000/health>（应返回 `{"status":"ok"}`）

### 命令行验证（可选）

```cmd
:: FastAPI 是否存活
curl http://127.0.0.1:8000/health

:: 策略列表（5 个）
curl http://127.0.0.1:8000/api/strategies

:: 引擎状态 + 限流统计
curl http://127.0.0.1:8000/api/monitor/health
```

三条命令都返回 JSON 即正常。

---

## 🔄 切换 Real 模式（连真实行情）

默认是 **Mock 模式**（用本地 CSV 样本数据），适合学习/调试。
要接通真实行情，按以下步骤切换到 **Real 模式**：

1. **启动通达信终端并登录**（保持前台，不要最小化到托盘）
2. **配置 tqcenter 路径**（关键！tqcenter 不是 pip 包，是通达信目录下的 Python 文件）：
   ```cmd
   :: 方式 A: 自动扫描 + 写入 config\app.yaml (推荐)
   python scripts\install_tqcenter.py

   :: 方式 B: 手动指定路径 (你的通达信装在 K:\txdlianghua)
   python scripts\install_tqcenter.py --path K:\txdlianghua\PYPlugins\user

   :: 方式 C: 用环境变量 (不写配置文件)
   python scripts\install_tqcenter.py --env
   :: 然后按提示在 cmd 里 set TQ_CENTER_PATH=K:\txdlianghua\PYPlugins\user
   ```
   脚本会把 `tqcenter.python_path: "K:\\txdlianghua\\PYPlugins\\user"` 写入 `config\app.yaml`。
3. **编辑 `config\app.yaml`** 切换模式：
   ```yaml
   app:
     adapter_mode: real    # mock → real
   ```
   > 💡 或直接用 `config\app.windows.example.yaml` 复制为 `app.yaml`，已预填 `K:\txdlianghua` 路径 + Real 模式 + 保守限流。
4. **双击 `restart.bat`** 重启服务（适配器模式不支持热加载）
5. **验证**：
   ```cmd
   curl http://127.0.0.1:8000/api/monitor?action=status
   ```
   应返回 `"adapter":"real"` 字样
6. **触发一次选股测试**：
   ```cmd
   curl -X POST http://127.0.0.1:8000/api/strategies/dbqzt/run
   :: 等待约 30 秒（Real 模式需调 tqcenter 拉数据）
   curl http://127.0.0.1:8000/api/selections?strategy_id=dbqzt
   :: 验证返回的 stock_name 是真实股票名
   ```

> ⚠️ Real 模式必须 Windows + 通达信终端已登录。Linux 不支持。
>
> 💡 **tqcenter 工作原理**: 你的项目 → RealAdapter → `sys.path.insert` 加载 `K:\txdlianghua\PYPlugins\user\tqcenter.py` → tqcenter 通过 `ctypes.CDLL` 加载 `K:\txdlianghua\TPythClient.dll` → 通达信终端。所以**不需要 pip install tqcenter**，只要路径配对就行。

### Real 模式初用建议

- **盘前测试**: 9:15-9:25 集合竞价期可调 `auction` 相关 API，行情稳定
- **盘内观察**: 9:30-15:00 是行情活跃期，可看 Dashboard 实时刷新
- **盘后复盘**: 15:00 后可拉日线、跑策略回测，不影响通达信
- **限流参数**: `config\app.yaml` 的 `tqcenter.global_qps: 10` 是默认值，如频繁报 `acquire_or_skip` 警告，可降到 `5`

---

## 🗄️ QuestDB 安装与启动（R18 替代 DuckDB）

R18 起 DuckDB 单文件存储已替换为 **QuestDB**（服务端时序数据库，彻底解决文件锁问题）。Real 模式必须先启动 QuestDB，Mock 模式可跳过（无 QuestDB 时自动降级）。

### 方式 A：Docker（推荐，跨平台一致）

前置：装 [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) 并启动。

```cmd
:: 启动 QuestDB (后台运行, 含 PG wire 8812 / HTTP 9000 / ILP 9009)
docker compose -f docker\questdb\docker-compose.yml up -d

:: 验证启动成功 (应返回 200)
curl http://127.0.0.1:9000/

:: 查看日志
docker logs tdxquant-questdb --tail 50

:: 停止
docker compose -f docker\questdb\docker-compose.yml down
```

数据持久化在 `docker\questdb\questdb-data\`，重启电脑不丢数据。

### 方式 B：原生 questdb.exe（无 Docker 时用）

1. 下载 Windows 版：[https://questdb.io/get/](https://questdb.io/get/)（选 `questdb-windows-amd64.zip`）
2. 解压到 `K:\questdb\`
3. 启动：
   ```cmd
   K:\questdb\questdb.exe start -d K:\questdb\data
   ```
4. 验证：浏览器访问 [http://127.0.0.1:9000](http://127.0.0.1:9000)，看到 Web 控制台即成功
5. 停止：
   ```cmd
   K:\questdb\questdb.exe stop -d K:\questdb\data
   ```

> 💡 想开机自启 QuestDB：用 `schtasks /create /tn "QuestDB" /tr "K:\questdb\questdb.exe start -d K:\questdb\data" /sc onstart /ru SYSTEM /f`

### 验证 QuestDB 连通

```cmd
:: Web 控制台 (浏览器打开)
http://127.0.0.1:9000

:: PG wire 端口 (psycopg2 用)
curl telnet://127.0.0.1:8812

:: 跑预检看 QuestDB 连接项
python scripts\precheck.py
:: 应看到: [PASS] QuestDB 连接 — PG wire 127.0.0.1:8812 可达
```

### QuestDB 配置（config\app.yaml）

默认配置即可使用，需要改时编辑 `config\app.yaml` 的 `questdb` 段：

```yaml
questdb:
  host: 127.0.0.1
  pg_port: 8812          # PG wire (查询/写入)
  http_port: 9000        # HTTP (DDL/Web 控制台)
  username: admin
  password: quest        # 生产环境建议改
  database: qdb
  connect_timeout: 5
  auto_init: true        # 启动时自动建表 (config\questdb_schema.sql)
```

环境变量覆盖（见 `.env.example`）：`QUESTDB_HOST` / `QUESTDB_PG_PORT` / `QUESTDB_HTTP_PORT` / `QUESTDB_USERNAME` / `QUESTDB_PASSWORD` / `QUESTDB_DATABASE`。

---

## 📂 日常使用

| 操作 | 双击文件 | 说明 |
|---|---|---|
| 🟢 启动 | `start.bat` | 前台启动，可看到日志 |
| 🟢 启动（静默后台） | `tdxquant-launcher.vbs` | 无 cmd 黑窗，5 秒后自动开浏览器 |
| 🟢 启动（桌面快捷方式） | 桌面 `TdxQuant 启动` | install.bat 创建 |
| 🔴 停止 | `stop.bat` | 停 FastAPI + Next.js + 健康轮询 |
| 🔄 重启 | `restart.bat` | 先 stop 等 3 秒再 start |
| 🩺 健康检查 | `tdxquant-healthcheck.bat` | 测两个端口状态码 + 开浏览器 |
| 🔄 配置热加载 | cmd 输入 `python scripts\dev.py reload` | 改完 yaml 不重启即生效 |
| 🚀 开机自启 | 见 [windows\TdxQuantAutoStart.xml](windows/TdxQuantAutoStart.xml) | Task Scheduler 模板 |

### 开机自启配置

1. XML 已预填 `K:\tdxquantv2`（你的项目路径）。如装别处，编辑 `windows\TdxQuantAutoStart.xml` 把 `K:\tdxquantv2` 替换为你的实际路径
2. 用管理员 cmd 运行：
   ```cmd
   schtasks /create /tn "TdxQuant" /xml windows\TdxQuantAutoStart.xml /f
   ```
3. 重启电脑后 30 秒内服务会自动后台启动

---

## 🩺 预检脚本

遇到问题先跑预检，会比手动排查更高效：

```cmd
:: 详细诊断（13 项检查）
python scripts\precheck.py

:: 输出 JSON（供脚本调用）
python scripts\precheck.py --json

:: 自动修复（能修的都修，比如初始化数据库）
python scripts\precheck.py --fix
```

预检覆盖：Python 版本 / pip / bun / tqcenter / Python 依赖 / 端口 / 目录可写 / QuestDB schema / QuestDB 连接 / 通达信终端 / 配置文件 / 磁盘空间。

---

## ❓ 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| `'python' 不是内部或外部命令` | Python 没装或没加 PATH | 重装 Python，勾选 "Add to PATH"；或手动把 `C:\Users\xxx\AppData\Local\Programs\Python\Python313\` 加入 PATH |
| `'bun' 不是内部或外部命令` | bun 没装 | `powershell -c "irm bun.sh/install.ps1 \| iex"`，重开 cmd |
| `tq.initialize() 失败` / `终端未连接` | 通达信终端没启动或没登录 | 启动通达信，登录后保持前台（不要最小化到托盘），再 `restart.bat` |
| `ModuleNotFoundError: tqcenter` | tqcenter 路径没配 | `python scripts\install_tqcenter.py`（自动扫描写入 config）；或手动配 `config\app.yaml` 的 `tqcenter.python_path`；或 `set TQ_CENTER_PATH=K:\txdlianghua\PYPlugins\user` |
| `database is locked` | 旧 DuckDB 文件锁遗留 (R18 后 QuestDB 无此问题) | `stop.bat` 后重启;或 `taskkill /F /IM python.exe` 强杀所有 Python 进程 |
| `[WARN] QuestDB 连接 PG wire 127.0.0.1:8812 不可达` | QuestDB 未启动 | `docker compose -f docker\questdb\docker-compose.yml up -d` 或 `questdb.exe start` |
| 端口 8000 / 3000 被占用 | 旧进程没退干净 | `netstat -ano \| findstr :8000` 找 PID，`taskkill /PID <pid> /F` |
| 端口 8812 / 9000 被占用 | QuestDB 端口冲突 | `netstat -ano \| findstr :8812` 找 PID,关掉旧 QuestDB 进程;或改 `config\app.yaml` 的 `questdb.pg_port` / `http_port` |
| 飞书推送不生效 | webhook 没配 | 编辑 `config\channels.yaml`，填 `feishu_webhook`，重启 |
| cmd 中文乱码 | 编码不对 | cmd 执行 `chcp 65001`（UTF-8），或重开 cmd |

### QuestDB 专项 FAQ

**Q1: QuestDB 和 DuckDB 区别？为什么 R18 要迁移？**

| 维度 | DuckDB (R17 及以前) | QuestDB (R18 起) |
|---|---|---|
| 架构 | 单文件嵌入式 | 服务端进程 |
| 并发写 | **单写锁**,多 FastAPI 实例必冲突报 `database is locked` | **无文件锁**,PG wire 多连接并发写 |
| 时序优化 | 无 | 原生时序表 (`timestamp(ts)`),自动分区 + 列存压缩 |
| 访问方式 | `import duckdb` 直连文件 | PG wire (8812, psycopg2) / HTTP (9000, /exec) / ILP (9009) |
| 运维 | 零运维,删 .db 即重置 | 需启动服务 (docker / questdb.exe),有 Web 控制台 |
| 数据持久化 | 单文件 `quant.db` | `docker/questdb/questdb-data/` 或 `K:\questdb\data\` |

迁移原因: DuckDB 单写锁导致多 FastAPI 实例并发必崩 (R12 限流方案缓解但未根治);Real 模式下盘中行情高频写入,锁冲突概率高。QuestDB 服务端架构彻底根治。

**Q2: 如何切换回 DuckDB？**

R18 起 DuckDB 已弃用,仅保留兼容入口:
1. `engine/storage/duckdb_store.py` 仍可 `import DuckDBStore`,但实际指向 `QuestDBStore` (别名)
2. `config/app.yaml` 的 `paths.duckdb` 字段保留,但代码不再读
3. 如确实需要回退 DuckDB,可 git revert R18 提交 (QuestDBStore 类 + duckdb_store.py 改回原 DuckDB 实现 + schema.py 的 QuestDBConfig 删除)

> ⚠️ 不建议回退。QuestDB 在并发写、时序查询、Web 控制台运维上都优于 DuckDB。回退需自行解决文件锁问题。

**Q3: 沙箱/Mock 模式没装 QuestDB 怎么办？**

无需任何操作。Mock 模式不依赖 DB (数据从 `data/v8-samples/` CSV 读),`QuestDBStore._connect()` 失败仅记 WARNING,所有读写降级返回空结果。`scripts/precheck.py` 也会标 `[WARN]` 而非 `[FAIL]`。

**Q4: QuestDB 数据怎么备份/迁移？**

- **Docker**: 数据在 `docker\questdb\questdb-data\`,直接 zip 整个目录即可
- **原生**: 数据在 `K:\questdb\data\`,同上
- **SQL 导出**: Web 控制台 `http://127.0.0.1:9000` 执行 `SELECT * FROM selection_results;` → 导出 CSV

详见 `docs/MAINTENANCE.md` §QuestDB 运维。

---

## 📁 文件清单

项目根目录的所有 `.bat` / `.vbs` 文件用途：

| 文件 | 用途 | 谁来用 |
|---|---|---|
| `install.bat` | 一键安装（首次部署） | 新手 |
| `start.bat` | 前台启动 | 日常 |
| `stop.bat` | 停止服务 | 日常 |
| `restart.bat` | 重启（先 stop 再 start） | 改配置后 |
| `tdxquant-launcher.vbs` | 静默后台启动（无黑窗） | 开机自启 / 后台常驻 |
| `tdxquant-healthcheck.bat` | 健康检查 + 开浏览器 | 排查 |

`windows\` 子目录：

| 文件 | 用途 |
|---|---|
| `TdxQuantAutoStart.xml` | Task Scheduler 开机自启模板 |

`config\` 子目录关键配置：

| 文件 | 用途 |
|---|---|
| `app.yaml` | 主配置（adapter_mode / 端口 / 路径 / 限流） |
| `app.windows.example.yaml` | Windows Real 模式示例（复制为 app.yaml 用） |
| `channels.yaml` | 飞书/钉钉 webhook 配置 |
| `monitor.yaml` | 监控规则 + 形态预警 + 套餐 |

---

## 📚 更多文档

| 文档 | 内容 |
|---|---|
| [docs/README.md](docs/README.md) | 项目总览 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 三环境部署详细指南（沙箱 / Windows / Linux） |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 用户手册（5 Tab 用法） |
| [docs/STRATEGY_FACTOR.md](docs/STRATEGY_FACTOR.md) | 策略与因子开发 |
| [docs/MAINTENANCE.md](docs/MAINTENANCE.md) | 运维 + 8 场景提示词 |
| [docs/maintenance/ARCHITECTURE.md](docs/maintenance/ARCHITECTURE.md) | 5 层架构（改代码前必读） |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 版本变更日志 |

---

## 💡 进阶提示

1. **配置热加载**: 改 `config\*.yaml` 后，cmd 跑 `python scripts\dev.py reload` 即生效，**无需重启**（adapter_mode 例外，必须 restart）
2. **5 个 Tab**: Dashboard / Strategies / Selections / Signals / Sectors + 形态预警 + 实时选股 + 自选股管理 + 全局搜索
3. **Mock 模式不限流**，开发体验优先；Real 模式有令牌桶保护通达信终端 GUI 线程
4. **QuestDB 多进程并发写无锁** (R18 替代 DuckDB): 可以同时跑多个 FastAPI 实例,QuestDB 是服务端架构不会报 `database is locked`
5. **静默后台启动**: `tdxquant-launcher.vbs` 用 VBScript + `WScript.Shell` 实现，无需 Python 进程常驻；适合开机自启场景

### 性能调优速查

| 现象 | 调哪里 | 建议 |
|---|---|---|
| Real 模式频繁报 `acquire_or_skip` | `config\app.yaml` → `tqcenter.global_qps` | 5-10（保守），盘内可调到 15 |
| 前端轮询被限流（429） | `config\app.yaml` → `api.rate_limit.rules` | 按需调高 `qpm` |
| QuestDB 查询慢 | QuestDB Web 控制台 (http://127.0.0.1:9000) 看表体积 | 定期备份 + 删除旧数据;时序表自动分区,分区过期会自动清理 |
| 日志占用磁盘 | `data\logs\` | 保留最近 30 天，旧的可删 |

### 自定义策略

策略文件在 `strategies\` 目录，每个 yaml 一个策略：

```yaml
# strategies\my_strategy.yaml
id: my_strategy
name: 我的策略
factors:
  - type: momentum
    weight: 0.5
    params: { window: 5 }
  - type: volume_price
    weight: 0.5
filter:
  min_score: 0.6
sort: { field: score, order: desc }
```

保存后 `python scripts\dev.py reload` 即生效，前端 Strategies Tab 可见。详见 [docs/STRATEGY_FACTOR.md](docs/STRATEGY_FACTOR.md)。

---

## 🆘 仍需帮助？

1. 先跑 `python scripts\precheck.py` 看具体哪一项 FAIL
2. 跑 `python scripts\precheck.py --fix` 尝试自动修复
3. 查 [docs/DEPLOY.md](docs/DEPLOY.md) 的 "Windows 常见问题" 章节
4. 保留 `data\logs\` 目录下的日志，便于反馈问题

---

**祝你量化顺利！** 📈
