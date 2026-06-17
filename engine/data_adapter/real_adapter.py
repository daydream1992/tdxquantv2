"""Real 数据适配器（封装 tqcenter API）。

设计要点：
1. **导入容错**：``import tqcenter`` 失败时仍可实例化，但调用任何方法都会抛
   ``RuntimeError``。Linux 沙箱环境无法运行 Real 模式，但代码骨架可被加载。
2. **subscribe_hq 分批**：batch_size 来自 ``config/app.yaml`` 的
   ``tqcenter.subscribe_batch_size``（默认 50）。
3. **get_market_data 自动续传**：单次最多 24000 条（来自 ``tqcenter.kline_max_count``），
   超出时按 end_time 倒推分批拉取并合并。
4. **板块管理返回真实结果**：与 Mock 不同，``create_sector`` / ``delete_sector`` 等
   会真实调用 tqcenter。
5. **不硬编码任何路径/阈值**：所有参数从 ``ConfigLoader`` 读取。

API 清单参考 worklog Task 2-a / 2-b / 2-h：
- 行情类：``get_market_snapshot`` / ``get_pricevol`` / ``get_market_data`` /
  ``get_more_info`` / ``get_stock_info`` / ``get_gb_info`` / ``get_gb_info_by_date`` /
  ``get_relation`` / ``get_ipo_info``
- 板块类：``get_stock_list`` / ``get_sector_list`` / ``get_stock_list_in_sector`` /
  ``get_user_sector``
- 财务类：``get_financial_data`` / ``get_gp_one_data`` / ``get_gpjy_value`` /
  ``get_gpjy_value_by_date``
- ETF/可转债：``get_kzz_info`` / ``get_trackzs_etf_info``
- 板块管理：``create_sector`` / ``delete_sector`` / ``rename_sector`` /
  ``clear_sector`` / ``send_user_block``
- 通用：``get_trading_dates`` / ``send_warn`` / ``send_message`` / ``subscribe_hq`` /
  ``unsubscribe_hq`` / ``refresh_kline`` / ``download_data``
"""

from __future__ import annotations

import logging
import math
import time
from datetime import date, datetime, timedelta
from typing import Any, Callable

import pandas as pd

from engine.config.loader import ConfigLoader
from engine.data_adapter.base import BaseDataAdapter, Callback, DateList, FieldList, StockList
from engine.utils.stock_code import normalize
from engine.utils.time import normalize_date

logger = logging.getLogger(__name__)


# tqcenter 可选导入
_tqcenter_available = False
_tq = None
_tqconst = None
try:
    from tqcenter import tq as _tq  # type: ignore[import]
    from tqcenter import tqconst as _tqconst  # type: ignore[import]
    _tqcenter_available = True
except Exception as _import_exc:  # noqa: BLE001
    _import_exc_msg = str(_import_exc)


