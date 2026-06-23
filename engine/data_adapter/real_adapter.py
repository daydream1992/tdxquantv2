"""Real 数据适配器（封装 tqcenter API）。

设计要点：
1. **tqcenter 导入机制**：tqcenter 不是 PyPI 包，是通达信终端目录下的 Python 文件
   (通常在 ``<通达信>\\PYPlugins\\user\\tqcenter.py``)。本模块通过 ``sys.path.insert``
   动态加入路径后 ``from tqcenter import tq`` 导入。路径优先级：
   环境变量 ``TQ_CENTER_PATH`` > config ``tqcenter.python_path`` > 通达信常见安装目录扫描。
2. **导入容错**：``import tqcenter`` 失败时仍可实例化，但调用任何方法都会抛
   ``RuntimeError``。Linux 沙箱环境无法运行 Real 模式，但代码骨架可被加载。
3. **subscribe_hq 分批**：batch_size 来自 ``config/app.yaml`` 的
   ``tqcenter.subscribe_batch_size``（默认 50）。
4. **get_market_data 自动续传**：单次最多 24000 条（来自 ``tqcenter.kline_max_count``），
   超出时按 end_time 倒推分批拉取并合并。
5. **板块管理返回真实结果**：与 Mock 不同，``create_sector`` / ``delete_sector`` 等
   会真实调用 tqcenter。
6. **不硬编码任何路径/阈值**：所有参数从 ``ConfigLoader`` 读取。

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
import os
import platform
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from engine.config.loader import ConfigLoader
from engine.data_adapter.base import BaseDataAdapter, Callback, DateList, FieldList, StockList
from engine.data_adapter.rate_limiter import RateLimitError, acquire_or_skip
from engine.utils.stock_code import normalize
from engine.utils.time import normalize_date

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------------
# tqcenter 动态导入（sys.path.insert 机制）
# ----------------------------------------------------------------------------
# tqcenter 是通达信终端目录下的 Python 文件，不在 PyPI。
# 导入路径优先级：
#   1. 环境变量 TQ_CENTER_PATH (绝对路径，指向含 tqcenter.py 的目录)
#   2. config/app.yaml 的 tqcenter.python_path
#   3. 通达信常见安装目录扫描 (Windows only)
#   4. 直接尝试 import (用户已手动 pip install -e 或加 PYTHONPATH 的情况)

# 通达信终端常见安装路径 (Windows)
_TDX_COMMON_PATHS = [
    r"C:\new_tdx", r"D:\new_tdx", r"E:\new_tdx", r"F:\new_tdx",
    r"C:\通达信", r"D:\通达信", r"E:\通达信", r"F:\通达信",
    r"C:\Program Files\通达信", r"D:\Program Files\通达信",
    r"C:\Program Files (x86)\通达信",
    r"K:\txdlianghua",  # 用户实际安装路径
]

# 在通达信根目录下查找 tqcenter.py 的候选子路径
_TQCENTER_SUBPATHS = [
    "PYPlugins\\user",           # 新版通达信: K:\txdlianghua\PYPlugins\user\tqcenter.py
    "T0002\\hq_cache\\PythonLib",  # 旧版: T0002\hq_cache\PythonLib\tqcenter.py
    "Python\\site-packages",    # 嵌入式 Python 环境
    "PYPlugins",                # 简化路径
]


def _find_tqcenter_dir() -> str | None:
    """扫描通达信常见安装目录，返回包含 tqcenter.py 的目录路径。Windows only。"""
    if platform.system() != "Windows":
        return None
    for tdx_root in _TDX_COMMON_PATHS:
        root = Path(tdx_root)
        if not root.exists():
            continue
        for sub in _TQCENTER_SUBPATHS:
            candidate = root / sub
            if (candidate / "tqcenter.py").exists() or (candidate / "tqcenter" / "__init__.py").exists():
                return str(candidate)
    return None


def _resolve_tqcenter_path() -> str | None:
    """按优先级解析 tqcenter 所在目录。返回绝对路径字符串或 None。"""
    # 1. 环境变量 TQ_CENTER_PATH
    env_path = os.environ.get("TQ_CENTER_PATH", "").strip()
    if env_path and Path(env_path).exists():
        return env_path
    # 2. config tqcenter.python_path
    try:
        cfg = ConfigLoader()
        cfg_path = str(cfg.get("tqcenter.python_path", "") or "").strip()
        if cfg_path and Path(cfg_path).exists():
            return cfg_path
    except Exception:  # noqa: BLE001
        pass
    # 3. 扫描通达信常见目录
    return _find_tqcenter_dir()


def _import_tqcenter() -> tuple[bool, str, Any, Any]:
    """动态导入 tqcenter。返回 (available, err_msg, tq, tqconst)。"""
    # 先尝试直接 import（用户可能已 pip install -e 或设 PYTHONPATH）
    try:
        from tqcenter import tq as tq_mod  # type: ignore[import]
        from tqcenter import tqconst as tqconst_mod  # type: ignore[import]
        return True, "", tq_mod, tqconst_mod
    except ImportError:
        pass

    # 通过 sys.path.insert 导入
    tq_dir = _resolve_tqcenter_path()
    if tq_dir:
        if tq_dir not in sys.path:
            sys.path.insert(0, tq_dir)
        try:
            from tqcenter import tq as tq_mod  # type: ignore[import]
            from tqcenter import tqconst as tqconst_mod  # type: ignore[import]
            logger.info("tqcenter 已从 %s 导入", tq_dir)
            return True, "", tq_mod, tqconst_mod
        except Exception as exc:  # noqa: BLE001
            return False, f"在 {tq_dir} 找到但导入失败: {exc}", None, None
        # 不从 sys.path 移除 tq_dir：tqcenter 内部可能还需要它来加载同目录的辅助模块
        # (如 TPythClient.dll 通过 __file__ 定位，但某些子模块可能走 sys.path)
    return False, "未找到 tqcenter.py，请设置 TQ_CENTER_PATH 环境变量或 config.tqcenter.python_path", None, None


# 模块加载时执行导入
_tqcenter_available = False
_tqcenter_err_msg = ""
_tq = None
_tqconst = None
try:
    _tqcenter_available, _tqcenter_err_msg, _tq, _tqconst = _import_tqcenter()
except Exception as _import_exc:  # noqa: BLE001
    _tqcenter_err_msg = str(_import_exc)


class RealAdapter(BaseDataAdapter):
    """Real 数据适配器（生产用，必须 Windows + 通达信终端环境）。"""

    def __init__(self) -> None:
        cfg = ConfigLoader()
        self._initialize_file: str = cfg.get("tqcenter.initialize_file", "__file__")
        self._python_path: str = str(cfg.get("tqcenter.python_path", "") or "")
        self._subscribe_batch_size: int = int(cfg.get("tqcenter.subscribe_batch_size", 50))
        self._kline_max_count: int = int(cfg.get("tqcenter.kline_max_count", 24000))
        self._initialized: bool = False
        # 已订阅 code -> callback 列表
        self._subscribers: dict[str, list[Callback]] = {}

        if not _tqcenter_available:
            logger.warning(
                "tqcenter 不可用（%s）。RealAdapter 可实例化但所有调用将抛 RuntimeError。"
                "解决方法：1) 设置环境变量 TQ_CENTER_PATH=<含 tqcenter.py 的目录>；"
                "2) 或在 config/app.yaml 的 tqcenter.python_path 配置路径；"
                "3) 或确保通达信终端已安装（自动扫描 K:\\txdlianghua 等常见路径）。",
                _tqcenter_err_msg,
            )

    # ------------------------------------------------------------------
    # 内部辅助
    # ------------------------------------------------------------------

    def _ensure_tq(self) -> None:
        """校验 tqcenter 已导入并已初始化。"""
        if not _tqcenter_available:
            raise RuntimeError(
                f"tqcenter 不可用：{_tqcenter_err_msg}。"
                "解决方法：1) 设置环境变量 TQ_CENTER_PATH=<含 tqcenter.py 的目录>；"
                "2) 或在 config/app.yaml 的 tqcenter.python_path 配置路径；"
                "3) 或确保通达信终端已安装。"
                "若仍无法解决，请切换 config/app.yaml 的 app.adapter_mode 为 mock。"
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
        """调用 ``tq.initialize(<path>)`` 初始化通达信连接。

        tq.initialize 需要一个路径作为上下文，用于定位 TPythClient.dll 和配置文件。
        路径优先级：
          1. config tqcenter.initialize_file (如果不是 "__file__" 占位符)
          2. config tqcenter.python_path (含 tqcenter.py 的目录) + "/tqcenter.py"
          3. 环境变量 TQ_CENTER_INITIALIZE
          4. 本文件 __file__ (兜底，可能无法定位 DLL)
        """
        if not _tqcenter_available:
            return False
        if self._initialized:
            return True
        try:
            init_arg: str = self._initialize_file
            if init_arg == "__file__":
                # 优先用 python_path 拼出 tqcenter.py 路径（用户示例：传 tqcenter.py 路径）
                if self._python_path:
                    init_arg = str(Path(self._python_path) / "tqcenter.py")
                else:
                    # 兜底环境变量
                    env_init = os.environ.get("TQ_CENTER_INITIALIZE", "").strip()
                    if env_init:
                        init_arg = env_init
                    else:
                        init_arg = __file__
            _tq.initialize(init_arg)
            self._initialized = True
            logger.info("RealAdapter tq.initialize 完成 (init_arg=%s)", init_arg)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("tq.initialize 失败 (init_arg=%s): %s", init_arg, exc)
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
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_market_snapshot({code}) 被拒绝")
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
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_pricevol({len(stock_list)} codes) 被拒绝")
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
        if not acquire_or_skip():
            raise RateLimitError(
                f"tqcenter 限流: get_market_data({len(stock_list)} codes) 被拒绝"
            )
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
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_more_info({code}) 被拒绝")
        tq = self._tq()
        try:
            ncode = normalize(code)
            return tq.get_more_info(stock_code=ncode, field_list=field_list or []) or {}
        except Exception as exc:  # noqa: BLE001
            logger.error("get_more_info(%s) 失败: %s", code, exc)
            return {}

    def get_stock_info(self, code: str, field_list: FieldList | None = None) -> dict:
        """``tq.get_stock_info(stock_code, field_list)``。"""
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_stock_info({code}) 被拒绝")
        tq = self._tq()
        try:
            ncode = normalize(code)
            return tq.get_stock_info(stock_code=ncode, field_list=field_list or []) or {}
        except Exception as exc:  # noqa: BLE001
            logger.error("get_stock_info(%s) 失败: %s", code, exc)
            return {}

    def get_gb_info(self, code: str, date_list: DateList, count: int = 1) -> list:
        """``tq.get_gb_info(stock_code, date_list, count)``。"""
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_gb_info({code}) 被拒绝")
        tq = self._tq()
        try:
            ncode = normalize(code)
            return tq.get_gb_info(stock_code=ncode, date_list=date_list, count=count) or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_gb_info(%s) 失败: %s", code, exc)
            return []

    def get_gb_info_by_date(self, code: str, start_date: str, end_date: str = "") -> list:
        """``tq.get_gb_info_by_date(stock_code, start_date, end_date)``。"""
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_gb_info_by_date({code}) 被拒绝")
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
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_relation({code}) 被拒绝")
        tq = self._tq()
        try:
            ncode = normalize(code)
            return tq.get_relation(stock_code=ncode) or []
        except Exception as exc:  # noqa: BLE001
            logger.error("get_relation(%s) 失败: %s", code, exc)
            return []

    def get_ipo_info(self, ipo_type: int = 0, ipo_date: int = 0) -> list:
        """``tq.get_ipo_info(ipo_type, ipo_date)``。"""
        if not acquire_or_skip():
            raise RateLimitError("tqcenter 限流: get_ipo_info 被拒绝")
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
        if not acquire_or_skip():
            raise RateLimitError("tqcenter 限流: get_stock_list 被拒绝")
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
        if not acquire_or_skip():
            raise RateLimitError("tqcenter 限流: get_sector_list 被拒绝")
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
        if not acquire_or_skip():
            raise RateLimitError(
                f"tqcenter 限流: get_stock_list_in_sector({block_code}) 被拒绝"
            )
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
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_gpjy_value({code}) 被拒绝")
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
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_gpjy_value_by_date({code}) 被拒绝")
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
        if not acquire_or_skip():
            raise RateLimitError(
                f"tqcenter 限流: get_financial_data({len(stock_list)} codes) 被拒绝"
            )
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
        if not acquire_or_skip():
            raise RateLimitError(
                f"tqcenter 限流: get_gp_one_data({len(stock_list)} codes) 被拒绝"
            )
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
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_kzz_info({code}) 被拒绝")
        tq = self._tq()
        try:
            ncode = normalize(code)
            return tq.get_kzz_info(stock_code=ncode, field_list=field_list or []) or {}
        except Exception as exc:  # noqa: BLE001
            logger.error("get_kzz_info(%s) 失败: %s", code, exc)
            return {}

    def get_trackzs_etf_info(self, index_code: str) -> list:
        """``tq.get_trackzs_etf_info(etf_code)``。"""
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_trackzs_etf_info({index_code}) 被拒绝")
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
        if not acquire_or_skip():
            raise RateLimitError(f"tqcenter 限流: get_user_sector({block_code}) 被拒绝")
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
