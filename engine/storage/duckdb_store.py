"""DuckDB 存储层（已弃用，保留兼容）。

R18 起 DuckDB 单文件存储已替换为 QuestDB（服务端架构，彻底无文件锁）。
本模块仅保留 ``DuckDBStore`` 名字作为 ``QuestDBStore`` 的别名，
让所有旧代码 ``from engine.storage.duckdb_store import DuckDBStore`` 零改动迁移。

迁移指南
========

1. **推荐**：新代码直接用 ``from engine.storage import QuestDBStore, get_store``
2. **兼容**：旧代码无需改动，``DuckDBStore`` 自动指向 ``QuestDBStore``
3. **SQL 适配**：
   - ``?`` 占位符 → QuestDBStore 内部自动转换为 ``$1, $2, ...``
   - ``SEQUENCE + nextval()`` → 用 ``QuestDBStore._gen_id()`` 应用层生成 ID
   - ``UNIQUE INDEX`` → 用 ``QuestDBStore.upsert(table, conflict_keys, data)``
4. **配置**：``config/app.yaml`` 加 ``questdb`` 段（host/port/username/password）
5. **启动 QuestDB**：``docker compose -f docker/questdb/docker-compose.yml up -d``
"""

from engine.storage.questdb_store import QuestDBStore

# 向后兼容别名
DuckDBStore = QuestDBStore

__all__ = ["DuckDBStore", "QuestDBStore"]
