"""DuckDB 存储层封装。

提供：
1. 单例风格的 ``DuckDBStore``（一个进程一个 db 文件，连接复用）
2. ``init_db()`` 从 ``config/duckdb_schema.sql`` 创建 8 张表
3. ``execute(sql, params)`` 写入 / ``query(sql)`` 返回 DataFrame
4. 线程安全的连接（DuckDB Python API 默认线程不安全，需 ``check_same_thread=False`` + 外部锁）
5. 上下文管理器 ``with DuckDBStore() as store: ...``

路径来自 ``config/app.yaml`` 的 ``paths.duckdb``，schema 文件来自
``config/duckdb_schema.sql``。
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import duckdb
import pandas as pd

from engine.config.loader import ConfigLoader

logger = logging.getLogger(__name__)


class DuckDBStore:
    """DuckDB 单文件存储封装。

    所有 SQL 操作通过本类统一入口，便于：
    - 加锁 / 重试 / 日志
    - 后续切换到其他后端（如 SQLite）
    - 在测试中替换为内存 DB
    """

    _instance: "DuckDBStore | None" = None
    _instance_lock = threading.Lock()

    def __new__(cls, *args: Any, **kwargs: Any) -> "DuckDBStore":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(
        self,
        db_path: str | os.PathLike | None = None,
        schema_path: str | os.PathLike | None = None,
        *,
        read_only: bool = False,
        auto_init: bool = True,
    ) -> None:
        if getattr(self, "_initialized", False):
            return
        self._initialized = True

        cfg = ConfigLoader()
        # DB 路径优先参数，其次配置
        if db_path is None:
            db_path = cfg.get("paths.duckdb", "./data/duckdb/quant.db")
        self._db_path = self._resolve_path(str(db_path))
        self._db_path.parent.mkdir(parents=True, exist_ok=True)

        # Schema 路径
        if schema_path is None:
            schema_path = self._resolve_path("./config/duckdb_schema.sql")
        self._schema_path = Path(schema_path)

        self._read_only = read_only
        self._lock = threading.RLock()
        self._conn: duckdb.DuckDBPyConnection | None = None
        self._connect()

        if auto_init and not read_only:
            self.init_db()

    # ------------------------------------------------------------------
    # 连接管理
    # ------------------------------------------------------------------

    def _connect(self) -> None:
        """打开 DB 连接。"""
        # DuckDB Python 连接默认线程安全（ConcurrentRead / 串行 Write），但为
        # 简化 P1 阶段语义，本类用 ``self._lock`` 把所有访问串行化，避免误用。
        try:
            self._conn = duckdb.connect(
                str(self._db_path),
                read_only=self._read_only,
            )
            logger.info("DuckDB 已连接: %s (read_only=%s)", self._db_path, self._read_only)
        except Exception as exc:  # noqa: BLE001
            logger.error("DuckDB 连接失败 %s: %s", self._db_path, exc)
            raise

    def close(self) -> None:
        """关闭连接。"""
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                except Exception as exc:  # noqa: BLE001
                    logger.warning("DuckDB 关闭异常: %s", exc)
                self._conn = None

    def reconnect(self) -> None:
        """重连。"""
        self.close()
        self._connect()

    @property
    def connection(self) -> duckdb.DuckDBPyConnection:
        """底层 DuckDB 连接（用于高级用法）。"""
        if self._conn is None:
            raise RuntimeError("DuckDB 连接已关闭")
        return self._conn

    # ------------------------------------------------------------------
    # Schema 初始化
    # ------------------------------------------------------------------

    def init_db(self) -> None:
        """从 ``config/duckdb_schema.sql`` 创建全部 8 张表。

        幂等：SQL 中所有 ``CREATE TABLE`` 都是 ``IF NOT EXISTS``。

        实现：DuckDB Python ``execute()`` 支持一次性执行多语句 SQL（以 ``;`` 分隔），
        因此直接读取整个 SQL 文件一次性执行。失败时再回退到按语句拆分以定位。
        """
        if not self._schema_path.exists():
            logger.warning("Schema 文件不存在: %s", self._schema_path)
            return
        sql_text = self._schema_path.read_text(encoding="utf-8")
        with self._lock:
            try:
                self._conn.execute(sql_text)
                logger.info("DuckDB schema 初始化完成: %s", self._schema_path.name)
            except Exception as exc:  # noqa: BLE001
                # 回退到按语句拆分以便定位失败语句
                logger.warning("整体执行失败，回退到按语句拆分: %s", exc)
                statements = [s.strip() for s in sql_text.split(";") if s.strip()]
                for stmt in statements:
                    if not stmt or stmt.startswith("--"):
                        # 跳过纯注释块（多行注释开头）
                        if stmt.startswith("--") and "CREATE" not in stmt:
                            continue
                    try:
                        self._conn.execute(stmt)
                    except Exception as exc2:  # noqa: BLE001
                        logger.error(
                            "Schema 语句执行失败: %s\nSQL: %s", exc2, stmt[:200]
                        )
                        raise

    # ------------------------------------------------------------------
    # 执行 / 查询
    # ------------------------------------------------------------------

    def execute(self, sql: str, params: tuple | list | dict | None = None) -> int:
        """执行写操作（INSERT/UPDATE/DELETE/DDL）。

        Args:
            sql: SQL 语句，支持 ``?`` / ``$name`` 占位符。
            params: 参数。

        Returns:
            受影响行数（DuckDB 不直接返回，固定返回 ``-1`` 表示未知；如需精确数请用
            ``query("SELECT COUNT(*) ...")`` 或 ``RETURNING`` 子句）。
        """
        with self._lock:
            try:
                if params is not None:
                    self._conn.execute(sql, params)
                else:
                    self._conn.execute(sql)
                # DuckDB Python 不返回受影响行数（rowcount 始终为 -1），统一返回 -1
                return -1
            except Exception as exc:  # noqa: BLE001
                logger.error("execute 失败: %s\nSQL: %s\nparams: %s", exc, sql[:200], params)
                raise

    def executemany(self, sql: str, params_list: list[tuple | list | dict]) -> int:
        """批量执行（用于 INSERT 多行）。

        Returns:
            受影响行数（固定 ``-1``，DuckDB 不直接返回）。
        """
        with self._lock:
            try:
                self._conn.executemany(sql, params_list)
                return -1
            except Exception as exc:  # noqa: BLE001
                logger.error("executemany 失败: %s\nSQL: %s", exc, sql[:200])
                raise

    def query(self, sql: str, params: tuple | list | dict | None = None) -> pd.DataFrame:
        """查询并返回 DataFrame。

        Args:
            sql: SELECT 语句。
            params: 参数。

        Returns:
            ``pd.DataFrame``，空结果也有正确列名。
        """
        with self._lock:
            try:
                if params is not None:
                    cur = self._conn.execute(sql, params)
                else:
                    cur = self._conn.execute(sql)
                return cur.df()
            except Exception as exc:  # noqa: BLE001
                logger.error("query 失败: %s\nSQL: %s\nparams: %s", exc, sql[:200], params)
                raise

    def fetchone(self, sql: str, params: tuple | list | dict | None = None) -> tuple | None:
        """查询单行。"""
        with self._lock:
            try:
                if params is not None:
                    cur = self._conn.execute(sql, params)
                else:
                    cur = self._conn.execute(sql)
                return cur.fetchone()
            except Exception as exc:  # noqa: BLE001
                logger.error("fetchone 失败: %s\nSQL: %s", exc, sql[:200])
                raise

    def fetchall(self, sql: str, params: tuple | list | dict | None = None) -> list[tuple]:
        """查询所有行（list of tuple）。"""
        with self._lock:
            try:
                if params is not None:
                    cur = self._conn.execute(sql, params)
                else:
                    cur = self._conn.execute(sql)
                return cur.fetchall()
            except Exception as exc:  # noqa: BLE001
                logger.error("fetchall 失败: %s\nSQL: %s", exc, sql[:200])
                raise

    # ------------------------------------------------------------------
    # 事务
    # ------------------------------------------------------------------

    @contextmanager
    def transaction(self) -> Iterator["DuckDBStore"]:
        """事务上下文管理器。

        用法：
            >>> with store.transaction() as s:
            ...     s.execute("INSERT ...", ...)
            ...     s.execute("UPDATE ...", ...)
            # 自动 commit / 异常时 rollback
        """
        with self._lock:
            self._conn.execute("BEGIN TRANSACTION")
            try:
                yield self
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    # ------------------------------------------------------------------
    # 工具
    # ------------------------------------------------------------------

    def table_exists(self, table_name: str) -> bool:
        """表是否存在。"""
        row = self.fetchone(
            "SELECT count(*) FROM information_schema.tables WHERE table_name = ?",
            (table_name.lower(),),
        )
        return bool(row and row[0] > 0)

    def list_tables(self) -> list[str]:
        """列出所有表。"""
        rows = self.fetchall(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
        )
        return [r[0] for r in rows]

    # ------------------------------------------------------------------
    # 上下文管理协议
    # ------------------------------------------------------------------

    def __enter__(self) -> "DuckDBStore":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        # 单例不真正关闭，由进程退出时清理
        pass

    def __repr__(self) -> str:
        return f"<DuckDBStore path={self._db_path} read_only={self._read_only}>"

    # ------------------------------------------------------------------
    # 路径解析
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_path(p: str) -> Path:
        """配置中的相对路径解析为项目根绝对路径。"""
        path = Path(p)
        if path.is_absolute():
            return path
        root = Path(__file__).resolve().parent.parent.parent
        return root / path

    # ------------------------------------------------------------------
    # 测试用：重置单例
    # ------------------------------------------------------------------

    @classmethod
    def _reset_singleton(cls) -> None:
        """仅用于测试：销毁单例。"""
        with cls._instance_lock:
            if cls._instance is not None:
                cls._instance.close()
                cls._instance = None