class RealAdapter(BaseDataAdapter):
    """Real 数据适配器（生产用，必须 Windows + 通达信终端环境）。"""

    def __init__(self) -> None:
        cfg = ConfigLoader()
        self._initialize_file: str = cfg.get("tqcenter.initialize_file", "__file__")
        self._subscribe_batch_size: int = int(cfg.get("tqcenter.subscribe_batch_size", 50))
        self._kline_max_count: int = int(cfg.get("tqcenter.kline_max_count", 24000))
        self._initialized: bool = False
        # 已订阅 code -> callback 列表
        self._subscribers: dict[str, list[Callback]] = {}

        if not _tqcenter_available:
            logger.warning(
                "tqcenter 不可用（%s）。RealAdapter 可实例化但所有调用将抛 RuntimeError",
                _import_exc_msg if not _tqcenter_available else "",
            )

    # ------------------------------------------------------------------
    # 内部辅助
    # ------------------------------------------------------------------

    def _ensure_tq(self) -> None:
        """校验 tqcenter 已导入并已初始化。"""
        if not _tqcenter_available:
            raise RuntimeError(
                "tqcenter 不可用，RealAdapter 无法工作。请在 Windows + 通达信终端环境运行，"
                "或切换 config/app.yaml 的 app.adapter_mode 为 mock"
            )
        if not self._initialized:
            if not self.initialize():
                raise RuntimeError("tq.initialize 失败")

    def _tq(self):
        """返回 tq 单例。"""
        self._ensure_tq()
        return _tq

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------

    def initialize(self) -> bool:
        """调用 ``tq.initialize(__file__)``。"""
        if not _tqcenter_available:
            return False
        if self._initialized:
            return True
        try:
            # tq.initialize(__file__) 需要 __file__ 上下文定位配置文件
            # 这里用本文件的 __file__ 或配置中的 initialize_file 字符串
            init_arg = self._initialize_file
            if init_arg == "__file__":
                init_arg = __file__
            _tq.initialize(init_arg)
            self._initialized = True
            logger.info("RealAdapter tq.initialize 完成")
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("tq.initialize 失败: %s", exc)
            return False

    def close(self) -> None:
        """取消所有订阅并关闭。"""
        if self._subscribers:
            codes = list(self._subscribers.keys())
            self.unsubscribe_hq(codes)
        logger.info("RealAdapter 已关闭")

    # ------------------------------------------------------------------
    # 行情类
    # ------------------------------------------------------------------

    def get_market_snapshot(self, code: str, field_list: FieldList | None = None) -> dict:
        """``tq.get_market_snapshot(stock_code, field_list)``。"""
        tq = self._tq()
        try:
            ncode = normalize(code)
            result = tq.get_market_snapshot(stock_code=ncode, field_list=field_list or [])
            return result or {}
        except Exception as exc:  # noqa: BLE001
            logger.error("get_market_snapshot(%s) 失败: %s", code, exc)
            return {}

    def get_pricevol(self, stock_list: StockList) -> dict:
        """``tq.get_pricevol(stock_list)``。"""
        tq = self._tq()
        try:
            codes = [normalize(c) for c in stock_list]
            return tq.get_pricevol(stock_list=codes) or {}
        except Exception as exc:  # noqa: BLE001
            logger.error("get_pricevol(%d codes) 失败: %s", len(stock_list), exc)
            return {}

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
        """``tq.get_market_data(...)``，超 24000 条自动分批续传。

        分批策略：
        1. 若 ``count`` ≤ 0 或 ``count * len(stock_list) ≤ kline_max_count`` → 单次调用
        2. 否则按 ``count // N`` 折算单次 count，多次调用并合并
        """
        tq = self._tq()
        try:
            codes = [normalize(c) for c in stock_list]
            n_codes = len(codes)
            single_call_max = max(self._kline_max_count // max(n_codes, 1), 1)

            # 不需要分批
            if count is None or count <= 0 or count <= single_call_max:
                return self._call_market_data(
                    tq, codes, period, start_time, end_time, count, dividend_type, field_list, fill_data
                )

            # 需要分批：按 end_time 倒推分批
            merged: dict[str, pd.DataFrame] = {}
            remaining = count
            current_end = end_time
            while remaining > 0:
                batch_count = min(remaining, single_call_max)
                batch_data = self._call_market_data(
                    tq, codes, period, start_time, current_end, batch_count, dividend_type, field_list, fill_data
                )
                if not batch_data:
                    break
                # 合并到已收集数据
                for field, df in batch_data.items():
                    if field not in merged:
                        merged[field] = df
                    else:
                        # 横向合并（columns=date），去重
                        merged[field] = merged[field].join(df, how="outer")
                remaining -= batch_count
                if remaining <= 0:
                    break
                # 推算下一批 end_time（取本批最早日期往前推一天）
                # 仅当能拿到日期列时才推算，否则退出避免无限循环
                try:
                    any_df = next(iter(batch_data.values()))
                    if not any_df.empty and len(any_df.columns) > 0:
                        dates = sorted([str(c) for c in any_df.columns])
                        earliest = dates[0].replace("-", "")
                        prev_day = (
                            datetime.strptime(earliest, "%Y%m%d") - timedelta(days=1)
                        ).strftime("%Y%m%d")
                        current_end = prev_day
                        # 也限制下界
                        if start_time and current_end < start_time:
                            break
                    else:
                        break
                except Exception:  # noqa: BLE001
                    break
            return merged
        except Exception as exc:  # noqa: BLE001
            logger.error("get_market_data 失败: %s", exc)
            return {}

    def _call_market_data(
        self,
        tq,
        codes: list[str],
        period: str,
        start_time: str,
        end_time: str,
        count: int,
        dividend_type: str | None,
        field_list: FieldList | None,
        fill_data: bool,
    ) -> dict:
        """单次调用 ``tq.get_market_data``。"""
        kwargs: dict[str, Any] = {
            "stock_list": codes,
            "period": period,
            "count": count if count is not None else -1,
            "fill_data": fill_data,
        }
        if start_time:
            kwargs["start_time"] = normalize_date(start_time)
        if end_time:
            kwargs["end_time"] = normalize_date(end_time)
        if dividend_type is not None:
            kwargs["dividend_type"] = dividend_type
        if field_list is not None:
            kwargs["field_list"] = field_list
        return tq.get_market_data(**kwargs) or {}

    def get_more_info(self, code: str, field_list: FieldList | None = None) -> dict:
        """``tq.get_more_info(stock_code, field_list)``。"""
        tq = self._tq()
        try:
            ncode = normalize(code)
            return tq.get_more_info(stock_code=ncode, field_list=field_list or []) or {}
        except Exception as exc:  # noqa: BLE001
            logger.error("get_more_info(%s) 失败: %s", code, exc)
            return {}

    def get_stock_info(self, code: str, field_list: FieldList | None = None) -> dict:
        """``tq.get_stock_info(stock_code, field_list)``。"""
        tq = self._tq()
        try:
            ncode = normalize(code)
            return tq.get_stock_info(stock_code=ncode, field_list=field_list or []) or {}
        except Exception as exc:  # noqa: BLE001
            logger.error("get_stock_info(%s) 失败: %s", code, exc)
            return {}

    def get_gb_info(self, code: str, date_list: DateList, count: int = 1) -> list:
        """``tq.get_gb_info(stock_code, date_list, count)``。"""
        tq = self._tq()
        try:
            ncode = normalize(code)
            return tq.get_gb_info(stock_code=ncode, date_list=date_list, count=count) or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_gb_info(%s) 失败: %s", code, exc)
            return []

    def get_gb_info_by_date(self, code: str, start_date: str, end_date: str = "") -> list:
        """``tq.get_gb_info_by_date(stock_code, start_date, end_date)``。"""
        tq = self._tq()
        try:
            ncode = normalize(code)
            return (
                tq.get_gb_info_by_date(
                    stock_code=ncode,
                    start_date=normalize_date(start_date),
                    end_date=normalize_date(end_date) if end_date else "",
                )
                or []
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("get_gb_info_by_date(%s) 失败: %s", code, exc)
            return []

    def get_relation(self, code: str) -> list:
        """``tq.get_relation(stock_code)``。"""
        tq = self._tq()
        try:
            ncode = normalize(code)
            return tq.get_relation(stock_code=ncode) or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_relation(%s) 失败: %s", code, exc)
            return []

    def get_ipo_info(self, ipo_type: int = 0, ipo_date: int = 0) -> list:
        """``tq.get_ipo_info(ipo_type, ipo_date)``。"""
        tq = self._tq()
        try:
            return tq.get_ipo_info(ipo_type=ipo_type, ipo_date=ipo_date) or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_ipo_info 失败: %s", exc)
            return []

    # ------------------------------------------------------------------
    # 板块/成份股
    # ------------------------------------------------------------------

    def get_stock_list(self, list_type: str = "0", market: str = "") -> list:
        """``tq.get_stock_list(market, list_type)``。"""
        tq = self._tq()
        try:
            kwargs: dict[str, Any] = {"list_type": int(list_type) if list_type.isdigit() else 0}
            if market:
                kwargs["market"] = market
            return tq.get_stock_list(**kwargs) or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_stock_list 失败: %s", exc)
            return []

    def get_sector_list(self, list_type: str = "0", market: str = "") -> list:
        """``tq.get_sector_list(list_type)``。"""
        tq = self._tq()
        try:
            kwargs: dict[str, Any] = {"list_type": int(list_type) if list_type.isdigit() else 0}
            return tq.get_sector_list(**kwargs) or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_sector_list 失败: %s", exc)
            return []

    def get_stock_list_in_sector(
        self, block_code: str, block_type: int = 0, list_type: str = "0"
    ) -> list:
        """``tq.get_stock_list_in_sector(code, list_type)``。"""
        tq = self._tq()
        try:
            kwargs: dict[str, Any] = {
                "code": block_code,
                "list_type": int(list_type) if list_type.isdigit() else 0,
            }
            return tq.get_stock_list_in_sector(**kwargs) or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_stock_list_in_sector(%s) 失败: %s", block_code, exc)
            return []

    # ------------------------------------------------------------------
    # 财务类
    # ------------------------------------------------------------------

    def get_gpjy_value(
        self, code: str, date_list: DateList, count: int = 1
    ) -> list:
        """``tq.get_gpjy_value(stock_code, date_list, count)``。"""
        tq = self._tq()
        try:
            ncode = normalize(code)
            return (
                tq.get_gpjy_value(stock_code=ncode, date_list=date_list, count=count)
                or []
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("get_gpjy_value(%s) 失败: %s", code, exc)
            return []

    def get_gpjy_value_by_date(
        self, code: str, start_date: str, end_date: str = ""
    ) -> list:
        """``tq.get_gpjy_value_by_date(stock_code, start_date, end_date)``。"""
        tq = self._tq()
        try:
            ncode = normalize(code)
            return (
                tq.get_gpjy_value_by_date(
                    stock_code=ncode,
                    start_date=normalize_date(start_date),
                    end_date=normalize_date(end_date) if end_date else "",
                )
                or []
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("get_gpjy_value_by_date(%s) 失败: %s", code, exc)
            return []

    def get_financial_data(
        self,
        stock_list: StockList,
        field_list: FieldList,
        start_time: str = "",
        end_time: str = "",
        report_type: str = "announce_time",
    ) -> pd.DataFrame:
        """``tq.get_financial_data(stock_list, field_list, start_time, end_time, report_type)``。

        Real 返回可能是 ``dict[code -> list[dict]]`` 或 DataFrame，本方法统一转
        DataFrame 输出（列：``stock_code`` + 各 field）。
        """
        tq = self._tq()
        try:
            codes = [normalize(c) for c in stock_list]
            kwargs: dict[str, Any] = {
                "stock_list": codes,
                "field_list": field_list,
                "report_type": report_type,
            }
            if start_time:
                kwargs["start_time"] = normalize_date(start_time)
            if end_time:
                kwargs["end_time"] = normalize_date(end_time)
            result = tq.get_financial_data(**kwargs)
            return _financial_result_to_df(result, codes, field_list)
        except Exception as exc:  # noqa: BLE001
            logger.error("get_financial_data 失败: %s", exc)
            return pd.DataFrame(columns=["stock_code"] + list(field_list))

    def get_gp_one_data(
        self, stock_list: StockList, field_list: FieldList
    ) -> dict:
        """``tq.get_gp_one_data(stock_list, field_list)``。"""
        tq = self._tq()
        try:
            codes = [normalize(c) for c in stock_list]
            return tq.get_gp_one_data(stock_list=codes, field_list=field_list) or {}
        except Exception as exc:  # noqa: BLE001
            logger.error("get_gp_one_data 失败: %s", exc)
            return {}

    # ------------------------------------------------------------------
    # ETF / 可转债
    # ------------------------------------------------------------------

    def get_kzz_info(self, code: str, field_list: FieldList | None = None) -> dict:
        """``tq.get_kzz_info(stock_code, field_list)``。"""
        tq = self._tq()
        try:
            ncode = normalize(code)
            return tq.get_kzz_info(stock_code=ncode, field_list=field_list or []) or {}
        except Exception as exc:  # noqa: BLE001
            logger.error("get_kzz_info(%s) 失败: %s", code, exc)
            return {}

    def get_trackzs_etf_info(self, index_code: str) -> list:
        """``tq.get_trackzs_etf_info(etf_code)``。"""
        tq = self._tq()
        try:
            return tq.get_trackzs_etf_info(etf_code=index_code) or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_trackzs_etf_info(%s) 失败: %s", index_code, exc)
            return []

    # ------------------------------------------------------------------
    # 板块管理（真实调用 tqcenter）
    # ------------------------------------------------------------------

    def create_sector(self, block_code: str, block_name: str) -> bool:
        tq = self._tq()
        try:
            tq.create_sector(block_code=block_code, block_name=block_name)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("create_sector(%s, %s) 失败: %s", block_code, block_name, exc)
            return False

    def delete_sector(self, block_code: str) -> bool:
        tq = self._tq()
        try:
            tq.delete_sector(block_code=block_code)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("delete_sector(%s) 失败: %s", block_code, exc)
            return False

    def rename_sector(self, block_code: str, new_name: str) -> bool:
        tq = self._tq()
        try:
            tq.rename_sector(block_code=block_code, block_name=new_name)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("rename_sector(%s, %s) 失败: %s", block_code, new_name, exc)
            return False

    def clear_sector(self, block_code: str) -> bool:
        """清空板块成份股。

        tqcenter 无直接 clear_sector API，惯用 ``send_user_block(block_code, [])``
        推空列表达到清空效果。注意：必须配合 ``SectorManager.update_stocks`` 使用。
        """
        tq = self._tq()
        try:
            tq.send_user_block(block_code=block_code, stock_list=[])
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("clear_sector(%s) 失败: %s", block_code, exc)
            return False

    def send_user_block(self, block_code: str, stock_list: StockList) -> bool:
        tq = self._tq()
        try:
            codes = [normalize(c) for c in stock_list]
            tq.send_user_block(block_code=block_code, stock_list=codes)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("send_user_block(%s, %d stocks) 失败: %s", block_code, len(stock_list), exc)
            return False

    def get_user_sector(self, block_code: str = "") -> list:
        tq = self._tq()
        try:
            if block_code:
                return tq.get_user_sector_by_code(sector_code=block_code) or []
            return tq.get_user_sector() or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_user_sector(%s) 失败: %s", block_code, exc)
            return []

    # ------------------------------------------------------------------
    # 通用函数
    # ------------------------------------------------------------------

    def get_trading_dates(
        self, market: str = "", start: str = "", end: str = ""
    ) -> list:
        """``tq.get_trading_dates(market, start_time, end_time)``。"""
        tq = self._tq()
        try:
            kwargs: dict[str, Any] = {}
            if market:
                kwargs["market"] = market
            if start:
                kwargs["start_time"] = normalize_date(start)
            if end:
                kwargs["end_time"] = normalize_date(end)
            return tq.get_trading_dates(**kwargs) or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_trading_dates 失败: %s", exc)
            return []

    def send_warn(self, stock_list: StockList, **kwargs: Any) -> bool:
        tq = self._tq()
        try:
            codes = [normalize(c) for c in stock_list]
            tq.send_warn(stock_list=codes, **kwargs)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("send_warn 失败: %s", exc)
            return False

    def send_message(self, msg: str) -> bool:
        tq = self._tq()
        try:
            tq.send_message(msg=msg)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("send_message 失败: %s", exc)
            return False

    def subscribe_hq(
        self,
        stock_list: StockList,
        callback: Callback,
        batch_size: int | None = None,
    ) -> bool:
        """订阅行情，**自动分批**（batch_size 来自配置）。

        单次最多 100 只（tqcenter 限制），默认 batch_size=50。
        """
        tq = self._tq()
        bs = batch_size or self._subscribe_batch_size
        try:
            codes: list[str] = []
            for c in stock_list:
                try:
                    codes.append(normalize(c))
                except ValueError:
                    continue
            all_ok = True
            for i in range(0, len(codes), bs):
                batch = codes[i : i + bs]
                try:
                    tq.subscribe_hq(stock_list=batch, callback=callback)
                    for c in batch:
                        self._subscribers.setdefault(c, []).append(callback)
                except Exception as exc:  # noqa: BLE001
                    logger.error("subscribe_hq 批次 %d-%d 失败: %s", i, i + len(batch), exc)
                    all_ok = False
            logger.info("subscribe_hq: %d 个代码，分批大小 %d，成功=%s", len(codes), bs, all_ok)
            return all_ok
        except Exception as exc:  # noqa: BLE001
            logger.error("subscribe_hq 失败: %s", exc)
            return False

    def unsubscribe_hq(self, stock_list: StockList) -> bool:
        tq = self._tq()
        try:
            if not stock_list:
                # 取消所有
                codes = list(self._subscribers.keys())
            else:
                codes = [normalize(c) for c in stock_list]
            bs = self._subscribe_batch_size
            all_ok = True
            for i in range(0, len(codes), bs):
                batch = codes[i : i + bs]
                try:
                    tq.unsubscribe_hq(stock_list=batch)
                    for c in batch:
                        self._subscribers.pop(c, None)
                except Exception as exc:  # noqa: BLE001
                    logger.error("unsubscribe_hq 批次失败: %s", exc)
                    all_ok = False
            return all_ok
        except Exception as exc:  # noqa: BLE001
            logger.error("unsubscribe_hq 失败: %s", exc)
            return False

    def refresh_kline(self, stock_code: str, period: str = "1d") -> bool:
        tq = self._tq()
        try:
            ncode = normalize(stock_code)
            tq.refresh_kline(stock_code=ncode, period=period)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("refresh_kline(%s, %s) 失败: %s", stock_code, period, exc)
            return False

    def download_data(self, stock_code: str, start_date: str, end_date: str) -> bool:
        tq = self._tq()
        try:
            ncode = normalize(stock_code)
            tq.download_data(
                stock_code=ncode,
                start_date=normalize_date(start_date),
                end_date=normalize_date(end_date),
            )
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("download_data(%s) 失败: %s", stock_code, exc)
            return False


# ----------------------------------------------------------------------------
# 辅助
# ----------------------------------------------------------------------------


def _financial_result_to_df(
    result: Any, codes: list[str], field_list: FieldList
) -> pd.DataFrame:
    """把 ``tq.get_financial_data`` 的多种返回格式统一转 DataFrame。

    可能返回：
    - ``dict[code -> list[dict]]``：每只股票多期数据
    - ``dict[code -> DataFrame]``：直接是 DataFrame
    - ``DataFrame``：已经整理好的 long-form

    输出列：``stock_code, date`` + field_list
    """
    if isinstance(result, pd.DataFrame):
        return result
    if not isinstance(result, dict):
        return pd.DataFrame(columns=["stock_code"] + list(field_list))

    rows: list[dict] = []
    for code, val in result.items():
        if val is None:
            continue
        if isinstance(val, pd.DataFrame):
            for _, r in val.iterrows():
                row = {"stock_code": code}
                row.update(r.to_dict())
                rows.append(row)
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, dict):
                    row = {"stock_code": code}
                    row.update(item)
                    rows.append(row)
        elif isinstance(val, dict):
            row = {"stock_code": code}
            row.update(val)
            rows.append(row)
    return pd.DataFrame(rows)
