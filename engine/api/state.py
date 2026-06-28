"""FastAPI 引擎运行时状态。

进程级单例，记录启动时间、信号计数、心跳等，供 ``/api/monitor`` 查询。
不持久化（重启清零），如需跨进程保留可后续接入 DuckDB ``signal_events`` 表。
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any


def _now_iso() -> str:
    """当前 UTC+8 时间 ISO 字符串。"""
    return datetime.now().astimezone().isoformat(timespec="seconds")


class EngineState:
    """引擎运行时状态（线程安全单例）。"""

    _instance: "EngineState | None" = None
    _instance_lock = threading.Lock()

    def __new__(cls) -> "EngineState":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self) -> None:
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self._lock = threading.RLock()
        self._started_at: datetime = datetime.now()
        self._last_hb: str = _now_iso()
        self._today_signals: int = 0
        self._today_limit_up: int = 0
        self._today_alerts: int = 0
        # 监控订阅缓存（key=stock_code）
        self._subscriptions: dict[str, dict[str, Any]] = {}
        # R14-2: API 限流监控计数（线程安全）
        self._api_call_total: int = 0
        self._api_rejected_total: int = 0
        self._api_avg_latency_ms: float = 0.0
        self._api_latency_samples: int = 0
        self._tqcenter_call_total: int = 0
        self._tqcenter_rejected_total: int = 0

    # ------------------------------------------------------------------
    # 心跳
    # ------------------------------------------------------------------

    def heartbeat(self) -> None:
        with self._lock:
            self._last_hb = _now_iso()

    def uptime_seconds(self) -> int:
        with self._lock:
            return int((datetime.now() - self._started_at).total_seconds())

    @property
    def started_at(self) -> datetime:
        return self._started_at

    # ------------------------------------------------------------------
    # 信号计数
    # ------------------------------------------------------------------

    def record_signal(self, signal_type: str) -> None:
        with self._lock:
            self._today_signals += 1
            if signal_type == "limit_up":
                self._today_limit_up += 1
            elif signal_type in ("drop_alert", "breakout"):
                self._today_alerts += 1

    def today_signal_counts(self) -> dict[str, int]:
        with self._lock:
            return {
                "today_signals": self._today_signals,
                "today_limit_up": self._today_limit_up,
                "today_alerts": self._today_alerts,
            }

    def reset_daily(self) -> None:
        """跨日清零（由调度器调用，本阶段手动触发）。"""
        with self._lock:
            self._today_signals = 0
            self._today_limit_up = 0
            self._today_alerts = 0

    @property
    def last_hb(self) -> str:
        with self._lock:
            return self._last_hb

    # ------------------------------------------------------------------
    # 订阅
    # ------------------------------------------------------------------

    def upsert_subscription(
        self,
        stock_code: str,
        *,
        strategy_id: str = "",
        subscriber: str = "engine",
        batch_no: int = 0,
    ) -> None:
        with self._lock:
            self._subscriptions[stock_code] = {
                "strategy_id": strategy_id,
                "stock_code": stock_code,
                "subscriber": subscriber,
                "subscribed_at": _now_iso(),
                "active": True,
                "batch_no": batch_no,
            }

    def remove_subscription(self, stock_code: str) -> None:
        with self._lock:
            self._subscriptions.pop(stock_code, None)

    def list_subscriptions(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._subscriptions.values())

    def monitored_count(self) -> int:
        with self._lock:
            return len(self._subscriptions)

    # ------------------------------------------------------------------
    # R14-2: API 限流监控计数
    # ------------------------------------------------------------------

    def record_api_call(self, latency_ms: float, rejected: bool = False) -> None:
        """记录一次 API 调用（线程安全，增量平均算法）。

        Args:
            latency_ms: 本次请求耗时（毫秒）
            rejected: 是否被限流中间件拒绝（status=429）
        """
        with self._lock:
            self._api_call_total += 1
            if rejected:
                self._api_rejected_total += 1
            # 增量平均：avg = avg + (new - avg) / n
            self._api_latency_samples += 1
            n = self._api_latency_samples
            self._api_avg_latency_ms = (
                self._api_avg_latency_ms + (float(latency_ms) - self._api_avg_latency_ms) / n
            )

    def record_tqcenter_call(self, rejected: bool = False) -> None:
        """记录一次 tqcenter 适配器调用（含被令牌桶拒绝）。

        Args:
            rejected: 是否被令牌桶拒绝（acquire_or_skip 返回 False）
        """
        with self._lock:
            self._tqcenter_call_total += 1
            if rejected:
                self._tqcenter_rejected_total += 1

    def api_stats(self) -> dict[str, Any]:
        """返回 API 限流相关统计快照。"""
        with self._lock:
            data = {
                "api_call_total": self._api_call_total,
                "api_rejected_total": self._api_rejected_total,
                "api_avg_latency_ms": round(self._api_avg_latency_ms, 2),
                "tqcenter_call_total": self._tqcenter_call_total,
                "tqcenter_rejected_total": self._tqcenter_rejected_total,
            }
        # rate_limit_status：从模块级单例取
        try:
            from engine.data_adapter.rate_limiter import get_limiter

            lim = get_limiter()
            if lim is not None:
                data["tqcenter_limiter"] = lim.snapshot()
            else:
                data["tqcenter_limiter"] = {"enabled": False}
        except Exception:  # noqa: BLE001
            data["tqcenter_limiter"] = {"enabled": False}
        try:
            from engine.api.middleware.rate_limit import get_global_limiter

            api_lim = get_global_limiter()
            if api_lim is not None:
                data["api_middleware"] = {
                    "enabled": True,
                    "rules_count": api_lim.rules_count,
                }
            else:
                data["api_middleware"] = {"enabled": False, "rules_count": 0}
        except Exception:  # noqa: BLE001
            data["api_middleware"] = {"enabled": False, "rules_count": 0}
        return data

    # ------------------------------------------------------------------
    # 测试用：重置单例
    # ------------------------------------------------------------------

    @classmethod
    def _reset_singleton(cls) -> None:
        """重置单例（仅测试用）。

        bug #13: 生产环境误调会丢全部内存状态（信号计数/订阅缓存清零）。
        加 DEBUG 环境变量检查，非测试环境调用直接抛 RuntimeError。
        """
        import os

        if os.getenv("DEBUG", "").lower() not in ("1", "true", "yes"):
            raise RuntimeError(
                "_reset_singleton 仅限测试环境调用（需 DEBUG=1）。"
                "生产环境调用会清空全部内存状态，已拦截。"
            )
        with cls._instance_lock:
            cls._instance = None


def get_engine_state() -> EngineState:
    """获取全局 EngineState 单例。"""
    return EngineState()
