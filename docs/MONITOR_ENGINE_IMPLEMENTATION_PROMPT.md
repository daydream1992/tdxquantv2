# 监控循环引擎 + 匹配策略层 —— 实施提示词

> **本文件用途**：这是一份**给实施 AI 的完整开发指令**。把它整体喂给一个全新会话的 AI，它能照此从零实施监控引擎，无需额外上下文。
>
> **配套方案文档**：`docs/MONITOR_ENGINE_PLAN.md`（1381 行，设计细节全文）。实施前必须通读。
>
> **最后更新**：R8 轮次 · 匹配策略增补

---

## 0. 给实施 AI 的元指令（最高优先级）

1. **先读后写**：开工前必须依次读完以下文件，理解现有架构与零件：
   - `docs/MONITOR_ENGINE_PLAN.md`（本任务设计全文，**最重要**）
   - `/home/z/my-project/worklog.md` 的末尾两个 Task（R8-监控引擎方案 / R8-监控引擎方案-匹配策略增补）
   - `config/monitor_rules.yaml` / `config/duckdb_schema.sql` / `engine/expression/evaluator.py` / `engine/api/state.py` / `engine/api/routes/monitor.py` / `engine/channels/registry.py` / `engine/data_adapter/mock_adapter.py` / `engine/data_adapter/real_adapter.py` / `engine/api/main.py` / `engine/pipeline/runner.py` / `strategies/strategy_rzq.yaml`
2. **能复用就不重写**：本任务的核心原则是「串零件」，不是「造零件」。已有零件清单见 PLAN 文档 §1.1，**禁止重写这些文件**（除非 PLAN 明确要求改）。
3. **不求高精度**：用户明确「不需高精度结果」。ML/回测拟合/跨周期共振/ST 精确名单/参数自动寻优——**一律不做**（见 PLAN §14.9）。MVP 跑通即可。
4. **代码量控制**：新增 + 改动总量目标 ~900 行（第四章 ~400 + 第十四章 ~350 + P0 优化 ~150）。超出则停下回顾设计。
5. **每步验证再进下一步**：PLAN §11 + §14.11 共 13 步，每步都有验证标准，**未通过验证不进下一步**。
6. **工作日志**：每完成一个 Task ID 阶段，必须**追加**（不要覆盖）一段记录到 `/home/z/my-project/worklog.md`，格式见文末 §7。
7. **不破坏现有功能**：选股信号推送（`strategies.py:594`）、前端 HTTP 轮询（`useRealtime.ts`）、通道配置 UI——**一律不动**。

---

## 1. 任务背景

### 1.1 项目现状

TdxQuant 是一个 Next.js 16 前端 + Python FastAPI 后端（`engine/`）的量化交易系统。已完成选股 pipeline、通道分发、回测、前端 Dashboard。**但监控层是半成品**——只有三块零件，缺把它们串起来的主动监控循环引擎。

### 1.2 监控层缺口（上一轮代码审查发现）

| 已有零件 | 状态 | 问题 |
|----------|------|------|
| `config/monitor_rules.yaml`（alert_templates + trading_hours + debounce） | ✅ 完整 | 无人读取求值 |
| `engine/expression/evaluator.py`（simpleeval 白名单求值） | ✅ 可用 | 无人调 |
| `engine/api/routes/monitor.py`（只读展示 API） | ✅ 可用 | 只读，不产生信号 |
| `engine/channels/registry.py`（dispatch 推送） | ✅ 可用 | 只有选股信号调它 |
| `signal_events` 表（DuckDB） | ⚠️ 只读 | 无人 INSERT |
| `EngineState.record_signal()` | ⚠️ 空转 | 无人调，today_signals 永远 0 |
| `MockAdapter.subscribe_hq` / `RealAdapter.subscribe_hq` | ⚠️ 闲置 | 无人订阅 |
| **`engine/monitor/` 目录** | ❌ **不存在** | 监控循环引擎缺位 |
| **匹配策略层** | ❌ **不存在** | 策略 YAML 的 `monitor.alert_conditions` 是死配置 |

