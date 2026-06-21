# TdxQuant 量化交易系统 — 项目维护文档

> **文档定位**：本文档是 TdxQuant 项目维护者的运维与开发总纲，涵盖项目架构、技术栈、依赖管理、部署流程、常见问题与维护责任。
> **配套文档**：
> - `docs/maintenance/ARCHITECTURE.md` — 5 层架构深度说明（AI 维护必读）
> - `docs/maintenance/STRATEGY_LOGIC.md` — 5 策略公式与阈值唯一依据
> - `docs/PROJECT_HANDOVER.md` — AI 接手 / 快速启动指南
> - `docs/USER_GUIDE.md` — 终端用户使用说明
> - `worklog.md` — AI 开发全程记录（按轮次归档）
>
> **最后更新**：R11 轮次（健康度卡片 + 匹配策略复制 + 自选股批量导入 + P2 后端优化）
> **当前版本**：前端 v0.3.0 (P1) · 引擎 v0.6.0 · 配置 v1.2

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
│  strategies/*.yaml + config/*.yaml + match_strategies.yaml  │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: 业务规则层（每周可能变）                          │
│  策略 / 因子 / 评分 / 匹配策略 / 聚合推送 / 分级值班（YAML）│
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
  ├─ src/app/page.tsx (唯一用户可见路由，7 Tab)        │
  └─ src/app/api/* (Next.js Route Handlers)            │
       └─ api-proxy.ts → tryFastAPI()                   │
            └─ http://127.0.0.1:8000/api/* (服务端转发) │
                 │  失败降级 → src/lib/mock-data.ts     │
                 ▼                                      │
FastAPI :8000                                          │
  └─ engine/api/routes/* (12 路由模块)                  │
       └─ engine.pipeline / channels / factors / ...   │
            ├─ DuckDB  : data/duckdb/quant.db           │
            ├─ CSV    : data/csv/                       │
            └─ Excel  : data/excel/                     │
```

### 2.2.1 监控引擎信号链路（R9 新增）

MonitorEngine 在 FastAPI `lifespan` 启动时拉起独立 daemon 线程，与 HTTP 请求链路解耦，
专门负责实时行情 → 求值 → 落库 → 推送链路：

```
DataAdapter.subscribe_hq / poll_loop
  │  行情快照 push / pull
  ▼
MonitorEngine._tick
  ├─ trading_hours 时段判定（Mock 强制 True，Real 严格执行）
  ├─ MatchRegistry.get_applicable(strategy_id, code)  ── 按 strategy_id 取匹配策略
  │     ├─ 精确 match（如 rzq_default）
  │     └─ _default 兜底 match（无精确命中时）
  ├─ scope 过滤（markets + exclude_st + exclude_codes + include_only）
  ├─ render condition（占位符 + default_params 兜底，向后兼容）
  ├─ ExpressionEvaluator.evaluate(snap)  ── simpleeval 白名单求值
  ├─ debounce 去重（(code, alert_type) 键 + 30s 窗口）
  └─ _fire_match:
       ├─ high 优先级 → 立即全通道 dispatch（tdx_warn + websocket + feishu）
       ├─ medium/low  → 立即推 websocket，其他通道进聚合队列
       ├─ EngineState.record_signal()           ── 内存计数
       ├─ DuckDB INSERT signal_events            ── 落库（signals.py 查询）
       └─ ChannelRegistry.dispatch(payload, channels)
            ├─ CSV Log   : logs/signals.csv
            ├─ TDX Warn  : tq.send_warn（半自动交易）
            ├─ WebSocket : 前端大屏（当前用轮询）
            └─ 飞书      : webhook

聚合队列（_agg_queue, key=(strategy_id, priority)）
  │  R10-5: tick 调 _flush_all_aggregation(force=False) 按窗口 flush
  │  R11-4: 独立 _aggregator_loop daemon 线程调 _flush_all_aggregation(force=True)
  ▼  窗口到 / 队列满 / stop 信号 → flush 摘要 payload 推 channels
```

### 2.3 实时数据策略

当前采用 **HTTP 轮询**（无 SSE / WebSocket 依赖），由 `src/lib/useRealtime.ts` 实现：

| 数据 | 轮询间隔 | 端点 |
|------|----------|------|
| 实时行情快照 | 10s | `GET /api/monitor?action=quotes` |
| 监控状态 | 15s | `GET /api/monitor?action=status` |
| 信号列表 | 10s | `GET /api/signals` |
| 通道状态 | 30s | `GET /api/channels` |
| **引擎健康度（R10-5 新增）** | 5s | `GET /api/monitor?action=health` |

> 规划中：SSE `/api/realtime/stream` 或独立 WebSocket 服务 `:3003`（见 `config/channels.yaml`），目前未部署。

#### 聚合推送定时器线程（R11-4 新增）

R10-5 起加入聚合推送机制（medium/low 优先级信号按 `(strategy_id, priority)` 维度攒批），
但 R10-5 的 flush 由 `_tick` 循环驱动（subscribe 模式 10s 间隔），在行情停推或非交易时段
会导致聚合队列不 flush。R11-4 起新增 **独立 daemon 线程** `_aggregator_loop`：

- 间隔 `max(5, alert_aggregate_window_seconds)` 秒（默认 60s），独立于 tick 循环
- 调 `_flush_all_aggregation(force=True)` 无条件 flush 所有非空 key，避免漏推
- 用 `self._stop_event.wait(interval)` 而非 `time.sleep`，stop 信号即时响应
- `daemon=True`，跟随主进程退出
- `_flush_all_aggregation(force=False)` 给 tick 调用，仅 flush 窗口到期的 key，让出主导权

> 此改动同时修复了 R10-5 中 "tick 10s 全 flush 架空 60s 窗口" 的隐性 bug。

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
| **监控循环引擎**（R9） | `engine/monitor/engine.py` MonitorEngine | v0.6 | lifespan 起独立 daemon 线程：行情 push → 求值 → record_signal → DuckDB INSERT → dispatch |
| **匹配策略注册表**（R9） | `engine/monitor/match_registry.py` MatchRegistry | v0.6 | 加载 `match_strategies.yaml`，按 strategy_id 取 match + scope 过滤 + CRUD 持久化（Lock + 原子 rename） |
| **聚合推送**（R10-5 + R11-4） | `engine/monitor/engine.py` `_aggregator_loop` | v0.6 | 独立 daemon 线程按 `alert_aggregate_window_seconds`（默认 60s）定时 flush，不依赖 tick |
| **分级值班**（R10-5） | `engine.py` `_fire_match` | v0.6 | high 立即全通道；medium/low 立即推 websocket，其他通道走聚合 |
| **健康度监控**（R10-5 + R11-4） | `GET /api/monitor/health` | v0.6 | 阈值读 `config/monitor_rules.yaml` `monitor.health` 段，响应透出 `thresholds` 字段 |

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

**前端页面结构（7 Tab，R10 起扩从 5 → 7）**：

| Tab | 组件 | 状态 |
|-----|------|------|
| 实时大屏 | `Dashboard.tsx`（含 `EngineHealthCard.tsx` R11-1 新增） | ✅ |
| 策略管理 | `StrategyManager.tsx` | ✅ |
| 选股结果 | `SelectionResults.tsx` | ✅ |
| 信号中心 | `SignalCenter.tsx` | ✅ |
| 资金流向 | `FlowRanking.tsx` | ✅ |
| **匹配策略**（R10-1 新增） | `MatchStrategyManager.tsx`（CRUD + 复制 R11-2 + test 预览） | ✅ |
| **自选股**（R10-1 新增） | `WatchlistManager.tsx`（列表 + 筛选 + 单只增删 + 批量导入 R11-3） | ✅ |

**R11 重点新增组件**：

| 组件 | 文件 | 能力 |
|------|------|------|
| `EngineHealthCard.tsx` | `src/components/quant/`（318 行） | 状态徽章（healthy/degraded/unhealthy/unknown 4 色）+ 6 指标 grid（订阅状态/行情延迟/求值次数/错误次数/去重队列/运行时长）+ SVG 折线趋势图（30 采样）+ 阈值脚注（动态跟随后端热加载）+ 5s 自动轮询 + 手动刷新按钮 + 首屏 Skeleton |
| `MatchStrategyManager.tsx` | `src/components/quant/`（1733 行） | 卡片列表（grid 1/2/3 列响应式）+ Switch 即时启停 + CRUD + 复制副本（makeUniqueCopyId + enableCopy/copyAlerts checkbox）+ test 调参预览 + _default 保护 |
| `WatchlistManager.tsx` | `src/components/quant/`（921 行） | 表格 7 列 + 分组 badge + 单只加入/移除 + 批量导入 Dialog（CSV 行/纯代码列表双格式，预览表 + 三色统计 Badge + 分组串行提交） |

### 3.3 基础设施

| 组件 | 技术 | 说明 |
|------|------|------|
| 网关 | Caddy 2 | `:81` 端口，`XTransformPort` 路由 |
| 包管理（前端） | bun | `bun run dev` / `bun run lint` |
| 包管理（后端） | pip + venv | `python` (PATH 已含 venv) / `pip` |
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
# Linux/macOS (venv 已在 PATH) 或 Windows
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
│   │   ├── main.py                  #   入口 create_app() + lifespan（R9 起挂 MonitorEngine）
│   │   ├── routes/                  #   12 路由模块（R9 起 +2）
│   │   │   ├── strategies.py        #   策略管理
│   │   │   ├── selection.py         #   选股结果
│   │   │   ├── monitor.py           #   实时监控 + 资金流向 + GET /health
│   │   │   ├── signals.py           #   信号中心
│   │   │   ├── config.py            #   配置热加载 + 策略 CRUD
│   │   │   ├── channels.py          #   推送通道管理
│   │   │   ├── backtest.py          #   回测引擎
│   │   │   ├── sectors.py           #   板块管理
│   │   │   ├── search.py            #   全局搜索
│   │   │   ├── theme.py             #   主题配置
│   │   │   ├── match_strategy.py    #   匹配策略 CRUD + reload + test（R9 新增）
│   │   │   └── watchlist.py         #   自选股管理（R9 新增，POST/DELETE/GET + by-sector）
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
│   │   ├── loader.py                #   ConfigLoader 单例 + mtime 监听（R10-3 起重载时通知 ChannelRegistry）
│   │   └── schema.py                #   配置 dataclass（R10-2 起补 match_strategies/monitor_rules/channels 路径）
│   ├── pipeline/                    # L2: 选股流水线
│   ├── monitor/                     # L2: 监控调度（R9 新增，原空目录填充）
│   │   ├── __init__.py              #   导出 MonitorEngine / RuleSet / MatchRegistry / AlertRule
│   │   ├── engine.py                #   MonitorEngine 主循环（~937 行，含 _aggregator_loop R11-4 + _fire_match R10-5）
│   │   ├── rules.py                 #   RuleSet 加载 alert_templates + evaluate
│   │   └── match_registry.py        #   MatchRegistry 加载 + scope 过滤 + CRUD 持久化
│   ├── messaging/                   # L2: 消息总线
│   ├── sector/                      # L2: 板块管理器
│   ├── factors/                     # L3: 因子插件（26 个）
│   ├── channels/                    # L3: 推送通道插件（4 个）
│   ├── exporters/                   # L3: 导出器（csv/excel/sector/duckdb）
│   └── expression/                  # L4: 表达式引擎
│
├── src/                             # 【Next.js 前端】
│   ├── app/
│   │   ├── page.tsx                 #   唯一用户可见路由（7 Tab，R10 起 5→7）
│   │   ├── layout.tsx               #   根布局
│   │   └── api/                     #   Next.js Route Handlers（代理层）
│   │       ├── strategies/
│   │       ├── selections/
│   │       ├── signals/
│   │       ├── monitor/             #   ?action=health 代理（R10-5 新增）
│   │       ├── config/
│   │       ├── channels/
│   │       ├── backtest/
│   │       ├── sectors/
│   │       ├── search/
│   │       ├── theme/
│   │       ├── monitor/match-strategies/  # R10-1 补 PUT/DELETE/test 代理
│   │       └── monitor/watchlist/        # R10-1 补 DELETE 代理（query→path）
│   ├── components/
│   │   ├── quant/                   #   量化业务组件（27 个，R11 起 +3）
│   │   │   ├── Dashboard.tsx        #   实时大屏（R11-1 起含 EngineHealthCard）
│   │   │   ├── EngineHealthCard.tsx #   引擎健康度卡片（R11-1 新增，SVG 趋势图 + 阈值脚注）
│   │   │   ├── StrategyManager.tsx  #   策略管理
│   │   │   ├── SelectionResults.tsx #   选股结果
│   │   │   ├── SignalCenter.tsx     #   信号中心
│   │   │   ├── SectorManager.tsx    #   板块管理
│   │   │   ├── FlowRanking.tsx      #   资金流向
│   │   │   ├── BacktestView.tsx     #   回测视图
│   │   │   ├── MatchStrategyManager.tsx # 匹配策略管理（R10-1 新增，含复制 R11-2）
│   │   │   ├── WatchlistManager.tsx #   自选股管理（R10-1 新增，含批量导入 R11-3）
│   │   │   ├── NotificationCenter.tsx # 通知中心
│   │   │   ├── GlobalSearch.tsx     #   全局搜索
│   │   │   └── ...                  #   其他
│   │   └── ui/                      #   shadcn/ui 原语（50+）
│   ├── lib/
│   │   ├── api.ts                   #   API 客户端 + DTO 类型（R10-5 加 EngineHealthDTO，R11-1 加 thresholds 可选字段）
│   │   ├── api-proxy.ts             #   服务端转发工具（R10-1 加 forwardFastAPI/relayJSON）
│   │   ├── useRealtime.ts           #   实时数据 Hook
│   │   ├── notifications.ts         #   通知 store
│   │   ├── db.ts                    #   Prisma client
│   │   ├── theme.ts                 #   主题系统
│   │   ├── mock-data.ts             #   降级 Mock 数据
│   │   └── utils.ts                 #   通用工具
│   └── hooks/
│
├── config/                          # 【配置文件】
│   ├── app.yaml                     #   全局配置（适配器模式 / 端口 / 路径，R10-2 补 3 个 paths）
│   ├── channels.yaml                #   推送通道配置（R10-3 起改后调 /api/config/reload 自动重载 ChannelRegistry）
│   ├── cleaning_rules.yaml          #   数据清洗规则
│   ├── monitor_rules.yaml           #   监控预警规则（含 monitor.health 段 R11-4 + alert_aggregate_* R10-5 + alert_templates emoji/label/default_params R9/R10-2）
│   ├── match_strategies.yaml        #   匹配策略装配单（R9 新增，strategy_id+scope+alerts+params）
│   ├── export.yaml                  #   导出格式
│   ├── theme.yaml                   #   主题
│   ├── sector_mapping.yaml          #   策略↔板块映射
│   └── duckdb_schema.sql            #   DuckDB 建表 SQL（R10-2 加 uq_mon_stock_active UNIQUE）
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
│   ├── excel/                       #   Excel 导出
│   └── logs/                        #   运行日志（fastapi.log + dev.log，R9-4a 起路径规范化）
│
├── docs/                            # 【文档】
│   ├── maintenance/
│   │   ├── ARCHITECTURE.md          #   架构总览（610 行）
│   │   └── STRATEGY_LOGIC.md        #   策略逻辑（71KB）
│   ├── tdx-quant/                   #   通达信原始文档
│   ├── v8-data/                     #   V8.1 选股系统源码 + 样本
│   ├── MONITOR_ENGINE_PLAN.md       #   监控引擎方案（R8，~1383 行）
│   ├── MONITOR_ENGINE_IMPLEMENTATION_PROMPT.md # 监控引擎实施提示词（R8）
│   ├── API_CAPABILITY_MAP.md        #   接口能力地图（R9-2，764 行）
│   ├── QUICKSTART_10MIN.md          #   10 分钟维护上手（R9-5b）
│   ├── STRATEGY_FACTOR_EXTENSION.md #   策略因子扩展专档（R8）
│   ├── PROJECT_MAINTENANCE.md       #   ← 本文档
│   ├── PROJECT_HANDOVER.md          #   AI 移交文档（R8 强化 AI 提示词 + Windows 运行）
│   └── USER_GUIDE.md                #   用户使用说明
│
├── scripts/                         # 【运维脚本】
│   ├── start_engine.py              #   启动 FastAPI
│   ├── start_all.sh                 #   一键启动全栈（R10-4 起自动跑 smoke_test.sh）
│   ├── start_all.ps1                #   Windows 启动（R9-4a 新增，R10-4 加 smoke_test 集成 + python 自动探测）
│   ├── stop.sh                      #   Linux 按端口+进程名精准停服务（R10-4 新增）
│   ├── stop.ps1                     #   Windows 版（R10-4 新增）
│   ├── smoke_test.sh                #   Linux 18 项检查（R10-4 新增，9 API + 2 写 + 1 _default 保护 + 6 代理）
│   ├── smoke_test.ps1               #   Windows 版（R10-4 新增）
│   ├── daemon.sh                    #   Linux 进程守护
│   ├── daemon.ps1                   #   Windows 进程守护（R9-4a 新增）
│   ├── realtime_daemon.sh           #   实时服务守护（预留）
│   ├── run_selection.py             #   手动选股
│   ├── reload_config.py             #   热加载配置
│   ├── init_db.py                   #   初始化 DuckDB
│   ├── paths.yaml                   #   路径占位符表（R9-4b 新增）
│   ├── replace-paths.sh             #   路径替换脚本（R9-4b 新增）
│   ├── replace-paths.ps1            #   Windows 版（R9-4b 新增）
│   ├── setup-env.sh                 #   环境初始化脚本（R9-4b 新增）
│   └── setup-env.ps1                #   Windows 版（R9-4b 新增）
│
├── mini-services/                   # 【独立微服务】（预留）
│   └── gateway/                     #   空占位
│
├── prisma/schema.prisma             #   Prisma schema（仅 User/Post 脚手架）
├── Caddyfile                        #   网关配置（:81）
├── .gitattributes                   #   跨平台换行规则（R9-4a 新增）
├── package.json                     #   前端依赖 + scripts（R9-4a 跨平台化：cpy-cli/rimraf/cross-env）
├── requirements.txt                 #   后端依赖
├── worklog.md                       #   AI 开发全程记录（按轮次）
└── .env                             #   DATABASE_URL（Prisma SQLite）
```

---

## 六、部署流程

### 6.1 沙箱 / 开发环境（Linux + Mock）

**前置条件**：Python 3.13 + bun 已安装，V8 样本数据在 `docs/v8-data/`。

```bash
# 1. 安装后端依赖 (Linux/macOS/Windows 通用, venv 已在 PATH)
pip install -r requirements.txt

# 2. 安装前端依赖
bun install

# 3. 初始化 DuckDB（首次）
python scripts/init_db.py

# 4. 确认适配器模式为 mock
# config/app.yaml → app.adapter_mode: mock

# 5. 一键启动全栈（R10-4 起启动后自动跑 smoke_test.sh，失败会打印日志路径）
bash scripts/start_all.sh
#   → FastAPI :8000 (后台, 日志 → data/logs/fastapi.log)
#   → Next.js :3000 (后台, 日志 → dev.log)
#   → 自动跑 scripts/smoke_test.sh（18 项检查）

# 或分别启动：
python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload &
bun run dev &

# 6. 验证
curl http://127.0.0.1:8000/health                       # → {"status":"ok",...}
curl http://127.0.0.1:8000/api/monitor/health          # R10-5 引擎健康度
curl http://127.0.0.1:3000/api                          # → 健康检查代理
# 浏览器访问 Caddy 网关 :81（沙箱预览面板）

# 7. 冒烟测试（独立调用）
bash scripts/smoke_test.sh                              # 18 项检查
bash scripts/smoke_test.sh --web-port 0                 # 仅后端 12 项（Next.js 未启时）

# 8. 停止服务
bash scripts/stop.sh                                    # R10-4 新增，按端口+进程名精准停
# 或手动 pkill -f "uvicorn engine.api.main" + pkill -f "next dev"
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

# 4. 一键启动全栈（R9-4a 起提供 ps1 脚本，R10-4 起自动跑 smoke_test.ps1）
.\scripts\start_all.ps1
#   → FastAPI :8000 (后台, 日志 → data/logs/fastapi.log)
#   → Next.js :3000 (后台, 日志 → dev.log)
#   → 自动探测 python/python3/py，自动跑 smoke_test.ps1

# 或分别启动：
python scripts/start_engine.py --reload                 # FastAPI :8000
bun run dev                                             # Next.js :3000

# 5. 冒烟测试
.\scripts\smoke_test.ps1                                # 18 项检查

# 6. 停止服务
.\scripts\stop.ps1                                      # R10-4 新增

# 7. 验证 tqcenter 连通
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

**R10-3 起，配置重载会联动通知各注册表**：

| 重载的配置 | 联动通知 | 效果 |
|------------|----------|------|
| `config/monitor_rules.yaml` | `RuleSet.invalidate()` | alert_templates 模板立即生效 |
| `config/match_strategies.yaml` | `MatchRegistry.invalidate()` | 匹配策略 CRUD 立即生效 |
| `config/channels.yaml` | `ChannelRegistry.reload_channel_config()` | **改通道配置后调 `/api/config/reload` 即重载，无需重启或 PUT /api/channels** |
| `strategies/strategy_*.yaml` | `FactorRegistry` + 策略缓存 | 策略 YAML 立即生效 |

> 改 `channels.yaml` 后调 `/api/config/reload` 即可，无需重启或 `PUT /api/channels`。

---

## 七、配置文件总览

| 文件 | 用途 | 热加载 | 关键字段 |
|------|------|--------|----------|
| `config/app.yaml` | 全局配置 | ✓ | `adapter_mode` / `server.port` / `paths.*`（R10-2 补 `paths.match_strategies` / `paths.monitor_rules` / `paths.channels`） |
| `config/channels.yaml` | 推送通道 | ✓ | `channels[]` (id/name/enabled/config)，R10-3 起调 `/api/config/reload` 自动重载 ChannelRegistry |
| `config/cleaning_rules.yaml` | 数据清洗 | ✓ | 7 条通用规则 |
| `config/monitor_rules.yaml` | 监控预警 | ✓ | `monitor.*` / `alert_templates.*`（见下方详细字段表） |
| `config/match_strategies.yaml` | **匹配策略装配单（R9 新增）** | ✓ | `match_strategies[]`（match_id/strategy_id/scope/alerts/params） |
| `config/export.yaml` | 导出格式 | ✓ | CSV/Excel 路径与列 |
| `config/theme.yaml` | 主题 | ✓ | 涨跌色 / 字体 |
| `config/sector_mapping.yaml` | 策略↔板块 | ✓ | 策略 ID → 板块 Code |
| `config/duckdb_schema.sql` | DuckDB 建表 | ✗ | 首次 `init_db.py` 执行（R10-2 加 `uq_mon_stock_active UNIQUE`） |
| `strategies/strategy_*.yaml` | 策略定义 | ✓ | 见 `STRATEGY_LOGIC.md` |
| `Caddyfile` | 网关 | ✗ | `:81` 端口 + `XTransformPort` 路由 |
| `.env` | 环境变量 | ✗ | `DATABASE_URL`（Prisma） |

### 7.1 `config/monitor_rules.yaml` 字段详解

```yaml
monitor:
  subscribe_batch_size: 50                  # subscribe_hq 分批大小
  poll_interval_seconds: 10                 # 轮询间隔（subscribe 不可用时）
  alert_debounce_seconds: 30                # 同股同类型防抖窗口
  alert_aggregate_window_seconds: 60        # R10-5: 聚合推送窗口（R11-4 独立 flush 线程间隔）
  alert_aggregate_max_size: 10              # R10-5: 聚合队列达此值立即 flush
  trading_hours:                            # 监控时段（Real 严格执行，Mock 强制 True）
    morning_start: "09:25"
    morning_end:   "11:30"
    afternoon_start: "13:00"
    afternoon_end:   "15:00"
  health:                                   # R11-4 新增：健康度判定阈值
    lag_healthy_seconds: 60                 # lag < 此值 且 errors < threshold => healthy
    lag_degraded_seconds: 120               # lag < 此值 => degraded，否则 unhealthy
    error_healthy_threshold: 10             # 错误数 < 此值才算 healthy
                                             # 配置缺失时回退 60/120/10

alert_templates:
  limit_up:
    condition:    "pct_change > {pct_threshold}"   # R9: 占位符语法（老模板无占位符原样返回）
    alert_type:   limit_up
    emoji:        🚀                          # R10-2: 14 个 templates 全补 emoji
    label:        涨停                       # R10-2: 中文短名（前端推送标题用）
    channels:     [tdx_warn, websocket, feishu]
    priority:     high
    description:  触及涨停价
    default_params:                          # R9: 参数兜底（占位符未渲染时用）
      pct_threshold: 0.095
```

### 7.2 `config/match_strategies.yaml` 装配单 schema（R9 新增）

```yaml
match_strategies:
- match_id: rzq_default                    # 全局唯一，_default 为兜底套餐（DELETE 返 403）
  name: 弱转强默认监控
  enabled: true
  strategy_id: rzq                          # 绑定策略 ID（同多个策略通过 strategy_id 取 match）
  scope:                                    # 作用域过滤
    markets: [SH, SZ, BJ]                   # 市场前缀
    exclude_st: true                        # 排除 ST 股（本轮用 snap 字段兜底）
    exclude_suspended: true
    exclude_codes: []                       # 黑名单
    include_only: []                        # 白名单（优先于黑名单）
  alerts:                                   # 引用 alert_templates，可覆盖 params
  - alert_type: rzq_ignite
    params: { pct_threshold: 0.03 }
    channels: [tdx_warn, websocket, feishu]
    priority: high
  debounce_override: 60                     # 覆盖 monitor.alert_debounce_seconds
  trading_hours_override: null              # 覆盖 monitor.trading_hours
```

持久化方式：纯 YAML + `Lock` + 临时文件原子 rename（与配置体系一致，可 git 版本）。R9-5a 起 `_default` 兜底套餐不允许删除（前端按钮 disabled，后端 DELETE 返 403）。

**配置修改原则**：
1. **绝不硬编码**阈值 / 路径 / 端口到代码，全部走 YAML
2. 修改后调 `/api/config/reload` 或等 2s 自动重载（R10-3 起联动通知各注册表）
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
| `monitor_subscriptions` | **监控股票池（R9 起被引擎写入）** | subscriber / strategy_id / stock_code / active / created_at / updated_at |

> **R10-2 起，`monitor_subscriptions` 加 UNIQUE 索引 `uq_mon_stock_active ON (stock_code, active)`**，防止重复 INSERT；重复加入会触发 SELECT-then-UPDATE `active=true` 复活语义。R9-5a 起冷启动 pipeline 完成后 `_inject_monitor_subscriptions` 主动 upsert 订阅带 strategy_id（不再依赖 fallback 被动兜底）。

### 8.3 数据流转

```
tqcenter / Mock CSV
  │  get_snapshot / get_kline / get_more_info
  ▼
DataAdapter (Mock / Real)
  │
  ├─→ Pipeline (cleaning → factors → scoring → ranking)
  │     ├─→ DuckDB selection_runs + selection_results
  │     ├─→ CSV data/csv/{strategy}_{date}_{hash}.csv
  │     ├─→ SectorManager 回写板块
  │     └─→ R9-5a: _inject_monitor_subscriptions 写 monitor_subscriptions 表（带 strategy_id）
  │
  └─→ subscribe_hq / poll_loop（实时行情 push/pull）
       │
       ▼
  MonitorEngine._tick（R9 起，独立 daemon 线程）
       ├─ MatchRegistry.get_applicable(strategy_id, code)  ── 取匹配策略
       ├─ RuleSet.evaluate(snap)  ── simpleeval 求值 alert_templates
       ├─ debounce 去重（(code, alert_type) 键 + 30s 窗口）
       └─ _fire_match（R10-5 起分级值班）
            ├─ high 优先级 → 立即全通道 dispatch
            │     ├─ EngineState.record_signal()              ── 内存计数
            │     ├─ DuckDB INSERT signal_events              ── 落库（signals.py 查询）
            │     └─ ChannelRegistry.dispatch(payload, channels)
            │          ├─ CSV Log   : logs/signals.csv
            │          ├─ TDX Warn  : tq.send_warn（半自动交易）
            │          ├─ WebSocket : 前端大屏（当前用轮询）
            │          └─ 飞书      : webhook
            └─ medium/low → 立即推 websocket + 落库
                 其他通道进 _agg_queue（按 (strategy_id, priority) 攒批）

聚合队列 flush（R10-5 tick 驱动 + R11-4 独立 daemon 线程）
  │  窗口到（alert_aggregate_window_seconds, 默认 60s）
  │  或队列满（alert_aggregate_max_size, 默认 10）
  ▼  构造摘要 payload → dispatch 推 channels
```

> 完整信号链路见 §2.2.1 监控引擎信号链路。

---

## 九、监控与日志

### 9.1 健康检查

```bash
# FastAPI 健康
curl http://127.0.0.1:8000/health
# → {"status":"ok","uptime_seconds":N,"adapter":"mock"}

# 引擎健康度（R10-5 新增，R11-4 透出 thresholds）
curl http://127.0.0.1:8000/api/monitor/health
# → {
#     "status": "healthy",
#     "subscribe_alive": true,
#     "quote_lag_seconds": 0.3,
#     "eval_count": 16736,
#     "error_count": 0,
#     "debounce_size": 39,
#     "queue_size": 0,
#     "uptime_seconds": 600,
#     "thresholds": {                         # R11-4 透出，便于前端展示 + 调参验证
#       "lag_healthy_seconds": 60,
#       "lag_degraded_seconds": 120,
#       "error_healthy_threshold": 10
#     }
#   }

# Next.js 健康（代理）
curl http://127.0.0.1:3000/api
curl http://127.0.0.1:3000/api/monitor?action=health   # 代理透传到 FastAPI
```

**`status` 判定逻辑（R11-4 起阈值可配）**：

| 判定 | 条件 | 说明 |
|------|------|------|
| `healthy` | `lag < lag_healthy_seconds` 且 `errors < error_healthy_threshold` | 缺省 60s / 10 |
| `degraded` | `lag < lag_degraded_seconds` | 缺省 120s |
| `unhealthy` | `lag < 0` 或 `lag > lag_degraded_seconds` | 阈值在 `config/monitor_rules.yaml` `monitor.health` 段，调参后调 `/api/config/reload` 即时生效；配置缺失时回退 60/120/10 |

前端呈现：R11-1 起在 Dashboard.tsx 顶部插入 `EngineHealthCard.tsx`，5s 自动轮询，含状态徽章（healthy/degraded/unhealthy/unknown 4 色）+ 6 指标 grid + SVG lag 趋势图（30 采样）+ 阈值脚注（动态跟随后端热加载）+ 手动刷新按钮。

### 9.2 日志位置

| 日志 | 路径 | 说明 |
|------|------|------|
| Next.js 开发日志 | `dev.log` | `bun run dev` 输出，排查前端 / API 代理问题 |
| **FastAPI 日志（R9-4a 起路径规范化）** | `data/logs/fastapi.log` | uvicorn 输出（`--log-level warning`），`start_all.sh/ps1` 重定向到这里 |
| 信号 CSV 日志 | `logs/signals.csv` | 所有推送信号强制记录（CsvLogChannel force_enabled） |
| 选股结果 CSV | `data/csv/*.csv` | 每次选股自动生成 |

> R9-4a 起所有脚本去除了 `/home/z/...` / `/tmp/...` 硬编码路径，改用相对路径 + `data/logs/` 统一日志目录。Windows 下 `start_all.ps1` 同样重定向到 `data/logs/fastapi.log` 与 `dev.log`。

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
| Next.js 端口 3000 被占用 | 旧进程未退 | `bash scripts/stop.sh` 或 `pkill -f "next dev"` 后重启 |
| Caddy 502 Bad Gateway | FastAPI / Next.js 未启动 | `ps aux \| grep -E "uvicorn\|next"` 检查 |
| DuckDB `database is locked` | 多进程写入冲突 | 确保只有一个 FastAPI 实例 |
| `bun run dev` 编译报错 | 依赖未装全 | `bun install` |
| **改 `channels.yaml` 后不生效（R10-3）** | 旧版需重启或 PUT /api/channels | R10-3 起调 `POST /api/config/reload` 即重载 ChannelRegistry，无需重启或 PUT |
| **Windows 启动报 `python` 不在 PATH（R10-4）** | 系统可能装的是 python3/py | `start_all.ps1` 自动探测 python/python3/py，或手动指定 |

### 10.2 运行时类

| 问题 | 原因 | 解决 |
|------|------|------|
| 前端 API 返回 mock 数据 | FastAPI 不通，降级 | 检查 `:8000` 是否运行，看 `data/logs/fastapi.log` |
| 策略不生效 | YAML 语法错误 | 看 FastAPI 日志 `ConfigLoader` 告警，用 `/api/config/reload` 触发重载 |
| 信号不推送 | 通道 `enabled: false` | 编辑 `config/channels.yaml`，调 `/api/config/reload`（R10-3 起自动重载 ChannelRegistry），或前端「推送通道配置」开启 |
| 板块回写失败 | 通达信客户端未启动（Real 模式） | 启动通达信终端并登录 |
| 回测结果每次不同 | 确定性 mock 依赖 stock_code hash | 正常行为（mock 模式），Real 模式接真实历史数据 |
| 资金流向排行空 | 订阅股票数 < 5 | 增加 `config/app.yaml` 订阅数或切换 Real 模式 |
| **聚合推送不 flush（R11-4）** | R10-5 的 flush 由 tick 驱动，行情停推/非交易时段不 flush | R11-4 起有独立 `_aggregator_loop` daemon 线程定时 flush，不依赖 tick；间隔 `max(5, alert_aggregate_window_seconds)` 秒 |
| **引擎健康度显示 unhealthy** | 行情延迟超阈值或错误过多 | 调 `config/monitor_rules.yaml` `monitor.health` 段阈值 + `/api/config/reload`，查看 `/api/monitor/health` 响应的 `thresholds` 字段确认生效阈值 |
| **重复加入股票报 UNIQUE 冲突（R10-2）** | `monitor_subscriptions` 加 `uq_mon_stock_active` UNIQUE | 后端 SELECT-then-UPDATE `active=true` 复活语义，无需手动清理 |

### 10.3 数据类

| 问题 | 原因 | 解决 |
|------|------|------|
| DuckDB 表不存在 | 未初始化 | `python scripts/init_db.py` |
| CSV 导出路径不存在 | `data/csv/` 被删 | `mkdir -p data/csv data/excel data/logs` |
| 策略 YAML 修改不生效 | 未热加载 | `POST /api/config/reload` 或等 2s 自动 |
| Prisma `db:push` 报错 | `DATABASE_URL` 路径错 | 检查 `.env` 指向 `db/custom.db` |
| **匹配策略 CRUD 不生效（R9）** | MatchRegistry 未 invalidate | 调 `/api/config/reload` 或 `/api/monitor/match-strategies/reload` |
| **匹配策略 `_default` 无法删除（R9-5a）** | 兜底套餐受保护 | 后端 DELETE 返 403，前端按钮 disabled；需修改 _default 内容请用 PUT |

### 10.4 前端类

| 问题 | 原因 | 解决 |
|------|------|------|
| 页面白屏 | hydration 失败 | 看 `dev.log` + 浏览器控制台 |
| 通知中心刷新即清空 | 仅内存 store（已知限制） | 规划中：localStorage 持久化 |
| 全局搜索打不开 | 快捷键冲突 | 点 header 搜索按钮，或检查 Cmd+K |
| K 线图数据假 | Mock 模式生成 | 正常，Real 模式接 `tq.get_market_data` |
| **7 个 tab 在窄屏横向滚动（R10-1）** | tab 数量 5→7 后窄屏装不下 | 已用 `grid-flow-col` + `overflow-x-auto`，窄屏可横向滚动不破版 |
| **匹配策略复制后副本不生效（R11-2）** | 副本默认 `enabled=false` | 复制 Dialog 勾选「启用副本」checkbox 创建为启用，或创建后在列表 Switch 启用 |
| **批量导入提示「代码格式错误」（R11-3）** | 输入需 6 位数字代码 | 自动剥离 `.SH/.SZ/.BJ` 后缀；纯代码列表只接受 6 位数字 |

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
| 前端 | v0.3.0 (P1) | `src/app/page.tsx` footer | R8 v0.1.0 → R10 v0.2.0（7 tab） → R11 v0.3.0（健康度卡片 + 复制 + 批量导入） |
| 引擎 | v0.6.0 | `engine/__init__.py` `__version__` | R8 v0.4.0 → R9 v0.5.0（监控引擎 + 匹配策略） → R10 v0.5.5（P1） → R11 v0.6.0（P2） |
| 配置 | v1.2 | `config/app.yaml` `app.version` | R8 v1.0 → R9 v1.1（match_strategies.yaml） → R10 v1.15（alert_aggregate_* + emoji/label） → R11 v1.2（monitor.health） |
| `package.json` | 0.2.0 | `package.json` `version` | 脚手架遗留（R9-4a 起跨平台化） |

> **已知不一致**：4 处版本号未对齐，建议统一为 `1.0.0` + 语义化版本。

### 12.2 开发轮次记录

所有开发历史归档于 `worklog.md`，按轮次组织：

- **R1–R4**：基础架构搭建（5 层 / 适配器 / DuckDB / FastAPI / Next.js 骨架）
- **R5**：消息总线插件化 + 回测引擎 + Settings Dialog + 信号中心增强
- **R6**：策略胜率排行 + 全局搜索 + 板块导出 + 信号筛选 + 对比导出
- **R7**：资金流向 + 信号详情抽屉 + 策略复制 + 通知中心
- **R8**：交接文档强化 + Windows 运行匹配 + 策略因子扩展专档 + 监控引擎方案设计（不写代码）
- **R9**：监控引擎实施（MonitorEngine 循环引擎 + MatchStrategy 匹配策略层）+ 9 个 bug 修复 + Windows 适配 88%（脚本跨平台 + 路径替换 + 10 分钟上手）
- **R10**：前端管理 UI（7 tab：匹配策略 + 自选股）+ 8 个低 bug 修复 + ConfigLoader 通知 ChannelRegistry + Windows 脚本增强（smoke_test / stop）+ P1 优化（聚合推送 / 分级值班 / 健康度 GET /api/monitor/health）
- **R11**：Dashboard 健康度卡片（EngineHealthCard.tsx） + 匹配策略复制 + 自选股批量导入 + P2 优化（聚合推送独立定时器线程 + 健康度阈值放 config/monitor_rules.yaml 的 monitor.health 段 + health 响应透出 thresholds 字段）

### 12.3 变更历史表（R8 起按轮次归档）

| 轮次 | 主要交付 | 涉及层 | 验证结果 |
|------|----------|--------|----------|
| **R8** | 交接文档强化（AI 提示词 + Windows 运行）+ 策略因子扩展专档 + 监控引擎方案设计（不写代码） | L5 文档 | 方案文档 4 份就绪，未实施 |
| **R9** | 监控引擎实施（MonitorEngine + MatchStrategy + P0 优化 ~900 行）+ 9 bug 修复 + Windows 适配 88%（5 项必改全做）+ 接口能力地图 + 10 分钟上手文档 | L2/L3/L4/L5 | 8 后端 API 全 200，smoke_test 后端全 PASS，eval_count 从 303→1135 持续增长 |
| **R10** | 前端管理 UI（匹配策略 + 自选股 tab，5→7 tab）+ 8 个低 bug 修复 + ConfigLoader 通知 ChannelRegistry（R10-3）+ Windows 脚本增强（smoke_test.sh/ps1 + stop.sh/ps1，R10-4）+ P1 优化（聚合推送 / 分级值班 / 健康度 GET /api/monitor/health，R10-5） | L3/L4/L5 + 脚本 | smoke_test.sh 18/18 PASS，health status=healthy，agent-browser 7 tab 全可见 |
| **R11** | Dashboard 健康度卡片（EngineHealthCard.tsx R11-1）+ 匹配策略复制（enableCopy bug 修复 R11-2）+ 自选股批量导入（端到端验证 R11-3）+ P2 后端优化（聚合推送独立 _aggregator_loop daemon 线程 + 健康度阈值放 config/monitor_rules.yaml monitor.health 段 + health 响应透出 thresholds，R11-4） | L3 + L4 配置 | bun run lint exit 0，smoke_test 18/18 PASS，阈值热加载生效，agent-browser 桌面+移动端验证 |

### 12.4 变更管理流程

1. **需求提出**：用户或 webDevReview cron 自动提出
2. **方案设计**：AI 维护者对照 5 层架构判断影响面
3. **实现**：前端优先（用户可见）→ 后端 → QA
4. **QA 验证**：lint + curl + agent-browser 端到端
5. **文档更新**：`worklog.md` append + 必要时更新 `ARCHITECTURE.md`
6. **移交**：更新 `PROJECT_HANDOVER.md` 关键配置位置

### 12.5 回滚策略

| 变更类型 | 回滚方式 |
|----------|----------|
| 配置 YAML | Git revert `config/*.yaml` + `/api/config/reload` |
| 策略 YAML | Git revert `strategies/*.yaml` + 重启 ConfigLoader |
| 匹配策略 YAML（R9） | Git revert `config/match_strategies.yaml` + `/api/monitor/match-strategies/reload` |
| 后端代码 | Git revert `engine/*.py` + 重启 FastAPI |
| 前端代码 | Git revert `src/*.tsx` + Next.js 热重载 |
| DuckDB schema | 备份 `data/duckdb/quant.db` → 覆盖回滚 |
| 健康度阈值（R11-4） | 改 `config/monitor_rules.yaml` `monitor.health` 段 + `/api/config/reload`（无需重启） |

> **建议**：每次大变更前 `cp data/duckdb/quant.db data/duckdb/quant.db.bak`。

---

## 附录：快速命令速查

```bash
# === 启动 ===
bash scripts/start_all.sh                    # Linux/macOS 一键启动全栈（R10-4 自动跑 smoke_test.sh）
# powershell -ExecutionPolicy Bypass -File scripts\start_all.ps1   # Windows（R10-4 自动跑 smoke_test.ps1）
python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload
bun run dev                                  # Next.js :3000

# === 停止（R10-4 新增脚本）===
bash scripts/stop.sh                         # Linux 按端口+进程名精准停
.\scripts\stop.ps1                           # Windows
# 或手动：
pkill -f "uvicorn engine.api.main"           # 停 FastAPI
pkill -f "next dev"                          # 停 Next.js

# === 冒烟测试（R10-4 新增）===
bash scripts/smoke_test.sh                   # Linux 18 项检查（9 API + 2 写 + 1 _default 保护 + 6 代理）
bash scripts/smoke_test.sh --web-port 0      # 仅后端 12 项（Next.js 未启时）
.\scripts\smoke_test.ps1                     # Windows

# === 配置 ===
curl -X POST http://127.0.0.1:8000/api/config/reload   # R10-3 起联动通知 RuleSet + MatchRegistry + ChannelRegistry
python scripts/reload_config.py

# === 监控引擎（R9 起）===
curl http://127.0.0.1:8000/api/monitor/health            # R10-5 引擎健康度（R11-4 透出 thresholds）
curl http://127.0.0.1:8000/api/monitor/match-strategies  # R9 匹配策略列表
curl http://127.0.0.1:8000/api/monitor/watchlist         # R9 自选股列表

# === 数据库 ===
python scripts/init_db.py                    # 初始化 DuckDB
bun run db:push                              # Prisma push (SQLite)

# === 质检 ===
bun run lint                                 # ESLint
curl http://127.0.0.1:8000/health            # FastAPI 健康
curl http://127.0.0.1:8000/api/monitor/health # 引擎健康度（R10-5）

# === 日志 ===
tail -f dev.log                              # Next.js 日志
tail -f data/logs/fastapi.log                # FastAPI 日志（R9-4a 起路径规范化）

# === 文档 ===
cat worklog.md | tail -100                   # 最近开发记录
```

---

**文档结束** · 有疑问先查 `worklog.md` + `ARCHITECTURE.md`，仍无解联系 AI 维护者。
