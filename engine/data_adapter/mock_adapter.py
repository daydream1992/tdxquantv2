"""Mock 数据适配器（基于 V8 系统的 CSV 样本数据）。

设计目标：
1. 在 Linux 沙箱环境（无通达信终端）下让选股/监控逻辑能跑通
2. 返回结构与 ``RealAdapter`` 一致（dict / DataFrame / list），上层无需感知 Mock
3. 板块管理方法（``create_sector`` / ``delete_sector`` 等）返回成功但 noop
4. ``subscribe_hq`` 用后台定时器模拟推送，基于快照 CSV 数据循环

CSV 数据源（路径来自 ``config/app.yaml`` 的 ``mock.data_dir``）：
- ``全市场L2快照_20260616.csv`` —— 快照 / more_info（约 6794 条）
- ``kline_*_daily.csv`` —— 日 K 线（4 个文件覆盖 2026-05-20 ~ 2026-06-16）
- ``stock_name_mapping.csv`` —— code → name 映射
- ``股票行业三级分类_20260616_033518.csv`` —— 行业分类
- ``stock_block_relation.csv`` —— 板块归属关系
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from engine.config.loader import ConfigLoader
from engine.data_adapter.base import BaseDataAdapter, Callback, DateList, FieldList, StockList
from engine.utils.stock_code import normalize
from engine.utils.time import normalize_date

logger = logging.getLogger(__name__)


# CSV 文件名常量（不硬编码路径，仅文件名）
_SNAPSHOT_CSV = "全市场L2快照_20260616.csv"
_NAME_MAPPING_CSV = "stock_name_mapping.csv"
_INDUSTRY_CSV = "股票行业三级分类_20260616_033518.csv"
_BLOCK_RELATION_CSV = "stock_block_relation.csv"
_KLINE_GLOB = "kline_*_daily.csv"


class MockAdapter(BaseDataAdapter):
    """Mock 数据适配器：基于 V8 CSV 静态样本。"""

    def __init__(self) -> None:
        cfg = ConfigLoader()
        rel_dir = cfg.get("mock.data_dir", "./data/v8-samples/data")
        self._data_dir: Path = self._resolve_path(str(rel_dir))
        self._push_interval: float = float(cfg.get("mock.push_interval", 3))

        # 缓存（懒加载）
        self._snapshot_df: pd.DataFrame | None = None
        self._kline_df: pd.DataFrame | None = None
        self._name_map_df: pd.DataFrame | None = None
        self._industry_df: pd.DataFrame | None = None
        self._block_relation_df: pd.DataFrame | None = None

        # subscribe_hq 状态
        self._subscribers: dict[str, list[tuple[Callback, str]]] = {}  # code -> [(cb, sub_id)]
        self._sub_lock = threading.Lock()
        self._push_thread: threading.Thread | None = None
        self._push_stop = threading.Event()
        self._sub_batch_no = 0

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------

    def initialize(self) -> bool:
        """Mock 不需要外部连接，仅校验数据目录存在。"""
        if not self._data_dir.exists():
            logger.error("Mock 数据目录不存在: %s", self._data_dir)
            return False
        logger.info("MockAdapter 初始化完成: %s", self._data_dir)
        return True

    def close(self) -> None:
        """停止所有订阅推送线程。"""
        self.unsubscribe_hq([])
        if self._push_thread and self._push_thread.is_alive():
            self._push_stop.set()
            self._push_thread.join(timeout=5)
            self._push_thread = None
        logger.info("MockAdapter 已关闭")

    # ------------------------------------------------------------------
    # CSV 加载（懒加载 + 缓存）
    # ------------------------------------------------------------------

    def _load_snapshot(self) -> pd.DataFrame:
        """加载全市场 L2 快照 CSV。"""
        if self._snapshot_df is None:
            path = self._data_dir / _SNAPSHOT_CSV
            self._snapshot_df = pd.read_csv(path, encoding="utf-8-sig", dtype=str)
            # 规范化 code 列
            if "code" in self._snapshot_df.columns:
                self._snapshot_df["code"] = self._snapshot_df["code"].str.upper()
            # 派生 is_limit_up / 是否涨停 列（基于 FCAmo > 0 或 ZAF >= 9.5）
            # V8 兼容: 涨停判断 FCAmo>0 涨停，<0 跌停
            for col in ("FCAmo", "ZAF", "FCb"):
                if col in self._snapshot_df.columns:
                    self._snapshot_df[col] = pd.to_numeric(self._snapshot_df[col], errors="coerce")
            fcamo = self._snapshot_df.get("FCAmo", pd.Series(dtype=float))
            zaf = self._snapshot_df.get("ZAF", pd.Series(dtype=float))
            limit_mask = (fcamo.fillna(0) > 0) | (zaf.fillna(0) >= 9.5)
            self._snapshot_df["is_limit_up"] = limit_mask
            self._snapshot_df["是否涨停"] = limit_mask
            # 派生 name 列（若缺）从 stock_name_mapping
            if "name" not in self._snapshot_df.columns:
                try:
                    nm = self._load_name_map()
                    if "name" in nm.columns:
                        self._snapshot_df = self._snapshot_df.merge(
                            nm[["code", "name"]], on="code", how="left"
                        )
                except Exception:  # noqa: BLE001
                    pass
        return self._snapshot_df

    def _load_kline(self) -> pd.DataFrame:
        """合并所有 kline_*_daily.csv 为一个 DataFrame。"""
        if self._kline_df is None:
            files = sorted(self._data_dir.glob(_KLINE_GLOB))
            if not files:
                logger.warning("未找到 K 线 CSV 文件: %s", self._data_dir / _KLINE_GLOB)
                self._kline_df = pd.DataFrame()
                return self._kline_df
            dfs = []
            for f in files:
                try:
                    df = pd.read_csv(f, encoding="utf-8-sig")
                    dfs.append(df)
                except Exception as exc:  # noqa: BLE001
                    logger.error("读取 K 线 CSV 失败 %s: %s", f, exc)
            if dfs:
                self._kline_df = pd.concat(dfs, ignore_index=True)
                self._kline_df["code"] = self._kline_df["code"].str.upper()
                # 数值列转 float
                for col in ("open", "high", "low", "close", "volume", "amount", "change_pct", "turnover", "forward_factor"):
                    if col in self._kline_df.columns:
                        self._kline_df[col] = pd.to_numeric(self._kline_df[col], errors="coerce")
                self._kline_df.sort_values(["code", "date"], inplace=True)
            else:
                self._kline_df = pd.DataFrame()
        return self._kline_df

    def _load_name_map(self) -> pd.DataFrame:
        if self._name_map_df is None:
            path = self._data_dir / _NAME_MAPPING_CSV
            self._name_map_df = pd.read_csv(path, encoding="utf-8-sig", dtype=str)
            self._name_map_df["code"] = self._name_map_df["code"].str.upper()
        return self._name_map_df

    def _load_industry(self) -> pd.DataFrame:
        if self._industry_df is None:
            path = self._data_dir / _INDUSTRY_CSV
            self._industry_df = pd.read_csv(path, encoding="utf-8-sig", dtype=str)
            self._industry_df["stock_code"] = self._industry_df["stock_code"].str.upper()
        return self._industry_df

    def _load_block_relation(self) -> pd.DataFrame:
        if self._block_relation_df is None:
            path = self._data_dir / _BLOCK_RELATION_CSV
            self._block_relation_df = pd.read_csv(path, encoding="utf-8-sig", dtype=str)
            self._block_relation_df["stock_code"] = self._block_relation_df["stock_code"].str.upper()
        return self._block_relation_df

    # ------------------------------------------------------------------
    # 行情类
    # ------------------------------------------------------------------

    def get_market_snapshot(self, code: str, field_list: FieldList | None = None) -> dict:
        """从快照 CSV 读取单只股票数据。

        V8 快照 CSV 实际是 ``get_more_info`` 字段集合，本 Mock 把它同时用于
        ``get_market_snapshot`` 与 ``get_more_info``。
        """
        try:
            ncode = normalize(code)
        except ValueError:
            return {}
        df = self._load_snapshot()
        row = df[df["code"] == ncode]
        if row.empty:
            return {}
        result: dict[str, Any] = row.iloc[0].to_dict()
        # 数值字段尝试转换
        for k, v in list(result.items()):
            if isinstance(v, str) and v.replace(".", "", 1).replace("-", "", 1).isdigit():
                try:
                    result[k] = float(v) if "." in v else int(float(v))
                except ValueError:
                    pass
        # 字段筛选
        if field_list:
            result = {k: result.get(k) for k in field_list}
        # 补充标准 snapshot 字段（与 tqcenter 对齐）
        result.setdefault("ErrorId", "0")
        result.setdefault("code", ncode)
        return result

    def get_market_snapshot_all(self) -> "pd.DataFrame":
        """返回全市场快照 DataFrame（批量接口，供 pipeline.load_data 使用）。

        列包含 CSV 全部字段 + 派生的 is_limit_up / 是否涨停 / name。
        """
        return self._load_snapshot().copy()

    def get_snapshot_batch(self) -> "pd.DataFrame":
        """``get_market_snapshot_all`` 别名，兼容 pipeline 不同方法名探测。"""
        return self.get_market_snapshot_all()

    def get_all_snapshots(self) -> "pd.DataFrame":
        """``get_market_snapshot_all`` 别名。"""
        return self.get_market_snapshot_all()

    def get_snapshot(self) -> "pd.DataFrame":
        """``get_market_snapshot_all`` 别名（pipeline 旧式批量接口）。"""
        return self.get_market_snapshot_all()

    def get_pricevol(self, stock_list: StockList) -> dict:
        """批量价量（从快照 CSV 提取 LastClose/Now/Volume 等关键字段）。

        V8 快照 CSV 字段映射（已通过探针脚本验证）：
        - ``ZAF``        = 涨跌幅（百分比，如 -1.08 表示跌 1.08%），**非价格**
        - ``MA5Value``   = 5日均线价（近似现价）
        - ``ZTPrice``    = 涨停价
        - ``DTPrice``    = 跌停价
        - ``CJJEPre1``   = 昨日成交额（元）
        - ``OpenAmo``    = 今日开盘成交额
        - ``TotalBVol``  = 总买量（手）
        - ``TotalSVol``  = 总卖量（手）

        推导：
        - ``Now``        ≈ MA5Value（5日均线，最近一日 close 近似）
        - ``LastClose``  = Now / (1 + ZAF/100)
        - ``Volume``     ≈ (TotalBVol + TotalSVol) / 100（手转股）
        - ``Amount``     ≈ CJJEPre1 或 OpenAmo
        """
        df = self._load_snapshot()
        out: dict[str, dict] = {}
        for code in stock_list:
            try:
                ncode = normalize(code)
            except ValueError:
                continue
            row = df[df["code"] == ncode]
            if row.empty:
                continue
            r = row.iloc[0].to_dict()
            pct = _to_float(_safe_sub(r, "ZAF", "0"))
            now = _to_float(_safe_sub(r, "MA5Value", "0"))
            # 兜底：MA5Value 缺失时用 ZTPrice / 1.1 估算
            if now <= 0:
                zt = _to_float(_safe_sub(r, "ZTPrice", "0"))
                if zt > 0:
                    now = round(zt / 1.1, 2)
            # LastClose = now / (1 + pct/100)
            last_close = round(now / (1 + pct / 100), 4) if (now > 0 and abs(pct) < 50) else now
            total_b = _to_float(_safe_sub(r, "TotalBVol", "0"))
            total_s = _to_float(_safe_sub(r, "TotalSVol", "0"))
            # V8 快照中 TotalBVol/TotalSVol 单位为"手"；pricevol 约定 Volume 也为"手"
            volume = total_b + total_s
            # V8 快照中 CJJEPre1 单位为"万元"（如 171156.13 = 17.11亿），OpenAmo 单位为"元"
            cjje = _to_float(_safe_sub(r, "CJJEPre1", "0"))
            open_amo = _to_float(_safe_sub(r, "OpenAmo", "0"))
            # 统一转换为元
            amount = cjje * 10000 if cjje > 0 else open_amo
            # 兜底：amount 缺失时用 volume * now 估算
            if amount <= 0 and volume > 0 and now > 0:
                amount = volume * 100 * now  # 手转股 × 现价
            name = str(_safe_sub(r, "name", "") or "")
            out[ncode] = {
                "LastClose": last_close,
                "Now": now,
                "pct_change": pct / 100,  # 转为小数
                "Volume": volume,
                "Amount": amount,
                "name": name,
                # V8 快照无 LastClose/Now/Volume 直接字段，用近似字段填充
                "_raw": r,
            }
        return out

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
        """从 kline_*_daily.csv 读取日 K 线。

        Mock 仅支持 ``period="1d"``，其他周期返回空。
        返回 ``dict[field -> DataFrame]``，与 Real 适配器一致。
        """
        if period not in ("1d", "daily", "1D"):
            logger.warning("Mock 仅支持日 K 线 (period=1d)，当前 period=%s", period)
            return {}

        kline = self._load_kline()
        if kline.empty:
            return {}

        # 归一化代码
        codes: list[str] = []
        for c in stock_list:
            try:
                codes.append(normalize(c))
            except ValueError:
                continue
        sub = kline[kline["code"].isin(codes)].copy()

        # 日期过滤
        try:
            sub["date_norm"] = sub["date"].astype(str).str.replace("-", "")
        except Exception:  # noqa: BLE001
            sub["date_norm"] = sub["date"].astype(str)
        if start_time:
            sub = sub[sub["date_norm"] >= normalize_date(start_time)]
        if end_time:
            sub = sub[sub["date_norm"] <= normalize_date(end_time)]

        # count：每只股票保留最后 count 条
        if count and count > 0:
            sub = sub.groupby("code", group_keys=False).tail(count)

        # 构造 dict[field -> DataFrame]，index=stock, columns=date
        # Date 作为列索引（columns），不作为 value 字段
        all_fields = ["Date", "Open", "High", "Low", "Close", "Volume", "Amount", "ForwardFactor"]
        fields = field_list or all_fields
        # 字段映射（标准 tqcenter 字段名 → 小写 CSV 列名）
        col_map = {
            "Date": "date",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
            "Amount": "amount",
            "ForwardFactor": "forward_factor",
        }
        out: dict[str, pd.DataFrame] = {}
        for f in fields:
            csv_col = col_map.get(f, f.lower())
            if f == "Date":
                # Date 单独处理：返回一个 DataFrame，index=code, columns=date
                # 值就是日期字符串本身（便于上层知道每列对应哪个交易日）
                if "date" not in sub.columns:
                    out[f] = pd.DataFrame(index=codes)
                    continue
                # 构造与其它字段一致的 index/columns 布局
                dates_per_code = (
                    sub.groupby("code")["date"].apply(lambda s: list(s))
                )
                # 取并集作为 columns
                all_dates = sorted(set(d for s in dates_per_code for d in s))
                df = pd.DataFrame(index=dates_per_code.index, columns=all_dates, dtype=object)
                for code, dlist in dates_per_code.items():
                    for d in dlist:
                        df.loc[code, d] = d
                out[f] = df
                continue
            if csv_col not in sub.columns:
                # 缺列返回空 DataFrame
                out[f] = pd.DataFrame(index=codes)
                continue
            pivot = sub.pivot_table(index="code", columns="date", values=csv_col, aggfunc="last")
            out[f] = pivot
        return out

    def get_more_info(self, code: str, field_list: FieldList | None = None) -> dict:
        """股票更多信息（与 ``get_market_snapshot`` 共享快照 CSV）。"""
        return self.get_market_snapshot(code, field_list)

    def get_stock_info(self, code: str, field_list: FieldList | None = None) -> dict:
        """证券基本信息（合成自 name_mapping + 快照 + 行业分类）。"""
        try:
            ncode = normalize(code)
        except ValueError:
            return {}
        name_df = self._load_name_map()
        name_row = name_df[name_df["code"] == ncode]
        name = name_row.iloc[0]["name"] if not name_row.empty else ""

        info: dict[str, Any] = {
            "Name": name,
            "Code": ncode,
            "HSStockKind": _classify_kind(ncode),
            "ErrorId": "0",
        }
        # 追加快照里的市值/股本字段
        snap = self.get_market_snapshot(ncode)
        for k in ("Zsz", "Ltsz", "Wtb", "fHSL", "ZTPrice", "DTPrice", "IPO_Price"):
            if k in snap:
                info[k] = snap[k]
        # 追加行业
        ind_df = self._load_industry()
        ind_row = ind_df[ind_df["stock_code"] == ncode]
        if not ind_row.empty:
            r = ind_row.iloc[0]
            info["rs_hyname"] = r.get("行业一级", "")
            info["rs_hyname2"] = r.get("行业二级", "")
            info["rs_hyname3"] = r.get("行业三级", "")
            info["rs_hycode_sim"] = r.get("行业一级_代码", "")

        if field_list:
            info = {k: info.get(k) for k in field_list}
        return info

    def get_gb_info(self, code: str, date_list: DateList, count: int = 1) -> list:
        """Mock 没有股本数据，返回空列表。"""
        return []

    def get_gb_info_by_date(self, code: str, start_date: str, end_date: str = "") -> list:
        """Mock 没有股本数据，返回空列表。"""
        return []

    def get_relation(self, code: str) -> list:
        """从 stock_block_relation.csv 过滤。"""
        try:
            ncode = normalize(code)
        except ValueError:
            return []
        df = self._load_block_relation()
        rows = df[df["stock_code"] == ncode]
        out: list[dict] = []
        for _, r in rows.iterrows():
            out.append({
                "BlockCode": str(r.get("block_code", "")),
                "BlockName": str(r.get("block_name", "")),
                "BlockType": str(r.get("block_type", "")),
                "GPNume": str(r.get("gp_num", "")),
            })
        return out

    def get_ipo_info(self, ipo_type: int = 0, ipo_date: int = 0) -> list:
        """Mock 没有 IPO 数据，返回空列表。"""
        return []

    # ------------------------------------------------------------------
    # 板块/成份股
    # ------------------------------------------------------------------

    def get_stock_list(self, list_type: str = "0", market: str = "") -> list:
        """从 K 线 CSV 取全市场股票代码（``list_type="0"`` 仅 Code，``"1"`` 含 Name）。"""
        kline = self._load_kline()
        if kline.empty:
            return []
        codes = sorted(kline["code"].unique().tolist())
        if list_type == "0":
            return [{"Code": c} for c in codes]
        # 含名称
        name_df = self._load_name_map()
        name_map = dict(zip(name_df["code"], name_df["name"]))
        return [{"Code": c, "Name": name_map.get(c, "")} for c in codes]

    def get_sector_list(self, list_type: str = "0", market: str = "") -> list:
        """从 stock_block_relation.csv 取板块清单。"""
        df = self._load_block_relation()
        if df.empty:
            return []
        agg = df.groupby(["block_code", "block_name", "block_type"]).size().reset_index(name="cnt")
        out: list[dict] = []
        for _, r in agg.iterrows():
            out.append({
                "Code": str(r.get("block_code", "")),
                "Name": str(r.get("block_name", "")),
                "Type": str(r.get("block_type", "")),
            })
        return out

    def get_stock_list_in_sector(
        self, block_code: str, block_type: int = 0, list_type: str = "0"
    ) -> list:
        """从 stock_block_relation.csv 过滤板块成份股。"""
        df = self._load_block_relation()
        rows = df[df["block_code"] == str(block_code)]
        if list_type == "0":
            return [{"Code": c} for c in rows["stock_code"].tolist()]
        # 含名称
        name_df = self._load_name_map()
        name_map = dict(zip(name_df["code"], name_df["name"]))
        return [
            {"Code": c, "Name": name_map.get(c, "")}
            for c in rows["stock_code"].tolist()
        ]

    # ------------------------------------------------------------------
    # 财务类
    # ------------------------------------------------------------------

    def get_gpjy_value(
        self, code: str, date_list: DateList, count: int = 1
    ) -> list:
        """Mock 从 K 线 CSV 取个股交易数据（OHLCV）。"""
        try:
            ncode = normalize(code)
        except ValueError:
            return []
        kline = self._load_kline()
        if kline.empty:
            return []
        sub = kline[kline["code"] == ncode].copy()
        sub["date_norm"] = sub["date"].astype(str).str.replace("-", "")
        target_dates = {normalize_date(d) for d in date_list}
        sub = sub[sub["date_norm"].isin(target_dates)]
        out: list[dict] = []
        for _, r in sub.iterrows():
            out.append({
                "Date": r.get("date", ""),
                "Open": float(r.get("open", 0) or 0),
                "Close": float(r.get("close", 0) or 0),
                "High": float(r.get("high", 0) or 0),
                "Low": float(r.get("low", 0) or 0),
                "Volume": float(r.get("volume", 0) or 0),
                "Amount": float(r.get("amount", 0) or 0),
            })
        return out[:count] if count > 0 else out

    def get_gpjy_value_by_date(
        self, code: str, start_date: str, end_date: str = ""
    ) -> list:
        """时间段个股交易数据。"""
        try:
            ncode = normalize(code)
        except ValueError:
            return []
        kline = self._load_kline()
        if kline.empty:
            return []
        sub = kline[kline["code"] == ncode].copy()
        sub["date_norm"] = sub["date"].astype(str).str.replace("-", "")
        if start_date:
            sub = sub[sub["date_norm"] >= normalize_date(start_date)]
        if end_date:
            sub = sub[sub["date_norm"] <= normalize_date(end_date)]
        out: list[dict] = []
        for _, r in sub.iterrows():
            out.append({
                "Date": r.get("date", ""),
                "Open": float(r.get("open", 0) or 0),
                "Close": float(r.get("close", 0) or 0),
                "High": float(r.get("high", 0) or 0),
                "Low": float(r.get("low", 0) or 0),
                "Volume": float(r.get("volume", 0) or 0),
                "Amount": float(r.get("amount", 0) or 0),
            })
        return out

    def get_financial_data(
        self,
        stock_list: StockList,
        field_list: FieldList,
        start_time: str = "",
        end_time: str = "",
        report_type: str = "announce_time",
    ) -> pd.DataFrame:
        """Mock 没有财务数据，返回空 DataFrame（含字段列）。"""
        return pd.DataFrame(columns=["stock_code"] + list(field_list))

    def get_gp_one_data(
        self, stock_list: StockList, field_list: FieldList
    ) -> dict:
        """Mock 没有 GO 系列数据，返回 ``{code: {field: None}}`` 形式。"""
        out: dict[str, dict] = {}
        for c in stock_list:
            try:
                ncode = normalize(c)
            except ValueError:
                continue
            out[ncode] = {f: None for f in field_list}
        return out

    # ------------------------------------------------------------------
    # ETF / 可转债
    # ------------------------------------------------------------------

    def get_kzz_info(self, code: str, field_list: FieldList | None = None) -> dict:
        """Mock 没有可转债数据，返回空 dict。"""
        return {}

    def get_trackzs_etf_info(self, index_code: str) -> list:
        """Mock 没有 ETF 跟踪指数数据，返回空 list。"""
        return []

    # ------------------------------------------------------------------
    # 板块管理（noop）
    # ------------------------------------------------------------------

    def create_sector(self, block_code: str, block_name: str) -> bool:
        logger.info("[Mock] create_sector(%s, %s) -> noop True", block_code, block_name)
        return True

    def delete_sector(self, block_code: str) -> bool:
        logger.info("[Mock] delete_sector(%s) -> noop True", block_code)
        return True

    def rename_sector(self, block_code: str, new_name: str) -> bool:
        logger.info("[Mock] rename_sector(%s, %s) -> noop True", block_code, new_name)
        return True

    def clear_sector(self, block_code: str) -> bool:
        logger.info("[Mock] clear_sector(%s) -> noop True", block_code)
        return True

    def send_user_block(self, block_code: str, stock_list: StockList) -> bool:
        logger.info("[Mock] send_user_block(%s, %d stocks) -> noop True", block_code, len(stock_list))
        return True

    def get_user_sector(self, block_code: str = "") -> list:
        """Mock 不跟踪用户自定义板块，返回空 list。"""
        return []

    # ------------------------------------------------------------------
    # 通用函数
    # ------------------------------------------------------------------

    def get_trading_dates(
        self, market: str = "", start: str = "", end: str = ""
    ) -> list:
        """从 K 线 CSV 推断交易日。"""
        kline = self._load_kline()
        if kline.empty:
            return []
        dates = sorted(kline["date"].astype(str).str.replace("-", "").unique().tolist())
        if start:
            s = normalize_date(start)
            dates = [d for d in dates if d >= s]
        if end:
            e = normalize_date(end)
            dates = [d for d in dates if d <= e]
        return dates

    def send_warn(self, stock_list: StockList, **kwargs: Any) -> bool:
        logger.info("[Mock] send_warn(%d stocks, %s) -> noop True", len(stock_list), kwargs)
        return True

    def send_message(self, msg: str) -> bool:
        logger.info("[Mock] send_message(%r) -> noop True", msg[:80])
        return True

    def subscribe_hq(
        self,
        stock_list: StockList,
        callback: Callback,
        batch_size: int | None = None,
    ) -> bool:
        """Mock 用后台线程模拟行情推送。

        每隔 ``mock.push_interval`` 秒，对所有已订阅代码各调用一次 ``callback``，
        推送数据来自快照 CSV。
        """
        cfg = ConfigLoader()
        bs = batch_size or int(cfg.get("tqcenter.subscribe_batch_size", 50))
        codes: list[str] = []
        for c in stock_list:
            try:
                codes.append(normalize(c))
            except ValueError:
                continue

        with self._sub_lock:
            self._sub_batch_no += 1
            batch_no = self._sub_batch_no
            for c in codes:
                self._subscribers.setdefault(c, []).append((callback, f"batch_{batch_no}"))

        logger.info(
            "[Mock] subscribe_hq: %d 个代码（batch_size=%d, batch_no=%d）",
            len(codes), bs, batch_no,
        )

        # 启动推送线程（如果未启动）
        if self._push_thread is None or not self._push_thread.is_alive():
            self._push_stop.clear()
            self._push_thread = threading.Thread(
                target=self._push_loop, name="MockAdapter-Push", daemon=True
            )
            self._push_thread.start()
        return True

    def unsubscribe_hq(self, stock_list: StockList) -> bool:
        """取消订阅。``stock_list`` 为空表示取消所有订阅。"""
        with self._sub_lock:
            if not stock_list:
                self._subscribers.clear()
            else:
                codes = []
                for c in stock_list:
                    try:
                        codes.append(normalize(c))
                    except ValueError:
                        continue
                for c in codes:
                    self._subscribers.pop(c, None)
            empty = not self._subscribers
        if empty and self._push_thread and self._push_thread.is_alive():
            self._push_stop.set()
            self._push_thread.join(timeout=2)
            self._push_thread = None
        return True

    def refresh_kline(self, stock_code: str, period: str = "1d") -> bool:
        logger.info("[Mock] refresh_kline(%s, %s) -> noop True", stock_code, period)
        return True

    def refresh_cache(self, market: str = "AG", force: bool = False) -> bool:
        """[Mock] 刷新行情缓存：noop 返回 True。

        Mock 模式数据来自 V8 CSV 快照，无需刷新；保留接口对齐 BaseDataAdapter。
        """
        logger.info("[Mock] refresh_cache(market=%s, force=%s) -> noop True", market, force)
        return True

    def download_data(self, stock_code: str, start_date: str, end_date: str) -> bool:
        logger.info("[Mock] download_data(%s, %s, %s) -> noop True", stock_code, start_date, end_date)
        return True

    def download_file(
        self, stock_code: str, down_time: str = "", down_type: int = 4
    ) -> dict:
        """[Mock] ``tq.download_file`` 直通：noop 返回成功响应。

        Mock 模式无真实文件下载；返回说明书约定的成功结构。
        """
        logger.info("[Mock] download_file(%s, down_time=%s, down_type=%s) -> noop", stock_code, down_time, down_type)
        return {"ErrorId": "0", "Msg": "Mock 模式无下载", "run_id": "mock"}

    # ------------------------------------------------------------------
    # 推送线程
    # ------------------------------------------------------------------

    def _push_loop(self) -> None:
        """Mock 推送循环：定期读取快照 CSV，对所有已订阅代码回调。"""
        logger.info("MockAdapter 推送线程启动 (interval=%.1fs)", self._push_interval)
        while not self._push_stop.is_set():
            try:
                with self._sub_lock:
                    subscribers = dict(self._subscribers)
                if not subscribers:
                    break
                snapshot = self._load_snapshot()
                for code, cb_list in subscribers.items():
                    row = snapshot[snapshot["code"] == code]
                    if row.empty:
                        continue
                    snap = row.iloc[0].to_dict()
                    snap["code"] = code
                    snap["ErrorId"] = "0"
                    for cb, _sub_id in list(cb_list):
                        try:
                            cb(snap)
                        except Exception as exc:  # noqa: BLE001
                            logger.error("推送回调异常 %s: %s", code, exc)
            except Exception as exc:  # noqa: BLE001
                logger.error("推送循环异常: %s", exc)
            self._push_stop.wait(self._push_interval)
        logger.info("MockAdapter 推送线程退出")

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


# ----------------------------------------------------------------------------
# 辅助
# ----------------------------------------------------------------------------


def _to_float(v: Any) -> float:
    """安全转 float。"""
    try:
        if v is None or v == "":
            return 0.0
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _safe_sub(d: dict, key: str, default: Any = "") -> Any:
    """安全取 dict 子键，缺失返回 default。"""
    return d.get(key, default) if isinstance(d, dict) else default


def _classify_kind(code: str) -> int:
    """根据代码前缀推断 HSStockKind（粗略，仅 Mock 用）。

    枚举参考 worklog Task 2-b：
    0=指数 / 1=A股主板 / 2=北证A股 / 3=创业板 / 4=科创板 / 5=B股 / 6=债券 /
    7=基金 / 8=权证 / 9=其它 / 10=非沪深京品种
    """
    if "." not in code:
        return 9
    pure, market = code.split(".")
    if pure.startswith("000001") or pure.startswith("399"):
        return 0  # 指数
    if market == "BJ":
        return 2
    if market == "SH" and pure.startswith("688"):
        return 4  # 科创板
    if market == "SZ" and pure.startswith("3"):
        return 3  # 创业板
    if market in ("SH", "SZ") and pure.startswith(("5", "1")):
        return 7  # 基金/ETF
    if market in ("SH", "SZ") and pure.startswith(("11", "12")):
        return 6  # 可转债
    if market in ("SH", "SZ") and pure.startswith(("6", "0")):
        return 1  # 主板
    return 9
