# TdxQuant — 监控循环引擎实现方案（给实施 AI 的规格说明）

> **文档定位**：本文档是监控循环引擎的**设计与实施规格**，供实施 AI 照着做。
> **核心结论**：现有监控只有「配置 + 求值器 + 只读 API」三块零件，缺把它们串起来的**主动监控循环**。本方案补这个缺口。
> **原则**：能复用现有零件就复用，能不写代码就不写。本方案**新增 1 个目录 + 2 个文件**，改 2 个文件，总代码量控制在 ~400 行。
>
> **最后更新**：R8 轮次

---

## 目录

1. [现状缺口分析](#一现状缺口分析)
2. [设计目标与非目标](#二设计目标与非目标)
3. [架构总览](#三架构总览)
4. [核心组件设计](#四核心组件设计)
5. [行情获取：subscribe_hq vs 轮询](#五行情获取subscribe_hq-vs-轮询)
6. [预警求值 → 落库 → 推送链路](#六预警求值--落库--推送链路)
7. [trading_hours 时段控制](#七trading_hours-时段控制)
8. [debounce 防抖机制](#八debounce-防抖机制)
9. [循环线程挂载点](#九循环线程挂载点)
10. [文件清单与改动范围](#十文件清单与改动范围)
11. [实施步骤（按顺序）](#十一实施步骤按顺序)
12. [验证方案](#十二验证方案)
13. [风险与回滚](#十三风险与回滚)
14. [匹配策略层（MatchStrategy）—— 可增删调参](#十四匹配策略层matchstrategy)
15. [其他可一并优化的点](#十五其他可一并优化的点)

---

## 一、现状缺口分析

### 1.1 已有零件（可复用，不重写）

| 零件 | 位置 | 状态 | 复用方式 |
|------|------|------|----------|
| 规则配置 | `config/monitor_rules.yaml` | ✅ 完整 | 引擎读 `alert_templates` + `monitor` 全局参数 |
| 表达式求值 | `engine/expression/evaluator.py` | ✅ 可用 | `ExpressionEvaluator().evaluate(condition, variables)` |
| 通道分发 | `engine/channels/registry.py` | ✅ 可用 | `get_registry().dispatch(payload, channels)` |
| 行情订阅接口 | `MockAdapter.subscribe_hq` / `RealAdapter.subscribe_hq` | ⚠️ 闲置 | 引擎调 `adapter.subscribe_hq(codes, callback)` |
| 信号表 | `signal_events`（DuckDB） | ⚠️ 只读 | 引擎写 `INSERT INTO signal_events` |
| 状态计数 | `EngineState.record_signal()` | ⚠️ 空转 | 引擎调 `state.record_signal(alert_type)` |
| 选股信号推送 | `strategies.py:594` | ✅ 已工作 | **不动**（这是选股信号，不是监控预警） |

### 1.2 缺口（需要补）

| 缺口 | 影响 |
|------|------|
| **无 `engine/monitor/` 目录** | ARCHITECTURE.md 声称的 L2 监控层是空的 |
| **无人调用 `subscribe_hq`** | Mock 的 `_push_loop` 线程永不启动，Real 的 tqcenter 推送不接入 |
| **无人读 `alert_templates` 求值** | 涨停/大跌/放量/竞价预警规则是纯文档 |
| **无人写 `signal_events`** | 表建好了只有读，监控信号无法落库 |
| **无人调 `state.record_signal()`** | 今日信号计数永远是 0（靠 DuckDB 兜底显示历史） |
| **无 trading_hours 控制** | 非交易时段也会空转求值 |
| **无 debounce** | 同股票同类型会重复推送（涨停价持续触发） |

### 1.3 一句话总结

> 现有监控 = 配置层 + 求值器 + 只读 API，**缺「主动监控循环引擎」把它们串起来**。

---

## 二、设计目标与非目标

### 2.1 目标

1. **主动监控循环**：FastAPI 启动后自动起一个后台线程，持续监控订阅股票
2. **双模式行情**：Mock 模式用 `subscribe_hq` 回调；Real 模式优先 `subscribe_hq`，不可用时降级轮询
3. **预警求值**：每条行情回调 → 读 `alert_templates` → 表达式求值 → 命中则触发
4. **落库 + 推送**：命中 → 写 `signal_events` + `state.record_signal()` + `channels.dispatch()`
5. **时段控制**：只在 `trading_hours` 内求值（非交易时段空转等待）
6. **防抖**：同股票同类型 `alert_debounce_seconds` 内只推一次

### 2.2 非目标（本轮不做）

- ❌ WebSocket 实时推送前端（保持 HTTP 轮询，前端 `useRealtime.ts` 不动）
- ❌ 多策略并发监控（本轮单队列串行求值，足够）
- ❌ 预警规则热加载（改 `monitor_rules.yaml` 需重启引擎，或调 `/api/config/reload` 后引擎自检）
- ❌ 历史信号回放（只处理实时行情）
- ❌ 跨进程状态持久化（`EngineState` 仍内存，但 `signal_events` 落 DuckDB 已持久）

---

## 三、架构总览

```
FastAPI lifespan 启动
    │
    ├── 1. ConfigLoader（已有）
    ├── 2. DuckDBStore（已有）
    ├── 3. DataAdapter（已有）
    ├── 4. ConfigLoader watcher（已有）
    └── 5. ★ MonitorEngine.start()  ← 新增
            │
            │  后台 daemon 线程
            ▼
         ┌─────────────────────────────────────────┐
         │  MonitorEngine 主循环                    │
         │                                          │
         │  while not stopped:                      │
         │    if not trading_hours.now():           │
         │      sleep(30s); continue                │
         │    ────────────────────────────────────  │
         │    # 行情获取（二选一）                   │
         │    mode A: adapter.subscribe_hq(codes,   │
         │              on_quote_callback)          │
         │    mode B: 轮询 adapter.get_pricevol()   │
         │    ────────────────────────────────────  │
         │    # 回调 / 轮询结果 → on_quote(snap)    │
         │    for rule in alert_templates:          │
         │      if rule.eval(snap):                 │
         │        if not debounced(code, type):     │
         │          fire_signal(rule, snap)         │
         └─────────────────────────────────────────┘
                        │
                        ▼
              fire_signal(rule, snap)
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
      写 signal_events  state.      channels.dispatch
      (DuckDB INSERT)   record_     (payload, channels)
                        signal()
```

---

## 四、核心组件设计

### 4.1 新增目录与文件

```
engine/monitor/                  ← 新增目录
├── __init__.py                  ← 新增（导出 MonitorEngine）
├── engine.py                    ← 新增（核心，~250 行）
└── rules.py                     ← 新增（规则加载与求值，~100 行）
```

### 4.2 组件职责

| 组件 | 文件 | 职责 |
|------|------|------|
| `MonitorEngine` | `engine/monitor/engine.py` | 后台线程主循环 + 行情获取 + 时段控制 + 防抖 + 触发分发 |
| `RuleSet` | `engine/monitor/rules.py` | 从 `monitor_rules.yaml` 加载 alert_templates，提供 `evaluate(snapshot) -> list[命中规则]` |
| **复用** `ExpressionEvaluator` | `engine/expression/evaluator.py` | 规则求值（不改） |
| **复用** `ChannelRegistry` | `engine/channels/registry.py` | 推送分发（不改） |
| **复用** `DuckDBStore` | `engine/storage/duckdb_store.py` | 落库（不改） |
| **复用** `EngineState` | `engine/api/state.py` | 计数（不改） |
| **复用** `DataAdapter` | `engine/data_adapter/` | 行情获取（不改） |

### 4.3 `MonitorEngine` 接口设计（伪代码，实施时照此实现）

```python
# engine/monitor/engine.py 核心结构（伪代码，非最终代码）

class MonitorEngine:
    """监控循环引擎（单例，daemon 线程）。"""

    def __init__(self):
        self._thread: Thread | None = None
        self._stop_event = Event()
        self._lock = Lock()
        self._debounce: dict[tuple[str, str], float] = {}  # (code, alert_type) -> last_ts
        self._subscribed = False  # subscribe_hq 是否已注册

    def start(self):
        """lifespan 启动时调用。"""
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = Thread(target=self._run, name="MonitorEngine", daemon=True)
        self._thread.start()

    def stop(self):
        """lifespan 关闭时调用。"""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self):
        """主循环。"""
        while not self._stop_event.is_set():
            try:
                if not self._in_trading_hours():
                    self._stop_event.wait(30)  # 非交易时段 30s 检查一次
                    continue

                self._ensure_subscribed()  # 首次 / 重连 subscribe_hq

                # subscribe_hq 模式：回调驱动，主循环只负责保活 + 降级检测
                # 轮询模式：主动 get_pricevol
                self._tick()

            except Exception as exc:
                logger.error("MonitorEngine 循环异常: %s", exc)
                self._stop_event.wait(10)  # 异常后退避 10s

    def _tick(self):
        """单次 tick：subscribe 模式下 sleep；轮询模式下主动拉。"""
        cfg = ConfigLoader()
        mode = cfg.get("app.adapter_mode", "mock")

        if self._should_poll(mode):
            self._poll_and_eval()
        else:
            # subscribe 模式：行情由 callback 推送，这里只保活
            self._stop_event.wait(cfg.get("monitor.poll_interval_seconds", 10))

    def on_quote(self, snap: dict):
        """行情回调（subscribe 模式）或轮询结果（poll 模式）统一入口。"""
        if not self._in_trading_hours():
            return
        code = snap.get("code", "")
        if not code:
            return

        rules = RuleSet.load()  # 从 ConfigLoader 缓存读
        hits = rules.evaluate(snap)  # 返回命中的规则列表

        for rule in hits:
            if self._is_debounced(code, rule.alert_type):
                continue
            self._fire(rule, snap)
            self._mark_debounce(code, rule.alert_type)
```

### 4.4 `RuleSet` 接口设计（伪代码）

```python
# engine/monitor/rules.py 核心结构（伪代码）

@dataclass
class AlertRule:
    alert_type: str           # limit_up / drop_alert / ...
    condition: str            # "pct_change > 0.095"
    channels: list[str]       # [tdx_warn, websocket, feishu]
    priority: str             # high / medium / low
    description: str = ""

class RuleSet:
    """从 monitor_rules.yaml 加载规则，提供批量求值。"""

    _cache: list[AlertRule] | None = None  # 类级缓存，配置 reload 时清

    @classmethod
    def load(cls) -> list[AlertRule]:
        if cls._cache is not None:
            return cls._cache
        cfg = ConfigLoader()
        templates = cfg.get("monitor_rules.alert_templates", {})
        # 转成 AlertRule 列表
        cls._cache = [...]
        return cls._cache

    @classmethod
    def invalidate(cls):
        """配置 reload 时调。"""
        cls._cache = None

    @classmethod
    def evaluate(cls, snap: dict) -> list[AlertRule]:
        """对一条行情快照求值所有规则，返回命中列表。"""
        hits = []
        ev = ExpressionEvaluator()
        # 把 snap 字段映射成表达式变量
        variables = {
            "pct_change": snap.get("pct_change", 0),
            "volume_ratio": snap.get("volume_ratio", 0),
            "main_inflow": snap.get("main_inflow", 0),
            "auction_pct": snap.get("auction_pct", 0),
            # ... 其他字段
        }
        for rule in cls.load():
            try:
                if ev.evaluate(rule.condition, variables):
                    hits.append(rule)
            except Exception:
                logger.debug("规则 %s 求值失败", rule.alert_type)
        return hits
```

---

## 五、行情获取：subscribe_hq vs 轮询

### 5.1 两种模式决策

```
adapter_mode == "mock"?
  ├─ 是 → 用 subscribe_hq（Mock 有 _push_loop 后台线程，push_interval=3s 自动回调）
  └─ 否 → adapter.subscribe_hq 是否成功？
            ├─ 是 → 用 subscribe_hq（tqcenter 推送，实时性最好）
            └─ 否 → 降级轮询 adapter.get_pricevol(codes)（poll_interval_seconds=10s）
```

### 5.2 subscribe_hq 模式

```python
def _ensure_subscribed(self):
    if self._subscribed:
        return
    cfg = ConfigLoader()
    adapter = get_adapter()
    codes = self._get_monitor_codes()  # 从 selection_results / 订阅缓存取

    if not codes:
        return

    ok = adapter.subscribe_hq(codes, callback=self.on_quote)
    if ok:
        self._subscribed = True
        logger.info("MonitorEngine subscribe_hq 成功: %d 个代码", len(codes))
    else:
        logger.warning("subscribe_hq 失败，降级轮询模式")
        self._subscribed = False  # 触发轮询
```

**Mock 模式**：`MockAdapter.subscribe_hq` 会启动 `_push_loop` 线程，每 `push_interval`（3s）调一次 `callback(snap)`。
**Real 模式**：`RealAdapter.subscribe_hq` 调 `tq.subscribe_hq(stock_list, callback)`，tqcenter 推送时回调。

### 5.3 轮询模式（降级）

```python
def _poll_and_eval(self):
    cfg = ConfigLoader()
    interval = cfg.get("monitor.poll_interval_seconds", 10)
    adapter = get_adapter()
    codes = self._get_monitor_codes()

    if not codes:
        self._stop_event.wait(interval)
        return

    try:
        pv = adapter.get_pricevol(codes)  # 批量
        for code, fields in pv.items():
            snap = self._normalize_snap(code, fields)
            self.on_quote(snap)
    except Exception as exc:
        logger.error("轮询失败: %s", exc)

    self._stop_event.wait(interval)
```

### 5.4 监控代码来源

`_get_monitor_codes()` 优先级：
1. `EngineState.list_subscriptions()` 的 `stock_code`（已有，选股后注入）
2. 兜底：`selection_results` 表最近一次选股 Top N（复用 `monitor.py` 的 `_fallback_top_picks` 逻辑）

---

## 六、预警求值 → 落库 → 推送链路

### 6.1 `_fire(rule, snap)` 完整流程

```python
def _fire(self, rule: AlertRule, snap: dict):
    """触发一次预警：落库 + 计数 + 推送。"""
    code = snap["code"]
    name = snap.get("name", "")
    strategy_id = snap.get("strategy_id", "")

    # 1. 构造 signal_id
    signal_id = str(uuid4())

    # 2. 落库 signal_events
    self._insert_signal_event(
        event_id=signal_id,
        strategy_id=strategy_id,
        stock_code=code,
        stock_name=name,
        alert_type=rule.alert_type,
        condition_expr=rule.condition,
        snapshot=json.dumps(snap, ensure_ascii=False, default=str),
        severity=self._priority_to_severity(rule.priority),
        channels_fired=json.dumps(rule.channels),
    )

    # 3. 内存计数
    EngineState().record_signal(rule.alert_type)

    # 4. 推送通道
    payload = ChannelPayload(
        signal_id=signal_id,
        signal_type=rule.alert_type,
        strategy_id=strategy_id,
        stock_code=code,
        stock_name=name,
        title=self._build_title(rule, snap),
        content=self._build_content(rule, snap),
        severity=self._priority_to_severity(rule.priority),
        priority=rule.priority,
        extra={"pct_change": snap.get("pct_change"), "last": snap.get("last")},
    )
    results = get_registry().dispatch(payload, channels=rule.channels)
    logger.info("预警触发 %s %s %s -> %s", code, rule.alert_type, name, [r.ok for r in results])
```

### 6.2 `_insert_signal_event` SQL

```sql
INSERT INTO signal_events
    (event_id, strategy_id, stock_code, stock_name, alert_type,
     condition_expr, snapshot, severity, channels_fired, triggered_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
```

表结构已存在于 `config/duckdb_schema.sql`，**无需改表**。

### 6.3 变量映射（snap → 表达式变量）

`monitor_rules.yaml` 的 condition 用这些变量名：

| 表达式变量 | snap 字段来源 | 说明 |
|------------|--------------|------|
| `pct_change` | `Now / LastClose - 1` | 涨跌幅 |
| `volume_ratio` | `Wtb`（量比） | 量比 |
| `main_inflow` | `Zjl`（主力净流入） | 资金流 |
| `auction_pct` | 竞价涨幅（Mock 可缺省 0） | 集合竞价 |
| `last` | `Now` | 现价 |
| `volume` | `Volume` | 成交量 |
| `amount` | `Amount` | 成交额 |

`RuleSet.evaluate` 负责把 snap dict 映射成这些变量。字段缺失时给默认值 0，不报错。

---

## 七、trading_hours 时段控制

### 7.1 配置（已有，`monitor_rules.yaml`）

```yaml
monitor:
  trading_hours:
    morning_start: "09:25"
    morning_end: "11:30"
    afternoon_start: "13:00"
    afternoon_end: "15:00"
```

### 7.2 判断逻辑

```python
def _in_trading_hours(self) -> bool:
    cfg = ConfigLoader()
    th = cfg.get("monitor_rules.monitor.trading_hours", {})
    if not th:
        return True  # 未配置则全天（Mock 模式友好）

    now = datetime.now()
    hhmm = now.strftime("%H:%M")

    m_start = th.get("morning_start", "09:25")
    m_end = th.get("morning_end", "11:30")
    a_start = th.get("afternoon_start", "13:00")
    a_end = th.get("afternoon_end", "15:00")

    return (m_start <= hhmm < m_end) or (a_start <= hhmm < a_end)
```

### 7.3 非交易时段行为

- 主循环 `sleep(30s)` 后重新检查，**不退出线程**
- 已 subscribe 的订阅**不取消**（避免反复 subscribe/unsubscribe 开销）
- `on_quote` 回调若在非交易时段触发（如 Mock 模式），直接 return 不求值

### 7.4 Mock 模式特殊处理

Mock 模式无真实交易时段概念，`trading_hours` 仍生效会导致沙箱演示时引擎「不工作」。

**方案**：`adapter_mode == "mock"` 时，`_in_trading_hours()` 强制返回 `True`（在方法内判断），保证沙箱演示正常。Real 模式严格执行时段。

---

## 八、debounce 防抖机制

### 8.1 配置（已有，`monitor_rules.yaml`）

```yaml
monitor:
  alert_debounce_seconds: 30
```

### 8.2 实现

```python
def _is_debounced(self, code: str, alert_type: str) -> bool:
    cfg = ConfigLoader()
    window = cfg.get("monitor_rules.monitor.alert_debounce_seconds", 30)
    key = (code, alert_type)
    now = time.time()
    with self._lock:
        last = self._debounce.get(key, 0)
        return (now - last) < window

def _mark_debounce(self, code: str, alert_type: str):
    with self._lock:
        self._debounce[(code, alert_type)] = time.time()
```

### 8.3 防抖键设计

- **键**：`(stock_code, alert_type)`，如 `("600519.SH", "limit_up")`
- **窗口**：`alert_debounce_seconds`（默认 30s）
- **存储**：内存 dict（`MonitorEngine._debounce`），重启清零（可接受，防抖本就是短期去重）
- **跨日清理**：主循环每次 tick 时顺带清理超过 1 天的旧 key（避免内存泄漏）

### 8.4 不防抖的场景

- 不同股票的同类型预警 → 各自独立防抖
- 同股票不同类型预警 → 各自独立防抖（如 600519 涨停 + 600519 放量可同时推）

---

## 九、循环线程挂载点

### 9.1 挂在 FastAPI lifespan（`engine/api/main.py`）

在现有 lifespan 的第 4 步（ConfigLoader watcher）之后，加第 5 步：

```python
# engine/api/main.py lifespan 内（伪代码，实施时照此插入）

    # 4. ConfigLoader watcher（已有）
    ...

    # 5. ★ MonitorEngine 启动（新增）
    try:
        from engine.monitor import MonitorEngine
        mon = MonitorEngine()
        mon.start()
        logger.info("MonitorEngine 已启动")
    except Exception as exc:
        logger.warning("MonitorEngine 启动失败（不阻断主流程）: %s", exc)

    yield  # FastAPI 运行期

    # 关闭（新增）
    try:
        from engine.monitor import MonitorEngine
        mon = MonitorEngine()
        mon.stop()
        logger.info("MonitorEngine 已停止")
    except Exception:
        pass
```

### 9.2 为什么用 daemon 线程而非 asyncio task

| 选项 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| daemon Thread | 简单、阻塞 API 友好（subscribe_hq / get_pricevol 都是同步） | 不享受 async 生态 | ✅ 选这个 |
| asyncio task | 协程轻量 | adapter 是同步 API，需 `run_in_executor` 包装，复杂 | ❌ |
| APScheduler | 成熟 | 引入新依赖 | ❌ |

### 9.3 异常隔离

- MonitorEngine 异常**不阻断** FastAPI 主流程
- `start()` 包在 try-except，失败只 warning
- 主循环异常退避 10s 重试，不退出线程

---

## 十、文件清单与改动范围

### 10.1 新增文件（3 个）

| 文件 | 行数估算 | 职责 |
|------|----------|------|
| `engine/monitor/__init__.py` | 5 | 导出 `MonitorEngine` |
| `engine/monitor/engine.py` | ~250 | 主循环 + 行情获取 + 时段 + 防抖 + 触发 |
| `engine/monitor/rules.py` | ~100 | 规则加载 + 求值 |

### 10.2 修改文件（2 个，最小改动）

| 文件 | 改动 | 行数 |
|------|------|------|
| `engine/api/main.py` | lifespan 加 MonitorEngine start/stop（第 5 步 + 关闭） | +15 |
| `engine/config/loader.py` | reload 时调 `RuleSet.invalidate()`（若 loader 有 reload hook） | +3 |

### 10.3 不动的文件（明确）

- ❌ `engine/api/routes/monitor.py`（只读 API 不变）
- ❌ `engine/api/state.py`（EngineState 不变，引擎调它的 record_signal）
- ❌ `engine/channels/*`（通道不变）
- ❌ `engine/data_adapter/*`（适配器不变）
- ❌ `engine/expression/evaluator.py`（求值器不变）
- ❌ `config/monitor_rules.yaml`（规则配置已完备）
- ❌ `config/duckdb_schema.sql`（signal_events 表已存在）
- ❌ 前端任何文件（HTTP 轮询不变）

### 10.4 总代码量

新增 ~355 行 + 修改 ~18 行 = **~373 行**，控制在 400 行内。

---

## 十一、实施步骤（按顺序）

### Step 1：创建目录与 `__init__.py`

```
mkdir engine/monitor
# engine/monitor/__init__.py:
from .engine import MonitorEngine
__all__ = ["MonitorEngine"]
```

### Step 2：实现 `engine/monitor/rules.py`

1. 读 `config/monitor_rules.yaml` 的 `alert_templates`（通过 `ConfigLoader`）
2. 转成 `AlertRule` dataclass 列表
3. 实现 `RuleSet.evaluate(snap) -> list[AlertRule]`：
   - 把 snap 映射成表达式变量（`pct_change` / `volume_ratio` / `main_inflow` / `auction_pct` / `last` / `volume` / `amount`）
   - 用 `ExpressionEvaluator().evaluate(rule.condition, variables)` 逐条求值
   - 命中则加入返回列表
4. 实现 `RuleSet.invalidate()`（配置 reload 时清缓存）

**验证**：
```python
from engine.monitor.rules import RuleSet
snap = {"code": "600519.SH", "pct_change": 0.1, "volume_ratio": 5, "main_inflow": 1000, "auction_pct": 0}
hits = RuleSet.evaluate(snap)
# 应命中 limit_up（pct_change > 0.095）和 volume_surge（volume_ratio > 3）
```

### Step 3：实现 `engine/monitor/engine.py`

按 §4.3 伪代码实现，包含：
- `__init__` / `start` / `stop` / `_run`
- `_in_trading_hours`（Mock 模式强制 True）
- `_ensure_subscribed` / `_should_poll` / `_poll_and_eval`
- `on_quote`（统一入口）
- `_is_debounced` / `_mark_debounce` / `_cleanup_debounce`
- `_fire`（落库 + 计数 + 推送）
- `_get_monitor_codes`（复用 `_fallback_top_picks` 逻辑）
- `_insert_signal_event`（DuckDB INSERT）
- `_build_title` / `_build_content` / `_priority_to_severity`

**验证**：
```python
from engine.monitor import MonitorEngine
mon = MonitorEngine()
mon.start()
# 等 5s，看 logs/signals.csv 是否有写入
mon.stop()
```

### Step 4：挂载到 lifespan（改 `engine/api/main.py`）

在 lifespan 第 4 步后加第 5 步（start），关闭段加 stop。见 §9.1。

### Step 5：配置 reload 联动（改 `engine/config/loader.py`）

找到 ConfigLoader 的 reload 成功 hook（`_reload` 或 `start_watcher` 的回调），加一行：
```python
RuleSet.invalidate()  # 清规则缓存，下次 evaluate 重新读 YAML
```

若 loader 无 hook，则在 `RuleSet.load()` 内做 mtime 检查（每次 load 比对文件修改时间，变了就重读）——这是无侵入方案，不改 loader。

### Step 6：端到端验证

见第十二章。

---

## 十二、验证方案

### 12.1 单元验证（Step 2 后）

```bash
# 规则求值
python -c "
from engine.monitor.rules import RuleSet
# 涨停场景
hits = RuleSet.evaluate({'code':'600519.SH','pct_change':0.1,'volume_ratio':1,'main_inflow':0,'auction_pct':0})
print('涨停命中:', [r.alert_type for r in hits])  # 应含 limit_up
# 大跌场景
hits = RuleSet.evaluate({'code':'600519.SH','pct_change':-0.06,'volume_ratio':1,'main_inflow':0,'auction_pct':0})
print('大跌命中:', [r.alert_type for r in hits])  # 应含 drop_alert
"
```

### 12.2 引擎验证（Step 3 后）

```bash
# 启动引擎
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

# 检查 CSV 日志
tail -5 logs/signals.csv
```

### 12.3 集成验证（Step 4 后）

```bash
# 重启 FastAPI (Linux/macOS, venv 已在 PATH)
pkill -f "uvicorn engine.api.main"
python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload &
# Windows: powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'uvicorn' } | Stop-Process -Force" 然后 python scripts\start_engine.py --reload

# 等 30s，检查日志有 "MonitorEngine 已启动"
tail -20 data/logs/engine.log | grep MonitorEngine

# 调 status API，today_signals 应 > 0（不再靠 DuckDB 兜底）
curl http://127.0.0.1:8000/api/monitor?action=status
# → {"today_signals": N>0, ...}

# 查信号列表
curl http://127.0.0.1:8000/api/signals?limit=5
# → 应有新信号（Mock 模式下 V8 样本数据会触发 limit_up/drop_alert）
```

### 12.4 时段控制验证

```bash
# Mock 模式：_in_trading_hours 强制 True，任何时段都工作
# Real 模式：改系统时间到 12:00（午休），引擎应空转
# 验证：12:00 时调 status，today_signals 不增长
```

### 12.5 防抖验证

```bash
# Mock push_interval=3s，同股票同类型 30s 内只推一次
# 验证：30s 内 signals 表同 (code, alert_type) 只有 1 条
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

## 十三、风险与回滚

### 13.1 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| MonitorEngine 异常拖垮 FastAPI | 低 | 高 | daemon 线程 + try-except 隔离，异常只 warning |
| subscribe_hq 反复重连 | 中 | 中 | `_subscribed` 标志位，成功不重复 subscribe |
| DuckDB 写入锁冲突 | 低 | 中 | signal_events 写入用 `INSERT`，DuckDB 单写多读，与选股写入串行 |
| 规则求值慢（大量股票） | 中 | 中 | 表达式求值 <1ms，1000 股 × 4 规则 = 4000 次 < 4s，可接受 |
| 内存 debounce dict 膨胀 | 低 | 低 | 每次 tick 清理超过 1 天的旧 key |
| Mock 模式非交易时段不工作 | 中 | 中 | Mock 模式 `_in_trading_hours` 强制 True |

### 13.2 回滚方案

**完全回滚**（若引擎导致问题）：
1. 注释 `engine/api/main.py` lifespan 中的 `MonitorEngine.start()` / `stop()`（2 处）
2. 重启 FastAPI
3. 系统回到「只读监控 API + 选股信号推送」状态，不影响其他功能

**部分回滚**（若某规则误触发）：
1. 编辑 `config/monitor_rules.yaml`，把误触发的 `alert_templates` 项 `condition` 改为 `"false"`
2. 调 `POST /api/config/reload`
3. `RuleSet.invalidate()` 后下次 evaluate 不再命中

### 13.3 灰度方案

若担心 Real 模式生产环境风险，可加配置开关：

```yaml
# config/monitor_rules.yaml
monitor:
  enabled: true   # ← 新增总开关，false 时 MonitorEngine.start() 直接 return
```

`MonitorEngine.start()` 第一行检查 `cfg.get("monitor_rules.monitor.enabled", True)`，false 则不启动。

---

## 附录：与现有架构的对齐

### A.1 5 层架构定位

本方案新增的 `engine/monitor/` 属于 **L2 核心引擎层**（与 `engine/pipeline/` 同级），符合 ARCHITECTURE.md 的 5 层模型。

### A.2 不破坏现有功能

- 选股信号推送（`strategies.py:594`）→ 不动，继续工作
- 前端 HTTP 轮询（`useRealtime.ts`）→ 不动，继续轮询 `/api/monitor` / `/api/signals`
- 通道配置 UI → 不动，`channels.dispatch` 接口不变

### A.3 补全后的监控链路

```
配置层:    monitor_rules.yaml (alert_templates + trading_hours + debounce)
              ↓
求值器:     ExpressionEvaluator (simpleeval + clip)
              ↓
★监控引擎:  MonitorEngine (subscribe_hq/轮询 → on_quote → RuleSet.evaluate → _fire)
              ↓
   ┌──────────┼──────────┐
   ▼          ▼          ▼
落库:      计数:       推送:
signal_   EngineState. ChannelRegistry
events    record_      .dispatch(payload,
(INSERT)   signal()            channels)
              ↓                ↓
          /api/monitor       /api/signals  +  CSV/飞书/通达信/Web
          (status API)       (列表/详情)
              ↓                ↓
           前端轮询展示 ←───────┘
```

---

## 十四、匹配策略层（MatchStrategy）

> **背景**：用户审查后指出，监控层目前只有「全局 alert_templates + 策略 YAML 内联 alert_conditions」两套静态规则，**缺一层可增删、可调参、可按策略/股票池匹配的「匹配策略」**。本节补这层。
>
> **原则**：能复用现有 `alert_templates` 与策略 YAML 的 `monitor.alert_conditions` 就复用；新增一层 `match_strategies` 配置做绑定与参数化。**本轮不求高精度**，只求跑通「策略→套餐→求值→推送」可调参链路。

### 14.1 为什么需要匹配策略（现状局限）

| 现状 | 局限 |
|------|------|
| `monitor_rules.yaml:alert_templates` 全局模板 | 所有股票一视同仁（600519 涨停和 ST 股用同一 9.5% 阈值） |
| 策略 YAML `monitor.alert_conditions` 已存在（如 `strategy_rzq.yaml:60-82`） | **当前无人读取**（监控引擎缺位的副产品），等于死配置 |
| 阈值硬编码在 condition 字符串里（`pct_change > 0.03`） | 调参要改 YAML + 重启，无法 UI 实时调 |
| 无股票池 scope 过滤 | 一只股票可能被多策略选中，触发多套规则刷屏，无法限定范围 |
| 无 UI/API 增删 match 配置 | 只能编辑文件 |

### 14.2 三层模型升级

```
L1 原子条件 alert_templates（monitor_rules.yaml，已有，不改）
    │  纯条件表达式 + 默认参数，不知道给谁用
    ↓ 被引用
L2 ★匹配策略 match_strategies（新增，可增删调参）
    │  绑定 strategy_id + scope（股票池过滤）+ params（参数）+ alerts（套餐引用）
    │  这是「给哪只股票、用哪套预警、用什么参数」的编排层
    ↓ 求值时按股票所属策略取对应 match
L3 监控引擎 MonitorEngine（第四章已设计，求值入口改造）
    │  on_quote(snap) → snap.strategy_id → MatchRegistry.get(strategy_id)
    │  → 对 match.alerts 逐条 render params + evaluate → 命中触发
```

**核心思想**：`alert_templates` 是「零件库」，`match_strategies` 是「装配单」，`MonitorEngine` 是「执行手」。装配单可增删调参，零件库稳定不动。

### 14.3 `match_strategies` 配置 schema（新增 `config/match_strategies.yaml`）

```yaml
# config/match_strategies.yaml —— 匹配策略编排（可增删调参，热加载）
# 每个 match 绑定一个选股 strategy_id，定义该策略选出股票用哪套预警、什么参数、什么范围。

match_strategies:
  # —— 弱转强策略的监控套餐 ——
  - match_id: rzq_default
    name: 弱转强默认监控
    enabled: true
    strategy_id: rzq                    # 绑定选股策略（对应 strategies 表 strategy_id）
    scope:                              # 股票池过滤（on_quote 时检查）
      markets: [SH, SZ, BJ]             # 市场前缀
      exclude_st: true                  # 排除 ST
      exclude_suspended: true           # 排除停牌
      exclude_codes: []                 # 黑名单
      include_only: []                  # 白名单（非空时只监控这些）
    alerts:                             # 引用 alert_templates，可覆盖参数与通道
      - alert_type: rzq_ignite
        params: { pct_threshold: 0.03 } # 覆盖默认参数
        channels: [tdx_warn, websocket, feishu]
        priority: high
      - alert_type: rzq_fail
        params: { pct_threshold: -0.03 }
        channels: [websocket, feishu]
        priority: high
      - alert_type: volume_surge
        params: { vol_ratio_threshold: 2 }   # 弱转强专用量比阈值（比全局 3 更严）
        channels: [websocket]
        priority: low
    debounce_override: 60               # 覆盖全局 alert_debounce_seconds（弱转强 60s）
    trading_hours_override: null        # null=用全局；可单独配 {morning_start:...}

  # —— 错杀反抽策略的监控套餐 ——
  - match_id: qzrfc_default
    name: 强转弱反抽监控
    enabled: true
    strategy_id: qzrfc
    scope:
      markets: [SH, SZ]
      exclude_st: true
    alerts:
      - alert_type: qzrfc_rebound
        params: { pct_threshold: 0.02 }
        channels: [tdx_warn, websocket, feishu]
        priority: high
      - alert_type: qzrfc_fail
        params: { pct_threshold: -0.05 }
        channels: [websocket, feishu]
        priority: high

  # —— 通用兜底套餐（不绑定具体策略，所有未匹配策略的股票走这套）——
  - match_id: _default
    name: 通用兜底监控
    enabled: true
    strategy_id: ""                     # 空字符串 = 兜底
    scope: {}
    alerts:
      - alert_type: limit_up
        channels: [websocket, feishu]
        priority: high
      - alert_type: drop_alert
        channels: [websocket, feishu]
        priority: medium
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `match_id` | str | 全局唯一，CRUD 的主键 |
| `name` | str | 显示名 |
| `enabled` | bool | false 时该 match 不参与求值 |
| `strategy_id` | str | 绑定选股策略；空串=兜底套餐 |
| `scope` | dict | 股票池过滤；空 dict=不过滤 |
| `alerts[].alert_type` | str | 引用 `alert_templates` 的 key |
| `alerts[].params` | dict | 覆盖默认参数（render 进 condition） |
| `alerts[].channels` | list[str] | 覆盖模板通道；不填用模板默认 |
| `alerts[].priority` | str | high/medium/low |
| `debounce_override` | int \| null | 覆盖全局 debounce 秒数 |
| `trading_hours_override` | dict \| null | 覆盖全局交易时段 |

### 14.4 `alert_templates` 参数化改造（最小改动）

现有 `alert_templates` 的 condition 是硬编码字符串，需改成**带占位符的模板**，由 match 的 params 渲染。

**改法**（改 `config/monitor_rules.yaml`，不改表结构）：

```yaml
# 改前（硬编码）
alert_templates:
  rzq_ignite:
    condition: "pct_change > 0.03"
    ...

# 改后（参数化，向后兼容）
alert_templates:
  rzq_ignite:
    condition: "pct_change > {pct_threshold}"   # 占位符
    default_params:                              # 默认参数（match 不覆盖时用这套）
      pct_threshold: 0.03
    alert_type: rzq_ignite
    channels: [tdx_warn, websocket, feishu]
    priority: high
    description: 弱转强点火成功
```

**渲染逻辑**（`RuleSet.evaluate` 内）：

```python
# 伪代码：condition 渲染
def _render_condition(template: str, params: dict, defaults: dict) -> str:
    merged = {**defaults, **params}        # match params 覆盖 defaults
    try:
        return template.format(**merged)    # "pct_change > {pct_threshold}" → "pct_change > 0.03"
    except KeyError as e:
        logger.warning("condition 渲染缺参 %s, 用默认", e)
        return template.format(**defaults)  # 退回默认
```

**向后兼容**：老的无占位符 condition（如 `volume_ratio > 3`）`.format()` 不会报错（无 `{}` 原样返回），所以现有模板不用全改，只改需要调参的几条。

### 14.5 求值流程改造（`on_quote` 内）

**改前**（第四章 §4.3）：

```python
def on_quote(self, snap):
    rules = RuleSet.load()           # 全局所有 alert_templates
    hits = rules.evaluate(snap)      # 全局求值
    for rule in hits:
        ...
```

**改后**（按策略匹配）：

```python
def on_quote(self, snap):
    code = snap["code"]
    strategy_id = snap.get("strategy_id", "")

    # 1. 取该股票适用的所有 match（按 strategy_id + 兜底）
    matches = MatchRegistry.get_applicable(strategy_id, code)
    #   - 先找 strategy_id 精确匹配的 enabled match
    #   - 再加 _default 兜底 match
    #   - scope 过滤：code 不在 match.scope 内则跳过该 match

    # 2. 对每个 match 的 alerts 逐条求值
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

**关键点**：
- `snap.strategy_id` 由订阅注入时带上（选股结果 upsert_subscription 时写入，见 §15.7）
- `MatchRegistry.get_applicable` 返回 `[精确匹配 match, _default match]`，多策略并集
- scope 过滤在求值前，避免无效求值

### 14.6 股票池 scope 过滤（`_in_scope`）

```python
# 伪代码
def _in_scope(self, code: str, scope: dict) -> bool:
    if not scope:
        return True                      # 空 scope = 不过滤
    # 白名单优先
    include_only = scope.get("include_only") or []
    if include_only and code not in set(include_only):
        return False
    # 市场前缀
    markets = scope.get("markets") or []
    if markets:
        if not any(code.startswith(m + ".") or code.startswith(m) for m in markets):
            return False
    # 黑名单
    if code in set(scope.get("exclude_codes") or []):
        return False
    # ST / 停牌：需 snap 带 is_st / is_suspended 字段（Mock 可缺省 False）
    # （本轮不求高精度，ST 列表可后续从 cleaning_rules 注入）
    return True
```

**本轮不求高精度**：ST/停牌判断暂用 snap 字段兜底（缺省 False），不做精确 ST 名单匹配。

### 14.7 增删调参 API（新增路由 `engine/api/routes/match_strategy.py`）

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/monitor/match-strategies` | 列出所有 match（含 enabled 状态） |
| `POST` | `/api/monitor/match-strategies` | 新增一个 match（写 YAML） |
| `PUT` | `/api/monitor/match-strategies/{match_id}` | 改参/改 scope/改 alerts |
| `DELETE` | `/api/monitor/match-strategies/{match_id}` | 删除 |
| `POST` | `/api/monitor/match-strategies/reload` | 热加载（调 `MatchRegistry.invalidate()`） |
| `POST` | `/api/monitor/match-strategies/{match_id}/test` | 用一只股票快照试跑，返回会命中哪些 alert（调参预览） |

**持久化选型**：

| 选项 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| 纯 YAML（`config/match_strategies.yaml`） | 与现有配置体系一致，可 git 版本 | 并发写需加锁 | ✅ **本轮选** |
| DuckDB 新表 `match_strategies` | 增删 API 简单 | 引入表结构变更，与 YAML 体系割裂 | ❌ 本轮不做 |

**写 YAML 的并发安全**：`MatchRegistry.update()` 内加 `threading.Lock`，写时先 dump 临时文件再原子 rename，避免半写状态被读。

### 14.8 多策略并发去重

一只股票被多个策略选中（如 600519 同时被 rzq 和 qzrfc 选出）时：

1. `MatchRegistry.get_applicable` 返回所有命中策略的 match 列表（并集）
2. 对每个 match 的 alerts 逐条求值
3. **同 alert_type 跨 match 命中** → debounce 去重（同 `(code, alert_type)` 在窗口内只推一次）
4. 推送 payload 的 `extra.match_ids` 标注所有命中的 match_id，前端可展示「弱转强+反抽 双策略命中」

**debounce 键不变**：仍是 `(stock_code, alert_type)`，跨 match 共享，避免重复推。

### 14.9 不需高精度的取舍（本轮明确不做）

| 不做 | 原因 | 后续 |
|------|------|------|
| ML 信号打分 | 本轮只做规则匹配，不上模型 | P2 |
| 回测拟合最优参数 | 用户明确「不需高精度」 | §15.4 提供回测 API，参数人工调 |
| 跨周期共振（日线+分钟线） | 复杂度高，本轮单快照求值 | P2 |
| ST 精确名单匹配 | 需接入 cleaning_rules 的 ST 列表 | P1 |
| 参数自动寻优 | 同 ML，不做 | P2 |

**本轮目标**：跑通「策略→match 套餐→参数渲染→求值→推送」，参数能 UI 调，规则能增删，**精度够用即可**。

### 14.10 文件清单增量（在第十章基础上）

| 文件 | 类型 | 行数估算 | 职责 |
|------|------|----------|------|
| `config/match_strategies.yaml` | 新增配置 | ~80 | 3 个示例 match（rzq/qzrfc/_default） |
| `engine/monitor/match_registry.py` | 新增 | ~120 | MatchRegistry：加载/求值/scope/CRUD 持久化 |
| `engine/api/routes/match_strategy.py` | 新增 | ~100 | 6 个 CRUD + reload + test 路由 |
| `config/monitor_rules.yaml` | 改 | +15 | alert_templates 加 default_params + 占位符 |
| `engine/monitor/engine.py`（第四章） | 改 | +30 | on_quote 改走 MatchRegistry |
| `engine/api/main.py` | 改 | +2 | 注册 match_strategy 路由 |

**增量约 +350 行**，与第四章合计 ~700 行，仍可控。

### 14.11 实施步骤（在十一章基础上追加）

- **Step 7**：改 `config/monitor_rules.yaml`，给需调参的 alert_templates 加 `default_params` + 占位符 condition（向后兼容）
- **Step 8**：新建 `config/match_strategies.yaml`（3 个示例 match）
- **Step 9**：实现 `engine/monitor/match_registry.py`（MatchRegistry + scope + render + CRUD 持久化）
- **Step 10**：改 `engine/monitor/engine.py` 的 `on_quote`，走 MatchRegistry
- **Step 11**：实现 `engine/api/routes/match_strategy.py`（6 个路由）
- **Step 12**：注册路由 + reload 联动（`MatchRegistry.invalidate()` 挂到 config reload hook）
- **Step 13**：端到端验证（调参 → test API 预览 → 实盘命中）

---

## 十五、其他可一并优化的点

> 用户问「还有没有其它的可以一并加入进去优化的」。以下按优先级排列，**P0 与匹配策略层一起做，P1/P2 后续轮次**。

### 15.1 监控股票池动态管理 API（P0，与匹配策略一起做）

**现状**：`_get_monitor_codes` 只从 `EngineState.list_subscriptions()` / `selection_results` 兜底取，**无主动加入/移除/按板块批量**的 API。用户想临时盯一只股票，只能等选股跑出来。

**补**：

| 方法 | 路径 | 功能 |
|------|------|------|
| `POST` | `/api/monitor/watchlist` | 批量加入监控 `{codes, strategy_id, subscriber}` |
| `DELETE` | `/api/monitor/watchlist/{code}` | 移除单只 |
| `POST` | `/api/monitor/watchlist/by-sector/{sector_code}` | 按板块批量加入（调 `SectorManager.get_stocks`） |
| `GET` | `/api/monitor/watchlist` | 列出当前监控池（含 strategy_id 归属） |

**实现**：复用 `EngineState.upsert_subscription` / `remove_subscription` + 写 `monitor_subscriptions` 表。`strategy_id` 必填（决定走哪个 match 套餐），临时盯盘可填 `_manual`。

### 15.2 预警聚合推送（P1）

**现状**：`_fire` 每命中一条立即推一条。开盘涨停潮时 8 只涨停 = 8 条飞书消息，刷屏。

**补**：同类预警短时间多发 → 聚合成一条摘要。

```python
# 伪代码：_fire 前检查聚合窗口
def _fire(self, match, alert_ref, template, snap):
    policy = self._dispatch_policy(alert_ref.priority)
    if policy == "immediate":
        self._dispatch_now(...)              # high 立即推（当前行为）
    elif policy == "batch_5min":
        self._aggregator.add(alert_ref.alert_type, snap)   # medium 攒批
        # 攒够 5 条 或 5 分钟到 → 推一条摘要
    elif policy == "log_only":
        self._insert_signal_event(...)       # low 只落库，前端轮询展示
```

**聚合消息格式**：「⚡ 近 5 分钟涨停 8 只：600519(+10.01%) / 000001(+9.98%) / ...」

**配置**（`monitor_rules.yaml` 新增）：

```yaml
monitor:
  alert_dispatch_policy:
    high: immediate          # 立即推
    medium: batch_5min       # 5 分钟聚合
    low: log_only            # 只落库
  batch_window_seconds: 300
  batch_max_count: 10        # 攒够 10 条提前推
```

### 15.3 预警分级与值班（P1，与 15.2 配套）

**现状**：所有 priority 都立即推，无值班概念。

**补**：
- `high` → 立即推全部启用通道（当前行为）
- `medium` → 攒批摘要推（§15.2）
- `low` → 只落库，前端轮询 `/api/signals` 展示

**值班时段**：非交易时段的 high 预警可配「静默到次日开盘」（避免半夜测试数据刷屏）。配置：

```yaml
monitor:
  silent_hours:              # 静默时段（high 也只落库不推）
    start: "15:30"
    end: "09:25"
```

### 15.4 预警回测验证（P2）

**目的**：调参有依据。改了 `pct_threshold` 从 0.03 到 0.05，到底命中率变多少？

**补**：

| 方法 | 路径 | 功能 |
|------|------|------|
| `POST` | `/api/monitor/backtest` | `{match_id, start_date, end_date}` → 用 `kline_cache` 回放，统计命中 |

**输出**：

```json
{
  "match_id": "rzq_default",
  "period": "2026-05-01 ~ 2026-06-17",
  "alerts": {
    "rzq_ignite": {"hits": 142, "unique_stocks": 68, "avg_next_day_return": 1.2},
    "rzq_fail": {"hits": 89, "unique_stocks": 52, "avg_next_day_return": -2.1}
  }
}
```

**实现**：从 `kline_cache` 取历史日线，逐日构造 snap，跑 `MatchRegistry.evaluate`，统计命中。**本轮不求高精度**，只做日线级回放（分钟线回放留后续）。

### 15.5 信号统计与归因日报（P2）

**现状**：`/api/monitor/status` 只返回今日总计数，无按策略/类型归因。

**补**：

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/monitor/daily-report?date=2026-06-17` | 按策略+类型二维统计 |

**输出**：

```json
{
  "date": "2026-06-17",
  "total_signals": 56,
  "by_strategy": {
    "rzq": {"rzq_ignite": 12, "rzq_fail": 3, "volume_surge": 8},
    "qzrfc": {"qzrfc_rebound": 5, "qzrfc_fail": 2}
  },
  "top_hit_stocks": [{"code": "600519.SH", "count": 4}]
}
```

**前端**：Dashboard 加「监控日报」卡片（复用现有 StatCard）。

### 15.6 引擎健康度监控（P1）

**现状**：`/api/monitor/status` 只有人数/信号数，无引擎自身健康（订阅存活/行情延迟/求值耗时/异常计数）。

**补**：`MonitorEngine` 上报健康指标到 `EngineState`：

```python
# EngineState 新增
self._health = {
    "subscribe_alive": True,          # subscribe_hq 是否还活着
    "last_quote_ts": 0,               # 最近一次 on_quote 时间戳
    "quote_lag_seconds": 0,           # 行情延迟（now - last_quote_ts）
    "eval_count": 0,                  # 累计求值次数
    "eval_avg_ms": 0,                 # 平均求值耗时
    "error_count": 0,                 # 累计异常
    "last_error": "",
}
```

**新路由**：`GET /api/monitor/health` → 返回上述指标。前端「引擎状态」卡片增强（行情延迟 > 30s 标红）。

**告警**：`quote_lag_seconds > 60` 时自动推一条 `system` 信号到飞书（引擎失联自检）。

### 15.7 冷启动自动注入订阅（P0，与匹配策略一起做）

**现状**：选股 run 完成后，结果落 `selection_results` 表，但**不主动注入 `monitor_subscriptions`**。监控引擎靠 `_fallback_top_picks` 被动兜底（且不带 strategy_id）。

**补**：选股 pipeline 完成后（`engine/pipeline/runner.py` 的 export 步骤后）主动调：

```python
# 伪代码：选股完成后自动注入订阅
for pick in results:
    state.upsert_subscription(
        pick.stock_code,
        strategy_id=strategy_id,        # ★ 带 strategy_id，匹配策略靠它
        subscriber="pipeline_auto",
        batch_no=(i // 50) + 1,
    )
# 同时写 monitor_subscriptions 表（持久化）
```

**好处**：
- 监控引擎启动即有股票可盯，不靠 fallback
- `snap.strategy_id` 正确填充，匹配策略能按策略取套餐
- 跨重启订阅不丢（表持久化）

### 15.8 跨日清理调度（P0，与匹配策略一起做）

**现状**：
- `EngineState.reset_daily()` 存在但**无人调**（注释写「由调度器调用，本阶段手动触发」）
- `MonitorEngine._debounce` dict 跨日不清会内存泄漏（§8.3 设计了清理但未实现调度）
- `monitor_subscriptions` 表 `active=false` 的记录不归档

**补**：`MonitorEngine` 主循环检测跨日，触发清理：

```python
# 伪代码：主循环内
def _run(self):
    last_date = datetime.now().date()
    while not self._stop_event.is_set():
        now_date = datetime.now().date()
        if now_date != last_date:
            self._on_new_day()           # 跨日清理
            last_date = now_date
        ...

def _on_new_day(self):
    EngineState().reset_daily()           # 信号计数清零
    self._cleanup_debounce()              # 清超过 1 天的 debounce key
    # monitor_subscriptions: 前一天的 active=false 归档（可选）
    logger.info("跨日清理完成")
```

**时段**：00:00 触发（Mock 模式也跑，无副作用）。

### 15.9 优先级总结

| 优先级 | 项 | 与本轮关系 |
|--------|-----|-----------|
| **P0** | §14 匹配策略层 + §15.1 股票池管理 + §15.7 冷启动注入 + §15.8 跨日清理 | **本轮一起做**（匹配策略依赖 strategy_id 注入 + 跨日清理） |
| **P1** | §15.2 聚合推送 + §15.3 分级值班 + §15.6 健康度 | 下一轮（监控引擎跑稳后做减噪与自检） |
| **P2** | §15.4 回测 + §15.5 日报 | 后续（数据积累后做归因与调参依据） |

**本轮总代码量**：第四章 ~400 行 + 第十四章 ~350 行 + §15.1/15.7/15.8 ~150 行 = **~900 行**，仍属可控范围（用户明确「不需高精度」，MVP 级别）。

---

## 附录 B：匹配策略层与现有架构的对齐

### B.1 不破坏现有功能

- 选股策略 YAML 的 `monitor.alert_conditions`（如 `strategy_rzq.yaml:60-82`）→ **保留**，作为该策略的默认 match 套餐的来源（首次启动时若 `match_strategies.yaml` 无对应 strategy_id，自动从策略 YAML 的 alert_conditions 生成一个 match）
- `monitor_rules.yaml:alert_templates` → 保留为零件库，加 `default_params` 向后兼容
- 前端「通道设置」「信号中心」→ 不动，`channels.dispatch` 接口不变

### B.2 数据流（补全匹配策略后）

```
选股 pipeline 完成
    │ 主动注入订阅（§15.7）带 strategy_id
    ▼
monitor_subscriptions 表 + EngineState
    │
    ▼
MonitorEngine.on_quote(snap)  ← snap.strategy_id 来自订阅
    │
    ▼
MatchRegistry.get_applicable(strategy_id, code)
    │  返回 [精确 match, _default match]，scope 过滤
    ▼
对 match.alerts 逐条 render params + evaluate
    │  命中
    ▼
_fire(match, alert_ref, template, snap)
    │
    ├── 写 signal_events（带 match_id）
    ├── EngineState.record_signal + 健康度更新（§15.6）
    └── ChannelRegistry.dispatch（按 alert_ref.channels）
```

### B.3 与「不需高精度」的取舍对应

| 用户要求 | 本轮做法 |
|----------|----------|
| 可增删 | §14.7 CRUD API |
| 可调参 | §14.4 参数化 + §14.7 PUT 改参 |
| 不需高精度 | §14.6 scope 用市场前缀兜底，ST 名单 P1；§14.9 不做 ML/寻优 |
| 一并优化 | §15.1/15.7/15.8 一起做（P0），§15.2-15.6 列出供后续 |

---

**文档结束** · 实施时严格按第十一章 + 第十四章 §14.11 步骤顺序，每步验证通过再进下一步。能复用的零件全部复用，新增代码控制在 ~900 行内（含匹配策略层）。**本轮不求高精度，只求可增删调参的匹配策略链路跑通**。
