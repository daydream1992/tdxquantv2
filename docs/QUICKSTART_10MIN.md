# TdxQuant 10分钟维护上手

> 目标：读完这份文档，你能在 10 分钟内启动系统、改配置、排查问题。
>
> - 适用读者：新接手的人类运维 / AI Agent
> - 生成日期：2026-06-17
> - 配套文档：`docs/API_CAPABILITY_MAP.md`、`docs/PATH_REPLACEMENT_GUIDE.md`、`docs/PROJECT_MAINTENANCE.md`

---

## 一、系统全貌（30 秒看懂）

### 5 层架构

| 层 | 职责 | 关键文件 |
|----|------|---------|
| L1 基础设施 | DuckDB 存储 / 通达信 tqcenter 数据适配器 / SSE 实时流 | `data/duckdb/quant.db`、`config/duckdb_schema.sql`、`engine/data_adapter/`、`src/app/api/realtime/` |
| L2 核心引擎 | FastAPI 后端 + Next.js 前端 + 表达式 / 因子 / 通道三大注册表 | `engine/api/main.py`、`engine/expression/`、`engine/factors/registry.py`、`engine/channels/registry.py` |
| L3 组件抽象 | Base 类定义扩展契约 | `engine/factors/base.py`、`engine/channels/base.py`、`engine/pipeline/base.py`、`engine/data_adapter/base.py` |
| L4 业务规则 | 选股 pipeline 6 步 + 监控引擎求值循环 | `engine/pipeline/runner.py`、`engine/monitor/engine.py`、`engine/monitor/match_registry.py` |
| L5 用户配置 | 策略 / 预警 / 通道 / 匹配 / 应用全局 | `strategies/strategy_*.yaml`、`config/{monitor_rules,match_strategies,channels,app,cleaning_rules}.yaml` |

### 核心数据流

```
┌─ 选股链 ─────────────────────────────────────────────────────────────┐
│ 策略 YAML → POST /api/strategies/{id}/run → PipelineRunner 6 步        │
│   1.load_data  2.calc_factors  3.score  4.rank                        │
│   5.persist(写 selection_results 表 + 自动订阅 Top 20)               │
│   6.export(Excel/CSV + 通达信板块回写)                                │
└──────────────────────────────────────────────────────────────────────┘

┌─ 监控链 ─────────────────────────────────────────────────────────────┐
│ FastAPI lifespan 启动 → adapter.subscribe_hq(codes, callback)         │
│   → MonitorEngine.on_quote(snap)                                      │
│   → MatchRegistry.get_applicable(code) 求得适用 match                │
│   → ExpressionEvaluator.evaluate_safe(condition, snap_vars)          │
│   → 命中 → record_signal + dispatch(channels) + 写 signal_events 表  │
│   → channels: csv_log(强制开) / websocket / tdx_warn / feishu        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 二、启动与停止（2 分钟）

### Linux（沙箱 / 生产）

```bash
# 一键启动（FastAPI:8000 + Next.js:3000，会先 pkill 旧进程）
bash scripts/start_all.sh

# 或手动后台拉起
setsid python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 \
  >> data/logs/fastapi.log 2>&1 < /dev/null &
setsid ./node_modules/.bin/next dev -H 127.0.0.1 -p 3000 \
  >> dev.log 2>&1 < /dev/null &

# 前端独立启动（开发模式）
bun run dev

# 停止
pkill -f "uvicorn engine.api"; pkill -f "next dev"; pkill -f "next-server"
```

### Windows

```powershell
# 一键启动（FastAPI + Next.js）
powershell -ExecutionPolicy Bypass -File scripts\start_all.ps1

# 停止
Get-Process | Where-Object { $_.ProcessName -match 'python|node|bun' } | Stop-Process -Force

# 生产环境用 nssm 注册服务，详见 docs\PROJECT_MAINTENANCE.md
```

### 新环境初始化

```bash
# Linux / macOS：6 步（检查依赖 / 建目录 / pip / bun / init_db / 路径替换）
bash scripts/setup-env.sh

