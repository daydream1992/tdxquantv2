"""FastAPI 请求/响应 Pydantic 模型。

所有对外 API 的入参与返回值都用 Pydantic v2 模型定义，保证：
1. 类型注解齐全（IDE 友好 + OpenAPI 文档自动生成）
2. 字段别名与前端 ``src/lib/mock-data.ts`` 中的 DTO 接口对齐
3. ``model_config = ConfigDict(from_attributes=True)`` 支持从 dataclass 构建

约定
----
- 响应模型用 ``Response`` 后缀（如 ``StrategyResponse``）
- 列表响应统一用 ``list[XxxResponse]``（FastAPI 自动 wrap）
- 不存在的资源返回 404，非法入参返回 422（Pydantic 默认行为）
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ============================================================================
# 通用
# ============================================================================


class OkResponse(BaseModel):
    """通用 ``{ok: true, ...}`` 响应。"""

    ok: bool = True
    message: str | None = None
    data: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    """错误响应。"""

    error: str
    detail: str | None = None


# ============================================================================
# 主题
# ============================================================================


class ThemeResponse(BaseModel):
    """``GET /api/theme`` 响应，对应 ``config/theme.yaml`` 的 ``theme`` 节。"""

    mode: str = "dark"
    primary_color: str = "#f59e0b"
    up_color: str = "#ef4444"
    down_color: str = "#22c55e"
    flat_color: str = "#6b7280"
    background: str = "#0a0a0a"
    card_background: str = "#171717"
    border_color: str = "#262626"
    font_family: str = "ui-sans-serif, system-ui"


# ============================================================================
# 策略
# ============================================================================


class StrategyFactorItem(BaseModel):
    """策略 YAML ``factors`` 项。"""

    factor_id: str
    weight: float = 1.0
    params: dict[str, Any] = Field(default_factory=dict)


class StrategySectorInfo(BaseModel):
    """策略 YAML ``sector`` 段。"""

    code: str = ""
    name: str = ""
    auto_update: bool = True
    update_mode: str = "replace"


class StrategyResponse(BaseModel):
    """``GET /api/strategies`` / ``GET /api/strategies/{id}`` 响应。"""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    strategy_id: str
    strategy_name: str
    strategy_emoji: str = ""
    version: str = "1.0"
    enabled: bool = True
    sector_code: str = ""
    sector_name: str = ""
    sector: StrategySectorInfo | None = None
    factors: list[StrategyFactorItem] = Field(default_factory=list)
    yaml_path: str = ""
    yaml_content: str = ""
    description: str = ""
    last_run_at: str | None = None
    last_run_stocks: int = 0


class StrategyToggleRequest(BaseModel):
    """``POST /api/strategies/{id}`` 入参：``{enabled: bool}``。"""

    enabled: bool


class StrategyBatchActionRequest(BaseModel):
    """``POST /api/strategies`` 入参：``{action: "enable_all"|"disable_all"|"run_all"}``。"""

    action: str = Field(..., description="enable_all | disable_all | run_all")


class StrategyRunResponse(BaseModel):
    """``POST /api/strategies/{id}/run`` 响应。"""

    ok: bool = True
    run_id: str
    strategy_id: str
    count: int = 0
    duration_sec: float | None = None
    error: str | None = None


class StrategyRunRecord(BaseModel):
    """``GET /api/strategies/{id}/runs`` 单条历史执行记录。"""

    run_id: str
    strategy_id: str
    run_date: str | None = None
    status: str = "pending"
    started_at: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None
    universe_count: int = 0
    result_count: int = 0
    error_message: str = ""


class StrategyBatchRunResult(BaseModel):
    """``POST /api/strategies {action:"run_all"}`` 单条结果。"""

    id: str
    count: int = 0
    ok: bool = True
    error: str | None = None


class StrategyBatchRunResponse(BaseModel):
    """``POST /api/strategies {action:"run_all"}`` 响应。"""

    ok: bool = True
    results: list[StrategyBatchRunResult] = Field(default_factory=list)


# ============================================================================
# 选股结果
# ============================================================================


class SelectionFactorScore(BaseModel):
    """选股结果中单因子分项。"""

    factor_id: str
    value: float = 0.0
    weight: float = 0.0
    score: float = 0.0


class SelectionRowResponse(BaseModel):
    """选股结果单行。"""

    run_id: str
    strategy_id: str
    strategy_name: str = ""
    stock_code: str
    stock_name: str = ""
    score: float = 0.0
    rank: int = 0
    factors: list[SelectionFactorScore] = Field(default_factory=list)
    run_at: str = ""


class SelectionDetailResponse(BaseModel):
    """``GET /api/selections/{run_id}`` 响应：包含 run 元信息 + 行列表。"""

    run_id: str
    strategy_id: str
    strategy_name: str = ""
    started_at: str | None = None
    finished_at: str | None = None
    duration_sec: float | None = None
    n_stocks: int = 0
    status: str = "success"
    rows: list[SelectionRowResponse] = Field(default_factory=list)


# ============================================================================
# 监控
# ============================================================================


class MonitorStatusResponse(BaseModel):
    """``GET /api/monitor/status`` 响应。"""

    engine_status: str = "running"  # running | stopped | error
    adapter_mode: str = "mock"
    monitored_count: int = 0
    today_signals: int = 0
    today_limit_up: int = 0
    today_alerts: int = 0
    uptime_seconds: int = 0
    last_hb: str = ""


class QuoteSnapshot(BaseModel):
    """``GET /api/monitor/quotes`` 单条快照。

    新增资金流字段 (R7-A):
    - ``main_inflow``: 主力净流入 (万元, 来自 ``Zjl``)
    - ``big_buy_ratio``: 大买占比 (0~1, ``TotalBVol / (TotalBVol+TotalSVol)``)
    - ``turnover_rate``: 换手率% (来自 ``fHSL``)

    新增竞价字段 (R13-2b):
    - ``auction_pct``: 竞价涨幅 (小数形式, 0.0523 = 5.23%, 来自 ``VOpenZAF/100``)。
      与 ``pct`` 同为小数形式, 缺失返回 0.0。

    所有新字段默认 0.0, 兼容旧调用方。
    """

    code: str
    name: str = ""
    last: float = 0.0
    pct: float = 0.0
    change: float = 0.0
    volume: float = 0.0
    amount: float = 0.0
    ts: int = 0
    main_inflow: float = 0.0
    big_buy_ratio: float = 0.0
    turnover_rate: float = 0.0
    auction_pct: float = 0.0


class FlowRankingItem(BaseModel):
    """``GET /api/monitor/flow-ranking`` 单条 (资金流向排行)。

    复用 :class:`QuoteSnapshot` 的字段子集 + 资金流指标,
    便于前端按 ``main_inflow`` / ``big_buy_ratio`` / ``turnover_rate`` 排序。
    """

    code: str
    name: str = ""
    last: float = 0.0
    pct: float = 0.0
    main_inflow: float = 0.0
    big_buy_ratio: float = 0.0
    turnover_rate: float = 0.0
    amount: float = 0.0


class MonitorSubscriptionItem(BaseModel):
    """监控订阅单条。"""

    strategy_id: str = ""
    stock_code: str
    subscriber: str = ""
    subscribed_at: str = ""
    active: bool = True
    batch_no: int = 0


# ============================================================================
# 板块
# ============================================================================


class SectorInfoResponse(BaseModel):
    """``GET /api/sectors`` 单条板块信息。"""

    code: str
    name: str = ""
    strategy_id: str = ""
    strategy_name: str = ""
    stock_count: int = 0
    auto_update: bool = True
    update_mode: str = "replace"
    last_update: str | None = None


class SectorStockResponse(BaseModel):
    """板块成份股单行。"""

    stock_code: str
    stock_name: str = ""
    added_at: str = ""
    score: float = 0.0


class SectorRefreshResponse(BaseModel):
    """``POST /api/sectors/{code}/refresh`` 响应。"""

    ok: bool = True
    code: str
    count: int = 0
    message: str = ""


# ============================================================================
# 信号
# ============================================================================


class SignalEventResponse(BaseModel):
    """``GET /api/signals`` 单条信号。

    R7-A 增强:
    - ``snapshot``: 触发时行情快照 JSON (来自 signal_events.snapshot 列)
    - ``severity``: 信号严重度 (info / warn / error)
    """

    id: str
    time: str
    type: str  # limit_up | drop_alert | breakout | selection | system
    strategy_id: str | None = None
    strategy_name: str | None = None
    stock_code: str | None = None
    stock_name: str | None = None
    content: str = ""
    pushed_channels: list[str] = Field(default_factory=list)
    push_status: str = "pending"  # success | partial | failed | pending
    snapshot: dict[str, Any] | None = None
    severity: str = "info"


class SignalStatsItem(BaseModel):
    """``GET /api/signals/stats`` 单条统计。"""

    type: str
    count: int = 0
    last_time: str | None = None


class SignalStatsResponse(BaseModel):
    """``GET /api/signals/stats`` 响应。"""

    total: int = 0
    by_type: list[SignalStatsItem] = Field(default_factory=list)


# ============================================================================
# 配置管理
# ============================================================================


class StrategyConfigFileItem(BaseModel):
    """``GET /api/config/strategies`` 单条。"""

    strategy_id: str
    strategy_name: str = ""
    enabled: bool = True
    yaml_path: str = ""
    yaml_content: str = ""


class StrategyConfigUpdateRequest(BaseModel):
    """``PUT /api/config/strategies/{id}`` 入参。"""

    yaml_content: str = Field(..., description="完整的策略 YAML 文本")
    enabled: bool | None = None


class ConfigReloadResponse(BaseModel):
    """``POST /api/config/reload`` 响应。"""

    ok: bool = True
    reloaded: list[str] = Field(default_factory=list)
    strategies_count: int = 0
    message: str = ""
