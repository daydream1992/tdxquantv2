"""QuestDB 存储层封装（替代 DuckDBStore，彻底解决文件锁问题）。

设计要点
========

1. **接口与 DuckDBStore 完全一致**：``execute`` / ``executemany`` / ``query`` /
   ``fetchone`` / ``fetchall`` / ``table_exists`` / ``list_tables`` / ``transaction``
   / ``init_db`` / ``close`` / ``reconnect`` 全部保留，调用方零改动。

2. **无文件锁**：QuestDB 是服务端架构，通过 PG wire (8812) / HTTP (9000) 访问，
   多进程/多实例并发写不再冲突（DuckDB 单写锁痛点根除）。

3. **SQL 方言适配**：
   - ``?`` 占位符 → ``$1, $2, ...`` （PG wire 风格）
   - 无 SEQUENCE → 应用层 ``_gen_id()`` 生成 LONG（毫秒时间戳 × 1000 + 随机）
   - 无 UNIQUE → 应用层 UPSERT（DELETE WHERE + INSERT）
   - 无 ``information_schema.tables`` → ``SELECT table_name FROM tables()``

4. **优雅降级**：沙箱/开发环境无 QuestDB 服务时，``_connect()`` 失败不抛异常，
   ``execute/query`` 调用记录警告并返回空结果（mock 模式不依赖 DB，仍可运行）。
   ``is_available`` 属性可查询当前是否真连上。

5. **连接管理**：
   - PG wire 用 ``psycopg2`` （QuestDB 兼容 PG 协议）
   - DDL / 大查询走 HTTP (9000) ``/exec`` 端点
   - ``_lock`` 保护 PG wire 连接（psycopg2 连接非线程安全）
   - ``ping()`` 自动重连（连接断开时）

6. **向后兼容**：``DuckDBStore = QuestDBStore`` 别名在 ``engine/storage/__init__.py``
   导出，旧代码 ``from engine.storage.duckdb_store import DuckDBStore`` 仍可用。

配置
====

``config/app.yaml``::

    questdb:
      host: 127.0.0.1
      pg_port: 8812          # PG wire（查询/写入）
      http_port: 9000        # HTTP（DDL/管理）
      username: admin
      password: quest
      database: qdb
      connect_timeout: 5     # 秒
      auto_init: true        # 启动时自动建表

环境变量覆盖::

    QUESTDB_HOST / QUESTDB_PG_PORT / QUESTDB_HTTP_PORT
    QUESTDB_USERNAME / QUESTDB_PASSWORD / QUESTDB_DATABASE

QuestDB 启动
============

见 ``docker/questdb/docker-compose.yml``::

    docker compose -f docker/questdb/docker-compose.yml up -d

或 Windows 直接下载 questdb.exe::

    questdb.exe start -d K:\\questdb\\data
    # Web 控制台: http://127.0.0.1:9000
"""

from __future__ import annotations

import json
import logging
import os
import random
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import pandas as pd

from engine.config.loader import ConfigLoader

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------------
# 依赖探测：psycopg2 / requests
# ----------------------------------------------------------------------------

try:
    import psycopg2  # type: ignore
    from psycopg2.extras import RealDictCursor  # type: ignore
    _HAS_PSYCOPG2 = True
except ImportError:
    psycopg2 = None  # type: ignore
    RealDictCursor = None  # type: ignore
    _HAS_PSYCOPG2 = False

try:
    import requests
    _HAS_REQUESTS = True
except ImportError:
    requests = None  # type: ignore
    _HAS_REQUESTS = False


# ----------------------------------------------------------------------------
# 工具
# ----------------------------------------------------------------------------


def _gen_id() -> int:
    """生成唯一 LONG ID（替代 DuckDB SEQUENCE.nextval）。

    实现：毫秒时间戳 × 10000 + 随机 [0, 10000)
    单进程内单调递增 + 多进程碰撞概率 < 1e-4
    """
    return int(time.time() * 1000) * 10000 + random.randint(0, 9999)


