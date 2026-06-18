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
# 重启 FastAPI
pkill -f "uvicorn engine.api.main"
/home/z/.venv/bin/python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload &

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

**文档结束** · 实施时严格按第十一章步骤顺序，每步验证通过再进下一步。能复用的零件全部复用，新增代码控制在 ~400 行内。
