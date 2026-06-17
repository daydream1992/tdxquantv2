# TdxQuant 量化交易系统 — 项目移交文档（AI 接手指南）

> **文档定位**：本文档是 **AI 维护者接手项目时的操作手册**，详细说明如何快速启动、修改初始接口、调整项目配置。
> **适用对象**：新接手的 AI 开发助手 / 自动化 cron 任务（webDevReview）
> **阅读顺序**：先读本文档 → 再读 `docs/maintenance/ARCHITECTURE.md` → 最后按需读 `worklog.md`
>
> **最后更新**：R7 轮次

---

## 目录

1. [移交概述](#一移交概述)
2. [快速启动（5 分钟）](#二快速启动5-分钟)
3. [权限说明](#三权限说明)
4. [关键配置文件位置](#四关键配置文件位置)
5. [修改初始接口指南](#五修改初始接口指南)
6. [调整项目配置指南](#六调整项目配置指南)
7. [常见修改场景 Step-by-Step](#七常见修改场景-step-by-step)
8. [AI 维护者工作流规范](#八ai-维护者工作流规范)
9. [质量门禁与验证清单](#九质量门禁与验证清单)
10. [风险与禁忌](#十风险与禁忌)

---

## 一、移交概述

### 1.1 项目当前状态

| 维度 | 状态 |
|------|------|
| **稳定性** | P1++++ 极度稳定，lint 0 错误，全 API 200 |
| **已完成轮次** | R1–R7（7 轮迭代） |
| **后端** | FastAPI :8000，10 路由模块，4 推送通道，26 因子，5 策略 |
| **前端** | Next.js :3000，5 Tab，24 量化组件，通知中心，全局搜索 |
| **数据** | Mock 模式（沙箱）/ Real 模式（Windows 生产） |
| **待办** | 因子插件补全 / K 线真实数据 / 回测真实数据 / WebSocket 服务 |

### 1.2 移交核心原则

1. **配置驱动**：阈值 / 路径 / 端口 / 开关全部在 YAML，**绝不硬编码**到代码
2. **变与不变分离**：修改前先判断属于 5 层架构的哪一层（见 `ARCHITECTURE.md` §二）
3. **前端优先**：开发时先写前端让用户可见，再写后端
4. **渐进迁移**：不搞大重构，逐文件逐功能推进
5. **worklog 必填**：每轮工作必须 append 到 `worklog.md`，`---` 分隔

### 1.3 必读文档清单（按优先级）

| 优先级 | 文档 | 用途 |
|--------|------|------|
| ★★★★★ | `worklog.md`（最后 2 轮章节） | 了解前序进展与未决事项 |
| ★★★★★ | 本文档 | 快速启动与修改规范 |
| ★★★★☆ | `docs/maintenance/ARCHITECTURE.md` | 5 层架构 + 目录结构深度说明 |
| ★★★☆☆ | `docs/PROJECT_MAINTENANCE.md` | 运维 / 部署 / 常见问题 |
| ★★★☆☆ | `docs/USER_GUIDE.md` | 用户视角功能说明 |
| ★★☆☆☆ | `docs/maintenance/STRATEGY_LOGIC.md` | 策略公式（改策略时必读） |
| ★☆☆☆☆ | `docs/tdx-quant/` | 通达信原始 API 文档（接 Real 模式时查） |

---

## 二、快速启动（5 分钟）

### 2.1 前置检查

```bash
# 1. 确认在项目根目录
cd /home/z/my-project

# 2. 确认 Python venv
ls /home/z/.venv/bin/python3   # 应存在

# 3. 确认 bun
which bun                       # 应输出路径

# 4. 确认关键目录
ls engine/ src/ config/ strategies/ data/ docs/ scripts/
```

### 2.2 启动全栈

```bash
# 方式 A：一键启动（推荐）
bash scripts/start_all.sh
#   → 自动 pkill 旧进程
#   → 后台启动 FastAPI :8000
#   → 后台启动 Next.js :3000（日志 → dev.log）

# 方式 B：分别启动（调试用）
/home/z/.venv/bin/python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload &
bun run dev &
```

### 2.3 验证启动成功

```bash
# 1. 进程检查
ps aux | grep -E "uvicorn|next dev" | grep -v grep
# 应看到 2 个进程

# 2. FastAPI 健康
curl http://127.0.0.1:8000/health
# → {"status":"ok","uptime_seconds":N,"adapter":"mock",...}

# 3. Next.js 代理
curl http://127.0.0.1:3000/api
# → 健康检查 JSON

# 4. 核心 API 冒烟
curl http://127.0.0.1:8000/api/strategies           # 策略列表
curl http://127.0.0.1:8000/api/monitor?action=status # 监控状态
curl http://127.0.0.1:8000/api/signals?limit=1       # 信号

# 5. 前端页面（通过 Caddy 网关）
# 沙箱预览面板自动访问 :81 → :3000
```

### 2.4 停止服务

```bash
pkill -f "uvicorn engine.api.main"
pkill -f "next dev"
```

### 2.5 重启（配置变更后通常不需要）

```bash
# 配置 YAML 改动 → 热加载即可，无需重启
curl -X POST http://127.0.0.1:8000/api/config/reload

# 代码改动才需要重启
pkill -f "uvicorn engine.api.main" && \
/home/z/.venv/bin/python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload &
# Next.js 自动热重载，无需手动重启
```

---

## 三、权限说明

### 3.1 文件系统权限

| 路径 | 权限 | 说明 |
|------|------|------|
| `/home/z/my-project/` | 读写 | AI 维护者完全控制 |
| `/home/z/.venv/` | 只读 | Python venv，**不可修改**，只能 `pip install` |
| `data/duckdb/quant.db` | 读写 | DuckDB 单文件，**同一时间只能一个 FastAPI 进程写入** |
| `docs/v8-data/` | 只读 | V8 样本数据（Mock 数据源），**不可修改** |
| `Caddyfile` | 读写 | 网关配置，修改后需 `caddy reload`（沙箱自动） |

### 3.2 端口权限

| 端口 | 服务 | 可否修改 |
|------|------|----------|
| `3000` | Next.js | ✗ 固定（沙箱约定） |
| `8000` | FastAPI | ✓ 改 `config/app.yaml` `server.port` |
| `81` | Caddy | ✗ 固定（外部唯一入口） |
| `3003` | WebSocket（规划） | ✓ 预留 |

> **禁止**在 API 请求 URL 中写端口号（包括 WebSocket），必须用 `?XTransformPort=N` query param 走 Caddy 转发。

### 3.3 进程权限

- AI 维护者可启动 / 停止 FastAPI 和 Next.js
- **禁止** `bun run build`（沙箱环境，仅 `bun run dev`）
- **禁止**直接访问 `localhost:3000` / `127.0.0.1:8000`（内部地址），用户只能通过 Caddy `:81` 预览面板访问

### 3.4 数据权限

| 数据 | 可读 | 可写 | 可删 |
|------|------|------|------|
| `data/duckdb/quant.db` | ✓ | ✓（引擎自动） | ⚠️ 需先备份 |
| `data/csv/*.csv` | ✓ | ✓（引擎自动） | ✓ |
| `data/excel/*.xlsx` | ✓ | ✓（引擎自动） | ✓ |
| `logs/signals.csv` | ✓ | ✓（CSV Log 通道追加） | ⚠️ 删后丢历史 |
| `strategies/*.yaml` | ✓ | ✓ | ✓（禁删启用中的策略，后端 409 拦截） |
| `config/*.yaml` | ✓ | ✓ | ✗ 删除会导致启动失败 |

---

## 四、关键配置文件位置

### 4.1 配置文件地图

```
/home/z/my-project/
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
├── Caddyfile                    ★★  网关配置（:81）
├── .env                         ★   DATABASE_URL（Prisma）
├── package.json                 ★★★ 前端依赖 + scripts
├── requirements.txt             ★★★ 后端依赖
└── tsconfig.json / eslint.config.mjs / tailwind.config.ts  ★ 前端工具链
```

### 4.2 核心配置字段速查

#### `config/app.yaml`（全局）

```yaml
app:
  adapter_mode: mock          # ★ mock(沙箱) / real(生产)
  log_level: INFO
server:
  host: 0.0.0.0
  port: 8000                  # ★ FastAPI 端口
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

关键字段（详见 `_template.yaml` 注释）：
- `strategy_id` / `strategy_name` / `strategy_emoji` / `enabled`
- `sector.code`（命名规则 `ZD_<拼音大写><两位序号>`）/ `sector.name`
- `universe`（股票池筛选：ST/停牌/新股/市场）
- `pool.expression`（策略专属筛选表达式）
- `cleaning.rules_file`（引用 `cleaning_rules.yaml`）
- `factors[]`（因子组合，`factor_id` + `weight` + `params`）
- `scoring.expression`（评分公式，必须含 `clip`）
- `monitor.alert_conditions[]`（预警条件 + `channels`）
- `export`（CSV/Excel/板块回写）

### 4.3 代码入口位置

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

### 5.1 「初始接口」的定义

本文档中「初始接口」指：

1. **后端 API 端点**：`engine/api/routes/*.py` 中的 FastAPI 路由
2. **前端 API 客户端**：`src/lib/api.ts` 中的 `xxxAPI` 命名空间
3. **前端 API 代理**：`src/app/api/*/route.ts` 中的 Next.js Route Handlers
4. **Pydantic Schema**：`engine/api/schemas.py` 中的请求 / 响应模型
5. **前端 DTO 类型**：`src/lib/api.ts` 中的 `*DTO` 类型

### 5.2 新增一个 API 端点的完整流程

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

> **注意**：`tryFastAPI` 服务端转发到 `http://127.0.0.1:8000`，3s 超时，失败返回 `null`（调用方降级到 mock）。

#### Step 6：验证

```bash
# 后端直连
curl http://127.0.0.1:8000/api/example/hello

# 前端代理
curl http://127.0.0.1:3000/api/example/hello

# 网关（带 XTransformPort 直达后端）
curl "http://127.0.0.1:81/api/example/hello?XTransformPort=8000"
```

### 5.3 修改现有接口的规范

1. **向后兼容**：新增字段用可选（`field?: type`），不删字段
2. **Schema 同步**：后端 `schemas.py` 改了，前端 `api.ts` DTO 必须同步
3. **代理透传**：Next.js route.ts 只做转发，**不加业务逻辑**（降级 mock 除外）
4. **错误码规范**：
   - `400` 请求参数错误
   - `404` 资源不存在
   - `409` 冲突（如策略已存在 / 启用中禁止删除）
   - `422` Pydantic 校验失败
   - `500` 服务端错误
   - `503` FastAPI 不可用（前端代理降级）

### 5.4 前端 API 代理规范（`src/lib/api-proxy.ts`）

```typescript
// 服务端转发工具（仅 Next.js Route Handler 使用）
export async function tryFastAPI<T>(path: string, options?: RequestInit): Promise<T | null> {
  // 走 http://127.0.0.1:8000，3s 超时
  // 失败返回 null，调用方降级到 mock
}

export function ok<T>(data: T, status = 200) { /* 成功响应 */ }
export function err(message: string, status = 500) { /* 错误响应 */ }
```

**三件套用法**：
```typescript
export async function GET() {
  const data = await tryFastAPI<MyDTO>('/api/my-endpoint');
  if (!data) return err('FastAPI unavailable', 503);
  return ok(data);
}
```

---

## 六、调整项目配置指南

### 6.1 配置热加载机制

ConfigLoader（`engine/config/loader.py`）特性：

1. **单例模式**：`ConfigLoader()` 全局唯一
2. **mtime 监听**：每 2s 检查 `config/*.yaml` + `strategies/*.yaml` 的修改时间，变更自动重载
3. **手动触发**：`POST /api/config/reload` 或 `python scripts/reload_config.py`
4. **失败容错**：单个 YAML 解析失败跳过并告警，不影响其他配置

### 6.2 修改配置的标准流程

```
编辑 YAML 文件
    ↓
（等待 2s 自动重载）或 手动 POST /api/config/reload
    ↓
验证：GET /api/strategies 或 GET /api/channels
    ↓
前端 UI 自动刷新（轮询 / 手动刷新）
```

### 6.3 配置修改场景速查

| 场景 | 文件 | 修改字段 | 生效方式 |
|------|------|----------|----------|
| 切换 Mock/Real | `config/app.yaml` | `app.adapter_mode` | 重启 FastAPI |
| 改 FastAPI 端口 | `config/app.yaml` | `server.port` | 重启 FastAPI + Caddyfile |
| 开关推送通道 | `config/channels.yaml` | `channels[].enabled` | 热加载 |
| 配置飞书 webhook | `config/channels.yaml` | `feishu.config.webhook_url/secret` | 热加载 |
| 新增策略 | `strategies/strategy_xxx.yaml` | 全字段 | 热加载（2s 自动） |
| 启用/禁用策略 | `strategies/strategy_xxx.yaml` | `enabled: true/false` | 热加载 |
| 调整策略阈值 | `strategies/strategy_xxx.yaml` | `factors[].params` / `scoring.expression` | 热加载 |
| 改数据清洗规则 | `config/cleaning_rules.yaml` | rules | 热加载 |
| 改监控预警条件 | `config/monitor_rules.yaml` | conditions | 热加载 |
| 改 DuckDB 路径 | `config/app.yaml` | `paths.duckdb` | 重启 FastAPI |
| 改导出格式 | `config/export.yaml` | columns | 热加载 |
| 改主题色 | `config/theme.yaml` | colors | 热加载 + 前端刷新 |

### 6.4 策略 YAML 修改规范

#### 新增策略

```bash
# 方式 1：复制模板（命令行）
cp strategies/_template.yaml strategies/strategy_mystr.yaml
# 编辑 strategy_mystr.yaml：strategy_id / name / sector / factors / scoring / enabled: true

# 方式 2：前端 UI（推荐）
# 策略管理 Tab → 选源策略 → 点 Copy 按钮 → 填新 ID/名/emoji → 确认
# 后端 POST /api/config/strategies 自动创建
```

**命名规则**：
- 文件名：`strategy_<拼音首字母小写>.yaml`（如 `strategy_dbqzt.yaml`）
- `strategy_id`：拼音首字母小写（如 `dbqzt`），2–30 字符，`[a-zA-Z0-9_]`
- `sector.code`：`ZD_<拼音大写><两位序号>`（如 `ZD_DBQZT01`）
- `sector.name`：`<中文名>选股`（如 `打板求涨停选股`）

#### 删除策略

```bash
# 前端 UI：策略管理 Tab → 点 Trash2 按钮 → 输入策略 ID 确认
# 后端 DELETE /api/config/strategies/{id}
# 限制：启用中的策略不可删（409），先 disable 再删
```

#### 修改策略阈值

直接编辑 `strategies/strategy_xxx.yaml` 的 `factors[].params` 或 `scoring.expression`，2s 自动热加载。

> **重要**：评分公式必须含 `clip` 限制上限，防止累加超限。公式语法见 `engine/expression/evaluator.py`（simpleeval）。

### 6.5 通道配置修改

#### 开启飞书推送

```yaml
# config/channels.yaml
- channel_id: feishu
  enabled: true                          # 改为 true
  config:
    webhook_url: "https://open.feishu.cn/..."  # 填入机器人 webhook
    secret: "your_sign_secret"           # 填入签名密钥
    msg_type: interactive
    at_users: ["user_id_1"]              # @ 用户
    at_all: false
```

热加载后，策略 YAML `monitor.alert_conditions[].channels` 引用 `feishu` 即可推送。

#### 测试通道

```bash
curl -X POST http://127.0.0.1:8000/api/channels/feishu/test
# → 发送测试消息到飞书
```

---

## 七、常见修改场景 Step-by-Step

### 场景 1：新增一个前端页面 Tab

1. **创建组件**：`src/components/quant/MyTab.tsx`
2. **注册到 page.tsx**：在 `TABS` 数组添加 `{ id: 'mytab', label: '我的 Tab', icon: ... }`
3. **在 main 区域渲染**：`{tab === 'mytab' && <MyTab />}`
4. **（如需后端）**：按 §5.2 新增 API
5. **验证**：agent-browser 打开页面，点击新 Tab

### 场景 2：新增一个因子插件

1. **创建文件**：`engine/factors/my_factor.py`
2. **实现接口**：继承 `BaseFactor`，实现 `compute(df) -> pd.Series`
3. **注册**：`FactorRegistry` 自动扫描 `engine/factors/*.py`（无需手动注册）
4. **策略引用**：`strategies/strategy_xxx.yaml` `factors[].factor_id: my_factor`
5. **验证**：`GET /api/strategies` 应包含新因子；运行策略选股检查输出

### 场景 3：新增一个推送通道

1. **创建文件**：`engine/channels/my_channel.py`
2. **实现接口**：继承 `NotificationChannel`，实现 `send(payload) -> ChannelResult`
3. **注册**：`ChannelRegistry` 自动扫描（无需手动注册）
4. **配置**：`config/channels.yaml` 添加 `channels[]` 条目
5. **策略引用**：`monitor.alert_conditions[].channels: [my_channel]`
6. **验证**：`POST /api/channels/my_channel/test` 发测试消息

### 场景 4：切换 Mock → Real 模式

```bash
# 1. 编辑配置
sed -i 's/adapter_mode: mock/adapter_mode: real/' config/app.yaml

# 2. 确认通达信终端已启动登录（Windows）

# 3. 重启 FastAPI（适配器模式不热加载）
pkill -f "uvicorn engine.api.main"
/home/z/.venv/bin/python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload &

# 4. 验证
curl http://127.0.0.1:8000/api/monitor?action=status
# → 应返回 adapter: real, subscribed: N
```

### 场景 5：修改 DuckDB 表结构

1. **编辑 SQL**：`config/duckdb_schema.sql`
2. **重建数据库**（⚠️ 会丢数据，先备份）：
   ```bash
   cp data/duckdb/quant.db data/duckdb/quant.db.bak
   rm data/duckdb/quant.db
   python scripts/init_db.py
   ```
3. **或增量迁移**：写 `scripts/migrate_xxx.py` 用 `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS`

### 场景 6：修改网关路由

```bash
# 1. 编辑 Caddyfile
vim Caddyfile

# 2. 重载 Caddy（沙箱自动，或手动）
caddy reload --config Caddyfile

# 3. 验证
curl "http://127.0.0.1:81/api/strategies?XTransformPort=8000"
```

---

## 八、AI 维护者工作流规范

### 8.1 每轮开发的标准流程

```
1. 读取 worklog.md（最后 2 轮章节）
   ↓
2. 拆解 todos（TodoWrite）
   ↓
3. 评估项目状态（curl /health + agent-browser QA）
   ↓
4. 有 Bug → 优先修复
   无 Bug → 推进新功能
   ↓
5. 前端优先开发（让用户可见）
   ↓
6. 后端 API 开发
   ↓
7. QA 验证（lint + curl + agent-browser）
   ↓
8. append worklog.md（--- 分隔 + Task ID + Stage Summary）
   ↓
9. 更新 PROJECT_HANDOVER.md / PROJECT_MAINTENANCE.md（如有架构变更）
```

### 8.2 worklog.md 写作规范

每轮工作 **必须** append 一个 section，格式：

```markdown
---
Task ID: <轮次>-<子任务，如 R7-A>
Agent: <agent 名称，如 full-stack-developer / main>
Task: <任务简述>

Work Log:
- <具体步骤 1>
- <具体步骤 2>
- ...

Stage Summary:
- 已完成: <列出>
- 文件变更: <后端 N 个 / 前端 N 个，列文件名>
- 未解决问题: <列出>
- 下一阶段建议: <列出>
```

**禁止**：
- 覆盖已有 worklog 内容（必须 append）
- 省略 `---` 分隔符
- 省略 Task ID

### 8.3 TodoWrite 规范

- 每个 todo 有唯一 `id`（数字或 `数字-字母` 表示并行）
- `status`：pending → in_progress → completed
- 同时只允许 1 个 `in_progress`
- 能并行的工作拆成 `2-a` / `2-b`，分配给不同 subagent

### 8.4 Subagent 委派规范

当任务复杂时，用 `Task` 工具委派 subagent：

- **必传参数**：`Task ID` / 任务描述 / 要求返回内容
- **必读 worklog**：告诉 subagent 先读 `/home/z/my-project/worklog.md`
- **必写 worklog**：告诉 subagent 完成后 append worklog
- **并行**：能并行的工作在**单条消息**里发多个 `Task` 调用

---

## 九、质量门禁与验证清单

### 9.1 每轮开发必须通过的质量门禁

| 门禁 | 命令 | 通过标准 |
|------|------|----------|
| **ESLint** | `bun run lint` | EXIT=0，0 错误 0 警告 |
| **FastAPI 健康** | `curl :8000/health` | 200 + `status: ok` |
| **核心 API** | `curl :8000/api/strategies` 等 | 全 200 |
| **前端代理** | `curl :3000/api/strategies` | 200（透传或降级 mock） |
| **dev.log** | `tail dev.log` | 无 Fatal / Error |
| **agent-browser** | 打开 `/` 路由 | 页面渲染 + 核心交互可用 |

### 9.2 agent-browser 验证步骤

```bash
# 1. 查看可用命令
agent-browser --help

# 2. 打开页面
agent-browser navigate <预览面板 URL>

# 3. 截图
agent-browser screenshot

# 4. 点击 / 输入
agent-browser click <selector>
agent-browser type <selector> <text>

# 5. 检查控制台
agent-browser console
```

**必验交互**：
- 5 个 Tab 切换
- 策略管理：启用/禁用/运行/复制/删除
- 信号中心：行点击抽屉
- 全局搜索：Cmd+K
- 通知中心：Bell 按钮
- 推送通道配置 Dialog

### 9.3 回归测试

每次修改后确认未破坏既有功能：

```bash
# 策略 CRUD
curl :8000/api/strategies
curl -X POST :8000/api/config/strategies -d '{"strategy_id":"test","yaml_content":"..."}'
curl -X DELETE :8000/api/config/strategies/test

# 监控
curl :8000/api/monitor?action=status
curl :8000/api/monitor?action=quotes
curl :8000/api/monitor/flow-ranking

# 信号
curl :8000/api/signals
curl :8000/api/signals/stats

# 通道
curl :8000/api/channels

# 回测
curl :8000/api/backtest/history
curl :8000/api/backtest/leaderboard
```

---

## 十、风险与禁忌

### 10.1 绝对禁忌（DO NOT）

| 禁忌 | 后果 | 正确做法 |
|------|------|----------|
| `bun run build` | 沙箱 OOM / 卡死 | 仅用 `bun run dev` |
| 直接访问 `localhost:3000` / `:8000` | 用户无法访问 | 走 Caddy `:81` |
| API URL 写端口号（含 WebSocket） | Caddy 不转发 | 用 `?XTransformPort=N` |
| 硬编码阈值到代码 | 无法热加载 | 全走 YAML |
| 多个 FastAPI 实例同时写 DuckDB | `database is locked` | 确保单实例 |
| 删除启用中的策略 YAML | 运行中策略异常 | 先 disable 再删 |
| `z-ai-web-dev-sdk` 在客户端调用 | 密钥泄露 | 仅后端使用 |
| 覆盖 worklog.md | 丢失开发历史 | append 模式 |
| 省略 Task ID | 追踪困难 | 每轮必填 |
| 跳过 QA 直接报告完成 | 用户看到白屏 | 必须 agent-browser 验证 |

### 10.2 高风险操作

| 操作 | 风险 | 缓解措施 |
|------|------|----------|
| 删 `data/duckdb/quant.db` | 丢全部业务数据 | 先备份 `.bak` |
| 改 `Caddyfile` | 全站不可访问 | 改后 `caddy reload` + 验证 |
| 改 `prisma/schema.prisma` | Prisma 客户端不匹配 | `bun run db:generate` |
| 改 `engine/api/main.py` lifespan | 引擎启动失败 | 充分测试 |
| 升级 `next` / `react` 大版本 | 全前端可能崩 | 锁版本 + 全量回归 |
| 升级 `fastapi` / `pydantic` | API 行为变化 | 检查 v1→v2 迁移 |

### 10.3 已知限制

| 限制 | 说明 | 规划 |
|------|------|------|
| 通知中心仅内存 | 刷新页面清空 | R8 加 localStorage 持久化 |
| WebSocket 通道未部署 | 用 HTTP 轮询替代 | R8 部署 `:3003` 服务 |
| 回测用 mock 价格 | 确定性 hash 生成 | R8 接 `tq.get_market_data` |
| K 线图 mock 数据 | 非真实行情 | R8 接真实数据 |
| Prisma schema 是脚手架 | 仅 User/Post | 业务数据用 DuckDB，Prisma 预留 |
| 版本号不一致 | 4 处版本未对齐 | 规划统一为 1.0.0 |
| `package.json` name 是脚手架名 | `nextjs_tailwind_shadcn_ts` | 规划改 `tdxquant` |

---

## 附录：快速启动 Checklist

接手项目时按此清单逐项确认：

- [ ] `cd /home/z/my-project`
- [ ] 读 `worklog.md` 最后 2 轮章节
- [ ] 读本文档 §二 §四 §五
- [ ] `ps aux | grep -E "uvicorn|next dev"` 确认进程
- [ ] `curl :8000/health` 确认 FastAPI
- [ ] `curl :3000/api` 确认 Next.js 代理
- [ ] `curl :8000/api/strategies` 确认策略加载
- [ ] `tail dev.log` 确认无错误
- [ ] agent-browser 打开 `/` 确认页面渲染
- [ ] 点击 5 个 Tab 确认切换正常
- [ ] `bun run lint` 确认 0 错误

全部通过 → 项目健康，可开始本轮开发。

---

**文档结束** · 有疑问先查 `worklog.md` + `ARCHITECTURE.md`，仍无解联系上一轮 AI 维护者（见 worklog 最后 section）。