### 1.3 本任务目标

实施 **3 块新增工作**，让监控层从「半成品」变成「可主动预警 + 可增删调参」：

1. **监控循环引擎主体**（PLAN 第四章 + 第五~九章）：daemon 线程 + 行情获取 + 求值 + 落库 + 推送 + 时段控制 + 防抖
2. **匹配策略层 MatchStrategy**（PLAN 第十四章）：三层模型（alert_templates 零件库 → match_strategies 装配单 → MonitorEngine 执行手），可增删调参
3. **P0 优化项**（PLAN §15.1 / §15.7 / §15.8）：股票池动态管理 API + 冷启动自动注入订阅 + 跨日清理调度

### 1.4 非目标（本轮明确不做）

- ❌ WebSocket 实时推送前端（保持 HTTP 轮询，前端 `useRealtime.ts` 不动）
- ❌ 多策略并发监控的复杂调度（单队列串行求值足够）
- ❌ 预警规则 ML 打分 / 参数自动寻优（§14.9）
- ❌ 跨周期共振（日线+分钟线，本轮单快照求值）
- ❌ ST 精确名单匹配（scope 用市场前缀兜底，留 P1）
- ❌ 预警回测验证 / 归因日报（P2，需数据积累）
- ❌ 预警聚合推送 / 分级值班 / 健康度监控（P1，下一轮）

---

## 2. 实施步骤总览（13 步，严格按序）

| 步骤 | 章节 | 内容 | 代码量 | 验证 |
|------|------|------|--------|------|
| **Step 1** | §11 | 创建 `engine/monitor/` 目录 + `__init__.py` | 5 行 | import 不报错 |
| **Step 2** | §11 | 实现 `engine/monitor/rules.py`（RuleSet 加载 + 求值） | ~100 行 | 单元验证 §12.1 |
| **Step 3** | §11 | 实现 `engine/monitor/engine.py`（MonitorEngine 主循环） | ~250 行 | 引擎验证 §12.2 |
| **Step 4** | §11 | 挂载到 `engine/api/main.py` lifespan | +15 行 | 集成验证 §12.3 |
| **Step 5** | §11 | ConfigLoader reload 联动 `RuleSet.invalidate()` | +3 行 | 改 YAML 后 reload 生效 |
| **Step 6** | §11 | 端到端验证（Mock 模式跑通） | — | §12.3-12.5 |
| **Step 7** | §14.11 | 改 `config/monitor_rules.yaml`：alert_templates 加 `default_params` + 占位符 condition | +15 行 | 老模板向后兼容 |
| **Step 8** | §14.11 | 新建 `config/match_strategies.yaml`（3 个示例 match） | ~80 行 | YAML 可加载 |
| **Step 9** | §14.11 | 实现 `engine/monitor/match_registry.py`（MatchRegistry + scope + render + CRUD） | ~120 行 | test API 能预览命中 |
| **Step 10** | §14.11 | 改 `engine/monitor/engine.py` 的 `on_quote`，走 MatchRegistry | +30 行 | 按策略匹配命中 |
| **Step 11** | §14.11 | 实现 `engine/api/routes/match_strategy.py`（6 个 CRUD + reload + test 路由） | ~100 行 | API 可增删改 |
| **Step 12** | §14.11 | 注册路由 + reload 联动 `MatchRegistry.invalidate()` | +2 行 | reload 后 match 生效 |
| **Step 13** | §14.11 | 端到端验证（调参 → test 预览 → 实盘命中） | — | 全链路通 |
| **Step 14** | §15.1 | 监控股票池动态管理 API（watchlist CRUD + 按板块批量加入） | ~80 行 | API 可加入/移除 |
| **Step 15** | §15.7 | 冷启动自动注入订阅（改 `engine/pipeline/runner.py` export 后） | +20 行 | 选股后订阅自动有 |
| **Step 16** | §15.8 | 跨日清理调度（MonitorEngine 主循环检测跨日） | +20 行 | 跨日计数清零 |

**总计**：~900 行新增/改动。

---

