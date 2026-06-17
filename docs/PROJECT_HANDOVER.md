# TdxQuant 量化交易系统 — 项目移交文档（AI 接手必读）

> **本文档是接手 AI 的第一手资料。任何动作前，请完整阅读本文档「第二章 AI 基本提示词」。**
> **若按本文档操作时发现与实际代码不符，以代码为准，并回填修正本文档。**
>
> **最后更新**：R8 轮次（交接文档强化 + Windows 运行匹配 + 策略因子扩展方案）
> **配套文档**：
> - `docs/STRATEGY_FACTOR_EXTENSION.md` — 策略与因子扩展完整步骤（本文档第六章的详尽版）
> - `docs/maintenance/ARCHITECTURE.md` — 5 层架构深度说明
> - `docs/maintenance/STRATEGY_LOGIC.md` — 5 策略公式与阈值唯一依据
> - `docs/PROJECT_MAINTENANCE.md` — 运维 / 部署 / 常见问题
> - `docs/USER_GUIDE.md` — 终端用户使用说明
> - `worklog.md` — AI 开发全程记录（按轮次归档，最后 2 轮必读）

---

## 目录

1. [项目是什么 / 不是什么](#一项目是什么--不是什么)
2. [AI 基本提示词（接手第一件事）](#二ai-基本提示词接手第一件事)
3. [Windows 运行匹配指南](#三windows-运行匹配指南)
4. [关键配置文件位置与修改步骤](#四关键配置文件位置与修改步骤)
5. [修改初始接口指南](#五修改初始接口指南)
6. [策略与因子扩展（简版，详见专档）](#六策略与因子扩展简版详见专档)
7. [AI 维护者工作流规范](#七ai-维护者工作流规范)
8. [质量门禁与验证清单](#八质量门禁与验证清单)
9. [风险与禁忌](#九风险与禁忌)
10. [接手 Checklist](#十接手-checklist)

---

## 一、项目是什么 / 不是什么

### 1.1 一句话定义

TdxQuant 是一套 **B/S 架构的 A 股量化选股 / 监控 / 回测系统**：
- **后端**：Python 3.13 + FastAPI（:8000），通过 `tqcenter` 调通达信终端
- **前端**：Next.js 16（:3000），用户用 **Chrome / Edge 浏览器**操作
- **不是**桌面 exe、不是 Electron、不是通达信插件

### 1.2 运行形态

```
Windows 生产环境：
  通达信金融终端（必须预启动登录）
        ↑ tqcenter API
  FastAPI :8000（后端引擎）
        ↑ HTTP
  Next.js :3000（前端 Web 服务）
        ↑ HTTP
  Chrome / Edge 浏览器 ← 用户在这里操作

Linux 沙箱开发环境：
  Mock 适配器（读 V8 CSV 样本）替代通达信
  其余同上 + Caddy :81 网关（沙箱对外唯一出口）
```

**关键结论**：用户端**永远是浏览器**，开发者要启动的是后端 + 前端两个进程。

### 1.3 当前项目状态（R7 末）

| 维度 | 状态 |
|------|------|
| 稳定性 | P1++++ 极度稳定，lint 0 错误，全 API 200 |
| 已完成轮次 | R1–R7（7 轮迭代） |
| 后端 | FastAPI :8000，10 路由，4 通道，26 因子，5 策略 |
| 前端 | Next.js :3000，5 Tab，24 量化组件 |
| 数据 | Mock 模式（沙箱）/ Real 模式（Windows 生产） |
| 待办 | 因子公式补全 / K 线真实数据 / 回测真实数据 |

---

## 二、AI 基本提示词（接手第一件事）

> ⚠️ **这是本文档最重要的一章。接手 AI 必须把下面这段作为「系统提示词」严格执行，避免「无头苍蝇」式乱改。**

### 2.1 核心行为准则（必须遵守）

```
你是 TdxQuant 项目的 AI 维护者。你的所有动作必须遵循以下准则：

【准则 1：先读后写】
任何代码修改前，必须先读 worklog.md 最后 2 个轮次章节 + 本文档对应章节。
不确定的事，先用 Read/Grep 工具核实，不要凭印象改。

【准则 2：配置驱动优先】
遇到「改阈值 / 改开关 / 改路径 / 改端口」需求，第一反应是改 YAML，不是改代码。
判断流程：
  - 改阈值/开关 → config/*.yaml 或 strategies/*.yaml（L5 层，热加载）
  - 增删策略 → strategies/ 加/删 YAML（L4 层，热加载）
  - 新增因子 → engine/factors/ 加 .py 插件（L3 层，自动扫描注册）
  - 新增通道 → engine/channels/ 加 .py 插件（L3 层，自动扫描注册）
  - 改选股流程 → engine/pipeline/（L2 层，慎重，影响全部策略）
  - 换数据库/API → engine/data_adapter/（L1 层，极少）

【准则 3：前端优先】
开发新功能时，先写前端组件让用户可见，再写后端 API。
后端 API 要通过 Next.js route.ts 代理，不要让前端直连 :8000。

【准则 4：最小改动】
一次只解决一个问题。不要顺手重构无关代码。
改 1 个文件能解决的事，不要改 10 个文件。

【准则 5：QA 必做】
每轮工作结束前必须：
  - bun run lint（0 错误）
  - curl 核心 API（全 200）
  - tail dev.log（无 Fatal/Error）
  - agent-browser 打开 / 路由验证渲染
四项任一不过，不许报告「完成」。

【准则 6：worklog 必填】
每轮工作必须 append 到 worklog.md（--- 分隔 + Task ID + Stage Summary）。
禁止覆盖已有内容。禁止省略 Task ID。

【准则 7：不动核心代码（除非必要）】
以下代码已经稳定，无明确理由不要动：
  - engine/data_adapter/real_adapter.py（双模式设计已完备）
  - engine/config/loader.py（ConfigLoader 单例 + mtime 监听）
  - engine/factors/registry.py（自动扫描机制）
  - engine/channels/registry.py（自动扫描机制）
  - src/lib/api-proxy.ts（tryFastAPI 三件套）
  - Caddyfile（沙箱网关，Windows 不用）
```

### 2.2 接手后的标准动作流程

```
第 1 步：环境确认（5 分钟）
  ├─ cd /home/z/my-project
  ├─ 读 worklog.md 最后 400 行
  ├─ 读本文档第二、三、四章
  └─ ps aux | grep -E "uvicorn|next dev"  确认进程在

第 2 步：健康检查（2 分钟）
  ├─ curl :8000/health
  ├─ curl :8000/api/strategies
  ├─ curl :3000/api
  └─ tail dev.log

第 3 步：理解任务（明确前不动手）
  ├─ 任务是修 Bug？→ 复现 → 定位文件 → 最小修复 → QA
  ├─ 任务是新功能？→ 判断层数 → 前端优先 → 后端 → QA
  └─ 任务不明确？→ 在 worklog 写「待确认」，不要瞎猜

第 4 步：执行（前端优先）
  ├─ 写前端组件
  ├─ 写后端 API + Schema
  ├─ 写 Next.js route.ts 代理
  └─ 同步 src/lib/api.ts 的 DTO 类型

第 5 步：QA 验证（四项全过才报告完成）
  ├─ bun run lint
  ├─ curl 全 API
  ├─ tail dev.log
  └─ agent-browser 端到端

第 6 步：归档
  └─ append worklog.md（--- + Task ID + Work Log + Stage Summary）
```

### 2.3 禁止行为清单

| 禁止 | 后果 | 正确做法 |
|------|------|----------|
| 凭印象改代码 | 引入 Bug | 先 Read/Grep 核实 |
| 一次改多个无关文件 | 难以回滚 | 一次一个问题 |
| 跳过 QA 报告完成 | 用户看到白屏 | 四项全过才报告 |
| 覆盖 worklog.md | 丢开发历史 | append 模式 |
| 改 real_adapter.py「优化」 | 破坏双模式 | 已稳定，别动 |
| 直接访问 localhost:3000 | 用户无法访问 | 走 Caddy :81（沙箱） |
| bun run build（沙箱） | OOM 卡死 | 仅 bun run dev |
| API URL 写端口号 | Caddy 不转发 | 用 ?XTransformPort=N |
| 硬编码阈值到代码 | 无法热加载 | 全走 YAML |
| 删启用中的策略 | 运行中策略异常 | 先 disable 再删 |

### 2.4 遇到不确定情况怎么办

```
情况 1：任务描述模糊（如「优化一下系统」）
  → 不要瞎猜。在 worklog 写「任务待澄清」，列出你理解的 3 种可能方向，
    等待用户确认。宁可不动，不要乱动。

情况 2：改了代码但 QA 不过
  → 不要硬凑。回滚改动，重新分析根因。
    worklog 如实记录「QA 未过，已回滚，待重新方案」。

情况 3：发现历史代码有「问题」
  → 不要顺手修。先判断是否真的影响当前功能。
    不影响 → 记录到 worklog「已知技术债」，留给后续轮次。
    影响 → 走最小修复流程。

情况 4：webDevReview cron 触发的任务
  → cron 每 15 分钟触发一次，任务描述见 cron 工具。
    按本文档流程执行，每轮只做 1-2 个明确的事，不要贪多。
```

---

## 三、Windows 运行匹配指南

> **核心结论：后端代码已为 Windows 做好适配，无需改 Python 代码。需要改的是配置 + 环境 + 启动脚本。**

### 3.1 两种环境对比

| 维度 | Linux 沙箱（开发） | Windows（生产） |
|------|-------------------|-----------------|
| 适配器模式 | `mock`（V8 CSV 样本） | `real`（tqcenter API） |
| 通达信终端 | 不需要 | **必须预启动登录** |
| tqcenter 包 | 不安装 | **必须安装** |
| 网关 | Caddy :81（对外唯一出口） | **不需要 Caddy**，直接访问 :3000 |
| 访问方式 | Caddy 预览面板 | `http://localhost:3000` |
| 板块回写 | 仅内存模拟 | **真实回写通达信** |
| 推送通道 | CSV + Web | 全部可用（含 tdx_warn） |
| 启动脚本 | `scripts/*.sh` | 需 `scripts/*.bat` / `.ps1`（待补） |
| `bun run build` | ❌ 禁止 | ✅ 可用（生产提速） |

### 3.2 后端代码为什么不用改？

核实 `engine/data_adapter/real_adapter.py` 第 50-120 行：

```python
# tqcenter 可选导入（沙箱导入失败也能实例化，调用时报错）
_tqcenter_available = False
try:
    from tqcenter import tq as _tq
    from tqcenter import tqconst as _tqconst
    _tqcenter_available = True
except Exception:
    pass

def initialize(self) -> bool:
    if not _tqcenter_available:
        return False
    _tq.initialize(init_arg)
    self._initialized = True
```

`engine/data_adapter/factory.py` 按 `config/app.yaml` 的 `app.adapter_mode` 自动切换：
- `mock` → `MockAdapter`（读 CSV）
- `real` → `RealAdapter`（调 tqcenter）

**设计已是「Windows 生产 + Linux 开发」双模式，改配置即可，不动代码。**

### 3.3 Windows 部署完整步骤

#### Step 1：环境准备（一次性）

```powershell
# 1.1 安装 Python 3.13（勾选 Add to PATH）
# 验证
python --version  # → Python 3.13.x

# 1.2 安装 Node.js 20+ 和 bun
# Node.js: https://nodejs.org/
powershell -c "irm bun.sh/install.ps1 | iex"
bun --version

# 1.3 安装通达信金融终端 + tqcenter
# 通达信终端：券商提供
# tqcenter：通达信终端自带，或 pip install tqcenter
pip install tqcenter
```

#### Step 2：获取项目 + 安装依赖

```powershell
cd D:\tdxquant  # 假设项目放这里

# 后端依赖
pip install -r requirements.txt

# 前端依赖
bun install
```

#### Step 3：切换适配器模式（关键）

编辑 `config/app.yaml`：

```yaml
app:
  adapter_mode: real    # ← 从 mock 改成 real
```

> ⚠️ 适配器模式变更**不支持热加载**，必须重启 FastAPI。

#### Step 4：初始化数据库（首次）

```powershell
python scripts\init_db.py
```

#### Step 5：启动通达信终端（必须）

> ⚠️ Real 模式下，通达信金融终端必须先启动并登录，否则 `tq.initialize()` 失败。
> 保持终端窗口运行，不要最小化到托盘（部分版本会断连）。

#### Step 6：启动后端 FastAPI

PowerShell 窗口 A：

```powershell
cd D:\tdxquant
python scripts\start_engine.py --reload
# 或：python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload
```

看到 `Uvicorn running on http://0.0.0.0:8000` 即成功。

**验证 tqcenter 连通**：
```powershell
curl http://127.0.0.1:8000/api/monitor?action=status
# 应返回 adapter: real, subscribed: N
# 若仍是 mock，说明 app.yaml 没改或没重启
```

#### Step 7：启动前端 Next.js

PowerShell 窗口 B：

```powershell
cd D:\tdxquant
bun run dev
```

看到 `Local: http://localhost:3000` 即成功。

#### Step 8：访问系统

Windows 生产**不需要 Caddy**，浏览器直接访问：

| 入口 | 地址 |
|------|------|
| 前端 UI | `http://localhost:3000` |
| 后端 API 文档 | `http://localhost:8000/docs` |
| 健康检查 | `http://localhost:8000/health` |

### 3.4 Windows 启动脚本（待补，建议接手 AI 创建）

当前 `scripts/` 只有 `.sh`，Windows 需要补：

| 待创建文件 | 对应 Linux | 功能 |
|------------|-----------|------|
| `scripts/start_all.bat` | `start_all.sh` | 一键启动 FastAPI + Next.js |
| `scripts/stop_all.bat` | 无 | 停止两个进程 |
| `scripts/start_engine.ps1` | `start_engine.py` | PowerShell 版引擎启动 |

`start_all.bat` 示例（接手 AI 可参考）：
```bat
@echo off
cd /d %~dp0\..
echo Starting TdxQuant FastAPI...
start "TdxQuant-Engine" cmd /k "python scripts\start_engine.py --reload"
timeout /t 5 /nobreak >nul
echo Starting TdxQuant Next.js...
start "TdxQuant-Web" cmd /k "bun run dev"
echo Both services started. Access http://localhost:3000
```

### 3.5 Windows 常见问题速查

| 问题 | 原因 | 解决 |
|------|------|------|
| `ModuleNotFoundError: tqcenter` | tqcenter 未装 | `pip install tqcenter` 或从通达信终端路径安装 |
| `tq.initialize()` 报「终端未连接」 | 终端未启动/未登录 | 启动通达信终端并登录，保持前台 |
| `database is locked` | 多 FastAPI 实例 | `tasklist \| findstr python` 杀多余进程 |
| 端口 8000/3000 占用 | 旧进程未退 | `netstat -ano \| findstr :8000` + `taskkill /PID <pid> /F` |
| 选股结果空 | 非交易时段 / 筛选过严 | 交易时段运行；检查 universe/pool |
| 板块回写失败 | 终端未启动 | 启动通达信终端 |
| YAML 路径反斜杠 | 单 `\` 转义 | 用 `/` 或 `\\` |
| 飞书推送不生效 | webhook 没配 | 编辑 channels.yaml + 热加载 + 测试 |

### 3.6 Windows 生产构建（可选提速）

```powershell
# 沙箱禁止，Windows 可用
bun run build    # 生成 .next/standalone/
bun run start    # NODE_ENV=production 运行
```

### 3.7 Windows 开机自启（可选）

用 [NSSM](https://nssm.cc/) 把 FastAPI 注册为 Windows 服务：
```powershell
nssm install TdxQuant-Engine "D:\tdxquant\.venv\Scripts\python.exe" "scripts\start_engine.py"
nssm set TdxQuant-Engine AppDirectory "D:\tdxquant"
nssm start TdxQuant-Engine
```

或用「任务计划程序」+ 批处理实现开机自启。

---

## 四、关键配置文件位置与修改步骤

### 4.1 配置文件地图

```
/home/z/my-project/（沙箱） / D:\tdxquant\（Windows）
├── config/
│   ├── app.yaml                 ★★★ 全局配置（适配器 / 端口 / 路径）
│   ├── channels.yaml            ★★★ 推送通道（4 通道开关与参数）
│   ├── cleaning_rules.yaml      ★★  数据清洗规则（7 条）
│   ├── monitor_rules.yaml       ★★  监控预警规则
│   ├── export.yaml              ★   导出格式
│   ├── theme.yaml               ★   前端主题
│   ├── sector_mapping.yaml      ★   策略↔板块映射
│   └── duckdb_schema.sql        ★★  DuckDB 建表（首次 init_db.py 执行）
├── strategies/
│   ├── _template.yaml           ★★★ 策略模板（复制即用）
│   └── strategy_*.yaml          ★★★ 5 个策略定义
├── prisma/schema.prisma         ★   Prisma schema（仅 User/Post 脚手架）
├── Caddyfile                    ★★  网关配置（仅沙箱 :81，Windows 不用）
├── .env                         ★   DATABASE_URL（Prisma）
├── package.json                 ★★★ 前端依赖 + scripts
├── requirements.txt             ★★★ 后端依赖
└── tsconfig.json / eslint.config.mjs / tailwind.config.ts  ★ 前端工具链
```

### 4.2 核心配置字段速查

#### `config/app.yaml`（全局）

```yaml
app:
  adapter_mode: mock       # ★ mock(沙箱) / real(Windows 生产)
  log_level: INFO
server:
  host: 0.0.0.0
  port: 8000               # ★ FastAPI 端口
paths:
  duckdb: ./data/duckdb/quant.db
  csv_output: ./data/csv
  excel_output: ./data/excel
  logs: ./data/logs
  strategies_dir: ./strategies
tqcenter:
  subscribe_batch_size: 50
  kline_max_count: 24000
mock:
  data_dir: ./docs/v8-data/stock_selection_v8_1_standalone/data
  push_interval: 3
```

#### `config/channels.yaml`（推送通道）

```yaml
channels:
  - channel_id: tdx_warn      # 通达信预警
    enabled: true
    config: { default_bs_flag: "0", ... }
  - channel_id: websocket     # Web 大屏
    enabled: true
    config: { gateway_url: "http://127.0.0.1:3003", ... }
  - channel_id: feishu        # 飞书（预留）
    enabled: false
    config: { webhook_url: "", secret: "", ... }
  - channel_id: csv_log       # CSV 日志（强制开启）
    enabled: true
```

#### `strategies/strategy_*.yaml`（策略）

关键字段（详见 `_template.yaml` 注释 + 第六 + `STRATEGY_FACTOR_EXTENSION.md`）：
- `strategy_id` / `strategy_name` / `strategy_emoji` / `enabled`
- `sector.code`（`ZD_<拼音大写><两位序号>`）/ `sector.name`
- `universe`（股票池筛选：ST/停牌/新股/市场）
- `pool.expression`（策略专属筛选表达式）
- `cleaning.rules_file`（引用 `cleaning_rules.yaml`）
- `factors[]`（因子组合，`factor_id` + `weight` + `params`）
- `scoring.formula`（评分公式，必须含 `clip`）
- `monitor.alert_conditions[]`（预警条件 + `channels`）
- `export`（CSV/Excel/板块回写）

### 4.3 配置修改标准流程

```
编辑 YAML 文件
    ↓
（等待 2s 自动重载）或 手动 POST /api/config/reload
    ↓
验证：GET /api/strategies 或 GET /api/channels
    ↓
前端 UI 自动刷新（轮询 / 手动刷新）
```

**例外**：`app.adapter_mode` 和 `server.port` 变更需重启 FastAPI（不热加载）。

### 4.4 代码入口位置

| 层 | 入口文件 | 关键函数 / 类 |
|----|----------|---------------|
| FastAPI | `engine/api/main.py` | `create_app()` + `lifespan` |
| 路由 | `engine/api/routes/*.py` | 10 个路由模块 |
| 适配器 | `engine/data_adapter/factory.py` | `get_adapter()` / `reset_adapter()` |
| 配置加载 | `engine/config/loader.py` | `ConfigLoader` 单例 |
| 选股流水线 | `engine/pipeline/` | `PipelineRunner` |
| 因子注册 | `engine/factors/registry.py` | `FactorRegistry`（自动扫描） |
| 通道注册 | `engine/channels/registry.py` | `ChannelRegistry`（自动扫描） |
| DuckDB | `engine/storage/` | `DuckDBStore` |
| 前端入口 | `src/app/page.tsx` | 5 Tab 布局 |
| 前端 API | `src/lib/api.ts` | `monitorAPI` / `configAPI` / ... |
| 前端代理 | `src/lib/api-proxy.ts` | `tryFastAPI(path)` |

---

## 五、修改初始接口指南

### 5.1 「初始接口」定义

1. **后端 API 端点**：`engine/api/routes/*.py` 中的 FastAPI 路由
2. **前端 API 客户端**：`src/lib/api.ts` 中的 `xxxAPI` 命名空间
3. **前端 API 代理**：`src/app/api/*/route.ts` 中的 Next.js Route Handlers
4. **Pydantic Schema**：`engine/api/schemas.py`
5. **前端 DTO 类型**：`src/lib/api.ts` 中的 `*DTO` 类型

### 5.2 新增 API 端点完整流程（6 步）

以「新增 `GET /api/example/hello`」为例：

#### Step 1：后端 Schema（`engine/api/schemas.py`）

```python
class ExampleResponse(BaseModel):
    message: str
    timestamp: int
```

#### Step 2：后端路由（新建 `engine/api/routes/example.py`）

```python
from fastapi import APIRouter
from ..schemas import ExampleResponse
import time

router = APIRouter(prefix="/api/example", tags=["example"])

@router.get("/hello", response_model=ExampleResponse)
async def hello():
    return ExampleResponse(message="world", timestamp=int(time.time()))
```

#### Step 3：注册路由（`engine/api/main.py`）

```python
from .routes import example  # 添加 import
# 在 create_app() 中：
app.include_router(example.router)
```

#### Step 4：前端 DTO + API 客户端（`src/lib/api.ts`）

```typescript
export interface ExampleDTO {
  message: string;
  timestamp: number;
}

export const exampleAPI = {
  hello: async (): Promise<ExampleDTO> => {
    const res = await fetch('/api/example/hello');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};
```

#### Step 5：前端代理（新建 `src/app/api/example/hello/route.ts`）

```typescript
import { tryFastAPI, ok, err } from '@/lib/api-proxy';

export async function GET() {
  const data = await tryFastAPI<ExampleDTO>('/api/example/hello');
  if (!data) return err('FastAPI unavailable', 503);
  return ok(data);
}
```

> **`tryFastAPI`**：服务端转发到 `http://127.0.0.1:8000`，3s 超时，失败返回 `null`（调用方降级到 mock）。

#### Step 6：验证

```bash
curl http://127.0.0.1:8000/api/example/hello           # 后端直连
curl http://127.0.0.1:3000/api/example/hello           # 前端代理
curl "http://127.0.0.1:81/api/example/hello?XTransformPort=8000"  # 网关直达
```

### 5.3 接口修改规范

1. **向后兼容**：新增字段用可选（`field?: type`），不删字段
2. **Schema 同步**：后端 `schemas.py` 改了，前端 `api.ts` DTO 必须同步
3. **代理透传**：Next.js route.ts 只做转发，**不加业务逻辑**（降级 mock 除外）
4. **错误码规范**：
   - `400` 请求参数错误
   - `404` 资源不存在
   - `409` 冲突（策略已存在 / 启用中禁止删除）
   - `422` Pydantic 校验失败
   - `500` 服务端错误
   - `503` FastAPI 不可用（前端代理降级）

---

## 六、策略与因子扩展（简版，详见专档）

> 📖 **完整步骤见 `docs/STRATEGY_FACTOR_EXTENSION.md`**，本章是速查版。

### 6.1 三种扩展场景速查

| 场景 | 改什么 | 生效方式 | 难度 |
|------|--------|----------|------|
| **调策略阈值** | `strategies/strategy_*.yaml` 的 `factors[].params` 或 `scoring.formula` | 热加载（2s） | ⭐ |
| **新增策略** | 复制 `_template.yaml` → 编辑 → 保存 | 热加载（2s） | ⭐⭐ |
| **新增因子** | `engine/factors/` 加 `.py` 插件 | 重启 FastAPI | ⭐⭐⭐ |
| **新增通道** | `engine/channels/` 加 `.py` 插件 | 重启 FastAPI | ⭐⭐⭐ |

### 6.2 新增因子最小示例

`engine/factors/my_factor.py`：

```python
from typing import Any
import pandas as pd
from engine.factors.base import Factor

class MyFactor(Factor):
    factor_id = "my_factor"            # 全局唯一，策略 YAML 引用此 ID
    factor_name = "我的因子"
    factor_category = "momentum"       # momentum/breakout/valuation/volume/limit_up/trend/reversal/turnover
    factor_description = "示例因子"

    def get_required_fields(self) -> list[str]:
        return ["ZAF"]                 # 声明依赖的数据列

    def get_default_params(self) -> dict[str, Any]:
        return {"window": 5}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        params = {**self.get_default_params(), **params}
        # 纯函数：不修改 df，无内部状态
        return pd.to_numeric(df["ZAF"], errors="coerce") * params["window"]
```

**注册**：`FactorRegistry` 启动时自动扫描 `engine/factors/*.py`，**无需手动注册**。
**使用**：策略 YAML 引用：
```yaml
factors:
  - factor_id: my_factor
    weight: 1.0
    params:
      window: 10
```

### 6.3 新增策略最小示例

复制 `strategies/_template.yaml` → `strategies/strategy_mystr.yaml`，改：

```yaml
strategy_id: mystr                    # 拼音首字母小写，2-30 字符
strategy_name: 我的策略
strategy_emoji: "🚀"
enabled: true                         # 复制后改 true
sector:
  code: ZD_MYSTR01                    # ZD_<拼音大写><两位序号>
  name: 我的策略选股
# factors[] / scoring.formula 按需调整
```

**生效**：2s 自动热加载，或 `POST /api/config/reload`。

> 📖 **因子公式实现的真实依据见 `docs/maintenance/STRATEGY_LOGIC.md`**（5 策略 4 维度评分公式）。补全因子时必须对照此文档，不要自己编公式。

---

## 七、AI 维护者工作流规范

### 7.1 每轮标准流程

```
1. 读 worklog.md 最后 2 轮 + 本文档第二章
2. TodoWrite 拆解任务
3. 评估项目状态（curl /health + agent-browser QA）
4. 有 Bug → 优先修复（最小改动）
   无 Bug → 推进 1-2 个新功能（不贪多）
5. 前端优先开发
6. 后端 API 开发
7. QA 验证（lint + curl + agent-browser，四项全过）
8. append worklog.md（--- + Task ID + Stage Summary）
9. 架构变更同步更新本文档 + ARCHITECTURE.md
```

### 7.2 worklog.md 写作规范

```markdown
---
Task ID: <轮次>-<子任务，如 R8-A>
Agent: <agent 名称>
Task: <任务简述>

Work Log:
- <具体步骤 1>
- <具体步骤 2>

Stage Summary:
- 已完成: <列出>
- 文件变更: <后端 N 个 / 前端 N 个>
- 未解决问题: <列出>
- 下一阶段建议: <列出>
```

**禁止**：覆盖已有内容 / 省略 `---` / 省略 Task ID。

### 7.3 Subagent 委派规范

复杂任务用 `Task` 工具委派：
- **必传**：Task ID / 任务描述 / 要求返回内容
- **必读 worklog**：告诉 subagent 先读 `/home/z/my-project/worklog.md`
- **必写 worklog**：告诉 subagent 完成后 append worklog
- **并行**：能并行的工作在**单条消息**里发多个 `Task` 调用

---

## 八、质量门禁与验证清单

### 8.1 每轮必须通过

| 门禁 | 命令 | 通过标准 |
|------|------|----------|
| ESLint | `bun run lint` | EXIT=0，0 错误 0 警告 |
| FastAPI 健康 | `curl :8000/health` | 200 + `status: ok` |
| 核心 API | `curl :8000/api/strategies` 等 | 全 200 |
| 前端代理 | `curl :3000/api/strategies` | 200（透传或降级 mock） |
| dev.log | `tail dev.log` | 无 Fatal / Error |
| agent-browser | 打开 `/` 路由 | 页面渲染 + 核心交互可用 |

### 8.2 agent-browser 验证步骤

```bash
agent-browser --help              # 查看命令
agent-browser navigate <URL>      # 打开页面
agent-browser screenshot          # 截图
agent-browser click <selector>    # 点击
agent-browser console             # 检查控制台
```

**必验交互**：5 Tab 切换 / 策略启停运行 / 信号抽屉 / 全局搜索 / 通知中心 / 通道配置。

### 8.3 回归测试

```bash
curl :8000/api/strategies           # 策略列表
curl :8000/api/monitor?action=status # 监控状态
curl :8000/api/signals?limit=1      # 信号
curl :8000/api/channels             # 通道
curl :8000/api/backtest/history     # 回测
```

---

## 九、风险与禁忌

### 9.1 绝对禁忌

| 禁忌 | 后果 | 正确做法 |
|------|------|----------|
| `bun run build`（沙箱） | OOM 卡死 | 仅 `bun run dev` |
| 直接访问 `localhost:3000`（沙箱） | 用户无法访问 | 走 Caddy `:81` |
| API URL 写端口号 | Caddy 不转发 | 用 `?XTransformPort=N` |
| 硬编码阈值到代码 | 无法热加载 | 全走 YAML |
| 多 FastAPI 实例写 DuckDB | `database is locked` | 单实例 |
| 删启用中的策略 | 运行中策略异常 | 先 disable 再删 |
| `z-ai-web-dev-sdk` 在客户端 | 密钥泄露 | 仅后端 |
| 覆盖 worklog.md | 丢历史 | append 模式 |
| 跳过 QA 报告完成 | 用户看白屏 | 四项全过才报告 |
| 改 `real_adapter.py`「优化」 | 破坏双模式 | 已稳定，别动 |

### 9.2 高风险操作

| 操作 | 风险 | 缓解 |
|------|------|------|
| 删 `data/duckdb/quant.db` | 丢全部业务数据 | 先备份 `.bak` |
| 改 `Caddyfile` | 全站不可访问 | 改后 `caddy reload` + 验证 |
| 改 `engine/api/main.py` lifespan | 引擎启动失败 | 充分测试 |
| 升级 `next`/`react` 大版本 | 全前端可能崩 | 锁版本 + 全量回归 |
| 升级 `fastapi`/`pydantic` | API 行为变化 | 检查 v1→v2 迁移 |

### 9.3 已知限制

| 限制 | 说明 | 规划 |
|------|------|------|
| 通知中心仅内存 | 刷新清空 | localStorage 持久化 |
| WebSocket 通道未部署 | HTTP 轮询替代 | 部署 :3003 服务 |
| 回测用 mock 价格 | 确定性 hash 生成 | 接 `tq.get_market_data` |
| K 线图 mock 数据 | 非真实行情 | 接真实数据 |
| Prisma schema 是脚手架 | 仅 User/Post | 业务数据用 DuckDB |
| 版本号不一致 | 4 处未对齐 | 统一 1.0.0 |
| `package.json` name 是脚手架名 | `nextjs_tailwind_shadcn_ts` | 改 `tdxquant` |
| Windows 启动脚本缺失 | 只有 `.sh` | 待补 `.bat`/`.ps1` |

---

## 十、接手 Checklist

```
□ cd /home/z/my-project（沙箱）/ D:\tdxquant（Windows）
□ 读 worklog.md 最后 2 轮章节
□ 读本文档第二、三、四章
□ ps aux | grep -E "uvicorn|next dev"（沙箱）确认进程
□ curl :8000/health 确认 FastAPI
□ curl :3000/api 确认 Next.js 代理
□ curl :8000/api/strategies 确认策略加载
□ tail dev.log 确认无错误
□ agent-browser 打开 / 确认页面渲染
□ 点击 5 个 Tab 确认切换正常
□ bun run lint 确认 0 错误
```

全部通过 → 项目健康，按第二章准则开始本轮开发。

---

## 附录：文档索引

| 文档 | 用途 | 何时读 |
|------|------|--------|
| **本文档** | AI 接手必读 | 每轮开发前 |
| `docs/STRATEGY_FACTOR_EXTENSION.md` | 策略与因子扩展完整步骤 | 改策略 / 加因子时 |
| `docs/maintenance/ARCHITECTURE.md` | 5 层架构深度说明 | 改架构 / 不确定层数时 |
| `docs/maintenance/STRATEGY_LOGIC.md` | 5 策略公式唯一依据 | 实现因子公式时 |
| `docs/PROJECT_MAINTENANCE.md` | 运维 / 部署 / 常见问题 | 部署 / 排错时 |
| `docs/USER_GUIDE.md` | 终端用户使用说明 | 回答用户功能问题时 |
| `worklog.md` | 开发全程记录 | 每轮开始前读最后 2 轮 |

---

**文档结束** · 有疑问先查 `worklog.md` + `ARCHITECTURE.md`，仍无解按第二章「不确定情况怎么办」处理。**宁可不动，不要乱动。**