# Windows
powershell -ExecutionPolicy Bypass -File scripts\setup-env.ps1
```

### 验证启动成功

```bash
# 后端健康
curl -s http://127.0.0.1:8000/health                              # → 200
curl -s http://127.0.0.1:8000/api/monitor/status | python -m json.tool
# 期望: engine_status="running", today_signals>0

# 前端
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/    # → 200
```

---

## 三、改配置（3 分钟）

### 配置文件速查表

| 要改什么 | 改哪个文件 | 改完怎么生效 |
|----------|-----------|-------------|
| 选股策略（因子 / 权重 / 评分公式） | `strategies/strategy_*.yaml` | `POST /api/config/reload` |
| 预警规则模板（条件 / 阈值 / 通道） | `config/monitor_rules.yaml` | `POST /api/config/reload` |
| 匹配策略（策略 ↔ 预警套餐绑定） | `config/match_strategies.yaml` | `POST /api/monitor/match-strategies/reload` |
| 推送通道（飞书 / webhook / 开关） | `config/channels.yaml` | `PUT /api/channels` |
| 数据清洗规则 | `config/cleaning_rules.yaml` | `POST /api/config/reload` |
| 应用全局（adapter_mode / 路径 / 时段） | `config/app.yaml` | **需重启 FastAPI** |
| 板块映射 | `config/sector_mapping.yaml` | `POST /api/config/reload` |
| 主题色 / UI | `config/theme.yaml` | 重启 Next.js |

> 配置文件被 ConfigLoader 的 watcher 监听，改完 2 秒内会自动 reload；显式调 POST 接口可立即生效。

### 3 个最常见改配置场景

#### 1. 调预警阈值

`config/monitor_rules.yaml` → `alert_templates.xxx.default_params`：

```yaml
alert_templates:
  limit_up_surge:
    condition: "pct_change > 0.05"   # ← 改这里（表达式语法，见 §四）
    alert_type: limit_up_surge
    channels: [tdx_warn, websocket, feishu]
```

```bash
curl -X POST http://127.0.0.1:8000/api/config/reload
```

#### 2. 加监控股票

```bash
curl -X POST http://127.0.0.1:8000/api/monitor/watchlist \
  -H 'Content-Type: application/json' \
  -d '{"codes": ["600519.SH","000001.SZ"], "strategy_id": "rzq"}'
```

#### 3. 开关通道

```bash
curl -X PUT http://127.0.0.1:8000/api/channels \
  -H 'Content-Type: application/json' \
  -d '{"channels": {"feishu": {"enabled": true, "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"}}}'
```

---

## 四、加新功能（3 分钟，详见 `docs/API_CAPABILITY_MAP.md` §六）

### 加新选股策略

1. 复制 `strategies/_template.yaml` → `strategies/strategy_myid.yaml`
2. 改 5 个必填段：`strategy_id` / `strategy_name` / `factors[]` / `scoring.formula` / `output` + 可选 `monitor.alert_conditions`
3. `curl -X POST http://127.0.0.1:8000/api/config/reload`
4. `curl -X POST http://127.0.0.1:8000/api/strategies/myid/run` 跑一次
5. `GET /api/selections?strategy_id=myid` 看结果

### 加新预警规则

1. `config/monitor_rules.yaml` 的 `alert_templates` 加一条（`condition` 用表达式语法，变量见 `docs/API_CAPABILITY_MAP.md` §6.2）
2. `config/match_strategies.yaml` 的某个 `match.alerts` 引用该 `alert_type`
3. `curl -X POST http://127.0.0.1:8000/api/monitor/match-strategies/reload`

### 加新因子

1. `engine/factors/` 加 `xxx.py`，定义 `class XxxFactor(Factor)`，实现 `get_required_fields()` / `get_default_params()` / `calculate()`
2. **无需改 registry**，`FactorRegistry` 启动时扫描 `engine/factors/*.py` 自动注册
3. 策略 YAML 的 `factors[].factor_id` 引用新因子
4. `POST /api/config/reload` 后 `POST /api/strategies/{id}/run`，查 `selection_results.factor_scores` JSON 含新字段即成功