## 3. 关键设计要点（实施时必须遵守）

### 3.1 监控引擎主体（Step 1-6）

**架构**（PLAN §三）：
```
FastAPI lifespan 启动
    └── 5. ★ MonitorEngine.start()  ← 新增
            │  后台 daemon 线程
            ▼
         MonitorEngine 主循环
            while not stopped:
              if not trading_hours.now(): sleep(30s); continue
              subscribe_hq 模式 / 轮询模式 → on_quote(snap)
              → RuleSet.evaluate(snap) → 命中 → _fire
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
      写 signal_events  state.      channels.dispatch
      (DuckDB INSERT)   record_     (payload, channels)
                        signal()
```

**行情获取模式决策**（PLAN §五）：
- `adapter_mode == "mock"` → 用 `subscribe_hq`（Mock 有 `_push_loop` 后台线程，push_interval=3s 自动回调）
- Real 模式 → 优先 `subscribe_hq`，失败降级轮询 `get_pricevol`（poll_interval_seconds=10s）

**trading_hours 时段控制**（PLAN §七）：
- Mock 模式 `_in_trading_hours()` **强制返回 True**（保证沙箱演示正常）
- Real 模式严格执行 09:25-11:30 / 13:00-15:00
- 非交易时段主循环 `sleep(30s)` 重新检查，**不退出线程**

**debounce 防抖**（PLAN §八）：
- 键：`(stock_code, alert_type)`
- 窗口：`alert_debounce_seconds`（默认 30s）
- 存储：内存 dict，重启清零（可接受）
- 跨日清理：主循环每次 tick 顺带清超过 1 天的旧 key

**挂载点**（PLAN §九）：FastAPI lifespan 第 5 步，daemon Thread，异常 try-except 隔离不阻断主流程。

**关键伪代码**（PLAN §4.3 / §4.4，实施时照此实现接口签名）：

```python
# engine/monitor/engine.py
class MonitorEngine:
    def __init__(self): ...           # _thread / _stop_event / _lock / _debounce dict / _subscribed
    def start(self): ...              # lifespan 启动调
    def stop(self): ...               # lifespan 关闭调
    def _run(self): ...               # 主循环
    def _tick(self): ...              # subscribe 模式 sleep / 轮询模式主动拉
    def on_quote(self, snap: dict): ...  # 统一入口（Step 1-6 用 RuleSet，Step 10 改 MatchRegistry）
    def _in_trading_hours(self) -> bool: ...
    def _ensure_subscribed(self): ...
    def _poll_and_eval(self): ...
    def _is_debounced(self, code, alert_type) -> bool: ...
    def _mark_debounce(self, code, alert_type): ...
    def _fire(self, rule, snap): ...  # 落库 + 计数 + 推送
    def _insert_signal_event(self, ...): ...
    def _get_monitor_codes(self): ... # 复用 monitor.py 的 _fallback_top_picks 逻辑
```

```python
# engine/monitor/rules.py
@dataclass
class AlertRule:
    alert_type: str; condition: str; channels: list[str]; priority: str; description: str = ""

class RuleSet:
    _cache: list[AlertRule] | None = None
    @classmethod
    def load(cls) -> list[AlertRule]: ...     # 从 ConfigLoader 读 alert_templates
    @classmethod
    def invalidate(cls): ...                  # reload 时清缓存
    @classmethod
    def evaluate(cls, snap: dict) -> list[AlertRule]: ...  # 映射变量 + 逐条求值
```

**变量映射**（PLAN §6.3，snap → 表达式变量）：

| 表达式变量 | snap 字段来源 |
|------------|--------------|
| `pct_change` | `Now / LastClose - 1` |
| `volume_ratio` | `Wtb`（量比） |
| `main_inflow` | `Zjl`（主力净流入） |
| `auction_pct` | 竞价涨幅（Mock 缺省 0） |
| `last` / `volume` / `amount` | `Now` / `Volume` / `Amount` |

