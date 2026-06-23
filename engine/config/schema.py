"""配置 Schema 定义（dataclass 版）。

所有 YAML 配置在加载后都会被解析为对应 dataclass 实例，提供：
1. 类型注解（IDE 友好，类型检查）
2. 默认值（缺字段不报错）
3. 校验方法 ``validate()`` 检查关键字段合法性

使用 dataclass 而非 pydantic 是为了零依赖 + Python 3.13 原生支持。
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


# ----------------------------------------------------------------------------
# 子结构
# ----------------------------------------------------------------------------


@dataclass
class AppConfig:
    """``config/app.yaml`` 中 ``app`` 段。"""

    name: str = "TdxQuant Engine"
    version: str = "1.0"
    adapter_mode: str = "mock"  # mock | real
    log_level: str = "INFO"

    def validate(self) -> None:
        """校验关键字段。"""
        if self.adapter_mode not in ("mock", "real"):
            raise ValueError(
                f"app.adapter_mode 必须为 mock/real，当前: {self.adapter_mode!r}"
            )
        if self.log_level not in (
            "DEBUG",
            "INFO",
            "WARNING",
            "ERROR",
            "CRITICAL",
        ):
            raise ValueError(f"app.log_level 非法: {self.log_level!r}")


@dataclass
class ServerConfig:
    """``config/app.yaml`` 中 ``server`` 段。"""

    host: str = "0.0.0.0"
    port: int = 8000

    def validate(self) -> None:
        if not (1 <= self.port <= 65535):
            raise ValueError(f"server.port 越界: {self.port}")


@dataclass
class PathsConfig:
    """``config/app.yaml`` 中 ``paths`` 段。所有相对路径以项目根为基准。"""

    duckdb: str = "./data/duckdb/quant.db"
    csv_output: str = "./data/csv"
    excel_output: str = "./data/excel"
    logs: str = "./data/logs"
    strategies_dir: str = "./strategies"
    # Task 2-b: 合并 monitor_rules.yaml + match_strategies.yaml → monitor.yaml
    # 监控配置统一入口：monitor / alert_templates / dedup / match_strategies 4 段
    monitor: str = "./config/monitor.yaml"
    channels: str = "./config/channels.yaml"


@dataclass
class TqCenterConfig:
    """``config/app.yaml`` 中 ``tqcenter`` 段（Real 模式专用）。"""

    # tqcenter.py 所在目录（Windows: K:\txdlianghua\PYPlugins\user）
    # 留空则自动扫描通达信常见安装路径，或读环境变量 TQ_CENTER_PATH
    python_path: str = ""
    # tq.initialize(path) 入参，传 "__file__" 占位符时代码自动用 python_path/tqcenter.py
    # 也可直接配绝对路径，如 K:\txdlianghua\PYPlugins\user\tqcenter.py
    initialize_file: str = "__file__"
    subscribe_batch_size: int = 50
    kline_max_count: int = 24000
    # R14-2: 适配器层令牌桶（保护终端 GUI 线程，Real 模式生效）
    # 默认 0 表示禁用；显式配 > 0 才启用
    global_qps: float = 0.0
    burst: int = 0
    acquire_timeout: float = 0.0
    # R17: 字段配置（权威来源 engine/data_adapter/tqcenter_fields.py）
    # 子键: v8_snapshot_source_api / v8_snapshot_field_list / kline_field_list /
    #        snapshot_field_list / financial_fn_fields
    # 留空 list 表示对应 API 用 field_list=[] 返回全部字段
    fields: dict[str, Any] = field(default_factory=dict)

    def validate(self) -> None:
        if self.subscribe_batch_size <= 0:
            raise ValueError("tqcenter.subscribe_batch_size 必须 > 0")
        if self.kline_max_count <= 0:
            raise ValueError("tqcenter.kline_max_count 必须 > 0")
        # 限流参数：要么全 0（禁用），要么全 > 0（启用）
        cfg_vals = (self.global_qps, self.burst, self.acquire_timeout)
        if all(v > 0 for v in cfg_vals):
            return
        if all(v == 0 for v in cfg_vals):
            return
        raise ValueError(
            f"tqcenter 限流配置需全 > 0 或全 0（禁用），当前: "
            f"global_qps={self.global_qps}, burst={self.burst}, "
            f"acquire_timeout={self.acquire_timeout}"
        )


@dataclass
class MockConfig:
    """``config/app.yaml`` 中 ``mock`` 段（Mock 模式专用）。"""

    data_dir: str = "./data/v8-samples/data"
    push_interval: int = 3  # Mock subscribe_hq 模拟推送间隔（秒）


# ----------------------------------------------------------------------------
# R14-2: API 限流配置
# ----------------------------------------------------------------------------


@dataclass
class ApiRateLimitRule:
    """单条端点限流规则。"""

    path_prefix: str = ""
    qpm: int = 60
    methods: list[str] = field(default_factory=list)  # 空列表表示不限方法


@dataclass
class ApiRateLimitConfig:
    """``config/app.yaml`` 中 ``api.rate_limit`` 段。"""

    enabled: bool = False
    rules: list[ApiRateLimitRule] = field(default_factory=list)
    default_qpm: int = 60
    cleanup_interval: int = 300  # 后台清理线程周期（秒）


@dataclass
class ApiConfig:
    """``config/app.yaml`` 中 ``api`` 段。"""

    rate_limit: ApiRateLimitConfig = field(default_factory=ApiRateLimitConfig)


@dataclass
class ChannelItem:
    """单条推送通道配置。"""

    channel_id: str
    enabled: bool = True
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class ChannelConfig:
    """``config/channels.yaml`` 的根结构（预留，P1-3 不强制创建文件）。"""

    channels: list[ChannelItem] = field(default_factory=list)


@dataclass
class StrategySectorConfig:
    """策略 YAML 中 ``sector`` 段。"""

    code: str = ""
    name: str = ""
    auto_update: bool = True
    update_mode: str = "replace"  # replace | append

    def validate(self) -> None:
        if self.update_mode not in ("replace", "append"):
            raise ValueError(
                f"sector.update_mode 必须为 replace/append，当前: {self.update_mode!r}"
            )


@dataclass
class StrategyFactorItem:
    """策略 YAML 中单条 ``factors`` 项。"""

    factor_id: str = ""
    weight: float = 1.0
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class StrategyScoringConfig:
    """策略 YAML 中 ``scoring`` 段。"""

    formula: str = "sum(factor_score * weight)"
    normalization: str = "rank_percentile"  # rank_percentile | zscore | minmax
    penalties: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class StrategyMonitorConfig:
    """策略 YAML 中 ``monitor`` 段。"""

    enabled: bool = False
    subscribe_hq: bool = False
    batch_size: int = 50
    alert_conditions: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class StrategyConfig:
    """策略 YAML 完整结构。"""

    strategy_id: str = ""
    strategy_name: str = ""
    strategy_emoji: str = ""
    version: str = "1.0"
    enabled: bool = True
    sector: StrategySectorConfig = field(default_factory=StrategySectorConfig)
    universe: dict[str, Any] = field(default_factory=dict)
    cleaning: dict[str, Any] = field(default_factory=dict)
    factors: list[StrategyFactorItem] = field(default_factory=list)
    scoring: StrategyScoringConfig = field(default_factory=StrategyScoringConfig)
    output: dict[str, Any] = field(default_factory=dict)
    monitor: StrategyMonitorConfig = field(default_factory=StrategyMonitorConfig)
    export: dict[str, Any] = field(default_factory=dict)
    yaml_path: str = ""  # 由 loader 注入

    def validate(self) -> None:
        """关键字段校验。"""
        if not self.strategy_id:
            raise ValueError("strategy_id 不能为空")
        if not self.strategy_name:
            raise ValueError("strategy_name 不能为空")
        self.sector.validate()
        # 因子权重总和应该 > 0
        if self.factors:
            total = sum(f.weight for f in self.factors)
            if total <= 0:
                raise ValueError(f"策略 {self.strategy_id} 因子权重之和必须 > 0")

    def to_dict(self) -> dict[str, Any]:
        """转 dict（用于持久化/JSON 序列化）。"""
        return asdict(self)


# ----------------------------------------------------------------------------
# 顶层组合
# ----------------------------------------------------------------------------


@dataclass
class AppConfigRoot:
    """``config/app.yaml`` 完整结构。"""

    app: AppConfig = field(default_factory=AppConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    paths: PathsConfig = field(default_factory=PathsConfig)
    tqcenter: TqCenterConfig = field(default_factory=TqCenterConfig)
    api: ApiConfig = field(default_factory=ApiConfig)
    mock: MockConfig = field(default_factory=MockConfig)

    def validate(self) -> None:
        self.app.validate()
        self.server.validate()
        self.tqcenter.validate()

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AppConfigRoot":
        """从原始 dict 构造，缺失字段走默认值。"""
        # R14-2: api.rate_limit.rules 需要逐项解析为 ApiRateLimitRule
        api_raw = data.get("api") or {}
        rl_raw = api_raw.get("rate_limit") or {}
        rules_raw = rl_raw.get("rules") or []
        rules = [
            ApiRateLimitRule(
                path_prefix=str(r.get("path_prefix", "")),
                qpm=int(r.get("qpm", 60)),
                methods=list(r.get("methods") or []),
            )
            for r in rules_raw
            if isinstance(r, dict)
        ]
        rl = ApiRateLimitConfig(
            enabled=bool(rl_raw.get("enabled", False)),
            rules=rules,
            default_qpm=int(rl_raw.get("default_qpm", 60)),
            cleanup_interval=int(rl_raw.get("cleanup_interval", 300)),
        )
        api_cfg = ApiConfig(rate_limit=rl)
        return cls(
            app=AppConfig(**(data.get("app") or {})),
            server=ServerConfig(**(data.get("server") or {})),
            paths=PathsConfig(**(data.get("paths") or {})),
            tqcenter=TqCenterConfig(**(data.get("tqcenter") or {})),
            api=api_cfg,
            mock=MockConfig(**(data.get("mock") or {})),
        )


@dataclass
class ThemeConfig:
    """``config/theme.yaml`` 完整结构。"""

    mode: str = "dark"
    primary_color: str = "#f59e0b"
    up_color: str = "#ef4444"
    down_color: str = "#22c55e"
    flat_color: str = "#6b7280"
    background: str = "#0a0a0a"
    card_background: str = "#171717"
    border_color: str = "#262626"
    font_family: str = "ui-sans-serif, system-ui"

    def validate(self) -> None:
        if self.mode not in ("dark", "light"):
            raise ValueError(f"theme.mode 必须为 dark/light，当前: {self.mode!r}")

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ThemeConfig":
        """从原始 dict 构造。"""
        return cls(**(data.get("theme") or {}))
