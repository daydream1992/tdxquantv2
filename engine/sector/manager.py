"""板块管理器（封装原子操作）。

核心痛点：``tq.send_user_block`` 是**追加**而非覆盖语义，调用方如果忘了
``clear_sector`` 就会导致板块成分股不断累积。本管理器把 ``clear + send_user_block``
打包成原子操作 ``update_stocks(code, stock_list)``，杜绝该陷阱。

参考 worklog Task 2-f 场景1 与 ARCHITECTURE.md 第 12 节"关键约束备忘"：
- ``send_user_block`` 是追加非覆盖 → 必须先 ``clear_sector``
- ``subscribe_hq`` 上限 100 只 → 分批 50（可配置）
- ``get_market_data`` 单次 24000 条 → 自动分批续传
"""

from __future__ import annotations

import logging
from typing import Iterable

from engine.data_adapter.base import BaseDataAdapter
from engine.utils.stock_code import normalize

logger = logging.getLogger(__name__)


class SectorManager:
    """板块管理器（基于 ``BaseDataAdapter`` 封装原子操作）。

    用法：
        >>> from engine.data_adapter.factory import get_adapter
        >>> from engine.sector.manager import SectorManager
        >>> sm = SectorManager(get_adapter())
        >>> sm.ensure_sector("ZD_DBQZT01", "打板求涨停选股")
        >>> sm.update_stocks("ZD_DBQZT01", ["600519.SH", "000001.SZ"])
    """

    def __init__(self, adapter: BaseDataAdapter) -> None:
        self._adapter = adapter

    # ------------------------------------------------------------------
    # 原子操作
    # ------------------------------------------------------------------

    def ensure_sector(self, code: str, name: str) -> bool:
        """确保板块存在，不存在则创建。

        Args:
            code: 板块代码，如 ``"ZD_DBQZT01"``。
            name: 板块名称。

        Returns:
            True 表示板块存在（已存在或创建成功）。
        """
        existing = self._safe_get_user_sector()
        existing_codes = {self._extract_code(s) for s in existing}
        if code in existing_codes:
            logger.debug("板块已存在: %s", code)
            return True
        ok = self._adapter.create_sector(code, name)
        if ok:
            logger.info("板块已创建: %s (%s)", code, name)
        else:
            logger.error("板块创建失败: %s (%s)", code, name)
        return ok

    def update_stocks(self, code: str, stock_list: Iterable[str]) -> bool:
        """**原子操作**：清空板块 + 推送新成份股。

        严格保证：先 ``clear_sector`` 再 ``send_user_block``，避免 ``send_user_block``
        的追加语义导致成份股累积。

        Args:
            code: 板块代码。
            stock_list: 新的成份股列表（完全替换）。

        Returns:
            ``clear`` 与 ``send`` 都成功才返回 True。
        """
        codes = self._normalize_list(stock_list)
        # Step 1: clear
        if not self._adapter.clear_sector(code):
            logger.error("update_stocks: clear_sector 失败 code=%s，已中止", code)
            return False
        # Step 2: send
        if not self._adapter.send_user_block(code, codes):
            logger.error(
                "update_stocks: send_user_block 失败 code=%s, %d stocks",
                code, len(codes),
            )
            return False
        logger.info("update_stocks: %s 已更新为 %d 只股票", code, len(codes))
        return True

    def get_stocks(self, code: str) -> list[str]:
        """获取板块当前成份股列表（code 列表）。"""
        rows = self._adapter.get_user_sector(code)
        out: list[str] = []
        for r in rows:
            c = self._extract_code(r)
            if c:
                out.append(c)
        return out

    def add_stocks(self, code: str, stock_list: Iterable[str]) -> bool:
        """追加成份股（不清空现有）。

        注意：内部仍调用 ``send_user_block``（追加语义），不会 clear。
        适用于"在已有板块基础上增加几只"的场景。

        Args:
            code: 板块代码。
            stock_list: 待追加的代码列表。

        Returns:
            推送是否成功。
        """
        codes = self._normalize_list(stock_list)
        if not codes:
            logger.debug("add_stocks: 列表为空，跳过 code=%s", code)
            return True
        ok = self._adapter.send_user_block(code, codes)
        if ok:
            logger.info("add_stocks: %s 追加 %d 只股票", code, len(codes))
        return ok

    def remove_stocks(self, code: str, stock_list: Iterable[str]) -> bool:
        """从板块移除成份股。

        实现策略：取当前成份股 → 减去待移除列表 → ``update_stocks`` 完全替换。

        Args:
            code: 板块代码。
            stock_list: 待移除的代码列表。

        Returns:
            ``update_stocks`` 的结果。
        """
        to_remove = set(self._normalize_list(stock_list))
        current = self.get_stocks(code)
        remaining = [c for c in current if c not in to_remove]
        if len(remaining) == len(current):
            logger.debug("remove_stocks: 无匹配项 code=%s", code)
            return True
        return self.update_stocks(code, remaining)

    def rename(self, code: str, new_name: str) -> bool:
        """重命名板块。"""
        return self._adapter.rename_sector(code, new_name)

    def delete(self, code: str) -> bool:
        """删除板块。"""
        return self._adapter.delete_sector(code)

    # ------------------------------------------------------------------
    # 辅助
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_list(stock_list: Iterable[str]) -> list[str]:
        """归一化代码列表，跳过非法代码。"""
        out: list[str] = []
        for c in stock_list:
            try:
                out.append(normalize(c))
            except ValueError:
                logger.warning("跳过非法代码: %r", c)
        return out

    def _safe_get_user_sector(self) -> list:
        """安全调用 ``get_user_sector``，失败返回空列表。"""
        try:
            return self._adapter.get_user_sector() or []
        except Exception as exc:  # noqa: BLE001
            logger.warning("get_user_sector 失败: %s", exc)
            return []

    @staticmethod
    def _extract_code(sector_row: dict | str) -> str:
        """从 sector 行 dict 提取 code（兼容多种字段命名）。"""
        if isinstance(sector_row, str):
            return sector_row
        if not isinstance(sector_row, dict):
            return ""
        # 兼容 Code/SectorCode/BlockCode/stock_code 多种命名
        for key in ("Code", "SectorCode", "BlockCode", "stock_code", "code"):
            v = sector_row.get(key)
            if v:
                return str(v)
        return ""