**落库 SQL**（PLAN §6.2，表已存在不用建）：
```sql
INSERT INTO signal_events
    (event_id, strategy_id, stock_code, stock_name, alert_type,
     condition_expr, snapshot, severity, channels_fired, triggered_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
```

### 3.2 匹配策略层（Step 7-13）

**三层模型**（PLAN §14.2）：
```
L1 alert_templates（零件库，已有，加 default_params 参数化）
    ↓ 被引用
L2 ★match_strategies（装配单，新增 config/match_strategies.yaml）
    │  绑定 strategy_id + scope + params + alerts
    ↓ 求值时按 snap.strategy_id 取对应 match
L3 MonitorEngine（执行手，on_quote 改造）
```

**match_strategies 配置 schema**（PLAN §14.3，新建 `config/match_strategies.yaml`）：

```yaml
match_strategies:
  - match_id: rzq_default          # 全局唯一，CRUD 主键
    name: 弱转强默认监控
    enabled: true
    strategy_id: rzq               # 绑定选股策略；空串=兜底
    scope:                         # 股票池过滤
      markets: [SH, SZ, BJ]
      exclude_st: true
      exclude_suspended: true
      exclude_codes: []
      include_only: []
    alerts:                        # 引用 alert_templates
      - alert_type: rzq_ignite
        params: { pct_threshold: 0.03 }   # 覆盖默认参数
        channels: [tdx_warn, websocket, feishu]
        priority: high
      - alert_type: rzq_fail
        params: { pct_threshold: -0.03 }
        channels: [websocket, feishu]
        priority: high
    debounce_override: 60          # 覆盖全局 debounce
    trading_hours_override: null   # null=用全局

  - match_id: _default             # 通用兜底
    name: 通用兜底监控
    enabled: true
    strategy_id: ""
    scope: {}
    alerts:
      - alert_type: limit_up
        channels: [websocket, feishu]
        priority: high
      - alert_type: drop_alert
        channels: [websocket, feishu]
        priority: medium
```

**alert_templates 参数化改造**（PLAN §14.4，向后兼容）：

```yaml
# 改前（硬编码）
rzq_ignite:
  condition: "pct_change > 0.03"

# 改后（参数化）
rzq_ignite:
  condition: "pct_change > {pct_threshold}"
  default_params:
    pct_threshold: 0.03
```

渲染逻辑（`RuleSet._render_condition`）：
```python
def _render_condition(template: str, params: dict, defaults: dict) -> str:
    merged = {**defaults, **params}
    try:
        return template.format(**merged)
    except KeyError:
        return template.format(**defaults)  # 退回默认
```
**向后兼容**：老的无占位符 condition（`volume_ratio > 3`）`.format()` 不报错，原样返回。

**on_quote 求值流程改造**（PLAN §14.5，Step 10）：

```python
def on_quote(self, snap):
    code = snap["code"]
    strategy_id = snap.get("strategy_id", "")
    matches = MatchRegistry.get_applicable(strategy_id, code)
    #   返回 [精确匹配 match, _default 兜底 match]
    for match in matches:
        if not self._in_scope(code, match.scope):
            continue
        for alert_ref in match.alerts:
            template = AlertTemplates.get(alert_ref.alert_type)
            condition = self._render_condition(
                template.condition, alert_ref.params, template.default_params
            )
            if ExpressionEvaluator().evaluate(condition, self._snap_vars(snap)):
                if self._is_debounced(code, alert_ref.alert_type, match.debounce_override):
                    continue
                self._fire(match, alert_ref, template, snap)
                self._mark_debounce(code, alert_ref.alert_type)
```

**关键点**：`snap.strategy_id` 由订阅注入时带上（Step 15 冷启动注入 + watchlist API 加入时填）。

**scope 过滤**（PLAN §14.6，本轮不求高精度）：
```python
def _in_scope(self, code: str, scope: dict) -> bool:
    if not scope:
        return True
    # 白名单优先 / 市场前缀 / 黑名单
    # ST/停牌本轮用 snap 字段兜底（缺省 False），不做精确 ST 名单
```

