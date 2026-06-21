"""监控循环引擎主体（MonitorEngine）。

设计要点（PLAN 第四章 + 第五~九章）：

1. **daemon 线程**：FastAPI lifespan 启动；adapter 是同步 API，不用 asyncio。
2. **行情获取双模式**：
   - Mock 模式 → ``subscribe_hq`` 回调（MockAdapter 有 ``_push_loop`` 后台线程）
   - Real 模式 → 优先 ``subscribe_hq``，失败降级轮询 ``get_pricevol``
3. **时段控制**：``_in_trading_hours()`` 在 Mock 模式强制 True（沙箱友好），
   Real 模式严格执行 09:25-11:30 / 13:00-15:00。非交易时段 sleep 30s 不退出。
4. **防抖**：``(stock_code, alert_type)`` 在 ``alert_debounce_seconds`` 内只推一次。
   跨 match 共享同 key，避免多策略重复推（PLAN §14.8）。
5. **跨日清理**（§15.8）：主循环每次 tick 检测日期变更 → ``_on_new_day``
   清计数 + 清 debounce + 归档。
6. **异常隔离**：所有异常 try-except，只 warning/error，不阻断 FastAPI 主流程。

求值入口 :meth:`on_quote` 在 Step 1-6 用 ``RuleSet`` 全局求值，Step 9 后改走
``MatchRegistry``（按 ``snap.strategy_id`` 取匹配策略）。
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime
from typing import Any
from uuid import uuid4

from engine.api.state import EngineState
from engine.channels.base import ChannelPayload
from engine.channels.registry import get_registry
from engine.config.loader import ConfigLoader
from engine.expression.evaluator import ExpressionEvaluator, ExpressionError
from engine.monitor.match_registry import AlertRef, MatchRegistry, MatchStrategy
from engine.monitor.rules import AlertRule, RuleSet

logger = logging.getLogger(__name__)


# ============================================================================
# MonitorEngine 单例
# ============================================================================


class MonitorEngine:
    """监控循环引擎（daemon 线程）。

    用法：
        >>> mon = MonitorEngine()
        >>> mon.start()
        >>> ...  # FastAPI 运行期
        >>> mon.stop()
    """

    _instance: "MonitorEngine | None" = None
    _instance_lock = threading.Lock()

    def __new__(cls) -> "MonitorEngine":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self) -> None:
        if getattr(self, "_initialized", False):
            return
        self._initialized = True

        # 线程控制
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._lock = threading.RLock()

        # 防抖：{(stock_code, alert_type): last_ts}
        self._debounce: dict[tuple[str, str], float] = {}

        # subscribe_hq 状态
        self._subscribed = False

        # 健康度（PLAN §15.6 P1，先记录基础指标）
        self._last_quote_ts: float = 0.0
        self._eval_count: int = 0
        self._error_count: int = 0
        self._last_error: str = ""

        # P1: 聚合推送队列
        # key = (strategy_id, priority), value = list[payload]
        # 窗口内同 strategy+priority 的信号聚合为一条摘要推送
        self._agg_queue: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self._agg_last_flush: dict[tuple[str, str], float] = {}

        # 跨日检测
        self._last_date: datetime.date = datetime.now().date()

        # 求值器（避免每 tick new 一个）
        self._evaluator = ExpressionEvaluator()

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------

    def start(self) -> None:
        """启动 daemon 线程（lifespan 调用，幂等）。"""
        # 灰度开关（PLAN §13.3）
        cfg = ConfigLoader()
        if not cfg.get("monitor.enabled", True):
            logger.info("MonitorEngine 已禁用 (monitor.enabled=false)")
            return

        if self._thread and self._thread.is_alive():
            logger.debug("MonitorEngine 线程已在运行")
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run, name="MonitorEngine", daemon=True
        )
        self._thread.start()
        logger.info("MonitorEngine 已启动")

    def stop(self) -> None:
        """停止 daemon 线程（lifespan 关闭时调）。"""
        self._stop_event.set()
        # 取消订阅（清 Mock 推送线程）
        try:
            from engine.data_adapter.factory import get_adapter

            adapter = get_adapter()
            if hasattr(adapter, "unsubscribe_hq"):
                adapter.unsubscribe_hq([])
        except Exception as exc:  # noqa: BLE001
            logger.debug("unsubscribe_hq 失败: %s", exc)

        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None
        self._subscribed = False
        logger.info("MonitorEngine 已停止")

    # ------------------------------------------------------------------
    # 主循环
    # ------------------------------------------------------------------

    def _run(self) -> None:
        """主循环：检测跨日 → 检测交易时段 → tick。"""
        while not self._stop_event.is_set():
            try:
                # 跨日检测（§15.8）
                now_date = datetime.now().date()
                if now_date != self._last_date:
                    self._on_new_day()
                    self._last_date = now_date

                # 非交易时段空转
                if not self._in_trading_hours():
                    self._stop_event.wait(30)
                    continue

                # 行情获取（subscribe 或轮询）
                self._tick()

            except Exception as exc:  # noqa: BLE001
                self._error_count += 1
                self._last_error = str(exc)
                logger.error("MonitorEngine 循环异常: %s", exc)
                self._stop_event.wait(10)  # 退避 10s

    def _tick(self) -> None:
        """单次 tick：subscribe 模式 sleep；轮询模式主动拉。"""
        cfg = ConfigLoader()
        if self._should_poll(cfg):
            self._poll_and_eval()
        else:
            # subscribe 模式：行情由 callback 推送，主循环保活 + 顺带清 debounce + flush 聚合
            self._ensure_subscribed()
            self._cleanup_debounce()
            self._flush_all_aggregation()
            self._stop_event.wait(
                float(cfg.get("monitor.poll_interval_seconds", 10))
            )

    def _should_poll(self, cfg: ConfigLoader) -> bool:
        """是否走轮询模式（subscribe_hq 不可用时降级）。"""
        if self._subscribed:
            return False
        # 尝试 subscribe，失败则轮询
        self._ensure_subscribed()
        return not self._subscribed

    # ------------------------------------------------------------------
    # 行情获取
    # ------------------------------------------------------------------

    def _ensure_subscribed(self) -> None:
        """首次 / 重连时调 subscribe_hq（成功后回调驱动）。"""
        if self._subscribed:
            return
        try:
            from engine.data_adapter.factory import get_adapter

            adapter = get_adapter()
        except Exception as exc:  # noqa: BLE001
            logger.warning("取 adapter 失败: %s", exc)
            return

        codes = self._get_monitor_codes()
        if not codes:
            return

        try:
            ok = adapter.subscribe_hq(codes, callback=self.on_quote)
            if ok:
                self._subscribed = True
                logger.info(
                    "MonitorEngine subscribe_hq 成功: %d 个代码", len(codes)
                )
            else:
                logger.warning("subscribe_hq 返回 False，降级轮询模式")
        except Exception as exc:  # noqa: BLE001
            logger.warning("subscribe_hq 异常，降级轮询模式: %s", exc)

    def _poll_and_eval(self) -> None:
        """轮询模式：主动调 get_pricevol，对每只股票 on_quote。"""
        cfg = ConfigLoader()
        interval = float(cfg.get("monitor.poll_interval_seconds", 10))
        try:
            from engine.data_adapter.factory import get_adapter

            adapter = get_adapter()
        except Exception as exc:  # noqa: BLE001
            logger.warning("取 adapter 失败: %s", exc)
            self._stop_event.wait(interval)
            return

        codes = self._get_monitor_codes()
        if not codes:
            self._stop_event.wait(interval)
            return

        try:
            pv = adapter.get_pricevol(codes)
            if pv and isinstance(pv, dict):
                # 找 strategy_id 归属（从 state 订阅缓存）
                strat_map = self._code_to_strategy_map()
                for code, fields in pv.items():
                    snap = self._normalize_snap(code, fields)
                    snap["strategy_id"] = strat_map.get(code, "")
                    self.on_quote(snap)
        except Exception as exc:  # noqa: BLE001
            self._error_count += 1
            self._last_error = str(exc)
            logger.error("轮询失败: %s", exc)

        self._stop_event.wait(interval)

    # ------------------------------------------------------------------
    # 行情回调 → 求值
    # ------------------------------------------------------------------

    def on_quote(self, snap: dict[str, Any]) -> None:
        """行情回调统一入口（subscribe 模式由 adapter 推；轮询模式由 _poll_and_eval 调）。

        Step 1-6：用 ``RuleSet.evaluate`` 全局求值。
        Step 9+：走 ``MatchRegistry``（按 ``snap.strategy_id`` 取 match）。
        """
        if not isinstance(snap, dict):
            return
        if not self._in_trading_hours():
            return
        code = snap.get("code") or snap.get("Code") or ""
        if not code:
            return
        snap.setdefault("code", code)

        self._last_quote_ts = time.time()

        # 规一化 V8 快照字段（subscribe_hq 推的是 raw V8 dict）
        snap = self._normalize_snap(code, snap)
        # strategy_id 由订阅注入（_ensure_subscribed 时已挂到 EngineState）；
        # 若 snap 缺则从 state 反查
        if not snap.get("strategy_id"):
            snap["strategy_id"] = self._code_to_strategy_map().get(code, "")

        try:
            # Step 9+：走 MatchRegistry（按 snap.strategy_id 取 match + scope 过滤）
            match_hits = MatchRegistry.evaluate(snap)
        except Exception as exc:  # noqa: BLE001
            self._error_count += 1
            self._last_error = str(exc)
            logger.warning("on_quote 求值异常 %s: %s", code, exc)
            return

        # 跨 match 去重：同 (code, alert_type) 命中多个 match 时只推一次，
        # 但 payload.extra.match_ids 标注所有命中的 match_id（PLAN §14.8）
        fired_by_type: dict[str, list[str]] = {}
        for match, alert_ref, _condition in match_hits:
            fired_by_type.setdefault(alert_ref.alert_type, []).append(match.match_id)

        # _eval_count 放在锁内，避免 subscribe 模式下并发计数丢失（bug #10）
        with self._lock:
            self._eval_count += 1
        # 遍历 match_hits，跳过已 debounced / 已 fire 的同类型
        fired_types: set[str] = set()
        for match, alert_ref, condition in match_hits:
            atype = alert_ref.alert_type
            if atype in fired_types:
                # 同股票同类型本轮已推一次，跨 match 去重
                continue
            if self._is_debounced(code, atype, match.debounce_override):
                continue
            try:
                self._fire_match(match, alert_ref, condition, snap, fired_by_type[atype])
                fired_types.add(atype)
            except Exception as exc:  # noqa: BLE001
                self._error_count += 1
                self._last_error = str(exc)
                logger.error("fire 异常 %s %s: %s", code, atype, exc)
            self._mark_debounce(code, atype)

    def _evaluate(self, snap: dict[str, Any]) -> list[AlertRule]:
        """遗留接口：用 RuleSet 全局求值（Step 9 后改走 MatchRegistry，本方法保留兼容）。"""
        return RuleSet.evaluate(snap)

    # ------------------------------------------------------------------
    # 时段控制
    # ------------------------------------------------------------------

    def _in_trading_hours(self) -> bool:
        """是否在交易时段（Mock 模式强制 True）。"""
        cfg = ConfigLoader()
        mode = str(cfg.get("app.adapter_mode", "mock"))
        if mode == "mock":
            return True
        th = cfg.get("monitor.trading_hours", {}) or {}
        if not th:
            return True
        hhmm = datetime.now().strftime("%H:%M")
        m_start = th.get("morning_start", "09:25")
        m_end = th.get("morning_end", "11:30")
        a_start = th.get("afternoon_start", "13:00")
        a_end = th.get("afternoon_end", "15:00")
        return (m_start <= hhmm < m_end) or (a_start <= hhmm < a_end)

    # ------------------------------------------------------------------
    # 防抖
    # ------------------------------------------------------------------

    def _is_debounced(
        self, code: str, alert_type: str, debounce_override: int | None = None
    ) -> bool:
        """是否在防抖窗口内（True=跳过推送）。

        Args:
            code: 股票代码
            alert_type: 预警类型
            debounce_override: match 级覆盖秒数；None 时用全局 ``alert_debounce_seconds``
        """
        cfg = ConfigLoader()
        if debounce_override is not None:
            window = float(debounce_override)
        else:
            window = float(cfg.get("monitor.alert_debounce_seconds", 30))
        key = (code, alert_type)
        now = time.time()
        with self._lock:
            last = self._debounce.get(key, 0.0)
            return (now - last) < window

    def _mark_debounce(self, code: str, alert_type: str) -> None:
        with self._lock:
            self._debounce[(code, alert_type)] = time.time()

    def _cleanup_debounce(self) -> None:
        """清理过期 debounce key（避免内存泄漏）。

        cutoff 取 ``max(window*10, 3600)`` 秒前（bug #11：原 86400s 频率太低，
        subscribe 模式下窗口短时 key 会堆积几小时才清）。
        """
        cfg = ConfigLoader()
        window = float(cfg.get("monitor.alert_debounce_seconds", 30))
        cutoff = time.time() - max(window * 10, 3600)
        with self._lock:
            stale = [k for k, ts in self._debounce.items() if ts < cutoff]
            for k in stale:
                self._debounce.pop(k, None)
            if stale:
                logger.debug("清理 %d 个过期 debounce key", len(stale))

    # ------------------------------------------------------------------
    # 触发：落库 + 计数 + 推送
    # ------------------------------------------------------------------

    def _fire(
        self, rule: AlertRule, snap: dict[str, Any]
    ) -> None:
        """遗留接口（Step 1-6 用）：用 RuleSet 触发。Step 9 后实际调 :meth:`_fire_match`。"""
        code = str(snap.get("code", ""))
        name = str(snap.get("name", "") or snap.get("Name", "") or "")
        strategy_id = str(snap.get("strategy_id", ""))
        signal_id = str(uuid4())

        condition_expr = RuleSet.render_condition(
            rule.condition, params={}, defaults=rule.default_params
        )
        severity = self._priority_to_severity(rule.priority)

        self._insert_signal_event(
            event_id=signal_id,
            strategy_id=strategy_id,
            stock_code=code,
            stock_name=name,
            alert_type=rule.alert_type,
            condition_expr=condition_expr,
            snapshot=json.dumps(snap, ensure_ascii=False, default=str),
            severity=severity,
            channels_fired=json.dumps(rule.channels, ensure_ascii=False),
        )
        EngineState().record_signal(rule.alert_type)
        payload = ChannelPayload(
            signal_id=signal_id,
            signal_type=rule.alert_type,
            strategy_id=strategy_id,
            stock_code=code,
            stock_name=name,
            title=self._build_title(rule, snap),
            content=self._build_content(rule, snap),
            severity=severity,
            priority=rule.priority,
            extra={
                "pct_change": snap.get("pct_change"),
                "last": snap.get("last"),
                "volume_ratio": snap.get("volume_ratio"),
                "alert_type": rule.alert_type,
            },
        )
        try:
            results = get_registry().dispatch(payload, channels=rule.channels)
            logger.info(
                "预警触发 %s %s %s -> %s",
                code, rule.alert_type, name,
                [(r.channel, r.ok) for r in results],
            )
        except Exception as exc:  # noqa: BLE001
            self._error_count += 1
            self._last_error = str(exc)
            logger.warning("推送通道异常 %s %s: %s", code, rule.alert_type, exc)

    def _fire_match(
        self,
        match: MatchStrategy,
        alert_ref: AlertRef,
        condition_expr: str,
        snap: dict[str, Any],
        match_ids: list[str],
    ) -> None:
        """触发一次预警（match 套餐路径，Step 9+ 主入口）。

        Args:
            match: 命中的 MatchStrategy
            alert_ref: 命中的 AlertRef
            condition_expr: 已渲染的条件表达式（落库留痕）
            snap: 行情快照
            match_ids: 同 (code, alert_type) 跨 match 命中的所有 match_id（标注去重）
        """
        code = str(snap.get("code", ""))
        name = str(snap.get("name", "") or snap.get("Name", "") or "")
        strategy_id = str(snap.get("strategy_id", "") or match.strategy_id)
        signal_id = str(uuid4())

        severity = self._priority_to_severity(alert_ref.priority)
        # 通道：alert_ref.channels 非空则用，否则查模板默认
        channels = list(alert_ref.channels or [])
        if not channels:
            tpl = RuleSet.get_template(alert_ref.alert_type) or {}
            channels = list(tpl.get("channels", []) or [])

        # 1. 落库 signal_events
        self._insert_signal_event(
            event_id=signal_id,
            strategy_id=strategy_id,
            stock_code=code,
            stock_name=name,
            alert_type=alert_ref.alert_type,
            condition_expr=condition_expr,
            snapshot=json.dumps(snap, ensure_ascii=False, default=str),
            severity=severity,
            channels_fired=json.dumps(channels, ensure_ascii=False),
        )

        # 2. 内存计数
        EngineState().record_signal(alert_ref.alert_type)

        # 3. 推送通道（extra.match_ids 标注所有命中 match）
        # P1: 分级值班 — high 优先级立即推, medium/low 走聚合队列
        payload = ChannelPayload(
            signal_id=signal_id,
            signal_type=alert_ref.alert_type,
            strategy_id=strategy_id,
            stock_code=code,
            stock_name=name,
            title=self._build_title_match(alert_ref, snap),
            content=self._build_content_match(alert_ref, snap),
            severity=severity,
            priority=alert_ref.priority,
            extra={
                "pct_change": snap.get("pct_change"),
                "last": snap.get("last"),
                "volume_ratio": snap.get("volume_ratio"),
                "alert_type": alert_ref.alert_type,
                "match_ids": match_ids,
            },
        )

        # P1 分级值班: high 立即推全通道; medium 立即推 websocket, feishu 走聚合;
        #            low 只推 websocket, 其他走聚合
        if alert_ref.priority == "high":
            try:
                results = get_registry().dispatch(payload, channels=channels)
                logger.info(
                    "预警触发 %s %s %s match=%s -> %s",
                    code, alert_ref.alert_type, name, match_ids,
                    [(r.channel, r.ok) for r in results],
                )
            except Exception as exc:  # noqa: BLE001
                self._error_count += 1
                self._last_error = str(exc)
                logger.warning("推送通道异常 %s %s: %s", code, alert_ref.alert_type, exc)
        else:
            # medium/low: websocket 立即推, 其他通道聚合
            immediate_ch = [c for c in channels if c == "websocket"]
            agg_ch = [c for c in channels if c != "websocket"]
            if immediate_ch:
                try:
                    get_registry().dispatch(payload, channels=immediate_ch)
                except Exception as exc:  # noqa: BLE001
                    self._error_count += 1
                    self._last_error = str(exc)
                    logger.debug("websocket 推送异常 %s: %s", code, exc)
            if agg_ch:
                self._enqueue_aggregation(strategy_id, alert_ref.priority, payload, agg_ch)
                logger.debug(
                    "聚合入队 %s %s %s (队列=%d)",
                    code, alert_ref.alert_type, alert_ref.priority,
                    len(self._agg_queue.get((strategy_id, alert_ref.priority), [])),
                )

    def _insert_signal_event(
        self,
        *,
        event_id: str,
        strategy_id: str,
        stock_code: str,
        stock_name: str,
        alert_type: str,
        condition_expr: str,
        snapshot: str,
        severity: str,
        channels_fired: str,
    ) -> None:
        """写 signal_events 表（表已存在，不建表）。"""
        try:
            from engine.storage.duckdb_store import DuckDBStore

            store = DuckDBStore()
            store.execute(
                """
                INSERT INTO signal_events
                    (event_id, strategy_id, stock_code, stock_name, alert_type,
                     condition_expr, snapshot, severity, channels_fired, triggered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    event_id, strategy_id, stock_code, stock_name, alert_type,
                    condition_expr, snapshot, severity, channels_fired,
                ],
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("signal_events 写入失败: %s", exc)

    # ------------------------------------------------------------------
    # 监控代码来源
    # ------------------------------------------------------------------

    def _get_monitor_codes(self) -> list[str]:
        """获取当前要监控的代码列表。

        优先级：
        1. ``EngineState.list_subscriptions()`` 的 stock_code
        2. 兜底：``selection_results`` 表最近一次选股 Top N（复用 monitor.py 逻辑）
        """
        state = EngineState()
        subs = state.list_subscriptions()
        codes: list[str] = []
        seen: set[str] = set()
        for s in subs:
            c = str(s.get("stock_code", "")).strip()
            if c and c not in seen:
                codes.append(c)
                seen.add(c)
        if codes:
            return codes[:200]  # 上限 200（subscribe_hq 分批内部处理）

        # 兜底：从 selection_results 取 Top 50
        try:
            from engine.storage.duckdb_store import DuckDBStore

            store = DuckDBStore()
            if not store.table_exists("selection_results"):
                return []
            df = store.query(
                "SELECT DISTINCT stock_code FROM selection_results "
                "ORDER BY created_at DESC LIMIT 50"
            )
            for v in df["stock_code"].astype(str).tolist():
                c = v.strip()
                if c and c not in seen:
                    codes.append(c)
                    seen.add(c)
                    # 注入 EngineState（subscriber=monitor_fallback，strategy_id 空）
                    state.upsert_subscription(
                        c,
                        strategy_id="",
                        subscriber="monitor_fallback",
                        batch_no=1,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning("兜底取 selection_results 失败: %s", exc)
        return codes

    def _code_to_strategy_map(self) -> dict[str, str]:
        """``{stock_code: strategy_id}``，从 EngineState 订阅缓存读。"""
        out: dict[str, str] = {}
        for s in EngineState().list_subscriptions():
            out[str(s.get("stock_code", ""))] = str(s.get("strategy_id", ""))
        return out

    # ------------------------------------------------------------------
    # 快照规一化（V8 raw → 标准 snap 字段）
    # ------------------------------------------------------------------

    def _normalize_snap(self, code: str, raw: dict[str, Any]) -> dict[str, Any]:
        """把 V8 raw 快照 / get_pricevol 结果规一化为标准 snap。

        输出字段：code / name / pct_change / volume_ratio / main_inflow /
        auction_pct / last / volume / amount / strategy_id（外部再注入）
        """
        if not isinstance(raw, dict):
            raw = {}

        def _num(*keys: str, default: float = 0.0) -> float:
            for k in keys:
                v = raw.get(k)
                if v is None or v == "":
                    continue
                try:
                    f = float(v)
                    if f == f:
                        return f
                except (TypeError, ValueError):
                    continue
            return default

        # pct_change: 优先显式，其次 ZAF/100，否则 Now/LastClose-1
        # bug #12: 原 `if not pct:` 把 0.0 当 falsy 跳过, 改为显式 None 判断
        pct = _num("pct_change", default=float("nan"))
        if pct != pct:  # NaN 检查
            zaf = _num("ZAF")
            pct = zaf / 100 if zaf else 0.0
        if pct != pct:  # 仍 NaN, 走 Now/LastClose
            now = _num("Now", "MA5Value")
            last_close = _num("LastClose")
            if now > 0 and last_close > 0:
                pct = now / last_close - 1
            else:
                pct = 0.0

        # main_inflow: Zjl
        main_inflow = _num("main_inflow", "Zjl")

        # volume_ratio: Wtb
        volume_ratio = _num("volume_ratio", "Wtb")

        # auction_pct: VOpenZAF/100
        vopen = _num("VOpenZAF")
        auction_pct = _num("auction_pct", default=float("nan"))
        if auction_pct != auction_pct:  # NaN
            auction_pct = vopen / 100 if vopen else 0.0

        last = _num("last", "Now", "MA5Value")
        volume = _num("volume", "Volume")
        amount = _num("amount", "Amount")
        name = str(raw.get("name") or raw.get("Name") or "")

        snap: dict[str, Any] = {
            "code": code,
            "name": name,
            "pct_change": pct,
            "volume_ratio": volume_ratio,
            "main_inflow": main_inflow,
            "auction_pct": auction_pct,
            "last": last,
            "volume": volume,
            "amount": amount,
        }
        # 保留原 raw 供 debug
        snap["_raw"] = {k: v for k, v in raw.items() if k not in snap}
        return snap

    # ------------------------------------------------------------------
    # 跨日清理（§15.8）
    # ------------------------------------------------------------------

    def _on_new_day(self) -> None:
        """跨日清理：信号计数清零 + 清 debounce + 归档 active=false 订阅。"""
        try:
            EngineState().reset_daily()
        except Exception as exc:  # noqa: BLE001
            logger.warning("reset_daily 失败: %s", exc)

        # 清所有 debounce key（跨日彻底清，不只是过期）
        with self._lock:
            n = len(self._debounce)
            self._debounce.clear()
        logger.info("跨日清理完成: 清零信号计数 + 清 %d 个 debounce key", n)

        # 归档：把 monitor_subscriptions 表中 active=false 的记录补 unsubscribed_at
        # 用 DELETE+INSERT 规避 DuckDB UPDATE 索引 bug；这里直接 DELETE active=false 旧记录
        try:
            from engine.storage.duckdb_store import DuckDBStore

            store = DuckDBStore()
            if store.table_exists("monitor_subscriptions"):
                store.execute(
                    "DELETE FROM monitor_subscriptions WHERE active = false"
                )
        except Exception as exc:  # noqa: BLE001
            logger.debug("归档订阅失败（可忽略）: %s", exc)

    # ------------------------------------------------------------------
    # 文案 / 优先级
    # ------------------------------------------------------------------

    def _build_title(self, rule: AlertRule, snap: dict[str, Any]) -> str:
        """构造推送标题（RuleSet 路径）。"""
        return self._format_title(rule.alert_type, snap)

    def _build_title_match(self, alert_ref: AlertRef, snap: dict[str, Any]) -> str:
        """构造推送标题（Match 路径）。"""
        return self._format_title(alert_ref.alert_type, snap)

    def _format_title(self, alert_type: str, snap: dict[str, Any]) -> str:
        name = str(snap.get("name", "") or "")
        pct = snap.get("pct_change", 0)
        pct_str = f"{pct * 100:+.2f}%" if isinstance(pct, (int, float)) else ""
        prefix = self._alert_prefix(alert_type)
        return f"{prefix} {name}({snap.get('code','')}) {pct_str}".strip()

    @staticmethod
    def _alert_prefix(alert_type: str) -> str:
        """alert_type → emoji 前缀。

        bug #17: 原 prefix_map 硬编码 8 项, 新增 alert_type 需同步改字典。
        改为从 alert_templates YAML 读 ``emoji`` 字段, 没有则用默认 ``📌``。
        """
        try:
            from engine.monitor.rules import RuleSet

            tpl = RuleSet.get_template(alert_type) or {}
            emoji = str(tpl.get("emoji", "")).strip()
            label = str(tpl.get("label", "")).strip()
            if emoji and label:
                return f"{emoji} {label}"
            if label:
                return f"📌 {label}"
        except Exception:  # noqa: BLE001
            pass
        return f"📌 {alert_type}"

    def _build_content(self, rule: AlertRule, snap: dict[str, Any]) -> str:
        """构造推送内容（RuleSet 路径）。"""
        tpl = RuleSet.get_template(rule.alert_type) or {}
        description = str(tpl.get("description", ""))
        return self._format_content(rule.alert_type, snap, description)

    def _build_content_match(self, alert_ref: AlertRef, snap: dict[str, Any]) -> str:
        """构造推送内容（Match 路径）。"""
        tpl = RuleSet.get_template(alert_ref.alert_type) or {}
        description = str(tpl.get("description", ""))
        return self._format_content(alert_ref.alert_type, snap, description)

    def _format_content(
        self, alert_type: str, snap: dict[str, Any], description: str
    ) -> str:
        parts = [
            f"代码: {snap.get('code','')}",
            f"名称: {snap.get('name','')}",
            f"涨跌幅: {snap.get('pct_change', 0) * 100:+.2f}%",
            f"量比: {snap.get('volume_ratio', 0):.2f}",
            f"主力净流入: {snap.get('main_inflow', 0):.0f}万",
        ]
        if description:
            parts.append(f"说明: {description}")
        return " | ".join(parts)

    @staticmethod
    def _priority_to_severity(priority: str) -> str:
        """优先级 → 严重度（high→error / medium→warn / low→info）。"""
        p = (priority or "medium").lower()
        if p == "high":
            return "error"
        if p == "medium":
            return "warn"
        return "info"

    # ------------------------------------------------------------------
    # P1: 聚合推送
    # ------------------------------------------------------------------

    def _enqueue_aggregation(
        self,
        strategy_id: str,
        priority: str,
        payload: ChannelPayload,
        channels: list[str],
    ) -> None:
        """把 medium/low 优先级信号入队，窗口内聚合为一条摘要推送。

        聚合 key = (strategy_id, priority)，窗口 = alert_aggregate_window_seconds (默认 60s)。
        窗口满或队列达到 max_size (默认 10) 时自动 flush。
        """
        cfg = ConfigLoader()
        window = float(cfg.get("monitor.alert_aggregate_window_seconds", 60))
        max_size = int(cfg.get("monitor.alert_aggregate_max_size", 10))
        key = (strategy_id, priority)
        now = time.time()

        with self._lock:
            self._agg_queue.setdefault(key, []).append({
                "signal_id": payload.signal_id,
                "stock_code": payload.stock_code,
                "stock_name": payload.stock_name,
                "alert_type": payload.signal_type,
                "pct_change": payload.extra.get("pct_change"),
                "title": payload.title,
                "channels": channels,
            })
            last_flush = self._agg_last_flush.get(key, now)
            should_flush = (
                len(self._agg_queue[key]) >= max_size
                or (now - last_flush) >= window
            )
            if should_flush:
                self._flush_aggregation_locked(key, channels)

    def _flush_aggregation_locked(
        self, key: tuple[str, str], channels: list[str]
    ) -> None:
        """刷新聚合队列（调用方需持锁）。"""
        items = self._agg_queue.pop(key, [])
        if not items:
            return
        self._agg_last_flush[key] = time.time()
        strategy_id, priority = key
        # 构造摘要 payload
        codes = [it["stock_code"] for it in items[:10]]
        names = [it.get("stock_name", "") for it in items[:10]]
        summary = ChannelPayload(
            signal_id=f"agg_{int(time.time())}_{strategy_id}_{priority}",
            signal_type="aggregate",
            strategy_id=strategy_id,
            stock_code=",".join(codes[:3]) + ("..." if len(codes) > 3 else ""),
            stock_name=",".join(n for n in names[:3] if n),
            title=f"📊 [{strategy_id}] {priority}级信号聚合 x{len(items)}",
            content=self._format_aggregate_content(items),
            severity=self._priority_to_severity(priority),
            priority=priority,
            extra={
                "aggregate": True,
                "count": len(items),
                "items": items,
            },
        )
        try:
            get_registry().dispatch(summary, channels=channels)
            logger.info(
                "聚合推送 flush: strategy=%s priority=%s count=%d -> %s",
                strategy_id, priority, len(items), channels,
            )
        except Exception as exc:  # noqa: BLE001
            self._error_count += 1
            self._last_error = str(exc)
            logger.warning("聚合推送异常: %s", exc)

    def _flush_all_aggregation(self) -> None:
        """刷新所有聚合队列（tick 循环定期调）。"""
        with self._lock:
            for key in list(self._agg_queue.keys()):
                if self._agg_queue[key]:
                    self._flush_aggregation_locked(key, self._agg_queue[key][0].get("channels", []))

    @staticmethod
    def _format_aggregate_content(items: list[dict[str, Any]]) -> str:
        """格式化聚合推送内容。"""
        lines = [f"聚合 {len(items)} 条信号:"]
        for i, it in enumerate(items[:10], 1):
            pct = it.get("pct_change", 0)
            pct_str = f"{pct * 100:+.2f}%" if isinstance(pct, (int, float)) else ""
            lines.append(
                f"  {i}. {it.get('stock_name','')}({it.get('stock_code','')}) "
                f"{it.get('alert_type','')} {pct_str}"
            )
        if len(items) > 10:
            lines.append(f"  ... 共 {len(items)} 条")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # 健康度查询（供 /api/monitor/health 用，P1）
    # ------------------------------------------------------------------

    def health(self) -> dict[str, Any]:
        """返回引擎健康指标。"""
        with self._lock:
            return {
                "subscribe_alive": self._subscribed,
                "last_quote_ts": self._last_quote_ts,
                "quote_lag_seconds": (
                    time.time() - self._last_quote_ts
                    if self._last_quote_ts else -1
                ),
                "eval_count": self._eval_count,
                "error_count": self._error_count,
                "last_error": self._last_error,
                "debounce_size": len(self._debounce),
            }