### 加新推送通道

1. `engine/channels/` 加 `xxx.py`，继承 `BaseChannel`，实现 `validate_config()` / `send()`
2. `engine/channels/registry.py` 的 `_CHANNEL_CLASSES` 字典登记 + `_DEFAULT_CONFIG` 加默认参数
3. `config/channels.yaml` 加一项 `{channel_id, channel_name, enabled, config}`
4. `PUT /api/channels` 热重载
5. `POST /api/channels/xxx/test` 测试发一条
6. 策略 YAML 的 `alert_conditions[].channels` 或 `monitor_rules.yaml` 的 `alert_templates.*.channels` 引用

---

## 五、排查问题（1 分钟）

### 日志位置

| 日志 | 路径 | 看什么 |
|------|------|--------|
| FastAPI | `data/logs/fastapi.log` | 后端报错 / 请求日志 / MonitorEngine 启动信息 |
| Next.js | `dev.log`（项目根） | 前端编译 / 运行时错误 |
| 信号 CSV | `logs/signals.csv` | 推送审计记录（csv_log 通道强制开） |
| DuckDB | `data/duckdb/quant.db` | `duckdb quant.db` 进 CLI 查 selection_results / signal_events / monitor_subscriptions |

### 常见报错

| 报错 | 原因 | 解决 |
|------|------|------|
| MonitorEngine 启动失败 | `app.adapter_mode` 或 `subscribe_hq` 问题 | 查 `fastapi.log`；Mock 模式应正常（`config/app.yaml: adapter_mode: mock`） |
| `feishu 通道异常: unknown url type: ''` | `webhook_url` 为空但 channel enabled=true | `channels.yaml` 配 `feishu.webhook_url`，或忽略（**预期日志噪音**，单通道失败不影响其他通道） |
| `today_signals=0` | MonitorEngine 没跑 | 确认 FastAPI lifespan 已启动；`grep "MonitorEngine已启动" data/logs/fastapi.log` |
| 前端白屏 / 502 | Next.js 没起 | `curl :3000` 确认；`bun run dev` 重启 |
| `404 /api/config` | 本轮已知（bug #9） | 用 `POST /api/config/reload` 替代；GET 摘要端点待补 |
| `422 /api/monitor/match-strategies/{id}/test` | body 缺 `snap` 包装 | 正确格式：`{"snap": {"code":"...","pct_change":0.04,...}}`（详见 API_CAPABILITY_MAP §6.2） |
| 启动后 monitor_subscriptions 全空 | lifespan 未从 DuckDB 冷启动加载（bug #1） | 重启后调 `POST /api/strategies/{id}/run` 重订阅 Top 20，或 `POST /api/monitor/watchlist` 手动补 |
| `pip install` 卡在 uvloop（Windows） | uvloop 是 Linux-only | `requirements.txt` 已拆 `uvicorn[standard]` 为 4 行，重新 `pip install -r` 即可 |

### 健康检查命令

```bash
# 一键体检
curl -s http://127.0.0.1:8000/api/monitor/status           | python -m json.tool
curl -s http://127.0.0.1:8000/api/monitor/match-strategies | python -m json.tool
curl -s http://127.0.0.1:8000/api/channels                 | python -m json.tool

# 看 DuckDB 里的数据
python -c "import duckdb; print(duckdb.connect('data/duckdb/quant.db').execute('SELECT alert_type, COUNT(*) FROM signal_events WHERE event_date=CURRENT_DATE GROUP BY 1').fetchall())"

# 看进程
ps -ef | grep -E "uvicorn|next dev|next-server" | grep -v grep
```

---

## 六、路径替换（30 秒，详见 `docs/PATH_REPLACEMENT_GUIDE.md`）

切换 Windows / Linux 环境时，所有 `{{...}}` 占位符可一键替换：

```bash
# Linux 上切到 Windows
bash scripts/replace-paths.sh --env windows

# Windows 上切到 Linux
powershell scripts\replace-paths.ps1 -Env linux

# 预览不写
bash scripts/replace-paths.sh --env windows --dry-run
```

