"""FastAPI 端点限流中间件。

设计要点：
1. **按端点组 + 单 IP 限流**：内存令牌桶，不引第三方
2. **配置驱动**：rules 在 config/app.yaml 的 api.rate_limit 段
3. **429 + Retry-After + X-RateLimit-* headers**：标准限流响应
4. **内存 LRU**：容量上限 10000 IP，超限淘汰最旧
5. **Mock/Real 都生效**：保护 Next 代理层 CPU

配置示例（config/app.yaml）：
    api:
      rate_limit:
        enabled: true
        rules:
          - path_prefix: "/api/health"
            qpm: 120
          - path_prefix: "/api/stocks"
            qpm: 30
          - path_prefix: "/api/sectors"
            qpm: 60
            methods: ["GET"]
          - path_prefix: "/api/sectors"
            qpm: 3
            methods: ["POST"]
          - path_prefix: "/api/monitor"
            qpm: 60
        default_qpm: 60
        cleanup_interval: 300

实现细节：
- 每个 (rule_id, ip) 维护一个 ``_IPBucket`` 实例，记录 tokens / last_refill / last_access
- 令牌算法：QPM 转 QPS = qpm/60，burst = qpm（1 分钟配额）
- 内存上限：dict 满 10000 entry 时清最旧 20%（按 last_access 时间戳）
- 后台线程定期清理 30 分钟未访问的 IP（cleanup_interval 控制，默认 300s）
- Starlette BaseHTTPMiddleware 包装顺序：后注册先执行，所以 RateLimit 在
  CORS 之后注册，会在 CORS 之后执行（CORS 处理 OPTIONS 预检不被限流）
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------------
# 单 IP 令牌桶
# ----------------------------------------------------------------------------


class _IPBucket:
    """单 (rule, ip) 维度的令牌桶（线程不安全，由外层 IPRateLimiter 锁保护）。"""

    __slots__ = ("qps", "burst", "tokens", "last_refill", "last_access")

    def __init__(self, qps: float, burst: int) -> None:
        self.qps: float = float(qps)
        self.burst: int = int(burst)
        self.tokens: float = float(burst)
        self.last_refill: float = time.monotonic()
        self.last_access: float = time.monotonic()

    def acquire(self) -> tuple[bool, int]:
        """尝试获取 1 个令牌。

        Returns:
            (allowed, retry_after_seconds)
            allowed=True 表示通过；retry_after 为建议重试等待秒数（0 表示无需等待）。
        """
        now = time.monotonic()
        self.last_access = now
        delta = now - self.last_refill
        if delta > 0:
            self.tokens = min(float(self.burst), self.tokens + delta * self.qps)
            self.last_refill = now
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return (True, 0)
        # 不够，计算需要等多久
        needed = 1.0 - self.tokens
        wait_s = needed / self.qps if self.qps > 0 else 60
        return (False, int(wait_s) + 1)


# ----------------------------------------------------------------------------
# 全局 IP 限流器
# ----------------------------------------------------------------------------


class IPRateLimiter:
    """按 (rule, ip) 维护令牌桶的限流器。

    线程安全：所有公开方法持锁。
    """

    # 内存上限：超过时按 last_access 清最旧 20%
    MAX_ENTRIES = 10_000
    EVICT_RATIO = 0.2
    # 单个 IP 30 分钟未访问可被清理
    IP_IDLE_TTL = 30 * 60

    def __init__(
        self,
        rules: list[dict[str, Any]],
        default_qpm: int = 60,
        cleanup_interval: int = 300,
    ) -> None:
        self._rules: list[dict[str, Any]] = []
        for idx, r in enumerate(rules):
            self._rules.append({
                "id": idx,
                "path_prefix": str(r.get("path_prefix", "")),
                "qpm": int(r.get("qpm", 60)),
                "methods": [str(m).upper() for m in (r.get("methods") or [])],
            })
        # 按 path_prefix 长度倒序，匹配时优先最长前缀
        self._rules.sort(key=lambda x: len(x["path_prefix"]), reverse=True)
        self._default_qpm: int = int(default_qpm)
        self._default_qps: float = self._default_qpm / 60.0
        self._cleanup_interval: int = int(cleanup_interval)
        self._buckets: OrderedDict[tuple[int, str], _IPBucket] = OrderedDict()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._cleanup_thread: threading.Thread | None = None

    # ------------------------------------------------------------------
    # 公开 API
    # ------------------------------------------------------------------

    @property
    def rules_count(self) -> int:
        return len(self._rules)

    @property
    def enabled(self) -> bool:
        return True

    def match_rule(self, path: str, method: str) -> dict[str, Any] | None:
        """返回匹配的 rule（最长前缀 + 可选 method 过滤），无匹配返回 None。"""
        m = method.upper()
        for r in self._rules:
            if not path.startswith(r["path_prefix"]):
                continue
            if r["methods"] and m not in r["methods"]:
                continue
            return r
        return None

    def acquire(self, rule_id: int, ip: str, qpm: int) -> tuple[bool, int]:
        """对 (rule_id, ip) 尝试获取 1 个令牌。

        Returns:
            (allowed, retry_after_seconds)
        """
        qps = qpm / 60.0
        burst = qpm  # 1 分钟配额作突发
        key = (rule_id, ip)
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                # 容量保护：超限时清最旧 EVICT_RATIO
                if len(self._buckets) >= self.MAX_ENTRIES:
                    self._evict_locked(self.EVICT_RATIO)
                bucket = _IPBucket(qps=qps, burst=burst)
                self._buckets[key] = bucket
            # 注意：bucket.qps / burst 已在首次创建时定，规则不变则不需更新
            # 若热加载改了 qpm，由于规则在启动时读取，重启才生效（设计上接受）
            return bucket.acquire()

    def try_request(self, path: str, method: str, ip: str) -> tuple[bool, int, dict[str, Any]]:
        """对一次请求做限流判定。

        Returns:
            (allowed, retry_after_seconds, debug_info)
            debug_info 包含 rule_id / qpm / remaining 等供响应 header 使用。
        """
        rule = self.match_rule(path, method)
        if rule is None:
            # 无规则匹配 → 用 default_qpm，rule_id = -1
            allowed, retry = self.acquire(-1, ip, self._default_qpm)
            info: dict[str, Any] = {
                "rule_id": -1,
                "qpm": self._default_qpm,
                "matched_rule": None,
            }
        else:
            allowed, retry = self.acquire(rule["id"], ip, rule["qpm"])
            info = {
                "rule_id": rule["id"],
                "qpm": rule["qpm"],
                "matched_rule": rule["path_prefix"],
            }
        info["remaining"] = self._get_remaining_locked(rule["id"] if rule else -1, ip)
        return (allowed, retry, info)

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    def _get_remaining_locked(self, rule_id: int, ip: str) -> int:
        """读取当前剩余令牌数（仅供响应 header 展示，已持锁）。"""
        key = (rule_id, ip)
        bucket = self._buckets.get(key)
        if bucket is None:
            return 0
        return int(bucket.tokens)

    def _evict_locked(self, ratio: float) -> None:
        """清最旧 ratio 比例 entry（按 last_access，必须持锁）。"""
        if not self._buckets:
            return
        n = max(1, int(len(self._buckets) * ratio))
        # 按 last_access 升序排，删前 n 个
        items = sorted(self._buckets.items(), key=lambda kv: kv[1].last_access)
        for k, _ in items[:n]:
            self._buckets.pop(k, None)
        logger.info("IPRateLimiter 清理最旧 %d 个 IP 桶（剩 %d）", n, len(self._buckets))

    def start_cleanup_thread(self) -> None:
        """启动后台清理线程。"""
        if self._cleanup_thread and self._cleanup_thread.is_alive():
            return
        self._stop_event.clear()
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop,
            name="IPRateLimiter-Cleanup",
            daemon=True,
        )
        self._cleanup_thread.start()
        logger.info(
            "IPRateLimiter 清理线程已启动 (interval=%ss, idle_ttl=%ss)",
            self._cleanup_interval, self.IP_IDLE_TTL,
        )

    def stop_cleanup_thread(self) -> None:
        self._stop_event.set()
        if self._cleanup_thread:
            self._cleanup_thread.join(timeout=3)
            self._cleanup_thread = None

    def _cleanup_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._cleanup_idle()
            except Exception as exc:  # noqa: BLE001
                logger.warning("IPRateLimiter 清理异常: %s", exc)
            self._stop_event.wait(self._cleanup_interval)

    def _cleanup_idle(self) -> None:
        """删除超过 IP_IDLE_TTL 未访问的 IP 桶。"""
        now = time.monotonic()
        evicted = 0
        with self._lock:
            for key in list(self._buckets.keys()):
                bucket = self._buckets.get(key)
                if bucket is None:
                    continue
                if now - bucket.last_access > self.IP_IDLE_TTL:
                    self._buckets.pop(key, None)
                    evicted += 1
        if evicted > 0:
            logger.info("IPRateLimiter 清理 %d 个空闲 IP 桶", evicted)


# ----------------------------------------------------------------------------
# 模块级单例
# ----------------------------------------------------------------------------


_global_limiter: IPRateLimiter | None = None
_global_limiter_lock = threading.Lock()


def get_global_limiter() -> IPRateLimiter | None:
    """返回全局 IPRateLimiter 单例（首次调用从 config 构造，禁用时返回 None）。"""
    global _global_limiter
    if _global_limiter is not None:
        return _global_limiter
    with _global_limiter_lock:
        if _global_limiter is not None:
            return _global_limiter
        try:
            from engine.config.loader import ConfigLoader

            cfg = ConfigLoader()
            enabled = bool(cfg.get("api.rate_limit.enabled", False))
            if not enabled:
                logger.info("api.rate_limit.enabled=False，端点限流禁用")
                return None
            rules = cfg.get("api.rate_limit.rules", []) or []
            default_qpm = int(cfg.get("api.rate_limit.default_qpm", 60) or 60)
            cleanup_interval = int(cfg.get("api.rate_limit.cleanup_interval", 300) or 300)
            _global_limiter = IPRateLimiter(
                rules=rules,
                default_qpm=default_qpm,
                cleanup_interval=cleanup_interval,
            )
            _global_limiter.start_cleanup_thread()
            logger.info(
                "IPRateLimiter 已创建: rules=%d, default_qpm=%d",
                _global_limiter.rules_count, default_qpm,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("IPRateLimiter 创建失败，限流禁用: %s", exc)
            return None
        return _global_limiter


def reset_global_limiter() -> None:
    """重置单例（重启 FastAPI 时由 lifespan 调用，或配置 reload 时调）。"""
    global _global_limiter
    with _global_limiter_lock:
        old = _global_limiter
        _global_limiter = None
    if old is not None:
        old.stop_cleanup_thread()
        logger.info("IPRateLimiter 已重置")


# ----------------------------------------------------------------------------
# Starlette 中间件
# ----------------------------------------------------------------------------


class RateLimitMiddleware(BaseHTTPMiddleware):
    """FastAPI 端点限流中间件。

    通过 ``app.add_middleware(RateLimitMiddleware)`` 注册。
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        limiter = get_global_limiter()
        if limiter is None:
            return await call_next(request)

        # 跳过 OPTIONS 预检（CORS 用）
        if request.method.upper() == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        method = request.method
        ip = _extract_client_ip(request)

        try:
            allowed, retry_after, info = limiter.try_request(path, method, ip)
        except Exception as exc:  # noqa: BLE001
            # 限流内部异常不阻断请求（fail-open），仅记录
            logger.warning("RateLimit 判定异常（fail-open）: %s", exc)
            return await call_next(request)

        if not allowed:
            body = {
                "error": "rate_limit_exceeded",
                "detail": "请求过于频繁，请稍后重试",
                "retry_after": retry_after,
            }
            resp = JSONResponse(status_code=429, content=body)
            resp.headers["Retry-After"] = str(retry_after)
            resp.headers["X-RateLimit-Limit"] = str(info.get("qpm", 0))
            resp.headers["X-RateLimit-Remaining"] = "0"
            return resp

        # 通过 → 调下游 + 加 X-RateLimit-Remaining header
        response = await call_next(request)
        try:
            response.headers["X-RateLimit-Limit"] = str(info.get("qpm", 0))
            response.headers["X-RateLimit-Remaining"] = str(info.get("remaining", 0))
        except Exception:  # noqa: BLE001
            pass
        return response


