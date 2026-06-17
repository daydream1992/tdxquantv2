# TdxQuant 量化交易系统 — 项目维护文档

> **文档定位**：本文档是 TdxQuant 项目维护者的运维与开发总纲，涵盖项目架构、技术栈、依赖管理、部署流程、常见问题与维护责任。
> **配套文档**：
> - `docs/maintenance/ARCHITECTURE.md` — 5 层架构深度说明（AI 维护必读）
> - `docs/maintenance/STRATEGY_LOGIC.md` — 5 策略公式与阈值唯一依据
> - `docs/PROJECT_HANDOVER.md` — AI 接手 / 快速启动指南
> - `docs/USER_GUIDE.md` — 终端用户使用说明
> - `worklog.md` — AI 开发全程记录（按轮次归档）
>
> **最后更新**：R7 轮次（资金流向 / 信号详情抽屉 / 策略复制 / 通知中心）
> **当前版本**：前端 v0.1.0 (P1) · 引擎 v0.4.0 · 配置 v1.0

---

## 目录

1. [项目概述](#一项目概述)
2. [系统架构](#二系统架构)
3. [技术栈](#三技术栈)
4. [依赖管理](#四依赖管理)
5. [目录结构](#五目录结构)
6. [部署流程](#六部署流程)
7. [配置文件总览](#七配置文件总览)
8. [数据存储与流转](#八数据存储与流转)
9. [监控与日志](#九监控与日志)
10. [常见问题与解决方案](#十常见问题与解决方案)
11. [维护责任人](#十一维护责任人)
12. [版本与变更管理](#十二版本与变更管理)

---

## 一、项目概述

### 1.1 系统目标

TdxQuant 是一套基于通达信（TDX）量化 API 的 A 股选股 / 监控 / 回测 / 半自动交易系统，核心能力：

| 能力域 | 说明 |
|--------|------|
| **选股** | 5 大策略（打板求涨停 / 趋势主升浪 / 错杀低吸 / 弱转强 / 强转弱反抽），YAML 驱动可热加载 |
| **监控** | 实时行情快照 + 资金流向排行 + 信号预警 + 多通道推送 |
| **回测** | 历史数据回测，输出夏普 / Alpha / Beta / 最大回撤 / 胜率 |
| **交易** | 半自动交易（`tq.send_warn` 推送预警到通达信客户端，人工确认下单） |
| **推送** | 4 通道插件化：通达信预警 / Web 大屏 / 飞书 / CSV 日志 |

### 1.2 运行环境

| 环境 | 操作系统 | Python | 数据源 | 适配器模式 |
|------|----------|--------|--------|------------|
| **生产** | Windows | 3.13 | tqcenter API（通达信金融终端必须预启动） | `real` |
| **开发 / 沙箱** | Linux | 3.13 | V8 CSV 样本数据 | `mock` |

### 1.3 端口规划

| 服务 | 端口 | 绑定 | 用途 |
|------|------|------|------|
| FastAPI 引擎 | `8000` | `0.0.0.0` | REST API + 自动文档 `/docs` |
| Next.js 前端 | `3000` | `127.0.0.1` | Web UI（唯一用户可见路由 `/`） |
| Caddy 网关 | `81` | — | 对外唯一入口，按 `?XTransformPort=N` 路由 |
| WebSocket 通道（规划） | `3003` | — | 预留，当前用 HTTP 轮询替代 |

> **重要**：外部只能访问 Caddy `:81`。前端所有 API 请求走相对路径 `/api/...`，需要直达 FastAPI 时追加 `?XTransformPort=8000`。

---

## 二、系统架构

### 2.1 5 层架构模型

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: 用户配置层（每天可能变）                          │
│  strategies/*.yaml + config/*.yaml                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: 业务规则层（每周可能变）                          │
│  策略定义 / 因子组合 / 评分公式（YAML 引用因子插件）        │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 组件抽象层（每月可能变）                          │
│  engine/factors/ · engine/channels/ · engine/exporters/     │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 核心引擎层（半年不变）                            │
│  engine/pipeline/ · engine/monitor/ · engine/messaging/     │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 基础设施层（一年不变）                            │
│  engine/data_adapter/ · engine/storage/ · engine/api/       │
└─────────────────────────────────────────────────────────────┘
```

**变与不变判断准则**（修改前先问自己：这属于哪一层？）：

| 修改内容 | 所属层 | 操作方式 |
|----------|--------|----------|
| 改阈值 / 开关 | L5 | 改 YAML，不改代码 |
| 增删策略 | L4 | 加 / 删 `strategies/strategy_*.yaml` |
| 新增因子 | L3 | 加 `engine/factors/*.py` 插件 |
| 新增推送通道 | L3 | 加 `engine/channels/*.py` 插件 |
| 改选股流程 | L2 | 改引擎代码（慎重，影响所有策略） |
| 换数据库 / API | L1 | 改基础设施代码（极少） |

> 完整架构说明见 `docs/maintenance/ARCHITECTURE.md`。

### 2.2 请求流转链路

```
浏览器
  │  http
  ▼
Caddy :81 ─────────────────────────────────────────────┐
  │  默认 reverse_proxy → localhost:3000 (Next.js)     │
  │  ?XTransformPort=8000 → localhost:8000 (FastAPI)   │
  ▼                                                    │
Next.js :3000                                          │
  ├─ src/app/page.tsx (唯一用户可见路由)               │
  └─ src/app/api/* (Next.js Route Handlers)            │
       └─ api-proxy.ts → tryFastAPI()                   │
            └─ http://127.0.0.1:8000/api/* (服务端转发) │
                 │  失败降级 → src/lib/mock-data.ts     │
                 ▼                                      │
FastAPI :8000                                          │
  └─ engine/api/routes/* (10 路由模块)                  │
       └─ engine.pipeline / channels / factors / ...   │
            ├─ DuckDB  : data/duckdb/quant.db           │
            ├─ CSV    : data/csv/                       │
            └─ Excel  : data/excel/                     │
```

### 2.3 实时数据策略

当前采用 **HTTP 轮询**（无 SSE / WebSocket 依赖），由 `src/lib/useRealtime.ts` 实现：

| 数据 | 轮询间隔 | 端点 |
|------|----------|------|
| 实时行情快照 | 10s | `GET /api/monitor?action=quotes` |
| 监控状态 | 15s | `GET /api/monitor?action=status` |
| 信号列表 | 10s | `GET /api/signals` |
| 通道状态 | 30s | `GET /api/channels` |

> 规划中：SSE `/api/realtime/stream` 或独立 WebSocket 服务 `:3003`（见 `config/channels.yaml`），目前未部署。

---

## 三、技术栈

### 3.1 后端（Python）

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| Web 框架 | FastAPI | ≥0.115 | REST API + 自动 OpenAPI 文档 |
| ASGI 服务器 | uvicorn[standard] | ≥0.30 | 生产 / 开发服务器 |
| 数据库 | DuckDB | ≥1.0 | 单文件列式存储，零运维 |
| ORM | — | — | 直连 DuckDB SQL，不用 ORM |
| 配置 | PyYAML | ≥6.0 | YAML 配置热加载 |
| 数据处理 | pandas | ≥2.0 | DataFrame 选股计算 |
| Excel 导出 | openpyxl | ≥3.1 | 多 Sheet Excel 导出 |
| 表达式引擎 | simpleeval | ≥1.0 | 评分公式 / 预警条件安全求值 |
| 表单 | python-multipart | ≥0.0.9 | FastAPI 表单解析 |
| 数据源 | tqcenter | — | 通达信量化 API（Windows 生产） |

### 3.2 前端（TypeScript）

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | Next.js | ^16.1.1 | App Router + RSC |
| UI 库 | React | ^19.0.0 | — |
| 语言 | TypeScript | 5 | 严格类型 |
| 样式 | Tailwind CSS | 4 | 原子化 CSS |
| 组件库 | shadcn/ui (New York) | — | 50+ Radix 原语封装 |
| 图标 | lucide-react | ^0.525 | — |
| 图表 | recharts | ^2.15 | 回测收益曲线 |
| 动画 | framer-motion | ^12.23 | 过渡 / 悬停动画 |
| 状态管理 | zustand | ^5.0 | 通知中心 store |
| 服务端状态 | @tanstack/react-query | ^5.82 | — |
| 表格 | @tanstack/react-table | ^8.21 | 股票表格 |
| 表单 | react-hook-form + zod | — | 策略配置编辑 |
| 主题 | next-themes | ^0.4 | 明暗切换 |
| Toast | sonner | ^2.0 | 操作反馈 |
| 认证 | next-auth | ^4.24 | 预留（当前未启用） |
| AI SDK | z-ai-web-dev-sdk | ^0.0.18 | 后端 AI 能力（必须服务端） |

### 3.3 基础设施

| 组件 | 技术 | 说明 |
|------|------|------|
| 网关 | Caddy 2 | `:81` 端口，`XTransformPort` 路由 |
| 包管理（前端） | bun | `bun run dev` / `bun run lint` |
| 包管理（后端） | pip + venv | `/home/z/.venv/bin/python3` |
| 数据库迁移 | Prisma | 仅 `db/custom.db`（脚手架），业务数据用 DuckDB |
| 进程守护 | scripts/daemon.sh | 5s 检查 + 自动重启 |

---

## 四、依赖管理

### 4.1 Python 依赖

**文件**：`requirements.txt`

```txt
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-multipart>=0.0.9
duckdb>=1.0.0
pyyaml>=6.0
pandas>=2.0
openpyxl>=3.1
simpleeval>=1.0
```

**安装**：
```bash
# 沙箱环境（已预装 venv）
/home/z/.venv/bin/pip install -r requirements.txt

# 生产环境（Windows）
pip install -r requirements.txt
# 额外安装 tqcenter（通达信终端自带，不通过 pip）
```

**升级策略**：
- 严格遵守 `>=` 下限，升级前跑全量 API 冒烟测试
- `fastapi` / `pydantic` v2 有破坏性变更，升级需检查 `@app.on_event` → `lifespan` 等迁移
- `duckdb` 大版本升级需重新 `python scripts/init_db.py`

### 4.2 前端依赖

**文件**：`package.json`

**安装**：
```bash
bun install   # 或 npm install / pnpm install
```

**关键依赖清单**（见 `package.json` `dependencies`）：
- 运行时：`next` / `react` / `react-dom` / `@prisma/client` / `zustand` / `@tanstack/react-query` / `recharts` / `framer-motion` / `sonner` / `lucide-react`
- Radix 原语：`@radix-ui/react-*`（dialog / popover / select / tabs / tooltip / ...）
- 表单：`react-hook-form` / `@hookform/resolvers` / `zod`
- 工具：`react-resizable-panels` / `vaul` / `embla-carousel-react` / `react-markdown` / `react-syntax-highlighter`

**升级策略**：
- `next` 大版本升级需同步检查 App Router API 变更
- `react` 19 与 `@radix-ui/*` 兼容性需验证
- `shadcn/ui` 组件通过 `bunx shadcn@latest add <component>` 增量添加

### 4.3 依赖安全

- 每月执行 `bun audit` + `pip-audit` 检查已知漏洞
- 锁文件：`bun.lock`（前端）/ 无锁文件（后端，建议引入 `pip-compile` 生成 `requirements.lock`）

---

## 五、目录结构

```
/home/z/my-project/
│
├── engine/                          # 【Python 引擎】
│   ├── api/                         # L1: FastAPI 层
│   │   ├── main.py                  #   入口 create_app() + lifespan
│   │   ├── routes/                  #   10 路由模块
│   │   │   ├── strategies.py        #   策略管理
│   │   │   ├── selection.py         #   选股结果
│   │   │   ├── monitor.py           #   实时监控 + 资金流向
│   │   │   ├── signals.py           #   信号中心
│   │   │   ├── config.py            #   配置热加载 + 策略 CRUD
│   │   │   ├── channels.py          #   推送通道管理
│   │   │   ├── backtest.py          #   回测引擎
│   │   │   ├── sectors.py           #   板块管理
│   │   │   ├── search.py            #   全局搜索
│   │   │   └── theme.py             #   主题配置
│   │   ├── schemas.py               #   Pydantic 模型
│   │   ├── state.py                 #   引擎状态单例
│   │   └── deps.py                  #   依赖注入
│   ├── data_adapter/                # L1: 数据适配器
│   │   ├── base.py                  #   抽象基类
│   │   ├── mock_adapter.py          #   Mock（CSV 样本）
│   │   ├── real_adapter.py          #   Real（tqcenter）
│   │   └── factory.py               #   工厂切换
│   ├── storage/                     # L1: DuckDB 存储
│   ├── config/                      # L1: 配置加载器
│   │   ├── loader.py                #   ConfigLoader 单例 + mtime 监听
│   │   └── schema.py                #   配置 dataclass
│   ├── pipeline/                    # L2: 选股流水线
│   ├── monitor/                     # L2: 监控调度
│   ├── messaging/                   # L2: 消息总线
│   ├── sector/                      # L2: 板块管理器
│   ├── factors/                     # L3: 因子插件（26 个）
│   ├── channels/                    # L3: 推送通道插件（4 个）
│   ├── exporters/                   # L3: 导出器（csv/excel/sector/duckdb）
│   └── expression/                  # L4: 表达式引擎
│
├── src/                             # 【Next.js 前端】
│   ├── app/
│   │   ├── page.tsx                 #   唯一用户可见路由（5 Tab）
│   │   ├── layout.tsx               #   根布局
│   │   └── api/                     #   Next.js Route Handlers（代理层）
│   │       ├── strategies/
│   │       ├── selections/
│   │       ├── signals/
│   │       ├── monitor/
│   │       ├── config/
│   │       ├── channels/
│   │       ├── backtest/
│   │       ├── sectors/
│   │       ├── search/
│   │       └── theme/
│   ├── components/
│   │   ├── quant/                   #   量化业务组件（24 个）
│   │   │   ├── Dashboard.tsx        #   实时大屏
│   │   │   ├── StrategyManager.tsx  #   策略管理
│   │   │   ├── SelectionResults.tsx #   选股结果
│   │   │   ├── SignalCenter.tsx     #   信号中心
│   │   │   ├── SectorManager.tsx    #   板块管理
│   │   │   ├── FlowRanking.tsx      #   资金流向
│   │   │   ├── BacktestView.tsx     #   回测视图
│   │   │   ├── NotificationCenter.tsx # 通知中心
│   │   │   ├── GlobalSearch.tsx     #   全局搜索
│   │   │   └── ...                  #   其他
│   │   └── ui/                      #   shadcn/ui 原语（50+）
│   ├── lib/
│   │   ├── api.ts                   #   API 客户端 + DTO 类型
│   │   ├── api-proxy.ts             #   服务端转发工具
│   │   ├── useRealtime.ts           #   实时数据 Hook
│   │   ├── notifications.ts         #   通知 store
│   │   ├── db.ts                    #   Prisma client
│   │   ├── theme.ts                 #   主题系统
│   │   ├── mock-data.ts             #   降级 Mock 数据
│   │   └── utils.ts                 #   通用工具
│   └── hooks/
│
├── config/                          # 【配置文件】
│   ├── app.yaml                     #   全局配置（适配器模式 / 端口 / 路径）
│   ├── channels.yaml                #   推送通道配置
│   ├── cleaning_rules.yaml          #   数据清洗规则
│   ├── monitor_rules.yaml           #   监控预警规则
│   ├── export.yaml                  #   导出格式
│   ├── theme.yaml                   #   主题
│   ├── sector_mapping.yaml          #   策略↔板块映射
│   └── duckdb_schema.sql            #   DuckDB 建表 SQL
│
├── strategies/                      # 【策略 YAML】
│   ├── _template.yaml               #   模板（ConfigLoader 跳过）
│   ├── strategy_dbqzt.yaml          #   打板求涨停
│   ├── strategy_qszsl.yaml          #   趋势主升浪
│   ├── strategy_cslx.yaml           #   错杀低吸
│   ├── strategy_rzq.yaml            #   弱转强
│   └── strategy_qzrfc.yaml          #   强转弱反抽
│
├── data/                            # 【运行时数据】
│   ├── duckdb/quant.db              #   DuckDB 主存储
│   ├── csv/                         #   CSV 导出
│   └── excel/                       #   Excel 导出
│
├── docs/                            # 【文档】
│   ├── maintenance/
│   │   ├── ARCHITECTURE.md          #   架构总览（610 行）
│   │   └── STRATEGY_LOGIC.md        #   策略逻辑（71KB）
│   ├── tdx-quant/                   #   通达信原始文档
│   ├── v8-data/                     #   V8.1 选股系统源码 + 样本
│   ├── PROJECT_MAINTENANCE.md       #   ← 本文档
│   ├── PROJECT_HANDOVER.md          #   AI 移交文档
│   └── USER_GUIDE.md                #   用户使用说明
│
├── scripts/                         # 【运维脚本】
│   ├── start_engine.py              #   启动 FastAPI
│   ├── start_all.sh                 #   一键启动全栈
│   ├── daemon.sh                    #   进程守护
│   ├── realtime_daemon.sh           #   实时服务守护（预留）
│   ├── run_selection.py             #   手动选股
│   ├── reload_config.py             #   热加载配置
│   └── init_db.py                   #   初始化 DuckDB
│
├── mini-services/                   # 【独立微服务】（预留）
│   └── gateway/                     #   空占位
│
├── prisma/schema.prisma             #   Prisma schema（仅 User/Post 脚手架）
├── Caddyfile                        #   网关配置（:81）
├── package.json                     #   前端依赖 + scripts
├── requirements.txt                 #   后端依赖
├── worklog.md                       #   AI 开发全程记录（按轮次）
└── .env                             #   DATABASE_URL（Prisma SQLite）
```

---

## 六、部署流程

### 6.1 沙箱 / 开发环境（Linux + Mock）

**前置条件**：Python 3.13 + bun 已安装，V8 样本数据在 `docs/v8-data/`。

```bash
# 1. 安装后端依赖
/home/z/.venv/bin/pip install -r requirements.txt

# 2. 安装前端依赖
bun install

# 3. 初始化 DuckDB（首次）
/home/z/.venv/bin/python scripts/init_db.py

# 4. 确认适配器模式为 mock
# config/app.yaml → app.adapter_mode: mock

# 5. 一键启动全栈
bash scripts/start_all.sh
#   → FastAPI :8000 (后台)
#   → Next.js :3000 (后台, 日志 → dev.log)

# 或分别启动：
/home/z/.venv/bin/python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload &
bun run dev &

# 6. 验证
curl http://127.0.0.1:8000/health        # → {"status":"ok",...}
curl http://127.0.0.1:3000/api           # → 健康检查代理
# 浏览器访问 Caddy 网关 :81（沙箱预览面板）
```

**进程守护**：
```bash
bash scripts/daemon.sh   # 5s 检查，退出自动重启
```

### 6.2 生产环境（Windows + Real）

**前置条件**：
1. Windows + Python 3.13
2. 通达信金融终端已安装并**预启动登录**
3. `tqcenter` 已安装（通达信终端自带）

```powershell
# 1. 安装依赖
pip install -r requirements.txt

# 2. 切换适配器模式
# 编辑 config/app.yaml → app.adapter_mode: real

# 3. 初始化 DuckDB
python scripts/init_db.py

# 4. 启动引擎
python scripts/start_engine.py --reload
#   → FastAPI :8000

# 5. 启动前端（另开终端）
cd /path/to/project
bun install
bun run dev
#   → Next.js :3000

# 6. 验证 tqcenter 连通
curl http://127.0.0.1:8000/api/monitor?action=status
#   → 应返回 {"adapter":"real", "subscribed":N, ...}
```

### 6.3 前端构建（生产）

```bash
bun run build   # next build + 拷贝 standalone
bun run start   # NODE_ENV=production bun .next/standalone/server.js
```

> **注意**：沙箱环境**禁止** `bun run build`，仅用 `bun run dev`。

### 6.4 数据库迁移

| 数据库 | 迁移方式 | 命令 |
|--------|----------|------|
| DuckDB（业务数据） | SQL 脚本 | `python scripts/init_db.py`（重建 `data/duckdb/quant.db`） |
| SQLite（Prisma 脚手架） | Prisma | `bun run db:push`（推送 `prisma/schema.prisma` 到 `db/custom.db`） |

### 6.5 配置热加载

修改 `config/*.yaml` 或 `strategies/*.yaml` 后，**无需重启**：

```bash
# 方式 1：API
curl -X POST http://127.0.0.1:8000/api/config/reload

# 方式 2：脚本
python scripts/reload_config.py

# 方式 3：前端 UI
# 页面顶部「热加载配置」按钮
```

ConfigLoader 同时有 2s 间隔的 mtime 文件监听器，文件变更自动重载。

---

## 七、配置文件总览

| 文件 | 用途 | 热加载 | 关键字段 |
|------|------|--------|----------|
| `config/app.yaml` | 全局配置 | ✓ | `adapter_mode` / `server.port` / `paths.*` |
| `config/channels.yaml` | 推送通道 | ✓ | `channels[]` (id/name/enabled/config) |
| `config/cleaning_rules.yaml` | 数据清洗 | ✓ | 7 条通用规则 |
| `config/monitor_rules.yaml` | 监控预警 | ✓ | 预警条件表达式 |
| `config/export.yaml` | 导出格式 | ✓ | CSV/Excel 路径与列 |
| `config/theme.yaml` | 主题 | ✓ | 涨跌色 / 字体 |
| `config/sector_mapping.yaml` | 策略↔板块 | ✓ | 策略 ID → 板块 Code |
| `config/duckdb_schema.sql` | DuckDB 建表 | ✗ | 首次 `init_db.py` 执行 |
| `strategies/strategy_*.yaml` | 策略定义 | ✓ | 见 `STRATEGY_LOGIC.md` |
| `Caddyfile` | 网关 | ✗ | `:81` 端口 + `XTransformPort` 路由 |
| `.env` | 环境变量 | ✗ | `DATABASE_URL`（Prisma） |

**配置修改原则**：
1. **绝不硬编码**阈值 / 路径 / 端口到代码，全部走 YAML
2. 修改后调 `/api/config/reload` 或等 2s 自动重载
3. 策略 YAML 必须能被 `yaml.safe_load` 解析，否则 ConfigLoader 跳过并告警
4. `Caddyfile` 修改后需 `caddy reload`（沙箱自动）

---

## 八、数据存储与流转

### 8.1 存储分工

| 存储 | 路径 | 用途 | 迁移工具 |
|------|------|------|----------|
| **DuckDB** | `data/duckdb/quant.db` | 业务数据（选股结果 / 信号 / 回测） | `init_db.py` |
| **CSV** | `data/csv/` | 选股结果导出（策略维度） | 自动生成 |
| **Excel** | `data/excel/` | 多策略汇总导出 | 自动生成 |
| **SQLite** | `db/custom.db` | Prisma 脚手架（User/Post，当前未用） | `bun run db:push` |
| **日志** | `data/logs/` + `logs/signals.csv` | 运行日志 + 信号 CSV 日志 | 自动生成 |

### 8.2 DuckDB 表结构

由 `config/duckdb_schema.sql` + `engine/storage/` 惰性创建：

| 表 | 用途 | 关键字段 |
|----|------|----------|
| `selection_runs` | 选股执行记录 | run_id / strategy_id / started_at / result_count |
| `selection_results` | 选股结果明细 | run_id / stock_code / stock_name / score |
| `signal_events` | 信号事件 | signal_id / strategy_id / stock_code / snapshot / channels / created_at |
| `backtest_results` | 回测结果 | run_id / strategy_id / metrics / equity_curve |

### 8.3 数据流转

```
tqcenter / Mock CSV
  │  get_snapshot / get_kline / get_more_info
  ▼
DataAdapter (Mock / Real)
  │
  ▼
Pipeline (cleaning → factors → scoring → ranking)
  │
  ├─→ DuckDB selection_runs + selection_results
  ├─→ CSV data/csv/{strategy}_{date}_{hash}.csv
  ├─→ SectorManager 回写板块
  └─→ Monitor 触发预警
       │
       ▼
  ChannelRegistry.dispatch(payload, channels)
       ├─→ CSV Log  : logs/signals.csv
       ├─→ TDX Warn : tq.send_warn（半自动交易）
       ├─→ WebSocket: 前端大屏（当前用轮询）
       └─→ 飞书     : webhook（预留）
```

---

## 九、监控与日志

### 9.1 健康检查

```bash
# FastAPI 健康
curl http://127.0.0.1:8000/health
# → {"status":"ok","uptime_seconds":N,"adapter":"mock"}

# Next.js 健康（代理）
curl http://127.0.0.1:3000/api
```

### 9.2 日志位置

| 日志 | 路径 | 说明 |
|------|------|------|
| Next.js 开发日志 | `dev.log` | `bun run dev` 输出，排查前端 / API 代理问题 |
| FastAPI 日志 | `data/logs/engine.log` | uvicorn 输出（`--log-level warning`） |
| 信号 CSV 日志 | `logs/signals.csv` | 所有推送信号强制记录 |
| 选股结果 CSV | `data/csv/*.csv` | 每次选股自动生成 |

### 9.3 API 自动文档

- FastAPI Swagger UI：`http://127.0.0.1:8000/docs`
- FastAPI ReDoc：`http://127.0.0.1:8000/redoc`
- OpenAPI JSON：`http://127.0.0.1:8000/openapi.json`

### 9.4 代码质量

```bash
bun run lint   # ESLint 检查（前端 + Next.js API Routes）
```

> 后端无 linter 配置，建议引入 `ruff` + `mypy`。

---

## 十、常见问题与解决方案

### 10.1 启动类

| 问题 | 原因 | 解决 |
|------|------|------|
| FastAPI 启动报 `ModuleNotFoundError: tqcenter` | 沙箱无 tqcenter | 确认 `config/app.yaml` `adapter_mode: mock` |
| Next.js 端口 3000 被占用 | 旧进程未退 | `pkill -f "next dev"` 后重启 |
| Caddy 502 Bad Gateway | FastAPI / Next.js 未启动 | `ps aux \| grep -E "uvicorn\|next"` 检查 |
| DuckDB `database is locked` | 多进程写入冲突 | 确保只有一个 FastAPI 实例 |
| `bun run dev` 编译报错 | 依赖未装全 | `bun install` |

### 10.2 运行时类

| 问题 | 原因 | 解决 |
|------|------|------|
| 前端 API 返回 mock 数据 | FastAPI 不通，降级 | 检查 `:8000` 是否运行，看 `dev.log` |
| 策略不生效 | YAML 语法错误 | 看 FastAPI 日志 `ConfigLoader` 告警，用 `/api/config/reload` 触发重载 |
| 信号不推送 | 通道 `enabled: false` | 编辑 `config/channels.yaml`，或前端「推送通道配置」开启 |
| 板块回写失败 | 通达信客户端未启动（Real 模式） | 启动通达信终端并登录 |
| 回测结果每次不同 | 确定性 mock 依赖 stock_code hash | 正常行为（mock 模式），Real 模式接真实历史数据 |
| 资金流向排行空 | 订阅股票数 < 5 | 增加 `config/app.yaml` 订阅数或切换 Real 模式 |

### 10.3 数据类

| 问题 | 原因 | 解决 |
|------|------|------|
| DuckDB 表不存在 | 未初始化 | `python scripts/init_db.py` |
| CSV 导出路径不存在 | `data/csv/` 被删 | `mkdir -p data/csv data/excel data/logs` |
| 策略 YAML 修改不生效 | 未热加载 | `POST /api/config/reload` 或等 2s 自动 |
| Prisma `db:push` 报错 | `DATABASE_URL` 路径错 | 检查 `.env` 指向 `db/custom.db` |

### 10.4 前端类

| 问题 | 原因 | 解决 |
|------|------|------|
| 页面白屏 | hydration 失败 | 看 `dev.log` + 浏览器控制台 |
| 通知中心刷新即清空 | 仅内存 store（已知限制） | 规划中：localStorage 持久化 |
| 全局搜索打不开 | 快捷键冲突 | 点 header 搜索按钮，或检查 Cmd+K |
| K 线图数据假 | Mock 模式生成 | 正常，Real 模式接 `tq.get_market_data` |

### 10.5 网关类

| 问题 | 原因 | 解决 |
|------|------|------|
| `?XTransformPort=8000` 不生效 | Caddy 规则未匹配 | 确认 `Caddyfile` `@transform_port_query` matcher |
| 跨域错误 | 直接访问 `:8000` | 改走 Caddy `:81` + `XTransformPort` |
| WebSocket 连不上 | `:3003` 未部署 | 当前用 HTTP 轮询，WebSocket 为规划项 |

---

## 十一、维护责任人

### 11.1 角色与职责

| 角色 | 职责 | 联系方式 |
|------|------|----------|
| **AI 维护者** | 代码开发 / Bug 修复 / 功能迭代 / 文档更新 | 通过 `worklog.md` 追踪，每轮 webDevReview cron |
| **系统管理员** | 部署 / 运维 / 进程守护 / 数据备份 | 见部署文档 |
| **策略研究员** | 策略 YAML 阈值调优 / 因子验证 | 参考 `STRATEGY_LOGIC.md` |
| **终端用户** | 日常使用 / 问题反馈 | 见 `USER_GUIDE.md` 反馈渠道 |

### 11.2 AI 维护者工作规范

1. **每轮开发前**：完整阅读 `worklog.md` 最后 2 个轮次章节，了解前序进展
2. **每轮开发中**：实时更新 `worklog.md`（append 模式，`---` 分隔）
3. **每轮开发后**：append Stage Summary，列出已完成 / 未解决 / 下一阶段建议
4. **代码规范**：
   - TypeScript 严格类型，`'use client'` / `'use server'` 显式标注
   - Python 遵循 PEP 8，类型注解必填
   - shadcn/ui 优先，不造轮子
   - 配置驱动，绝不硬编码
5. **QA 规范**：每轮必须 `bun run lint` + curl 全 API + agent-browser 端到端验证
6. **文档规范**：架构变更同步更新 `ARCHITECTURE.md`，策略变更同步更新 `STRATEGY_LOGIC.md`

### 11.3 定时任务

当前已配置 **webDevReview** cron（每 15 分钟触发）：

- 自动评估项目状态 → agent-browser QA → 修 bug 或推进新功能
- 自动更新 `worklog.md`
- 任务描述见 `cron` 工具配置

---

## 十二、版本与变更管理

### 12.1 版本号约定

| 层 | 当前版本 | 位置 | 说明 |
|----|----------|------|------|
| 前端 | v0.1.0 (P1) | `src/app/page.tsx` footer | 阶段标记 |
| 引擎 | v0.4.0 | `engine/__init__.py` `__version__` | API 版本 |
| 配置 | v1.0 | `config/app.yaml` `app.version` | 配置格式 |
| `package.json` | 0.2.0 | `package.json` `version` | 脚手架遗留（建议改名 `tdxquant`） |

> **已知不一致**：4 处版本号未对齐，建议统一为 `1.0.0` + 语义化版本。

### 12.2 开发轮次记录

所有开发历史归档于 `worklog.md`，按轮次组织：

- **R1–R4**：基础架构搭建（5 层 / 适配器 / DuckDB / FastAPI / Next.js 骨架）
- **R5**：消息总线插件化 + 回测引擎 + Settings Dialog + 信号中心增强
- **R6**：策略胜率排行 + 全局搜索 + 板块导出 + 信号筛选 + 对比导出
- **R7**：资金流向 + 信号详情抽屉 + 策略复制 + 通知中心

### 12.3 变更管理流程

1. **需求提出**：用户或 webDevReview cron 自动提出
2. **方案设计**：AI 维护者对照 5 层架构判断影响面
3. **实现**：前端优先（用户可见）→ 后端 → QA
4. **QA 验证**：lint + curl + agent-browser 端到端
5. **文档更新**：`worklog.md` append + 必要时更新 `ARCHITECTURE.md`
6. **移交**：更新 `PROJECT_HANDOVER.md` 关键配置位置

### 12.4 回滚策略

| 变更类型 | 回滚方式 |
|----------|----------|
| 配置 YAML | Git revert `config/*.yaml` + `/api/config/reload` |
| 策略 YAML | Git revert `strategies/*.yaml` + 重启 ConfigLoader |
| 后端代码 | Git revert `engine/*.py` + 重启 FastAPI |
| 前端代码 | Git revert `src/*.tsx` + Next.js 热重载 |
| DuckDB schema | 备份 `data/duckdb/quant.db` → 覆盖回滚 |

> **建议**：每次大变更前 `cp data/duckdb/quant.db data/duckdb/quant.db.bak`。

---

## 附录：快速命令速查

```bash
# === 启动 ===
bash scripts/start_all.sh                    # 一键启动全栈
/home/z/.venv/bin/python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload
bun run dev                                  # Next.js :3000

# === 停止 ===
pkill -f "uvicorn engine.api.main"           # 停 FastAPI
pkill -f "next dev"                          # 停 Next.js

# === 配置 ===
curl -X POST http://127.0.0.1:8000/api/config/reload
python scripts/reload_config.py

# === 数据库 ===
python scripts/init_db.py                    # 初始化 DuckDB
bun run db:push                              # Prisma push (SQLite)

# === 质检 ===
bun run lint                                 # ESLint
curl http://127.0.0.1:8000/health            # 健康检查

# === 日志 ===
tail -f dev.log                              # Next.js 日志
tail -f data/logs/engine.log                 # FastAPI 日志

# === 文档 ===
cat worklog.md | tail -100                   # 最近开发记录
```

---

**文档结束** · 有疑问先查 `worklog.md` + `ARCHITECTURE.md`，仍无解联系 AI 维护者。