**增删调参 API**（PLAN §14.7，新建 `engine/api/routes/match_strategy.py`）：

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/monitor/match-strategies` | 列出所有 match |
| POST | `/api/monitor/match-strategies` | 新增 match（写 YAML） |
| PUT | `/api/monitor/match-strategies/{match_id}` | 改参/改 scope/改 alerts |
| DELETE | `/api/monitor/match-strategies/{match_id}` | 删除 |
| POST | `/api/monitor/match-strategies/reload` | 热加载 |
| POST | `/api/monitor/match-strategies/{match_id}/test` | 用快照试跑，返回命中 alert（调参预览） |

**持久化**：纯 YAML（`config/match_strategies.yaml`），`MatchRegistry.update()` 内加 `threading.Lock`，写时先 dump 临时文件再原子 rename。

**多策略并发去重**（PLAN §14.8）：一股票被多策略选中 → match 并集 → 同 `(code, alert_type)` debounce 跨 match 共享 → payload.extra.match_ids 标注所有命中。

### 3.3 P0 优化项（Step 14-16）

**§15.1 监控股票池动态管理 API**（Step 14，新建路由或在 monitor.py 加）：

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/monitor/watchlist` | 批量加入 `{codes, strategy_id, subscriber}` |
| DELETE | `/api/monitor/watchlist/{code}` | 移除单只 |
| POST | `/api/monitor/watchlist/by-sector/{sector_code}` | 按板块批量加入（调 `SectorManager.get_stocks`） |
| GET | `/api/monitor/watchlist` | 列出当前监控池（含 strategy_id 归属） |

实现：复用 `EngineState.upsert_subscription` / `remove_subscription` + 写 `monitor_subscriptions` 表。`strategy_id` 必填（决定走哪个 match 套餐），临时盯盘填 `_manual`。

**§15.7 冷启动自动注入订阅**（Step 15，改 `engine/pipeline/runner.py`）：

选股 pipeline 完成（export 步骤后）主动调：
```python
for i, pick in enumerate(results):
    state.upsert_subscription(
        pick.stock_code,
        strategy_id=strategy_id,        # ★ 带 strategy_id，匹配策略靠它
        subscriber="pipeline_auto",
        batch_no=(i // 50) + 1,
    )
# 同时写 monitor_subscriptions 表（持久化）
```
好处：监控引擎启动即有股票可盯，`snap.strategy_id` 正确填充，跨重启订阅不丢。

**§15.8 跨日清理调度**（Step 16，改 `MonitorEngine._run`）：

```python
def _run(self):
    last_date = datetime.now().date()
    while not self._stop_event.is_set():
        now_date = datetime.now().date()
        if now_date != last_date:
            self._on_new_day()           # 跨日清理
            last_date = now_date
        ...  # 原有循环逻辑

def _on_new_day(self):
    EngineState().reset_daily()           # 信号计数清零（原来无人调）
    self._cleanup_debounce()              # 清超过 1 天的 debounce key
    logger.info("跨日清理完成")
```

---

## 4. 文件清单（明确改什么、不改什么）

### 4.1 新增文件（6 个）

| 文件 | 行数 | 职责 |
|------|------|------|
| `engine/monitor/__init__.py` | 5 | 导出 MonitorEngine |
| `engine/monitor/engine.py` | ~280 | 主循环 + 行情 + 时段 + 防抖 + 触发 + 跨日清理（Step 3 + Step 10 + Step 16） |
| `engine/monitor/rules.py` | ~100 | RuleSet 加载 + 求值 + render_condition |
| `engine/monitor/match_registry.py` | ~120 | MatchRegistry + scope + render + CRUD 持久化 |
| `engine/api/routes/match_strategy.py` | ~100 | 6 个 CRUD + reload + test 路由 |
| `config/match_strategies.yaml` | ~80 | 3 个示例 match |

### 4.2 修改文件（5 个，最小改动）

