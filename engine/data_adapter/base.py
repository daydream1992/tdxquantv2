"""数据适配器抽象基类。

定义 ``BaseDataAdapter``，覆盖 worklog Task 2-a/2-b/2-h 中确认的全部
tqcenter API 清单（行情 / 财务 / 板块 / 通用函数 / 板块管理 / 订阅）。

Mock 与 Real 适配器都实现本接口，业务层通过 ``factory.get_adapter()`` 拿到
当前模式对应实例，对上层完全透明。

返回类型约定（与 tqcenter 原生 API 对齐）：
- 列表类（sector_list / stock_list / ipo_info / match_stkinfo / user_sector）→ ``list[dict]``
- 单只详情（market_snapshot / stock_info / kzz_info / trackzs_etf_info）→ ``dict``
- 批量价量（pricevol）→ ``dict[code -> fields]``
- K 线（market_data）→ ``dict[field -> DataFrame]``（index=stock, columns=time）
- 区间查询（``*_by_date``）→ ``list[dict]``
- 单日期查询（``*_value``）→ ``list[dict]``
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import date
from typing import Any, Callable

import pandas as pd

logger = logging.getLogger(__name__)


# 类型别名
StockList = list[str]
DateList = list[str]
FieldList = list[str]
Callback = Callable[[dict], None]


class BaseDataAdapter(ABC):
    """数据适配器抽象基类。

    所有方法都应 ``@abstractmethod``，由子类实现。Mock 适配器基于 V8 CSV
    返回静态数据；Real 适配器调用 tqcenter API。
    """

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------

    @abstractmethod
    def initialize(self) -> bool:
        """初始化适配器（Real 模式调用 ``tq.initialize(__file__)``）。

        Returns:
            初始化是否成功。
        """

    @abstractmethod
    def close(self) -> None:
        """释放资源（取消订阅、关闭连接等）。"""

    # ------------------------------------------------------------------
    # 行情类（a行情类信息）
    # ------------------------------------------------------------------

    @abstractmethod
    def get_market_snapshot(self, code: str, field_list: FieldList | None = None) -> dict:
        """单只证券快照（``tq.get_market_snapshot``）。

        Args:
            code: 证券代码，如 ``"600519.SH"``。
            field_list: 字段筛选，``None``/空列表表示返回全部字段。

        Returns:
            dict，含 ``LastClose/Open/Max/Min/Now/Volume/Amount`` 以及
            五档买卖盘 ``Buyp/Buyv/Sellp/Sellv``（list）等。
        """

    @abstractmethod
    def get_pricevol(self, stock_list: StockList) -> dict:
        """批量价量（``tq.get_pricevol``）。

        Args:
            stock_list: 证券代码列表。

        Returns:
            ``dict[code -> {LastClose, Now, Volume}]``。
        """

    @abstractmethod
    def get_market_data(
        self,
        stock_list: StockList,
        period: str = "1d",
        start_time: str = "",
        end_time: str = "",
        count: int = -1,
        dividend_type: str | None = "none",
        field_list: FieldList | None = None,
        fill_data: bool = True,
    ) -> dict:
        """K 线行情（``tq.get_market_data``）。

        Args:
            stock_list: 证券代码列表。
            period: 周期，``"1d"`` / ``"5m"`` / ``"15m"`` / ``"30m"`` / ``"60m"`` / ``"1w"`` / ``"1M"``。
            start_time: 起始时间 ``YYYYMMDD``。
            end_time: 结束时间 ``YYYYMMDD``。
            count: 数据条数；``-1`` 表示不限制。
            dividend_type: 复权类型，``"none"``/``"front"``/``"back"``。
            field_list: 字段筛选。
            fill_data: 是否向后填充空缺数据。

        Returns:
            ``dict[field -> DataFrame]``，DataFrame 的 index=stock, columns=time。

        Note:
            单次最多 24000 条；Real 适配器自动分批续传。
        """

    @abstractmethod
    def get_more_info(self, code: str, field_list: FieldList | None = None) -> dict:
        """股票更多信息（``tq.get_more_info``），含资金流/封板/估值/关键日期。"""

    @abstractmethod
    def get_stock_info(self, code: str, field_list: FieldList | None = None) -> dict:
        """证券基本信息（``tq.get_stock_info``），含名称/分类/股本/财务摘要。"""

    @abstractmethod
    def get_gb_info(self, code: str, date_list: DateList, count: int = 1) -> list:
        """每天股本数据（``tq.get_gb_info``），指定离散日期。"""

    @abstractmethod
    def get_gb_info_by_date(self, code: str, start_date: str, end_date: str = "") -> list:
        """时间段股本数据（``tq.get_gb_info_by_date``）。"""

    @abstractmethod
    def get_relation(self, code: str) -> list:
        """股票所属板块（``tq.get_relation``），返回 ``list[{BlockCode/BlockName/BlockType/GPNume}]``。"""

    @abstractmethod
    def get_ipo_info(self, ipo_type: int = 0, ipo_date: int = 0) -> list:
        """新股申购信息（``tq.get_ipo_info``）。

        Args:
            ipo_type: ``0`` 新股 / ``1`` 新发债 / ``2`` 新股+新发债。
            ipo_date: ``0`` 仅今日 / ``1`` 今日及以后。
        """

    # ------------------------------------------------------------------
    # 板块/成份股（c分类板块）
    # ------------------------------------------------------------------

    @abstractmethod
    def get_stock_list(self, list_type: str = "0", market: str = "") -> list:
        """系统分类成份股（``tq.get_stock_list``）。

        Args:
            list_type: ``"0"`` 仅返回 Code / ``"1"`` 返回 Code+Name。
            market: 市场代码，如 ``"5"`` 全部 A 股 / ``"7"`` 上证主板 / ``"31"`` ETF 等。
        """

    @abstractmethod
    def get_sector_list(self, list_type: str = "0", market: str = "") -> list:
        """A 股板块代码列表（``tq.get_sector_list``）。"""

    @abstractmethod
    def get_stock_list_in_sector(
        self, block_code: str, block_type: int = 0, list_type: str = "0"
    ) -> list:
        """板块成份股（``tq.get_stock_list_in_sector``）。

        Args:
            block_code: 板块代码。
            block_type: ``0`` 板块指数 / ``1`` 自定义板块。
            list_type: ``"0"`` 仅 Code / ``"1"`` Code+Name。
        """

    # ------------------------------------------------------------------
    # 财务类数据（b财务类数据）
    # ------------------------------------------------------------------

    @abstractmethod
    def get_gpjy_value(
        self, code: str, date_list: DateList, count: int = 1
    ) -> list:
        """个股交易数据（``tq.get_gpjy_value``），单日期 / 多日期离散。"""

    @abstractmethod
    def get_gpjy_value_by_date(
        self, code: str, start_date: str, end_date: str = ""
    ) -> list:
        """个股交易数据（``tq.get_gpjy_value_by_date``），时间段。"""

    @abstractmethod
    def get_financial_data(
        self,
        stock_list: StockList,
        field_list: FieldList,
        start_time: str = "",
        end_time: str = "",
        report_type: str = "announce_time",
    ) -> "pd.DataFrame":
        """专业财务数据（``tq.get_financial_data``，FN 系列）。"""

    @abstractmethod
    def get_gp_one_data(
        self, stock_list: StockList, field_list: FieldList
    ) -> dict:
        """股票单个财务数据（``tq.get_gp_one_data``，GO 系列）。"""

    # ------------------------------------------------------------------
    # ETF / 可转债
    # ------------------------------------------------------------------

    @abstractmethod
    def get_kzz_info(self, code: str, field_list: FieldList | None = None) -> dict:
        """可转债信息（``tq.get_kzz_info``）。"""

    @abstractmethod
    def get_trackzs_etf_info(self, index_code: str) -> list:
        """ETF 跟踪指数信息（``tq.get_trackzs_etf_info``）。"""

    # ------------------------------------------------------------------
    # 板块管理（d客户端操作类）—— 原子操作由 SectorManager 封装
    # ------------------------------------------------------------------

    @abstractmethod
    def create_sector(self, block_code: str, block_name: str) -> bool:
        """创建自定义板块（``tq.create_sector``）。"""

    @abstractmethod
    def delete_sector(self, block_code: str) -> bool:
        """删除自定义板块（``tq.delete_sector``）。"""

    @abstractmethod
    def rename_sector(self, block_code: str, new_name: str) -> bool:
        """重命名自定义板块（``tq.rename_sector``）。"""

    @abstractmethod
    def clear_sector(self, block_code: str) -> bool:
        """清空自定义板块成份股（``tq.clear_sector``）。

        关键：``send_user_block`` 是**追加**而非覆盖，更新板块前必须先 clear。
        """

    @abstractmethod
    def send_user_block(self, block_code: str, stock_list: StockList) -> bool:
        """向自定义板块推送成份股（``tq.send_user_block``，**追加**语义）。"""

    @abstractmethod
    def get_user_sector(self, block_code: str = "") -> list:
        """获取自定义板块列表 / 指定板块成份股（``tq.get_user_sector``）。"""

    # ------------------------------------------------------------------
    # 通用函数（订阅 / 推送 / 交易日）
    # ------------------------------------------------------------------

    @abstractmethod
    def get_trading_dates(
        self, market: str = "", start: str = "", end: str = ""
    ) -> list:
        """获取交易日列表（``tq.get_trading_dates``）。"""

    @abstractmethod
    def send_warn(self, stock_list: StockList, **kwargs: Any) -> bool:
        """向通达信客户端推送预警（半自动交易下单入口）。"""

    @abstractmethod
    def send_message(self, msg: str) -> bool:
        """向通达信 TQ 策略管理器推送消息（``tq.send_message``）。"""

    @abstractmethod
    def subscribe_hq(
        self, stock_list: StockList, callback: Callback, batch_size: int | None = None
    ) -> bool:
        """订阅行情（``tq.subscribe_hq``）。

        Args:
            stock_list: 订阅代码列表（单次上限 100 只，自动分批，batch_size 来自配置）。
            callback: 行情推送回调 ``callback(snapshot: dict) -> None``。
            batch_size: 分批大小，``None`` 表示从配置读取。

        Returns:
            是否全部订阅成功。
        """

    @abstractmethod
    def unsubscribe_hq(self, stock_list: StockList) -> bool:
        """取消订阅行情（``tq.unsubscribe_hq``）。"""

    @abstractmethod
    def refresh_kline(self, stock_code: str, period: str = "1d") -> bool:
        """刷新 K 线缓存（``tq.refresh_kline``）。"""

    @abstractmethod
    def download_data(self, stock_code: str, start_date: str, end_date: str) -> bool:
        """下载特定数据文件（``tq.download_data``）。"""
