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
    # 测试用：重置单例
    # ------------------------------------------------------------------

    @classmethod
    def _reset_singleton(cls) -> None:
        with cls._instance_lock:
            cls._instance = None


def get_engine_state() -> EngineState:
    """获取全局 EngineState 单例。"""
    return EngineState()