| 文件 | 改动 | 行数 |
|------|------|------|
| `engine/api/main.py` | lifespan 加 MonitorEngine start/stop + 注册 match_strategy 路由 | +17 |
| `engine/config/loader.py` | reload 时调 `RuleSet.invalidate()` + `MatchRegistry.invalidate()` | +5 |
| `config/monitor_rules.yaml` | alert_templates 加 `default_params` + 占位符 condition（向后兼容） | +15 |
| `engine/monitor/engine.py` | on_quote 改走 MatchRegistry + 跨日清理 | +50（含在 §4.1 的 280 里） |
| `engine/pipeline/runner.py` | export 后主动 upsert_subscription 带 strategy_id | +20 |

### 4.3 新增路由文件（watchlist，可并入 monitor.py 或独立）

| 文件 | 行数 | 职责 |
|------|------|------|
| `engine/api/routes/watchlist.py`（或并入 monitor.py） | ~80 | watchlist CRUD 4 路由 |

### 4.4 禁止改动（明确）

- ❌ `engine/api/routes/monitor.py`（只读 API 不变，watchlist 可新建独立路由文件）
- ❌ `engine/api/state.py`（EngineState 不变，引擎调它的 record_signal；仅 Step 16 调它的 reset_daily）
- ❌ `engine/channels/*`（通道不变）
- ❌ `engine/data_adapter/*`（适配器不变）
- ❌ `engine/expression/evaluator.py`（求值器不变）
- ❌ `config/duckdb_schema.sql`（signal_events 表已存在，不建新表）
- ❌ 任何前端文件（`src/**`，HTTP 轮询不变）
- ❌ 选股策略 YAML 的 `monitor.alert_conditions`（保留，作为首次启动自动生成 match 的来源，PLAN 附录 B.1）

---

## 5. 验证方案（每步通过再进下一步）

### Step 2 后：规则求值单元验证

```bash
cd <project-root>   # Linux: /home/z/my-project, Windows: D:\tdxquant
python -c "
from engine.monitor.rules import RuleSet
hits = RuleSet.evaluate({'code':'600519.SH','pct_change':0.1,'volume_ratio':1,'main_inflow':0,'auction_pct':0})
print('涨停命中:', [r.alert_type for r in hits])  # 应含 limit_up
hits = RuleSet.evaluate({'code':'600519.SH','pct_change':-0.06,'volume_ratio':1,'main_inflow':0,'auction_pct':0})
print('大跌命中:', [r.alert_type for r in hits])  # 应含 drop_alert
"
```

### Step 3 后：引擎验证

```bash
python -c "
from engine.monitor import MonitorEngine
import time
mon = MonitorEngine()
mon.start()
time.sleep(10)  # 等 Mock push_interval 3s 推 2-3 次
mon.stop()
"
# 检查 signal_events 是否有写入
python -c "
from engine.storage.duckdb_store import DuckDBStore
s = DuckDBStore()
print(s.query('SELECT event_id, stock_code, alert_type, triggered_at FROM signal_events ORDER BY triggered_at DESC LIMIT 5'))
"
```

### Step 4-6 后：集成验证

```bash
# 重启 FastAPI（用项目现有方式，查 scripts/start_engine.py 或 daemon.sh）
# 等 30s，检查日志有 "MonitorEngine 已启动"
tail -20 data/logs/engine.log 2>/dev/null | grep -i MonitorEngine

# 调 status API，today_signals 应 > 0
curl "http://127.0.0.1:8000/api/monitor?action=status"
# 查信号列表
curl "http://127.0.0.1:8000/api/signals?limit=5"
```

### Step 9-13 后：匹配策略验证

```bash
# 列出 match
curl "http://127.0.0.1:8000/api/monitor/match-strategies"

# 调参预览（test API）
curl -X POST "http://127.0.0.1:8000/api/monitor/match-strategies/rzq_default/test" \
  -H "Content-Type: application/json" \
  -d '{"code":"600519.SH","pct_change":0.04,"volume_ratio":1}'
# 应返回命中的 alert 列表

# 改参
curl -X PUT "http://127.0.0.1:8000/api/monitor/match-strategies/rzq_default" \
  -H "Content-Type: application/json" \
  -d '{"alerts":[{"alert_type":"rzq_ignite","params":{"pct_threshold":0.05},...}]}'

# reload
curl -X POST "http://127.0.0.1:8000/api/monitor/match-strategies/reload"
```