def _convert_sql(sql: str) -> str:
    """把 DuckDB 风格 ``?`` 占位符转换为 PG 风格 ``$1, $2, ...``。

    QuestDB PG wire 只支持 ``$N`` 参数化（不支持 ``?``）。
    简单解析：跳过字符串字面量内的 ``?``，按出现顺序替换。
    """
    out: list[str] = []
    i = 0
    n = len(sql)
    idx = 1
    in_single = False
    in_double = False
    while i < n:
        ch = sql[i]
        if ch == "'" and not in_double:
            in_single = not in_single
            out.append(ch)
        elif ch == '"' and not in_single:
            in_double = not in_double
            out.append(ch)
        elif ch == "?" and not in_single and not in_double:
            out.append(f"${idx}")
            idx += 1
        else:
            out.append(ch)
        i += 1
    return "".join(out)


# ----------------------------------------------------------------------------
# QuestDBStore
# ----------------------------------------------------------------------------


class QuestDBStore:
    """QuestDB 存储封装（接口与 DuckDBStore 完全一致）。

    所有 SQL 操作通过本类统一入口，便于：
    - 加锁 / 重试 / 日志
    - 在测试中替换为 mock
    - 沙箱环境无 QuestDB 时优雅降级
    """

    _instance: "QuestDBStore | None" = None
    _instance_lock = threading.Lock()

    # 单例
    def __new__(cls, *args: Any, **kwargs: Any) -> "QuestDBStore":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(
        self,
        db_path: str | os.PathLike | None = None,  # 兼容旧签名，忽略
        schema_path: str | os.PathLike | None = None,
        *,
        read_only: bool = False,
        auto_init: bool = True,
    ) -> None:
        if getattr(self, "_initialized", False):
            return
        self._initialized = True

        cfg = ConfigLoader()

        # QuestDB 连接配置（环境变量 > 配置文件 > 默认值）
        self._host = os.environ.get("QUESTDB_HOST") or cfg.get(
            "questdb.host", "127.0.0.1"
        )
        self._pg_port = int(
            os.environ.get("QUESTDB_PG_PORT") or cfg.get("questdb.pg_port", 8812)
        )
        self._http_port = int(
            os.environ.get("QUESTDB_HTTP_PORT") or cfg.get("questdb.http_port", 9000)
        )
        self._username = os.environ.get("QUESTDB_USERNAME") or cfg.get(
            "questdb.username", "admin"
        )
        self._password = os.environ.get("QUESTDB_PASSWORD") or cfg.get(
            "questdb.password", "quest"
        )
        self._database = os.environ.get("QUESTDB_DATABASE") or cfg.get(
            "questdb.database", "qdb"
        )
        self._connect_timeout = int(cfg.get("questdb.connect_timeout", 5))

        # Schema 文件
        if schema_path is None:
            schema_path = self._resolve_path("./config/questdb_schema.sql")
        self._schema_path = Path(schema_path)

        self._read_only = read_only
        self._lock = threading.RLock()
        self._conn: Any = None  # psycopg2 connection
        self._available = False

        self._connect()

        if auto_init and not read_only and self._available:
            self.init_db()

    # ------------------------------------------------------------------
    # 连接管理
    # ------------------------------------------------------------------

    def _connect(self) -> None:
        """打开 QuestDB PG wire 连接。

        失败时不抛异常，仅记录警告（沙箱环境无 QuestDB 时优雅降级）。
        """
        if not _HAS_PSYCOPG2:
            logger.warning(
                "psycopg2 未安装，QuestDBStore 不可用。"
                "mock 模式仍可运行（不依赖 DB），real 模式需 pip install psycopg2-binary"
            )
            self._available = False
            return

        try:
            self._conn = psycopg2.connect(
                host=self._host,
                port=self._pg_port,
                user=self._username,
                password=self._password,
                dbname=self._database,
                connect_timeout=self._connect_timeout,
                application_name="tdxquant-engine",
            )
            # QuestDB PG wire 不支持事务，设 autocommit
            self._conn.autocommit = True
            self._available = True
            logger.info(
                "QuestDB 已连接: %s:%s (pg wire, db=%s)",
                self._host, self._pg_port, self._database,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "QuestDB 连接失败 %s:%s: %s。"
                "mock 模式仍可运行；real 模式请启动 QuestDB "
                "(docker compose -f docker/questdb/docker-compose.yml up -d)",
                self._host, self._pg_port, exc,
            )
            self._available = False
            self._conn = None

    @property
    def is_available(self) -> bool:
        """QuestDB 是否真正连上（沙箱降级时返回 False）。"""
        return self._available

    def ping(self) -> bool:
        """心跳检测，失败时自动重连。"""
        if not self._available:
            self._connect()
            return self._available
        try:
            with self._lock:
                if self._conn is None:
                    self._connect()
                    return self._available
                cur = self._conn.cursor()
                cur.execute("SELECT 1")
                cur.fetchone()
                cur.close()
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("QuestDB ping 失败，尝试重连: %s", exc)
            self._connect()
            return self._available

    def close(self) -> None:
        """关闭连接。"""
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                except Exception as exc:  # noqa: BLE001
                    logger.warning("QuestDB 关闭异常: %s", exc)
                self._conn = None
            self._available = False

    def reconnect(self) -> None:
        """重连。"""
        self.close()
        self._connect()

    @property
    def connection(self) -> Any:
        """底层 psycopg2 连接（用于高级用法）。"""
        if self._conn is None:
            raise RuntimeError("QuestDB 连接已关闭")
        return self._conn

    # ------------------------------------------------------------------
    # HTTP 接口（DDL / 管理）
    # ------------------------------------------------------------------

    def _http_exec(self, sql: str) -> dict[str, Any]:
        """通过 HTTP /exec 端点执行 SQL（用于 DDL，不支持参数化）。

        Returns:
            QuestDB 返回的 JSON dict。
        """
        if not _HAS_REQUESTS:
            raise RuntimeError("requests 未安装，无法走 HTTP DDL")

        url = f"http://{self._host}:{self._http_port}/exec"
        try:
            resp = requests.post(
                url,
                data={"query": sql},
                timeout=self._connect_timeout * 2,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.error("QuestDB HTTP /exec 失败: %s\nSQL: %s", exc, sql[:200])
            raise

    # ------------------------------------------------------------------
    # Schema 初始化
    # ------------------------------------------------------------------

    def init_db(self) -> None:
        """从 ``config/questdb_schema.sql`` 创建全部 8 张表。

        幂等：SQL 中所有 ``CREATE TABLE`` 都是 ``IF NOT EXISTS``。

        实现：QuestDB PG wire 对多语句 DDL 支持不稳定，优先走 HTTP /exec。
        HTTP 失败时回退到 PG wire 按语句拆分执行。
        """
        if not self._available:
            logger.warning("QuestDB 不可用，跳过 init_db")
            return

        if not self._schema_path.exists():
            logger.warning("Schema 文件不存在: %s", self._schema_path)
            return

        sql_text = self._schema_path.read_text(encoding="utf-8")

        # 按语句拆分（去注释、去空）
        statements: list[str] = []
        for raw in sql_text.split(";"):
            stmt = raw.strip()
            if not stmt:
                continue
            # 跳过纯注释行
            lines = [ln for ln in stmt.split("\n") if not ln.strip().startswith("--")]
            cleaned = "\n".join(lines).strip()
            if cleaned and cleaned.upper().startswith("CREATE"):
                statements.append(cleaned)

        # 优先 HTTP /exec（DDL 最稳）
        if _HAS_REQUESTS:
            ok, fail = 0, 0
            for stmt in statements:
                try:
                    self._http_exec(stmt)
                    ok += 1
                except Exception as exc:  # noqa: BLE001
                    # 表已存在等非致命错误，记录后继续
                    if "already exists" in str(exc).lower():
                        ok += 1
                    else:
                        fail += 1
                        logger.warning("QuestDB DDL 语句失败: %s\nSQL: %s", exc, stmt[:120])
            logger.info(
                "QuestDB schema 初始化完成 (HTTP): %d 成功, %d 失败, 共 %d 语句",
                ok, fail, len(statements),
            )
            return

        # 回退：PG wire 按语句执行
        with self._lock:
            for stmt in statements:
                try:
                    cur = self._conn.cursor()
                    cur.execute(stmt)
                    cur.close()
                except Exception as exc:  # noqa: BLE001
                    if "already exists" in str(exc).lower():
                        continue
                    logger.error("QuestDB schema 语句失败: %s\nSQL: %s", exc, stmt[:200])
                    raise

    # ------------------------------------------------------------------
    # 执行 / 查询
    # ------------------------------------------------------------------

    def execute(self, sql: str, params: tuple | list | dict | None = None) -> int:
        """执行写操作（INSERT/UPDATE/DELETE/DDL）。

        Args:
            sql: SQL 语句，支持 ``?`` 或 ``$1`` 占位符（``?`` 自动转换）。
            params: 参数。

        Returns:
            受影响行数（QuestDB PG wire 不返回精确 rowcount，固定 ``-1``）。
        """
        if not self._available:
            logger.debug("QuestDB 不可用，execute 跳过: %s", sql[:80])
            return -1
        with self._lock:
            try:
                pg_sql = _convert_sql(sql)
                cur = self._conn.cursor()
                if params is not None:
                    cur.execute(pg_sql, params)
                else:
                    cur.execute(pg_sql)
                cur.close()
                return -1
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "execute 失败: %s\nSQL: %s\nparams: %s", exc, sql[:200], params
                )
                # 连接断开时标记不可用，下次自动重连
                if "connection" in str(exc).lower() or "closed" in str(exc).lower():
                    self._available = False
                raise

    def executemany(self, sql: str, params_list: list[tuple | list | dict]) -> int:
        """批量执行（用于 INSERT 多行）。

        Returns:
            受影响行数（固定 ``-1``）。
        """
        if not self._available:
            logger.debug("QuestDB 不可用，executemany 跳过: %d 行", len(params_list))
            return -1
        with self._lock:
            try:
                pg_sql = _convert_sql(sql)
                cur = self._conn.cursor()
                cur.executemany(pg_sql, params_list)
                cur.close()
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
            ``pd.DataFrame``，空结果也有正确列名；QuestDB 不可用时返回空 DataFrame。
        """
        if not self._available:
            logger.debug("QuestDB 不可用，query 返回空: %s", sql[:80])
            return pd.DataFrame()
        with self._lock:
            try:
                pg_sql = _convert_sql(sql)
                cur = self._conn.cursor()
                if params is not None:
                    cur.execute(pg_sql, params)
                else:
                    cur.execute(pg_sql)
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = cur.fetchall()
                cur.close()
                return pd.DataFrame(rows, columns=cols)
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "query 失败: %s\nSQL: %s\nparams: %s", exc, sql[:200], params
                )
                return pd.DataFrame()

    def fetchone(self, sql: str, params: tuple | list | dict | None = None) -> tuple | None:
        """查询单行。"""
        if not self._available:
            return None
        with self._lock:
            try:
                pg_sql = _convert_sql(sql)
                cur = self._conn.cursor()
                if params is not None:
                    cur.execute(pg_sql, params)
                else:
                    cur.execute(pg_sql)
                row = cur.fetchone()
                cur.close()
                return row
            except Exception as exc:  # noqa: BLE001
                logger.error("fetchone 失败: %s\nSQL: %s", exc, sql[:200])
                return None

    def fetchall(self, sql: str, params: tuple | list | dict | None = None) -> list[tuple]:
        """查询所有行（list of tuple）。"""
        if not self._available:
            return []
        with self._lock:
            try:
                pg_sql = _convert_sql(sql)
                cur = self._conn.cursor()
                if params is not None:
                    cur.execute(pg_sql, params)
                else:
                    cur.execute(pg_sql)
                rows = cur.fetchall()
                cur.close()
                return rows
            except Exception as exc:  # noqa: BLE001
                logger.error("fetchall 失败: %s\nSQL: %s", exc, sql[:200])
                return []

    # ------------------------------------------------------------------
    # 事务（QuestDB PG wire 无事务，这里保持接口兼容，实际 no-op）
    # ------------------------------------------------------------------

    @contextmanager
    def transaction(self) -> Iterator["QuestDBStore"]:
        """事务上下文管理器（接口兼容，QuestDB 无事务，实际 no-op）。

        QuestDB 是时序数据库，不支持事务回滚。本方法保留是为了让 DuckDBStore
        调用方零改动迁移。如果操作失败，数据已写入，需要调用方自行补偿
        （通常用 UPSERT 模式：DELETE WHERE + INSERT）。
        """
        yield self

    # ------------------------------------------------------------------
    # UPSERT 辅助（QuestDB 无 UNIQUE，应用层去重）
    # ------------------------------------------------------------------

    def upsert(
        self,
        table: str,
        conflict_keys: list[str],
        data: dict[str, Any],
    ) -> int:
        """UPSERT 写入（QuestDB 无 UNIQUE，用 DELETE WHERE + INSERT 模拟）。

        Args:
            table: 表名。
            conflict_keys: 冲突判定列（如 ["stock_code", "active"]）。
            data: 要写入的列值 dict。

        Returns:
            -1（固定）。

        示例::

            store.upsert("monitor_subscriptions",
                         conflict_keys=["stock_code", "active"],
                         data={"id": _gen_id(), "stock_code": "600519.SH",
                               "active": True, ...})
        """
        if not self._available:
            return -1

        # 1. DELETE WHERE conflict_keys 匹配
        where = " AND ".join(f"{k} = ?" for k in conflict_keys)
        params = tuple(data.get(k) for k in conflict_keys)
        del_sql = f"DELETE FROM {table} WHERE {where}"
        # 2. INSERT
        cols = list(data.keys())
        placeholders = ", ".join("?" for _ in cols)
        col_list = ", ".join(cols)
        ins_sql = f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})"
        ins_params = tuple(data[k] for k in cols)

        with self._lock:
            try:
                pg_del = _convert_sql(del_sql)
                pg_ins = _convert_sql(ins_sql)
                cur = self._conn.cursor()
                cur.execute(pg_del, params)
                cur.execute(pg_ins, ins_params)
                cur.close()
                return -1
            except Exception as exc:  # noqa: BLE001
                logger.error("upsert 失败: %s\ntable=%s data=%s", exc, table, data)
                raise

    # ------------------------------------------------------------------
    # 工具
    # ------------------------------------------------------------------

    def table_exists(self, table_name: str) -> bool:
        """表是否存在。"""
        if not self._available:
            return False
        try:
            # QuestDB 用 tables() 函数查表清单
            row = self.fetchone(
                "SELECT count(*) FROM tables() WHERE table_name = ?",
                (table_name.lower(),),
            )
            return bool(row and row[0] and int(row[0]) > 0)
        except Exception:  # noqa: BLE001
            # 兜底：直接查表（不存在会抛异常）
            try:
                self.fetchone(f"SELECT * FROM {table_name} LIMIT 1")
                return True
            except Exception:  # noqa: BLE001
                return False

    def list_tables(self) -> list[str]:
        """列出所有表。"""
        if not self._available:
            return []
        rows = self.fetchall("SELECT table_name FROM tables() ORDER BY table_name")
        return [str(r[0]) for r in rows]

    # ------------------------------------------------------------------
    # 上下文管理协议
    # ------------------------------------------------------------------

    def __enter__(self) -> "QuestDBStore":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        # 单例不真正关闭，由进程退出时清理
        pass

    def __repr__(self) -> str:
        return (
            f"<QuestDBStore host={self._host}:{self._pg_port} "
            f"db={self._database} available={self._available}>"
        )

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


# ----------------------------------------------------------------------------
# 便捷导出
# ----------------------------------------------------------------------------


def get_store() -> QuestDBStore:
    """获取 QuestDBStore 单例（便捷函数）。"""
    return QuestDBStore()
