"""TdxQuant 量化交易系统 - Python 引擎包。

本包按 5 层架构组织：
- L1 基础设施: ``engine.config`` / ``engine.data_adapter`` / ``engine.storage``
- L2 核心引擎: ``engine.pipeline`` / ``engine.monitor`` / ``engine.messaging`` / ``engine.sector``
- L3 组件抽象: ``engine.factors`` / ``engine.exporters`` / ``engine.channels``
- L4 业务规则: ``engine.expression``
- L5 用户配置: ``strategies/*.yaml`` / ``config/*.yaml``

P1-4 子任务负责 L3 因子插件、L3 导出器插件、L2 选股流水线。
"""
__version__ = "0.4.0"