### Step 14 后：watchlist 验证

```bash
# 批量加入
curl -X POST "http://127.0.0.1:8000/api/monitor/watchlist" \
  -H "Content-Type: application/json" \
  -d '{"codes":["600519.SH","000001.SZ"],"strategy_id":"_manual","subscriber":"test"}'

# 列出
curl "http://127.0.0.1:8000/api/monitor/watchlist"
```

### Step 15 后：冷启动注入验证

跑一次选股（调 `/api/strategies/{id}/run`），完成后查：
```bash
curl "http://127.0.0.1:8000/api/monitor/subscriptions"
# 应有选股结果的股票，且带正确 strategy_id
```

### Step 16 后：跨日清理验证

Mock 模式下改系统时间到次日 00:00:01（或直接调 `mon._on_new_day()` 测试），验证：
- `EngineState.today_signal_counts()` 归零
- `_debounce` dict 清空

### 防抖验证（§12.5）

```bash
# Mock push_interval=3s，同股票同类型 30s 内只推一次
python -c "
from engine.storage.duckdb_store import DuckDBStore
s = DuckDBStore()
print(s.query('''
  SELECT stock_code, alert_type, COUNT(*) as cnt
  FROM signal_events
  WHERE triggered_at >= CURRENT_TIMESTAMP - INTERVAL 1 minute
  GROUP BY stock_code, alert_type
  HAVING cnt > 1
'''))
# 应为空（防抖生效）
"
```

---

## 6. 硬约束与红线

### 6.1 必须遵守

1. **Python 后端**：所有新代码在 `engine/` 下，Python 3.10+，类型注解齐全
2. **FastAPI 路由**：新路由注册到 `engine/api/main.py`，遵循现有 `Depends(get_config)` / `Depends(get_state)` / `Depends(get_adapter)` 依赖注入模式
3. **配置**：YAML 配置走 `ConfigLoader`，不直接 `yaml.safe_load`（除 `MatchRegistry` 持久化写文件外）
4. **DuckDB**：用 `DuckDBStore` 单例，不直接建连接；表结构不动
5. **线程安全**：`MonitorEngine._debounce` / `MatchRegistry._cache` 都要加 `threading.Lock`
6. **异常隔离**：MonitorEngine 异常 try-except，**不阻断 FastAPI 主流程**，失败只 warning
7. **日志**：用 `logging.getLogger(__name__)`，关键节点 info，异常 warning/error

### 6.2 禁止

1. ❌ 禁止用 `eval` / `exec`（求值走 `ExpressionEvaluator`）
2. ❌ 禁止改 `config/duckdb_schema.sql`（不建新表）
3. ❌ 禁止改前端任何文件（`src/**`）
4. ❌ 禁止引入新依赖（simpleeval / pydantic / fastapi 已有，够用）
5. ❌ 禁止用 asyncio task（adapter 是同步 API，用 daemon Thread，PLAN §9.2）
6. ❌ 禁止做 ML / 参数寻优 / 跨周期共振（§14.9）
7. ❌ 禁止改选股信号推送逻辑（`strategies.py:594` 不动）

### 6.3 代码风格

- TypeScript 严格类型（前端不动，略）
- Python：`from __future__ import annotations` + 类型注解 + docstring
- ES6+ import/export
- shadcn/ui 组件优先（前端不动，略）
- 错误处理：`except Exception as exc: logger.warning(...)`，不静默吞异常

---

## 7. 工作日志要求

每完成一个 Task ID 阶段（建议按 Step 1-6 / Step 7-13 / Step 14-16 三个阶段），**追加**（不要覆盖）一段到 `/home/z/my-project/worklog.md`：

