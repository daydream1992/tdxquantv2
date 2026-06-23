#!/usr/bin/env python3
"""初始化 QuestDB 数据库（建表）。

R18 起 DuckDB 已替换为 QuestDB（服务端架构，无文件锁）。
``DuckDBStore`` 名字保留为 ``QuestDBStore`` 别名，调用方零改动。

用法
----
    python scripts/init_db.py                # 建表 + 显示表清单
    python scripts/init_db.py --reset        # 危险：DROP 全部表后重建（开发用）
    python scripts/init_db.py --json         # JSON 输出

幂等：``config/questdb_schema.sql`` 中所有 ``CREATE TABLE`` 都是 ``IF NOT EXISTS``。

沙箱降级
--------
无 QuestDB 服务（沙箱/mock 模式）时，``DuckDBStore()`` 内部 ``_connect()`` 失败
仅记警告，``init_db()`` 跳过；mock 模式不依赖 DB 仍可运行。

启动 QuestDB
------------

见 ``docker/questdb/docker-compose.yml``::

    docker compose -f docker/questdb/docker-compose.yml up -d

或 Windows::

    questdb.exe start -d K:\\questdb\\data

Web 控制台: http://127.0.0.1:9000
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(description="初始化 QuestDB 数据库")
    parser.add_argument("--reset", action="store_true", help="危险：DROP 全部表后重建（开发用）")
    parser.add_argument("--json", action="store_true", help="JSON 输出")
    args = parser.parse_args()

    try:
        # DuckDBStore 名字保留兼容，实际指向 QuestDBStore（见 engine/storage/__init__.py）
        from engine.storage.duckdb_store import DuckDBStore
        from engine.utils.logger import setup_logging
    except ImportError as exc:
        print(f"[ERROR] 导入引擎失败: {exc}", file=sys.stderr)
        sys.exit(1)

    setup_logging(level="INFO")
    store = DuckDBStore()

    # 危险操作：先 DROP
    if args.reset:
        existing = store.list_tables()
        if existing:
            if not args.json:
                print(f"[WARN] --reset 模式：将 DROP {len(existing)} 张表: {existing}")
            for t in existing:
                try:
                    store.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
                except Exception as exc:  # noqa: BLE001
                    print(f"  DROP {t} 失败: {exc}", file=sys.stderr)

    # 建表（QuestDBStore.init_db 读 config/questdb_schema.sql）
    store.init_db()

    # QuestDB 不可用时（沙箱/mock 模式）优雅降级
    is_available = getattr(store, "is_available", False) or getattr(store, "_available", False)
    if not is_available:
        msg = (
            "QuestDB 不可用（沙箱/mock 模式或服务未启动），跳过建表。\n"
            "  - mock 模式不依赖 DB，可正常运行。\n"
            "  - real 模式请启动 QuestDB: docker compose -f docker/questdb/docker-compose.yml up -d\n"
            "  - 配置见 config/app.yaml 的 questdb 段（host/pg_port/http_port）"
        )
        if args.json:
            print(json.dumps({
                "ok": False,
                "available": False,
                "message": msg,
            }, ensure_ascii=False, indent=2))
        else:
            print("[WARN] " + msg.replace("\n", "\n         "))
        return

    tables = store.list_tables()
    table_counts: dict[str, int] = {}
    for t in tables:
        try:
            row = store.fetchone(f"SELECT COUNT(*) FROM {t}")
            table_counts[t] = int(row[0]) if row else 0
        except Exception as exc:  # noqa: BLE001
            table_counts[t] = -1

    if args.json:
        print(json.dumps({
            "ok": True,
            "available": True,
            "host": getattr(store, "_host", "127.0.0.1"),
            "pg_port": getattr(store, "_pg_port", 8812),
            "tables": tables,
            "row_counts": table_counts,
        }, ensure_ascii=False, indent=2))
        return

    print("QuestDB 初始化完成")
    print(f"  连接: {getattr(store, '_host', '127.0.0.1')}:{getattr(store, '_pg_port', 8812)}")
    print(f"  Schema: {getattr(store, '_schema_path', 'config/questdb_schema.sql')}")
    print(f"  表清单（共 {len(tables)} 张）:")
    for t in tables:
        cnt = table_counts.get(t, 0)
        print(f"    - {t}  ({cnt} 行)")


if __name__ == "__main__":
    main()
