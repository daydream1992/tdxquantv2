"""存储层统一入口。

R18 起 DuckDB 单文件存储已替换为 QuestDB（服务端架构，彻底无文件锁）。

- ``QuestDBStore`` 是新存储后端，接口与旧 ``DuckDBStore`` 完全一致
- ``DuckDBStore`` 保留为 ``QuestDBStore`` 的别名，旧代码零改动迁移
- ``get_store()`` 便捷获取单例
"""

from engine.storage.questdb_store import QuestDBStore, get_store

# 向后兼容别名：旧代码 `from engine.storage.duckdb_store import DuckDBStore` 仍可用
DuckDBStore = QuestDBStore

__all__ = ["QuestDBStore", "DuckDBStore", "get_store"]