```markdown
---
Task ID: R9-监控引擎实施-<阶段名>
Agent: <你的标识，如 full-stack-developer 或 general-purpose>
Task: 实施 MONITOR_ENGINE_PLAN.md 第<X>章，完成 Step <N>-<M>

Work Log:
- 读了哪些文件
- 创建/修改了哪些文件
- 遇到什么问题、怎么解决
- 验证结果（贴关键输出）

Stage Summary:
- 已完成: <列出>
- 文件变更:
  新增 (N 个):
    engine/monitor/engine.py   # ~280 行
    ...
  修改 (N 个):
    engine/api/main.py   # +17 行
    ...
- 未解决问题: <列出，无则写"无">
- 下一阶段建议: <列出>
```

---

## 8. 交付物

实施完成后，应产出：

1. **代码**：§4.1 列的 6 个新文件 + §4.2 列的 5 个改动文件 + watchlist 路由
2. **配置**：`config/match_strategies.yaml`（3 个示例 match）+ `config/monitor_rules.yaml`（参数化改造）
3. **验证记录**：§5 每步的验证输出贴在 worklog
4. **worklog 更新**：`/home/z/my-project/worklog.md` 追加 R9 阶段记录
5. **文档更新**（可选，实施后）：
   - `docs/maintenance/ARCHITECTURE.md` 补 `engine/monitor/` + match_strategies 章节
   - `docs/PROJECT_HANDOVER.md` 把「EngineState 不持久化」「监控只读」「WebSocket 通道未部署」从已知限制移除

---

## 9. 风险与回滚（PLAN §十三）

### 9.1 完全回滚

若 MonitorEngine 导致问题：
1. 注释 `engine/api/main.py` lifespan 中的 `MonitorEngine.start()` / `stop()`（2 处）
2. 重启 FastAPI
3. 系统回到「只读监控 API + 选股信号推送」状态，不影响其他功能

### 9.2 部分回滚（某规则误触发）

1. 编辑 `config/match_strategies.yaml`，把误触发的 match 的 `enabled` 改 `false`（或删该 alert 项）
2. 调 `POST /api/monitor/match-strategies/reload`
3. `MatchRegistry.invalidate()` 后下次求值不再命中

### 9.3 灰度开关

`monitor_rules.yaml` 可加 `monitor.enabled: false`，`MonitorEngine.start()` 第一行检查，false 则不启动。

---

## 10. 实施前自检清单

实施 AI 开工前，确认以下都已读懂（打勾再开工）：

- [ ] 通读 `docs/MONITOR_ENGINE_PLAN.md` 全文（1381 行）
- [ ] 读懂 `config/monitor_rules.yaml`（alert_templates + trading_hours + debounce 现有配置）
- [ ] 读懂 `config/duckdb_schema.sql` 的 signal_events / monitor_subscriptions 表结构
- [ ] 读懂 `engine/expression/evaluator.py` 的 `evaluate(expr, variables)` 接口
- [ ] 读懂 `engine/api/state.py` 的 `EngineState` 单例（record_signal / reset_daily / upsert_subscription）
- [ ] 读懂 `engine/api/routes/monitor.py` 的 `_fallback_top_picks` 逻辑（Step 3 复用）
- [ ] 读懂 `engine/channels/registry.py` 的 `dispatch(payload, channels)` 接口
- [ ] 读懂 `engine/data_adapter/mock_adapter.py` 的 `subscribe_hq` / `get_pricevol` 接口
- [ ] 读懂 `engine/api/main.py` 的 lifespan 结构（Step 4 挂载点）
- [ ] 读懂 `engine/pipeline/runner.py` 的 export 步骤（Step 15 挂载点）
- [ ] 读懂 `strategies/strategy_rzq.yaml` 的 `monitor.alert_conditions`（匹配策略雏形）
- [ ] 读懂 worklog.md 末尾两个 R8 Task（方案设计背景）

全部打勾后，按 §2 的 16 步顺序开工。**每步验证通过再进下一步，不求快求全**。

---

**提示词结束** · 实施时严格按本文件 §2 步骤顺序 + §5 验证标准 + §6 硬约束。能复用的零件全部复用，新增代码控制在 ~900 行内。**本轮不求高精度，只求监控引擎 + 匹配策略链路跑通，可增删调参**。
