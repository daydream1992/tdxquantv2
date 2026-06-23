"""板块回写导出器。

将选股结果回写到通达信客户端自定义板块。

特性
----
- 原子操作: 先 ``clear_sector`` 清空板块，再 ``send_user_block`` 推送新列表
  （V8 Bug 修复: ``send_user_block`` 是追加非覆盖，必须先 clear）
- 板块 code 来自策略配置 ``sector.code`` 或 ``config/sector_mapping.yaml``
- ``update_mode``: ``replace`` (清空重写) / ``append`` (追加，不 clear)
- Mock 模式（无 ``SectorManager``）下 noop 通达信客户端，但**仍写 DuckDB ``sector_snapshots`` 表**
  以保证 Web 板块管理页能正确展示 stock_count（修复 P1 阶段板块显示 0 的 Bug）

P1-3 依赖
----------
- ``engine.sector.manager.SectorManager`` 提供原子操作封装
  - ``manager.clear_sector(code)``
  - ``manager.send_user_block(code, stock_list)``

P1-3 接口未稳定时，本导出器对 ``SectorManager`` 缺失做兜底处理。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import pandas as pd

from engine.exporters.base import DataExporter, ExporterError
from engine.pipeline.base import PipelineContext
from engine.storage.questdb_store import _gen_id  # R18-A: QuestDB 无 SEQUENCE，应用层生成 id

logger = logging.getLogger(__name__)

# P1-3 依赖: SectorManager 可能由 P1-3 或后续阶段实现，做兜底
try:  # pragma: no cover
    from engine.sector.manager import SectorManager  # type: ignore
    _SECTOR_MANAGER_READY = True
except (ImportError, AttributeError, Exception):  # pragma: no cover
    _SECTOR_MANAGER_READY = False

    class SectorManager:  # type: ignore[no-redef]
        """P1-3 占位。Mock 模式下所有方法为 noop。"""
        # TODO: 待 P1-3 完成

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self._mock = True

        def clear_sector(self, code: str) -> bool:
            return True

        def send_user_block(self, code: str, stock_list: list[str]) -> bool:
            return True

        def update_stocks(self, code: str, stock_list: list[str], mode: str = "replace") -> bool:
            """原子操作: clear + send_user_block。"""
            if mode == "replace":
                self.clear_sector(code)
            return self.send_user_block(code, stock_list)


class SectorExporter(DataExporter):
    """板块回写导出器。"""

    exporter_id = "sector"
    exporter_name = "板块回写"

    def export(self, context: PipelineContext) -> str:
        sector_cfg: dict[str, Any] = (
            self.strategy_config.get("sector", {})
            or self.config.get("sector", {})
            or {}
        )
        code = sector_cfg.get("code")
        if not code:
            self.logger.warning("策略 %s 未配置 sector.code，跳过板块回写", context.strategy_id)
            return ""

        # 收集股票代码
        df = context.final if context.final is not None else pd.DataFrame()
        stock_list: list[str] = []
        if not df.empty:
            code_col = "code" if "code" in df.columns else "stock_code" if "stock_code" in df.columns else None
            if code_col:
                stock_list = df[code_col].astype(str).tolist()

        update_mode = self.config.get("update_mode", sector_cfg.get("update_mode", "replace"))
        sector_name = sector_cfg.get("name", "") or f"{context.strategy_id}_选股"

        # 始终写一份板块快照到 DuckDB（无论 Mock / Real），用于 Web 板块管理页展示 stock_count
        self._record_snapshot(code, sector_name, context.strategy_id, stock_list, update_mode)

        # Mock 模式判断
        if self.config.get("mock", False) or not _SECTOR_MANAGER_READY:
            self.logger.info(
                "[Mock] 板块回写 strategy=%s code=%s mode=%s stocks=%d",
                context.strategy_id, code, update_mode, len(stock_list),
            )
            return f"mock:{code}:{len(stock_list)}"

        try:
            manager = SectorManager()
            # P1-3 真实接口: update_stocks(code, stock_list) 内部实现原子 clear+send_user_block
            # 注意真实签名不接受 mode 参数; append 模式调用 add_stocks
            if update_mode == "append" and hasattr(manager, "add_stocks"):
                success = manager.add_stocks(code, stock_list)  # type: ignore[attr-defined]
            else:
                # replace 模式 (默认): update_stocks 原子替换
                success = manager.update_stocks(code, stock_list)  # type: ignore[attr-defined]
            if success:
                self.logger.info(
                    "板块回写成功 code=%s mode=%s stocks=%d",
                    code, update_mode, len(stock_list),
                )
                return f"{code}:{len(stock_list)}"
            else:
                raise ExporterError(f"板块回写失败 code={code}")
        except ExporterError:
            raise
        except Exception as exc:  # noqa: BLE001
            self.logger.exception("板块回写异常")
            raise ExporterError(f"板块回写异常: {exc}") from exc

    # ------------------------------------------------------------------
    # 内部：板块快照持久化
    # ------------------------------------------------------------------
    def _record_snapshot(
        self,
        code: str,
        name: str,
        strategy_id: str,
        stock_list: list[str],
        operation: str,
    ) -> None:
        """把本次板块更新写入 ``sector_snapshots`` 表。

        无论 Mock / Real 模式都执行，这样 Web 端 ``GET /api/sectors`` 才能取到
        真实 ``stock_count``。失败时仅记录警告，不阻断主流程。
        """
        if self.storage is None:
            self.logger.debug("未注入 storage，跳过 sector_snapshots 写入")
            return
        if not hasattr(self.storage, "execute"):
            return
        sql = (
            "INSERT INTO sector_snapshots "
            "(id, sector_code, sector_name, strategy_id, stock_count, stock_list, operation, snapshot_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        params = [
            _gen_id(),  # R18-A: QuestDB 无 SEQUENCE，应用层生成 id
            code,
            name,
            strategy_id,
            len(stock_list),
            json.dumps(stock_list, ensure_ascii=False),
            operation,
            datetime.now(),
        ]
        try:
            self.storage.execute(sql, params)  # type: ignore[attr-defined]
            self.logger.info(
                "sector_snapshots 已记录: code=%s count=%d op=%s",
                code, len(stock_list), operation,
            )
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("sector_snapshots 写入失败 (非致命): %s", exc)
