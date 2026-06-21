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
    # bug #15: 原未显式声明，走默认值。现补齐 3 个 YAML 配置路径
    monitor_rules: str = "./config/monitor_rules.yaml"
    match_strategies: str = "./config/match_strategies.yaml"
    channels: str = "./config/channels.yaml"


@dataclass
class TqCenterConfig:
    """``config/app.yaml`` 中 ``tqcenter`` 段（Real 模式专用）。"""

    initialize_file: str = "__file__"
    subscribe_batch_size: int = 50
    kline_max_count: int = 24000

    def validate(self) -> None:
        if self.subscribe_batch_size <= 0:
            raise ValueError("tqcenter.subscribe_batch_size 必须 > 0")
        if self.kline_max_count <= 0:
            raise ValueError("tqcenter.kline_max_count 必须 > 0")


@dataclass
class MockConfig:
    """``config/app.yaml`` 中 ``mock`` 段（Mock 模式专用）。"""

    data_dir: str = "./docs/v8-data/stock_selection_v8_1_standalone/data"
    push_interval: int = 3  # Mock subscribe_hq 模拟推送间隔（秒）


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
    mock: MockConfig = field(default_factory=MockConfig)

    def validate(self) -> None:
        self.app.validate()
        self.server.validate()
        self.tqcenter.validate()

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AppConfigRoot":
        """从原始 dict 构造，缺失字段走默认值。"""
        return cls(
            app=AppConfig(**(data.get("app") or {})),
            server=ServerConfig(**(data.get("server") or {})),
            paths=PathsConfig(**(data.get("paths") or {})),
            tqcenter=TqCenterConfig(**(data.get("tqcenter") or {})),
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
