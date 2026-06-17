#!/usr/bin/env python3
"""初始化 DuckDB 数据库（建表）。

用法
----
    python scripts/init_db.py                # 建表 + 显示表清单
    python scripts/init_db.py --reset        # 危险：DROP 全部表后重建（开发用）
    python scripts/init_db.py --json         # JSON 输出

幂等：``config/duckdb_schema.sql`` 中所有 ``CREATE TABLE`` 都是 ``IF NOT EXISTS``。
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
    parser = argparse.ArgumentParser(description="初始化 DuckDB 数据库")
    parser.add_argument("--reset", action="store_true", help="危险：DROP 全部表后重建（开发用）")
    parser.add_argument("--json", action="store_true", help="JSON 输出")
    args = parser.parse_args()

    try:
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

    # 建表
    store.init_db()

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
            "db_path": str(store._db_path),
            "tables": tables,
            "row_counts": table_counts,
        }, ensure_ascii=False, indent=2))
        return

    print("DuckDB 初始化完成")
    print(f"  路径: {store._db_path}")
    print(f"  表清单（共 {len(tables)} 张）:")
    for t in tables:
        cnt = table_counts.get(t, 0)
        print(f"    - {t}  ({cnt} 行)")


if __name__ == "__main__":
    main()
