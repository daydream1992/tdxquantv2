# AI 交接文档 — TdxQuant 量化交易系统

> **本文档是 AI 新会话的第一手资料。** 任何新会话开始前，先完整读本文档（约 15 分钟），
> 再按需查阅 `worklog.md` / `maintenance/ARCHITECTURE.md` / `CHANGELOG.md`。
>
> **核心目标**：让接手的 AI 能在 30 分钟内理解项目全貌，并按「实盘接入流程」章节
> 快速把项目从 Mock 模式切换到 Real 模式（通达信实盘数据）。
>
> **最后更新**：R21（2026-06-24）
> **当前状态**：R19 验收 + **R21 实盘真机验证通过（real 模式端到端打通，24 只选股落库）**；
> tqcenter 29 API 全覆盖，QuestDB 迁移完成
>
> ⚠️ **改存储层 / 升级 QuestDB / 排查 real 模式前，先读 [`docs/QUESTDB9_REALMODE_FIXES.md`](QUESTDB9_REALMODE_FIXES.md)**
> （R21 实战经验：QuestDB 9.x 方言兼容清单 + 11 个修复 + 维护 SOP + 经验教训）。

---

## 目录

1. [项目本质（30 秒读懂）](#一项目本质30-秒读懂)
2. [技术栈速查](#二技术栈速查)
3. [5 层架构与目录骨架](#三5-层架构与目录骨架)
4. [核心数据流（必读）](#四核心数据流必读)
5. [实盘数据快速接入流程（重点章节）](#五实盘数据快速接入流程重点章节)
6. [tqcenter API 对接权威指南](#六tqcenter-api-对接权威指南)
7. [QuestDB 存储层（R18 迁移）](#七questdb-存储层r18-迁移)
8. [配置文件全景图](#八配置文件全景图)
9. [前端架构速查](#九前端架构速查)
10. [运维脚本与命令](#十运维脚本与命令)
11. [关键约束与坑点](#十一关键约束与坑点)
12. [常见任务 SOP](#十二常见任务-sop)
13. [未解决问题与下一步](#十三未解决问题与下一步)
14. [文档导航](#十四文档导航)

---

## 一、项目本质（30 秒读懂）

**TdxQuant = 通达信量化交易系统**，基于通达信 TdxQuant API 的 A 股量化交易系统：

```
用户 (Web 前端)  →  FastAPI (Python 引擎)  →  tqcenter (通达信终端 API)
                       ↓                            ↓
                   QuestDB (存储)            TPythClient.dll (Windows)
```

**三大核心能力**：
1. **选股**：5 大策略（打板求涨停/趋势主升浪/错杀低吸/弱转强/强转弱反抽）× 26 个因子
2. **监控**：实时行情订阅 + 10 类预警规则 + 4 通道推送（飞书/Webhook/WebSocket/站内）
3. **回测**：历史数据回测 + 净值曲线 + 多策略对比

**两种运行模式**：
- `mock` — Linux 沙箱开发，数据来自 `data/v8-samples/` CSV 样本，无外部依赖
- `real` — Windows 生产，数据来自通达信终端 `tqcenter` API，必须先启动并登录通达信

**切换方式**：编辑 `config/app.yaml` 的 `app.adapter_mode` 字段（mock ↔ real **必须重启**）

---

## 二、技术栈速查

| 层 | 技术 | 版本 | 说明 |
|---|---|---|---|
| 前端 | Next.js | 16 (App Router) | 唯一用户可见路由 `/` (src/app/page.tsx) |
| 前端 | React | 19 | 10 Tab 单页应用 |
| 前端 | TypeScript | 5 | 严格模式 |
| 前端 | Tailwind CSS | 4 | shadcn/ui 组件库 (New York style) |
| 前端 | Zustand + TanStack Query | latest | 客户端状态 + 服务端状态 |
| 后端 | FastAPI | latest | 端口 8000 |
| 后端 | Python | 3.13+ | 引擎 + 量化计算 |
| 后端 | PyYAML | latest | 配置热加载 |
| 后端 | simpleeval | latest | 表达式引擎（评分公式沙箱） |
| 后端 | pandas | latest | K 线/快照数据处理 |
| 存储 | QuestDB | latest (R18 替代 DuckDB) | 时序数据库，PG wire 8812 / HTTP 9000 / ILP 9009 |
| 存储 | psycopg2-binary | 2.9+ | QuestDB PG wire 连接 |
| 数据源 | tqcenter | 通达信终端内置 | Windows only，ctypes 加载 TPythClient.dll |
| 实时 | WebSocket | 前端 30s 轮询兜底 | 信号推送 |
| 限流 | 三层（令牌桶 + 端点中间件 + 监控统计）| R12 | Real 模式生效，Mock 不限流 |

**端口约定**：
- `3000` — Next.js dev server（用户访问）
- `8000` — FastAPI 引擎（前端代理目标）
- `8812` — QuestDB PG wire（psycopg2 连接）
- `9000` — QuestDB HTTP（Web 控制台 + DDL）
- `9009` — QuestDB ILP（批量写入，可选）

---

## 三、5 层架构与目录骨架

```
L5 用户配置层（每天可能变）→ strategies/*.yaml + config/*.yaml
L4 业务规则层（每周可能变）→ YAML 引用因子插件 + 表达式引擎
L3 组件抽象层（每月可能变）→ factors/ channels/ exporters/ data_adapter/ 插件
L2 核心引擎层（半年不变）  → pipeline/ monitor/ sector/ expression/
L1 基础设施层（一年不变）  → data_adapter/ storage/ api/ config/ utils/
```

### 目录骨架（关键文件标注 ★）

```
/home/z/my-project/
├── engine/                          # 【Python 引擎】
│   ├── data_adapter/                # L1+L3: 数据源适配器
│   │   ├── base.py                  #   ★ BaseDataAdapter 抽象基类（29 API 接口）
│   │   ├── mock_adapter.py          #   ★ Mock 适配器（CSV 样本，沙箱用）
│   │   ├── real_adapter.py          #   ★ Real 适配器（tqcenter API，生产用）
│   │   ├── factory.py               #   工厂（按 config.app.adapter_mode 切换）
│   │   ├── tqcenter_fields.py       #   ★ API_REGISTRY 29 个 API 字段权威目录
│   │   └── rate_limiter.py          #   令牌桶（Layer 1 限流）
│   ├── pipeline/                    # L2: 选股流水线
│   │   ├── runner.py                #   ★ StrategyRunner.run_strategy()
│   │   └── steps/                   #   6 步：load→clean→factors→score→filter→export
│   ├── monitor/                     # L2: 监控引擎
│   │   ├── engine.py                #   ★ MonitorEngine (subscribe_hq + 10s 轮询)
│   │   ├── rules.py                 #   RuleSet 预警条件求值
│   │   └── match_registry.py        #   匹配策略注册表
│   ├── factors/                     # L3: 26 个因子插件
│   │   ├── base.py                  #   Factor 基类（自动扫描注册）
│   │   ├── registry.py              #   注册表
│   │   └── *.py                     #   momentum/breakout/turnover/valuation/...
│   ├── channels/                    # L3: 4 个推送通道
│   │   ├── tdx_warn.py              #   通达信预警（send_warn）
│   │   ├── websocket.py             #   WebSocket
│   │   ├── feishu.py                #   飞书
│   │   └── csv_log.py               #   CSV 日志
│   ├── exporters/                   # L3: 4 种导出器
│   │   ├── csv_exporter.py
│   │   ├── excel_exporter.py
│   │   ├── sector_exporter.py       #   回写通达信板块
│   │   └── duckdb_exporter.py       #   QuestDB 持久化（名字保留兼容）
│   ├── storage/                     # L1: 存储层
│   │   ├── questdb_store.py         #   ★ QuestDBStore (PG wire + HTTP + _gen_id + _convert_sql)
│   │   ├── duckdb_store.py          #   兼容别名 (DuckDBStore = QuestDBStore)
│   │   └── __init__.py              #   导出 get_store()
│   ├── api/                         # FastAPI 服务
│   │   ├── main.py                  #   ★ 入口（端口 8000）
│   │   ├── routes/                  #   40+ 路由
│   │   │   ├── strategies.py        #     策略 CRUD + run
│   │   │   ├── selection.py         #     选股结果
│   │   │   ├── monitor.py           #     监控 + 健康度
│   │   │   ├── signals.py           #     信号
│   │   │   ├── sectors.py           #     板块
│   │   │   ├── backtest.py          #     回测
│   │   │   ├── watchlist.py         #     自选股
│   │   │   └── ...
│   │   ├── middleware/rate_limit.py #   Layer 2 限流中间件
│   │   ├── state.py                 #   Layer 3 监控统计
│   │   └── schemas.py               #   Pydantic 模型
│   ├── config/                      # L1: 配置加载
│   │   ├── loader.py                #   ★ ConfigLoader (YAML 热加载)
│   │   └── schema.py                #   ★ AppConfigRoot + QuestDBConfig + TqCenterConfig
│   ├── expression/evaluator.py      #   simpleeval 表达式引擎
│   ├── sector/manager.py            #   板块管理（原子操作）
│   └── utils/
│       ├── stock_code.py            #   代码归一化 (normalize)
│       ├── time.py                  #   日期归一化 (normalize_date)
│       ├── encoding.py              #   Windows UTF-8 强制（R18 新增）
│       └── logger.py
├── src/                             # 【Next.js 前端】
│   ├── app/
│   │   ├── page.tsx                 #   ★ 唯一用户可见路由（10 Tab）
│   │   ├── layout.tsx
│   │   └── api/                     #   37 个 API 代理路由 → FastAPI
│   ├── components/
│   │   ├── ui/                      #   48 个 shadcn/ui 组件
│   │   └── quant/                   #   量化专用组件
│   │       ├── Dashboard.tsx        #     实时大屏
│   │       ├── StrategyManager.tsx  #     策略管理
│   │       ├── SelectionResults.tsx #     选股结果
│   │       ├── SignalCenter.tsx     #     信号中心
│   │       ├── SectorManager.tsx    #     板块管理
│   │       ├── BacktestView.tsx     #     回测
│   │       ├── WatchlistManager.tsx #     自选股
│   │       ├── RealtimeSelection.tsx#     实时选股
│   │       ├── PatternAlertLibrary.tsx #  形态预警
│   │       └── AuctionPanel.tsx     #     竞价监控
│   └── lib/
│       ├── api.ts                   #   API 客户端
│       ├── api-proxy.ts             #   ★ 统一代理 helper (tryFastAPI/ok/err/fallback)
│       ├── useRealtime.ts           #   实时数据 hook
│       └── theme.ts                 #   主题
├── config/                          # 【L5 配置】
│   ├── app.yaml                     #   ★ 主配置（adapter_mode/paths/questdb/tqcenter/api限流）
│   ├── app.windows.example.yaml     #   Windows 部署示例
│   ├── monitor.yaml                 #   监控（4 段：monitor/alert_templates/dedup/match_strategies）
│   ├── channels.yaml                #   4 通道配置
│   ├── cleaning_rules.yaml          #   V8.1 5 项数据清洗
│   ├── sector_mapping.yaml          #   策略↔板块映射
│   ├── export.yaml                  #   导出配置
│   ├── theme.yaml                   #   前端主题
│   ├── questdb_schema.sql           #   ★ QuestDB 8 张表 schema
│   └── duckdb_schema.sql            #   [已弃用] 旧 DuckDB schema
├── strategies/                      # 【L4 策略 YAML】
│   ├── _template.yaml               #   模板（复制即用）
│   ├── strategy_dbqzt.yaml          #   打板求涨停
│   ├── strategy_qszsl.yaml          #   趋势主升浪
│   ├── strategy_cslx.yaml           #   错杀低吸
│   ├── strategy_rzq.yaml            #   弱转强
│   └── strategy_qzrfc.yaml          #   强转弱反抽
├── scripts/                         # 【运维脚本】
│   ├── dev.py                       #   ★ 主入口（start/stop/setup/reload/test/paths/daemon）
│   ├── init_db.py                   #   QuestDB 初始化
│   ├── precheck.py                  #   13 项环境预检
│   ├── install_tqcenter.py          #   tqcenter 路径扫描
│   ├── run_selection.py             #   命令行选股
│   └── start_all.sh / .ps1          #   兼容 wrapper
├── docker/questdb/                  # 【QuestDB 部署】
│   ├── docker-compose.yml           #   ★ Docker 启动模板
│   ├── questdb.conf                 #   配置
│   └── questdb-data/                #   数据持久化目录
├── data/                            # 【运行时数据】
│   ├── duckdb/                      #   [已弃用] 旧 DuckDB 文件
│   ├── v8-samples/                  #   ★ Mock 模式数据源（CSV 样本）
│   ├── csv/                         #   CSV 导出
│   ├── excel/                       #   Excel 导出
│   └── logs/                        #   日志
├── docs/                            # 【文档】
│   ├── AI_HANDOVER.md               #   ★ 本文档
│   ├── maintenance/ARCHITECTURE.md  #   5 层架构详解
│   ├── USER_GUIDE.md                #   用户手册
│   ├── MAINTENANCE.md               #   运维手册
│   ├── DEPLOY.md                    #   部署指南
│   ├── STRATEGY_FACTOR.md           #   策略/因子开发
│   ├── CHANGELOG.md                 #   变更日志
│   └── tongdaxin-api-docs/          #   ★ 通达信官方说明书（49 篇 markdown，权威来源）
├── windows/                         # 【Windows 自启动】
│   └── TdxQuantAutoStart.xml        #   计划任务 XML
├── worklog.md                       #   ★ 工作日志（AI 必读，每次改动 append）
├── worklog-archive-R5-R13.md.gz     #   归档（R5-R13 全部 13008 行）
├── requirements.txt                 #   Python 依赖
├── package.json                     #   Node 依赖
├── Caddyfile                        #   网关配置（沙箱用）
├── install.bat / start.bat / stop.bat / restart.bat  # Windows 一键脚本
├── start-questdb.bat                #   QuestDB 启动脚本
└── tdxquant-launcher.vbs            #   Windows 静默启动
```

---

## 四、核心数据流（必读）

### 4.1 选股流程

```
用户点"执行选股" (前端 StrategyManager)
  → POST /api/strategies/{id}/run (经 Layer 2 限流, qpm=10)
  → Next.js api/strategies/[id]/run/route.ts 代理
  → FastAPI engine/api/routes/strategies.py
  → StrategyRunner.run_strategy() (engine/pipeline/runner.py)
  → Pipeline 6 步执行:
      1. load_data.py    → adapter.get_more_info() / get_market_data() 拉数据
      2. clean_data.py   → 应用 cleaning_rules.yaml 清洗
      3. calc_factors.py → 26 个因子并行计算
      4. score.py        → simpleeval 表达式求值
      5. filter_sort.py  → 按 score 排序取 Top N
      6. export.py       → 写 QuestDB selection_results + CSV/Excel 导出
  → 自动订阅 Top 20 到 MonitorEngine
  → 返回 run_id 给前端
```

### 4.2 监控流程

```
MonitorEngine 后台线程 (engine/monitor/engine.py):
  - Mock 模式: subscribe_hq → MockAdapter._push_loop (3s/次读 CSV)
  - Real 模式: subscribe_hq 优先 (tqcenter 回调), 失败降级 10s 轮询
    (Layer 1 令牌桶守卫, qps=10/burst=20)

on_quote(snapshot) 触发:
  → RuleSet.snap_to_variables() 转换为规则变量
  → RuleSet.evaluate() 求值 14 个信号模板
  → 命中规则 → 写 signal_events 表
  → ChannelRegistry.dispatch() 4 通道推送
  → 前端 SignalCenter 30s 轮询展示 + SignalToast 即时推送
```

### 4.3 适配器切换（mock ↔ real）

```
config/app.yaml 的 app.adapter_mode
  → ConfigLoader.get("app.adapter_mode")
  → factory.get_adapter() (单例 + threading.Lock)
  → mock: MockAdapter() (从 data/v8-samples/ 读 CSV)
  → real: RealAdapter() (动态 import tqcenter, 调 tq.Xxx API)
  → adapter.initialize()
  → 业务层全走 BaseDataAdapter 抽象接口，对上层透明
```

---

## 五、实盘数据快速接入流程（重点章节）

> **目标**：把项目从 Mock 模式（沙箱 CSV）切换到 Real 模式（通达信实盘数据）。
> **前置条件**：Windows 10/11 + 通达信金融终端已安装并登录一次 + Python 3.13+ + 项目已解压。

### Step 0 — 环境准备（5 分钟）

```cmd
:: 1. 解压项目到不含中文/空格的路径，推荐 K:\tdxquantv2
:: 2. 确保 Python 3.13+ 已装并加入 PATH
python --version   :: 应输出 Python 3.13.x

:: 3. 确保通达信终端已安装并登录一次（让 tqcenter 库注册到系统）
::    通达信目录示例: K:\txdlianghua\
::    tqcenter.py 位置: K:\txdlianghua\PYPlugins\user\tqcenter.py

:: 4. (推荐) 安装 Docker Desktop 用于启动 QuestDB
::    或下载 questdb-windows-amd64.zip 解压到 K:\questdb\
```

### Step 1 — 启动 QuestDB（2 分钟）

**方式 A: Docker（推荐）**
```cmd
cd K:\tdxquantv2
docker compose -f docker\questdb\docker-compose.yml up -d

:: 验证
curl http://127.0.0.1:9000/    :: 应返回 200 (Web 控制台)
docker logs tdxquant-questdb --tail 20
```

**方式 B: 原生二进制（无 Docker / Docker Hub 不可达时用，国内推荐）**
```cmd
:: 下载 questdb-*-rt-windows-x86-64.tar.gz（-rt 自带 JRE，无需另装 Java）解压到 K:\questdb\
::   https://github.com/questdb/questdb/releases

:: 启动（questdb.exe install 需管理员；非管理员用 java -m 直跑，最稳）
cd K:\questdb\bin
java -m io.questdb/io.questdb.ServerMain -d K:\questdb\bin\qdbroot

:: 验证
curl http://127.0.0.1:9000/exec?query=SELECT%201    :: 应返回 JSON
```

**或双击 `start-questdb.bat`**（自动检测 docker，无 docker 时打印下载指南）。

### Step 2 — 配置 tqcenter 路径（1 分钟）

编辑 `config/app.yaml`，找到 `tqcenter` 段：

```yaml
tqcenter:
  # 方式 1: 显式配置 tqcenter.py 所在目录（推荐，最稳定）
  python_path: "K:\\txdlianghua\\PYPlugins\\user"

  # 方式 2: 留空让 RealAdapter 自动扫描通达信常见安装路径
  # python_path: ""
  # 自动扫描路径列表见 real_adapter.py 的 _TDX_COMMON_PATHS + _TQCENTER_SUBPATHS
  # 包含: C:\new_tdx / D:\new_tdx / K:\txdlianghua 等下的 PYPlugins\user

  # tq.initialize(path) 入参，留 "__file__" 让代码自动用 python_path/tqcenter.py
  initialize_file: __file__

  # 也可用环境变量覆盖（优先级最高）:
  #   TQ_CENTER_PATH = K:\txdlianghua\PYPlugins\user
  #   TQ_CENTER_INITIALIZE = K:\txdlianghua\PYPlugins\user\tqcenter.py
```

**或直接设环境变量**（不改配置文件）：
```cmd
set TQ_CENTER_PATH=K:\txdlianghua\PYPlugins\user
set TQ_CENTER_INITIALIZE=K:\txdlianghua\PYPlugins\user\tqcenter.py
```

### Step 3 — 切换 adapter_mode 为 real（30 秒）

编辑 `config/app.yaml`：

```yaml
app:
  adapter_mode: real    # mock → real
```

> ⚠️ **适配器模式不支持热加载**，改完必须重启 FastAPI。

### Step 4 — 启动服务（1 分钟）

```cmd
:: 方式 1: 双击 start.bat（推荐，自动打开浏览器）
start.bat

:: 方式 2: 命令行
python scripts\dev.py start

:: 方式 3: 守护进程模式
python scripts\dev.py daemon
```

### Step 5 — 验证实盘接入成功（1 分钟）

```cmd
:: 1. 引擎状态应显示 adapter_mode=real（注意路由是 /api/monitor/status）
curl http://127.0.0.1:8000/api/monitor/status
:: 期望: {"engine_status":"running","adapter_mode":"real",...}

:: 2. 查看启动日志，应出现:
::    "tqcenter 已从 K:\txdlianghua\PYPlugins\user 导入"
::    "tqcenter API 覆盖完整：说明书 29 个 API 全部就绪"
::    "RealAdapter tq.initialize 完成"

:: 3. 预检 13 项全过
python scripts\precheck.py
:: 期望: [PASS] QuestDB 连接 / [PASS] tqcenter 路径 / [PASS] 13 项检查

:: 4. 跑一次选股验证数据流通
curl -X POST http://127.0.0.1:8000/api/strategies/dbqzt/run
:: 期望: 返回 run_id + result_count > 0

:: 5. QuestDB Web 控制台看数据
::    浏览器访问 http://127.0.0.1:9000
::    执行 SQL: SELECT * FROM selection_results ORDER BY created_at DESC LIMIT 10;
```

### Step 6 — 前端访问

打开浏览器访问 `http://127.0.0.1:3000`（或通过预览面板），应看到：
- 顶部 4 个统计卡片有真实数据
- 策略管理 Tab 5 个策略可运行
- 选股结果 Tab 有实盘选股记录
- 信号中心 Tab 盘中会实时推送预警

### 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `tqcenter 不可用：未找到 tqcenter.py` | 路径配置错或通达信未安装 | 检查 `python_path` 或设 `TQ_CENTER_PATH` 环境变量 |
| `tq.initialize 失败` | 通达信终端未启动/未登录 | 先启动通达信终端并登录一次 |
| `tqcenter 缺少说明书定义的 N 个 API` | 通达信版本过旧 | 升级通达信终端到最新版 |
| `QuestDB 连接不可达` | QuestDB 未启动 | `docker compose up -d` 或 `questdb.exe start` |
| `端口 8812/9000 被占用` | 其他服务占用 | 改 `config/app.yaml` 的 `questdb.pg_port/http_port` |
| `psycopg2 ImportError` | Python 依赖未装 | `pip install -r requirements.txt` |
| 选股结果为空 | 通达信未下载数据包 | 在通达信客户端手动下载 K 线 + 财务数据包 |
| 监控无信号推送 | 非交易时段 / 未订阅 | 确认交易时段 9:25-11:30/13:00-15:00 + 已执行选股触发自动订阅 |

---

## 六、tqcenter API 对接权威指南

### 6.1 架构

```
项目代码
  → engine/data_adapter/real_adapter.py (RealAdapter)
  → 动态 sys.path.insert + from tqcenter import tq
  → tqcenter.py (在通达信目录 K:\txdlianghua\PYPlugins\user\)
  → ctypes.CDLL 加载 TPythClient.dll
  → 通达信终端进程（必须预启动并登录）
```

### 6.2 字段权威目录

**唯一事实来源**：`engine/data_adapter/tqcenter_fields.py` 的 `API_REGISTRY`（29 个 API）

**对照说明书**：`docs/tongdaxin-api-docs/通达信量化平台说明书/`（49 篇 markdown）

**29 个 API 分类**：

| 类别 | API 数 | 列表 |
|---|---|---|
| 行情类 | 9 | get_market_snapshot / get_market_data / get_pricevol / get_more_info / get_stock_info / get_gb_info / get_gb_info_by_date / get_relation / get_ipo_info |
| 财务类 | 3 | get_financial_data (FN系列) / get_gp_one_data (GO系列) / get_gpjy_value (GP系列) |
| 分类板块 | 3 | get_stock_list / get_sector_list / get_stock_list_in_sector |
| 客户端操作 | 6 | get_user_sector / create_sector / delete_sector / rename_sector / clear_sector / send_user_block |
| ETF/可转债 | 2 | get_kzz_info / get_trackzs_etf_info |
| 通用函数 | 6 | get_trading_dates / send_message / send_warn / refresh_cache / refresh_kline / download_file |

### 6.3 参数名对齐说明书（R17 修正 7 处 + R19 补 2 处）

**关键易错点**（说明书参数名 vs 直觉命名）：

| API | 说明书参数名 | ❌ 错误直觉命名 |
|---|---|---|
| send_user_block | `stocks=` | stock_list= |
| get_trackzs_etf_info | `zs_code=` | etf_code= |
| send_message | `msg_str=` | msg= |
| refresh_kline | `stock_list=` (列表) | stock_code= (字符串) |
| get_sector_list | 无 market 参数 | market= |
| clear_sector | 直接 API | 用 send_user_block(code, []) 变通 |
| get_user_sector | 无参数 | block_code= |
| get_stock_list_in_sector | `block_code=` | code= |

### 6.4 适配层签名 vs tqcenter 原生签名

RealAdapter 的方法签名是**适配层签名**（业务层友好），内部调用 `tq.Xxx()` 时用**说明书参数名**：

```python
# 适配层签名（业务层调用）
def get_more_info(self, code: str, field_list: FieldList | None = None) -> dict:

# 内部调用 tqcenter（参数名对齐说明书）
tq.get_more_info(stock_code=ncode, field_list=field_list or [])
```

### 6.5 tqcenter 动态导入机制

`real_adapter.py` 的 `_import_tqcenter()` 按 4 级优先级解析路径：

1. **直接 import** — 用户已 `pip install -e` 或设 `PYTHONPATH`
2. **环境变量 `TQ_CENTER_PATH`** — 绝对路径，指向含 tqcenter.py 的目录
3. **config `tqcenter.python_path`** — 同上
4. **扫描通达信常见目录** — Windows only，见 `_TDX_COMMON_PATHS` + `_TQCENTER_SUBPATHS`

`tq.initialize(path)` 路径解析（`real_adapter.py` 的 `initialize()`）：
1. config `tqcenter.initialize_file`（如果不是 `"__file__"` 占位符）
2. config `tqcenter.python_path` + `/tqcenter.py`
3. 环境变量 `TQ_CENTER_INITIALIZE`
4. `__file__` 兜底（可能无法定位 DLL）

### 6.6 限流（三层）

| Layer | 位置 | 作用 | 配置 | 生效模式 |
|---|---|---|---|---|
| L1 令牌桶 | `rate_limiter.py` + `real_adapter.py` 20 个方法 | 保护通达信终端 GUI 线程 | `tqcenter.global_qps=10` / `burst=20` | Real only |
| L2 端点中间件 | `middleware/rate_limit.py` 7 条规则 | 保护 FastAPI + Next 代理 | `api.rate_limit.rules` | Mock + Real |
| L3 监控统计 | `state.py` | 透出 api_stats + rate_limit | 自动 | Mock + Real |

**fail-open 设计**：中间件异常放行，不误杀请求。

**热加载**：
- `tqcenter.global_qps/burst` 支持热加载（`reset_limiter` 已接入 reload 链）
- `api.rate_limit.rules` 不支持热加载（中间件启动时加载，需重启）

### 6.7 API 覆盖率验证

R19 验收结果：**29/29 API 全覆盖** ✓

```python
# 验证脚本
from engine.data_adapter.tqcenter_fields import API_REGISTRY
from engine.data_adapter.real_adapter import RealAdapter
from engine.data_adapter.mock_adapter import MockAdapter
real_m = set(dir(RealAdapter)); mock_m = set(dir(MockAdapter))
missing = [a for a in API_REGISTRY if a not in real_m]
# 期望: missing = []
```

`RealAdapter.initialize()` 内置 `_probe_api_coverage()` 方法，启动后自动核对 tqcenter 实际暴露的 API 与说明书差异，缺失的记 WARNING（不阻断）。

---

## 七、QuestDB 存储层（R18 迁移）

> ⚠️ **R21 实测补充（重要）**：R18 迁移代码按 PostgreSQL 方言写，**在真实 QuestDB 9.x 上有
> 6 类不兼容**（`/exec` 只接受 GET、占位符需 `%s` 非 `$1`、不支持 `CURRENT_DATE`/
> `CURRENT_TIMESTAMP`/`DELETE FROM`、designated timestamp 列 INSERT 必填）。这些已在 R21 集中
> 修复并兜底（见 `questdb_store._convert_sql` / `_http_exec`），**新写 SQL 勿再用 PG 方言**。
> 完整清单见 [`docs/QUESTDB9_REALMODE_FIXES.md` §二](QUESTDB9_REALMODE_FIXES.md)。

### 7.1 为什么从 DuckDB 迁移到 QuestDB

| 痛点 | DuckDB (R5-R17) | QuestDB (R18+) |
|---|---|---|
| 并发写 | 单写锁，多 FastAPI 实例必冲突 `database is locked` | 无文件锁，PG wire 多连接并发写 |
| 时序优化 | 无 | 原生 `timestamp(ts)` + 自动分区 + 列存压缩 |
| 高频写入 | 锁争用严重，R12 限流仅缓解 | 服务端架构，天生支持高频写入 |
| Web 运维 | 无 | HTTP 9000 控制台（查表/执行 SQL/看分区） |

### 7.2 接口零改动迁移

```python
# 旧代码（R5-R17）仍可用，DuckDBStore 是 QuestDBStore 的别名
from engine.storage.duckdb_store import DuckDBStore
# 等价于
from engine.storage.questdb_store import QuestDBStore as DuckDBStore
```

### 7.3 QuestDBStore 核心设计

文件：`engine/storage/questdb_store.py`（620 行）

**三通道访问**：
- PG wire (8812) — psycopg2 连接，查询/写入
- HTTP (9000) — requests 调 `/exec` 端点，DDL 用
- ILP (9009) — InfluxDB Line Protocol，批量写入（可选，高性能场景）

**SQL 方言自动适配**（`_convert_sql()`）：
- `?` 占位符 → `$1, $2, ...`（PG wire 风格）
- 跳过字符串字面量内的 `?`

**应用层 ID 生成**（`_gen_id()`）：
- 替代 DuckDB 的 `SEQUENCE + nextval()`
- 毫秒时间戳 × 1000 + 随机数，保证唯一

**UPSERT 模式**（`upsert()` 辅助方法）：
- 替代 DuckDB 的 `UNIQUE INDEX`
- `DELETE WHERE key=?` + `INSERT`

**优雅降级**：
- 沙箱/mock 模式无 QuestDB 时，`_connect()` 失败仅记 WARNING
- `is_available` 属性返回 `False`
- `execute/query` 返回空结果
- `init_db()` 跳过建表
- mock 模式不依赖 DB 仍可运行

### 7.4 8 张表 schema

文件：`config/questdb_schema.sql`（153 行）

| 表名 | 用途 | designated timestamp | 主键 |
|---|---|---|---|
| strategies | 策略注册表 | 无（非时序） | strategy_id |
| selection_results | 选股结果 | created_at | id (LONG) |
| signal_events | 信号事件 | triggered_at | id (LONG) |
| sector_snapshots | 板块快照 | snapshot_at | id (LONG) |
| strategy_runs | 策略执行日志 | 无 | run_id (UUID) |
| monitor_subscriptions | 监控订阅 | subscribed_at | id (LONG) |
| config_changes | 配置变更审计 | changed_at | id (LONG) |
| kline_cache | K线缓存 | cached_at | id (LONG) |

**QuestDB 方言要点**：
- 无 `SEQUENCE/AUTOINCREMENT` → 应用层 `_gen_id()` 生成 LONG ID
- 无 `UNIQUE` 约束 → 应用层 UPSERT（DELETE + INSERT）
- 无 `DEFAULT CURRENT_TIMESTAMP` → 应用层填值
- `SYMBOL CAPACITY N` 类型 → 低基数字符串（stock_code/alert_type）自动去重+压缩
- `timestamp(col)` → 标记 designated timestamp，自动按天 partition
- 参数化查询 → PG wire 用 `$1,$2,...`（DuckDB 用 `?`）

### 7.5 环境变量覆盖

优先级：环境变量 > `config/app.yaml` 的 `questdb` 段

```bash
QUESTDB_HOST=127.0.0.1
QUESTDB_PG_PORT=8812
QUESTDB_HTTP_PORT=9000
QUESTDB_USERNAME=admin
QUESTDB_PASSWORD=quest
QUESTDB_DATABASE=qdb
```

---

## 八、配置文件全景图

| 文件 | 职责 | 修改频率 | 热加载 |
|---|---|---|---|
| `config/app.yaml` | 主配置（adapter_mode/paths/questdb/tqcenter/api限流） | 极低 | 部分（adapter_mode 不支持） |
| `config/app.windows.example.yaml` | Windows 部署示例 | 极低 | - |
| `config/monitor.yaml` | 监控（4 段：monitor/alert_templates/dedup/match_strategies） | 高 | ✓ |
| `config/channels.yaml` | 4 个推送通道 | 中 | ✓ |
| `config/cleaning_rules.yaml` | V8.1 5 项数据清洗 | 中 | ✓ |
| `config/sector_mapping.yaml` | 策略↔板块映射 | 新增策略时 | ✓ |
| `config/export.yaml` | 导出配置 | 低 | ✓ |
| `config/theme.yaml` | 前端主题 | 中 | ✓ |
| `config/questdb_schema.sql` | QuestDB 8 张表 schema | 极低 | - (init_db 时读) |
| `config/duckdb_schema.sql` | [已弃用] 旧 DuckDB schema | - | - |
| `strategies/strategy_*.yaml` | 5 个策略定义 | 高（调参） | ✓ |

### 关键配置项速查

**`config/app.yaml` 关键段**：

```yaml
app:
  adapter_mode: mock    # mock | real（real 必须 Windows + 通达信）

questdb:                # R18 新增
  host: 127.0.0.1
  pg_port: 8812         # PG wire
  http_port: 9000       # HTTP
  auto_init: true       # 启动时自动建表

tqcenter:               # Real 模式必填
  python_path: ""       # tqcenter.py 所在目录，留空自动扫描
  initialize_file: __file__
  subscribe_batch_size: 50
  kline_max_count: 24000
  global_qps: 10        # Layer 1 限流
  burst: 20
  fields:               # R17 字段配置
    v8_snapshot_source_api: get_more_info
    v8_snapshot_field_list: []  # 留空返回全部 88 字段

api:
  rate_limit:           # Layer 2 限流
    enabled: true
    rules:              # 7 条规则
      - path_prefix: "/api/monitor"
        qpm: 60
```

---

## 九、前端架构速查

### 9.1 路由

- **唯一用户可见路由**：`/` (`src/app/page.tsx`)
- **API 代理路由**：37 个 `src/app/api/*/route.ts` → FastAPI

### 9.2 10 Tab 单页应用

| Tab | 组件 | 功能 |
|---|---|---|
| 实时大屏 | Dashboard.tsx | 行情总览 + 涨跌榜 + 资金流向 + 引擎健康卡 |
| 策略管理 | StrategyManager.tsx | 5 策略启停/运行/复制/删除/编辑 |
| 选股结果 | SelectionResults.tsx | 历史选股 + 导出 CSV/Excel + 回测入口 |
| 信号中心 | SignalCenter.tsx | 预警信号列表 + 详情抽屉 + 重推 |
| 板块管理 | SectorManager.tsx | 策略↔板块映射 + 成份股维护 |
| 匹配策略 | MatchStrategyManager.tsx | 5 个匹配策略配置 |
| 自选股 | WatchlistManager.tsx | 自选股管理 + 批量导入 |
| 实时选股 | RealtimeSelection.tsx | 定时器轮询 + 流式更新 |
| 形态预警 | PatternAlertLibrary.tsx | 7 类形态预警套餐 |
| 竞价监控 | AuctionPanel.tsx | 集合竞价实时面板 |

### 9.3 API 代理统一

所有 37 个 `src/app/api/*/route.ts` 用 `src/lib/api-proxy.ts` 的 4 个 helper：

```typescript
import { tryFastAPI, ok, err, fallback } from "@/lib/api-proxy";

export async function GET(request: NextRequest) {
  return tryFastAPI(request, "/api/strategies", fallback("/api/strategies"));
}
```

**降级数据**：FastAPI 不可用时，`fallback(path)` 返回 mock 数据（原 `mock-data.ts` 已删除）。

### 9.4 实时数据

- `src/lib/useRealtime.ts` — WebSocket + 30s 轮询兜底
- `src/components/quant/SignalToast.tsx` — 信号即时推送
- `src/components/quant/EngineHealthCard.tsx` — 引擎健康度 15s 刷新

---

## 十、运维脚本与命令

### 10.1 主入口 `scripts/dev.py`

```bash
python scripts/dev.py start    # 启动双服务（FastAPI:8000 + Next.js:3000）
python scripts/dev.py stop     # 停止
python scripts/dev.py setup    # 环境初始化
python scripts/dev.py reload   # 热加载配置（adapter_mode 除外）
python scripts/dev.py test --smoke   # 8 端点冒烟测试
python scripts/dev.py test --lint    # ESLint
python scripts/dev.py test --all     # 全部
python scripts/dev.py paths --env windows  # 路径替换（Windows 部署）
python scripts/dev.py daemon   # 守护进程模式
```

### 10.2 其他脚本

| 脚本 | 用途 |
|---|---|
| `scripts/init_db.py` | QuestDB 初始化（建 8 张表） |
| `scripts/precheck.py` | 13 项环境预检（Python/pip/通达信/QuestDB/端口/依赖） |
| `scripts/install_tqcenter.py` | 扫描通达信目录，配置 tqcenter 路径 |
| `scripts/run_selection.py` | 命令行选股（`--strategy dbqzt --date 2025-06-22`） |
| `scripts/reload_config.py` | 热加载配置（等同 `dev.py reload`） |
| `scripts/create_shortcut.py` | 创建桌面快捷方式 |

### 10.3 Windows 一键脚本

| 脚本 | 用途 |
|---|---|
| `install.bat` | 一键安装（预检 + 装依赖 + 建库 + 配置 + 快捷方式） |
| `start.bat` | 启动双服务 + 打开浏览器 |
| `stop.bat` | 停止服务 |
| `restart.bat` | 重启（改 adapter_mode 后用） |
| `start-questdb.bat` | 启动 QuestDB（自动检测 docker） |
| `tdxquant-launcher.vbs` | 静默启动（无控制台窗口） |
| `tdxquant-healthcheck.bat` | 健康检查 |

### 10.4 常用 API 端点

```bash
# 引擎状态
curl http://127.0.0.1:8000/api/monitor?action=status

# 健康检查
curl http://127.0.0.1:8000/health

# 策略列表
curl http://127.0.0.1:8000/api/strategies

# 执行选股
curl -X POST http://127.0.0.1:8000/api/strategies/dbqzt/run

# 选股结果
curl http://127.0.0.1:8000/api/selections?strategy_id=dbqzt

# 信号列表
curl http://127.0.0.1:8000/api/signals?limit=20

# 热加载配置
curl -X POST http://127.0.0.1:8000/api/config/reload
```

---

## 十一、关键约束与坑点

### 11.1 硬约束（违反必崩）

1. **适配器模式不支持热加载** — 改 `adapter_mode` (mock ↔ real) **必须重启** FastAPI
2. **api.rate_limit.rules 变更需重启** — 中间件启动时加载，热加载不生效
3. **QuestDB 必须先启动** — Real 模式前置依赖；Mock 模式自动降级（不依赖 DB）
4. **通达信终端必须预启动并登录** — Real 模式前置依赖（Windows only）
5. **tqcenter 仅 Windows 可用** — Linux 沙箱无法运行 Real 模式（代码骨架可加载，调用抛 RuntimeError）
6. **`send_user_block` 是追加非覆盖** — 更新板块前必须先 `clear_sector`
7. **`subscribe_hq` 上限 100 只** — 自动分批 50（可配置 `tqcenter.subscribe_batch_size`）
8. **`get_market_data` 单次最多 24000 条** — 自动分批续传（按 end_time 倒推）
9. **QuestDB 9.x 不支持 `DELETE FROM`**（R21）— 退订/清理一律 `UPDATE active=false` 软删除；归档行按 `active=true` 过滤隔离
10. **designated timestamp 列 INSERT 必填**（R21）— `selection_results.created_at` 等时序列每次 INSERT 必须显式赋值，否则报 `insert statement must populate timestamp`
11. **`get_market_data` 的 `count` 不可传 -1**（R21）— 无界拉取会 hang；`real_adapter` 已在 `count<=0` 时兜底 250
12. **选股 endpoint 必须 `asyncio.to_thread`**（R21）— `run_strategy` 同步且 real 模式耗时数分钟，直接调会阻塞整个事件循环

### 11.2 设计约束

1. **前端不直连 DB** — 全走 FastAPI API（Prisma 已删）
2. **Mock 模式不限流** — 限流守卫只在 Real 模式触发（开发体验优先）
3. **限流中间件 fail-open** — 中间件异常放行，不误杀请求
4. **配置驱动** — 绝不硬编码业务参数到代码
5. **插件式架构** — 加因子/通道/数据源只需加文件，不改引擎
6. **worklog 必填** — 每次改动 append 到 `worklog.md`，这是项目规范

### 11.3 易错点

1. **参数名对齐说明书** — 见 [§6.3](#63-参数名对齐说明书r17-修正-7-处--r19-补-2-处)
2. **`get_sector_list` 无 market 参数** — 与 `get_stock_list` 不同
3. **`get_user_sector` 无参数** — 查指定板块成份股用 `get_stock_list_in_sector(block_code, block_type=1)`
4. **`refresh_kline` 参数是 `stock_list`（列表）** — 不是 `stock_code`（字符串）
5. **`download_file` 是说明书原始 API** — `download_data` 是适配层包装（down_type=4 固定）
6. **QuestDB 无 UNIQUE** — 应用层用 UPSERT 模式（DELETE + INSERT）
7. **QuestDB 无 SEQUENCE** — 应用层 `_gen_id()` 生成 LONG ID

### 11.4 沙箱环境限制

- Linux 沙箱 **无法运行 Real 模式**（无 Windows + 无通达信）
- 沙箱 QuestDB 可选（mock 模式不依赖 DB）
- 沙箱验证范围：lint + py_compile + Mock 模式端到端 + agent-browser 页面验证
- Real 模式实际写入性能需 **Windows 真机** 验证

---

## 十二、常见任务 SOP

### 12.1 新增策略

1. 确定策略中文名 → 取拼音首字母 → 生成 `strategy_id`（如 `dbqzt`）
2. 复制 `strategies/_template.yaml` → 命名 `strategy_<id>.yaml`
3. 编辑 YAML：因子组合、阈值、评分公式、板块映射
4. 在 `config/sector_mapping.yaml` 添加映射（`ZD_<ID>01` → strategy_id）
5. 执行 `python scripts/dev.py reload` 热加载
6. 系统自动注册策略 + 创建板块

### 12.2 新增因子

1. 创建 `engine/factors/my_factor.py`
2. 继承 `Factor` 基类，实现 `calculate(df)` 方法
3. 设置 `factor_id` / `name` / `category` / `dependencies`
4. **自动注册**（`registry.py` 启动时扫描 `engine/factors/*.py`）
5. 在策略 YAML 引用：`factors: [{id: my_factor, weight: 0.3}]`

### 12.3 新增推送通道

1. 创建 `engine/channels/my_channel.py`
2. 继承 `Channel` 基类，实现 `send(message)` 方法
3. **自动注册**（`registry.py` 启动时扫描）
4. 在 `config/channels.yaml` 配置开关与参数

### 12.4 新增数据字段（因子需要新数据）

1. 读 `engine/data_adapter/base.py` 看是否有对应获取接口
2. 若无，在 3 个文件同步添加：
   - `base.py` — 加抽象方法 `get_xxx()`
   - `mock_adapter.py` — 从 CSV 读或 hash 生成
   - `real_adapter.py` — 调 tqcenter API（加 `acquire_or_skip` 守卫）
3. `engine/pipeline/steps/load_data.py` — 在数据加载时调用并注入 df
4. 因子 `calculate` 即可从 `df["xxx"]` 读取

### 12.5 修改配置后

```bash
# 改 YAML 后热加载（adapter_mode 除外）
python scripts/dev.py reload

# 改 adapter_mode 必须重启
python scripts/dev.py stop && python scripts/dev.py start
# 或 Windows: restart.bat
```

### 12.6 验证改动

```bash
# 1. Lint
bun run lint

# 2. Python 编译检查
python3 -m py_compile engine/**/*.py

# 3. 冒烟测试
python scripts/dev.py test --smoke

# 4. agent-browser 端到端验证
agent-browser open http://127.0.0.1:3000/
agent-browser snapshot -i -c
agent-browser click @e15  # 切 Tab
agent-browser console     # 查看错误
agent-browser errors      # 查看页面错误
```

### 12.7 写 worklog

每次改动 **必须** append 到 `worklog.md`：

```markdown
---
Task ID: R<轮次>-<子任务>
Agent: <agent 名>
Task: <任务描述>

Work Log:
- <步骤 1>
- <步骤 2>
- ...

Stage Summary:
- <修改文件数>
- <新增/修改方法数>
- <验证结果>
- <未解决问题>
```

---

## 十三、未解决问题与下一步

### 13.1 当前未解决问题

1. **Real 模式实际写入性能未在沙箱验证** — 需 Windows 真机 + 通达信终端 + QuestDB 服务
2. **旧 DuckDB 数据文件不会自动迁移到 QuestDB** — 需手动 SQL 导出/导入（见 `MAINTENANCE.md` §6.2 备份方式 B）
3. **`engine/factors/` 下 8 个因子文件有 TODO(P1-2)** — 待 STRATEGY_LOGIC.md 确认阈值（非阻断，mock 模式可用默认阈值）
4. **`engine/pipeline/` 下 5 个文件有 TODO(P1-3)** — data_adapter.get_financial_data 已实现，TODO 注释未清理
5. **R5-R13 archived worklog 仍提及 DuckDB** — 历史记录不回改

### 13.2 下一步优先事项

**P0（实盘接入前必须）**：
- Windows 真机部署验证 Real 模式完整链路
- 验证 tqcenter 29 API 在真实通达信终端的可用性
- 验证 QuestDB 盘中高频写入性能

**P1（实盘接入后优化）**：
- 清理 `engine/factors/` 和 `engine/pipeline/` 下的 TODO 注释
- 完善 STRATEGY_LOGIC.md 确认各因子阈值
- 旧 DuckDB 数据迁移到 QuestDB（如有历史数据）

**P2（长期优化）**：
- ILP 批量写入优化（QuestDB 9009 端口）
- 更多推送通道（企业微信/钉钉）
- 更多因子（资金流/北向/龙虎榜）

---

## 十四、文档导航

| 文档 | 用途 | 何时读 |
|---|---|---|
| **本文档 (AI_HANDOVER.md)** | AI 交接总览 + 实盘接入流程 | **新会话第一份必读** |
| `docs/QUESTDB9_REALMODE_FIXES.md` | **R21 实战**：QuestDB 9.x 方言清单 + 11 修复 + 维护 SOP + 经验教训 | 改存储层 / 升级 QuestDB / 排查 real 模式时读 |
| `worklog.md` | 工作日志（最近 5 段 + 项目纪要） | 改代码前必读 |
| `docs/maintenance/ARCHITECTURE.md` | 5 层架构详解 + R5-R18 演进 | 改 engine/ 代码前读 |
| `docs/CHANGELOG.md` | 变更日志（R5-R18） | 了解历史迭代 |
| `docs/DEPLOY.md` | 部署指南（Windows/Linux/沙箱） | 部署时读 |
| `docs/MAINTENANCE.md` | 运维手册 + 8 场景提示词 + QuestDB 运维 | 运维时读 |
| `docs/USER_GUIDE.md` | 用户手册（10 Tab 功能） | 了解功能时读 |
| `docs/STRATEGY_FACTOR.md` | 策略/因子开发指南 | 开发策略/因子时读 |
| `WINDOWS_README.md` | Windows 5 分钟开箱即用 | Windows 部署时读 |
| `docs/tongdaxin-api-docs/` | 通达信官方说明书（49 篇 markdown） | 查 API 字段细节时读 |
| `engine/data_adapter/tqcenter_fields.py` | API_REGISTRY 29 API 字段权威目录 | 查 API 参数/字段时读 |

### 快速决策树

```
新会话开始
  → 读 AI_HANDOVER.md（本文档）
  → 读 worklog.md 最近 5 段
  → 判断任务类型:
      部署/接入实盘 → 按 §五 流程
      改 engine/ 代码 → 读 ARCHITECTURE.md
      加策略/因子 → 读 STRATEGY_FACTOR.md
      运维问题 → 读 MAINTENANCE.md
      查 API 字段 → 读 tqcenter_fields.py + tongdaxin-api-docs/
      改前端 → 读 src/app/page.tsx + src/lib/api-proxy.ts
  → 改完写 worklog
```

---

**本文档随项目演进持续更新。每次重大修改后，维护者需更新对应章节。**
**最后更新**：R21（2026-06-24）· **当前状态**：R19 验收 + R21 实盘真机验证通过，tqcenter 29/29 API 全覆盖