占位符定义在 `scripts/paths.yaml`（共 5 个：`{{VENV_PYTHON}}` / `{{PROJECT_ROOT}}` / `{{LOG_DIR}}` / `{{TMP_DIR}}` / `{{NULL_DEV}}`）。需要绝对路径就改 `paths.yaml` 的 `placeholders` 段，无需动脚本。

> **注意**：脚本只替换 `{{...}}` 占位符，不会动已有硬编码路径（避免误伤）。新代码请用 `pathlib.Path` + 占位符，不要写死 `/home/z/...` 或 `C:\...`。

---

## 七、文档导航

| 文档 | 看什么 |
|------|--------|
| `docs/API_CAPABILITY_MAP.md` | 所有接口清单（40 路由）+ §六扩展指引（加策略 / 预警 / 因子 / 通道） |
| `docs/MONITOR_ENGINE_PLAN.md` | 监控引擎设计全案（一~十五章） |
| `docs/MONITOR_ENGINE_IMPLEMENTATION_PROMPT.md` | 监控引擎实施提示词（可整体喂给实施 AI） |
| `docs/PATH_REPLACEMENT_GUIDE.md` | 路径替换详细说明（5 占位符 + FAQ） |
| `docs/PROJECT_MAINTENANCE.md` | 完整运维手册（含 nssm 服务注册） |
| `docs/STRATEGY_FACTOR_EXTENSION.md` | 策略因子扩展步骤详解 |
| `docs/PROJECT_HANDOVER.md` | 项目交接文档 |
| `docs/USER_GUIDE.md` | 终端用户使用指南 |
| `docs/maintenance/ARCHITECTURE.md` | 系统架构总览 |
| `docs/maintenance/STRATEGY_LOGIC.md` | 策略逻辑详解 |
| `worklog.md` | 开发历史 + 每轮变更 + bug 清单 |

---

## 八、关键约束（必读）

1. **不改 `config/duckdb_schema.sql`**（不建新表；如必须加字段，需同步评估 DuckDB UPDATE 索引 bug）
2. **不改前端 `src/**`**（HTTP 轮询契约不变；如需新数据，先在后端加路由 + 在 `src/app/api/` 加 route.ts 代理）
3. **求值用 `ExpressionEvaluator`**（基于 simpleeval AST，**不用 `eval` / `exec`**）
4. **路径用 `pathlib.Path`**（不用字符串拼 `/` 或 `\`）
5. **新代码加类型注解 + docstring**（PEP 484，便于 AI 维护）
6. **`csv_log` 通道强制开启**（审计要求，不可关闭）
7. **`send_user_block` 是追加非覆盖**（必须先 `clear_sector`，`SectorManager.update_stocks` 已封装原子操作）
8. **`subscribe_hq` 上限 100 只**（分批 50，`config/app.yaml: tqcenter.subscribe_batch_size`）
9. **改完跑 `bun run lint` + 重启 FastAPI 验证**（`bash scripts/start_all.sh` 会自动重启）
10. **不要 `DELETE /api/monitor/match-strategies/_default`**（兜底套餐保护未实施，误删会让所有非绑定股票失预警；详见 worklog R9-3 bug #2）

---

## 九、本次文档对应的项目现状（2026-06-17）

| 项目 | 状态 |
|------|------|
| 监控引擎 | 已实施（R9-1 完成） |
| Windows 跨平台适配 | 已完成 88%（R9-4，剩真实 Windows 机器验证） |
| Bug 扫描 | 已完成（R9-3，3 高 + 6 中 + 8 低） |
| 5 层架构 / DuckDB 8 表 / 26 因子 / 4 通道 | 全部就绪 |
| 待修高优 bug | R9-3 #1 lifespan 冷启动 / #2 _default 保护 / #3 channels.yaml 格式 |

> 新接手者建议先读 `worklog.md` 末 3 段，了解 R9-3 / R9-4 已知 bug，再动手。
