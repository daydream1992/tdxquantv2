"""tqcenter API 调用令牌桶限流器。

设计要点：
1. **全局令牌桶**：保护通达信终端 GUI 线程，防止高频调用导致卡死/掉线
2. **Mock 模式跳过**：开发体验优先，Mock 适配器不调用本限流器
   （mock_adapter.py 不 import 也不调 acquire_or_skip，故开发环境零开销）
3. **API 分类计费**：订阅类不计费（被动推送），查询类 1 token/次
4. **线程安全**：threading.Lock 保护，acquire 超时抛 RateLimitError
5. **可观测**：记录 total/acquired/rejected/waited_ms 等指标供 /health 透出

配置（config/app.yaml 的 tqcenter 段）：
    global_qps: 10          # 全局每秒最大调用数
    burst: 20                # 突发容量
    acquire_timeout: 5       # 获取令牌超时（秒），超时抛 RateLimitError

实现细节：
- 漏桶算法补令牌：``tokens = min(burst, tokens + (now - last_refill) * qps)``
- 模块级单例 ``_global_limiter``，首次 get_limiter() 创建，缓存到下次 reset_limiter()
- 配置变更需调 ``reset_limiter()`` 重建（由 ConfigLoader.reload 自动触发）
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------------
# 异常
# ----------------------------------------------------------------------------


class RateLimitError(RuntimeError):
    """令牌获取超时或被拒绝时抛出。"""


# ----------------------------------------------------------------------------
# 令牌桶
# ----------------------------------------------------------------------------


class TokenBucket:
    """漏桶算法令牌桶（线程安全）。

    Args:
        qps: 每秒补充的令牌数（即长期 QPS 上限）。
        burst: 桶容量（允许的瞬时突发请求数）。
        timeout: acquire 阻塞最长等待秒数，超时抛 RateLimitError。
    """

    def __init__(self, qps: float, burst: int, timeout: float) -> None:
        if qps <= 0 or burst <= 0:
            raise ValueError(f"qps/burst 必须 > 0: qps={qps}, burst={burst}")
        self._qps: float = float(qps)
        self._burst: int = int(burst)
        self._timeout: float = float(timeout)
        self._lock = threading.Lock()
        # 初始令牌数 = burst（满桶）
        self._tokens: float = float(burst)
        self._last_refill: float = time.monotonic()
        # 监控指标
        self._total_calls: int = 0
        self._rejected_calls: int = 0
        self._total_wait_ms: float = 0.0

    # ------------------------------------------------------------------
    # 公开 API
    # ------------------------------------------------------------------

    def acquire(self) -> None:
        """阻塞获取 1 个令牌；超时抛 ``RateLimitError``。

        实现：循环"检查-补令牌-不够则锁外 sleep"直到拿到令牌或超时。
        sleep 时释放锁，避免阻塞其他线程 acquire。
        """
        start = time.monotonic()
        deadline = start + self._timeout
        counted = False
        while True:
            sleep_s: float = 0.0
            with self._lock:
                if not counted:
                    self._total_calls += 1
                    counted = True
                self._refill_locked()
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    self._total_wait_ms += (time.monotonic() - start) * 1000.0
                    return
                # 计算需要等待多久才有 1 个令牌
                needed = 1.0 - self._tokens
                sleep_s = needed / self._qps
            # 锁外判断 deadline
            now = time.monotonic()
            if now + sleep_s > deadline:
                # 超时
                with self._lock:
                    self._rejected_calls += 1
                    self._total_wait_ms += (now - start) * 1000.0
                raise RateLimitError(
                    f"令牌获取超时 (qps={self._qps}, burst={self._burst}, "
                    f"timeout={self._timeout}s, waited={(now - start) * 1000.0:.1f}ms)"
                )
            # 锁外 sleep（不阻塞其他线程 acquire）
            time.sleep(min(sleep_s, deadline - now))
            # 循环回去再检查

    def snapshot(self) -> dict[str, Any]:
        """返回当前指标快照（线程安全，不消耗令牌）。"""
        with self._lock:
            self._refill_locked()
            return {
                "enabled": True,
                "qps": self._qps,
                "burst": self._burst,
                "acquire_timeout": self._timeout,
                "current_tokens": round(self._tokens, 2),
                "total_calls": self._total_calls,
                "rejected_calls": self._rejected_calls,
                "total_wait_ms": round(self._total_wait_ms, 1),
            }

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    def _refill_locked(self) -> None:
        """按漏桶算法补令牌（必须持锁调用）。"""
        now = time.monotonic()
        delta = now - self._last_refill
        if delta > 0:
            self._tokens = min(float(self._burst), self._tokens + delta * self._qps)
            self._last_refill = now


# ----------------------------------------------------------------------------
# 模块级单例
# ----------------------------------------------------------------------------


_global_limiter: TokenBucket | None = None
_global_limiter_lock = threading.Lock()


def get_limiter() -> TokenBucket | None:
    """返回全局令牌桶单例；配置缺失/非法时返回 None（禁用限流）。

    首次调用按 ``config/app.yaml`` 的 ``tqcenter.global_qps`` / ``burst`` /
    ``acquire_timeout`` 创建。后续返回缓存，配置变更需调 ``reset_limiter()``。
    """
    global _global_limiter
    if _global_limiter is not None:
        return _global_limiter
    with _global_limiter_lock:
        if _global_limiter is not None:
            return _global_limiter
        try:
            from engine.config.loader import ConfigLoader

            cfg = ConfigLoader()
            qps = float(cfg.get("tqcenter.global_qps", 0) or 0)
            burst = int(cfg.get("tqcenter.burst", 0) or 0)
            timeout = float(cfg.get("tqcenter.acquire_timeout", 0) or 0)
        except Exception as exc:  # noqa: BLE001
            logger.warning("读取限流配置失败，限流禁用: %s", exc)
            return None
        if qps <= 0 or burst <= 0 or timeout <= 0:
            logger.info(
                "tqcenter 限流配置缺失或 ≤0 (qps=%s, burst=%s, timeout=%s)，限流禁用",
                qps, burst, timeout,
            )
            return None
        try:
            _global_limiter = TokenBucket(qps=qps, burst=burst, timeout=timeout)
            logger.info(
                "tqcenter 令牌桶已创建: qps=%s, burst=%s, timeout=%ss",
                qps, burst, timeout,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("令牌桶创建失败，限流禁用: %s", exc)
            return None
        return _global_limiter


def reset_limiter() -> None:
    """清缓存，下次 ``get_limiter()`` 重建。

    由 ``ConfigLoader.reload()`` 触发，让 ``app.yaml`` 修改后无需重启即可生效。
    """
    global _global_limiter
    with _global_limiter_lock:
        old = _global_limiter
        _global_limiter = None
    if old is not None:
        logger.info("tqcenter 令牌桶已重置（下次 get_limiter 重建）")


def acquire_or_skip() -> bool:
    """便捷封装：成功获取返回 True，被限流返回 False。

    若 ``get_limiter()`` 返回 None（限流禁用），直接返回 True。
    若 acquire 抛 RateLimitError，返回 False（调用方自行决定降级策略）。

    副作用：调用 ``EngineState.record_tqcenter_call`` 累计 tqcenter 调用计数
    （Real 模式生效；Mock 模式因 mock_adapter 不调本函数故不计）。
    """
    limiter = get_limiter()
    if limiter is None:
        return True
    try:
        limiter.acquire()
        _record_tqcenter_call(rejected=False)
        return True
    except RateLimitError:
        _record_tqcenter_call(rejected=True)
        return False


def _record_tqcenter_call(*, rejected: bool) -> None:
    """安全记录 tqcenter 调用计数到 EngineState（避免循环依赖 + 异常吞掉）。"""
    try:
        from engine.api.state import get_engine_state

        get_engine_state().record_tqcenter_call(rejected=rejected)
    except Exception:  # noqa: BLE001
        # EngineState 在 FastAPI 启动前不可用，吞掉避免阻塞限流逻辑
        pass