def _extract_client_ip(request: Request) -> str:
    """取 client IP，优先 X-Forwarded-For 第一个。"""
    xff = request.headers.get("x-forwarded-for") or ""
    if xff:
        # 取第一个非空
        for part in xff.split(","):
            part = part.strip()
            if part:
                return part
    if request.client is not None:
        return request.client.host
    return "unknown"


# ----------------------------------------------------------------------------
# 工厂函数
# ----------------------------------------------------------------------------


def create_rate_limit_middleware(app) -> None:
    """读 config，若 enabled=True 则 ``app.add_middleware(RateLimitMiddleware)``。

    禁用时不注册中间件（零开销）。

    注意：Starlette 中间件注册顺序是"后注册先执行"。本函数应在 CORSMiddleware
    之后调用，使 RateLimit 在 CORS 之后执行（CORS 先处理 OPTIONS 预检不被限流）。
    """
    try:
        from engine.config.loader import ConfigLoader

        cfg = ConfigLoader()
        enabled = bool(cfg.get("api.rate_limit.enabled", False))
    except Exception as exc:  # noqa: BLE001
        logger.warning("读取 api.rate_limit.enabled 失败，限流中间件不注册: %s", exc)
        return
    if not enabled:
        logger.info("api.rate_limit.enabled=False，RateLimitMiddleware 不注册")
        return
    app.add_middleware(RateLimitMiddleware)
    logger.info("RateLimitMiddleware 已注册")
