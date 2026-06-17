"""数据加载步骤。

根据策略 YAML 的 ``universe`` 与 ``factors`` 配置，从数据适配器拉取所需数据，
应用 universe 过滤，结果存入 ``context.data``。

输出到 ``context.data`` 的 key:
- ``stock_list``  - 全市场股票列表
- ``snapshot``    - L2 快照数据
- ``kline``       - K 线数据（多日合并，按 code+date 排序）
- ``financial``   - 财务数据（如策略因子需要）
- ``universe``    - 经过 universe 过滤后的股票池（pd.DataFrame, 含 code 列）

V8 兼容性
----------
V8 选股的 universe 过滤逻辑:
1. 排除 T0 基金、可转债、停牌 (IsT0Fund=0 & IsKzz=0 & TPFlag=0 & SafeValue!=-1)
2. 股票代码正则: ``^(6|0|3|4|8)\\d{5}\\.(SZ|SH|BJ)$``
3. 排除 ST (基于名称包含 "ST")
4. 排除新股 (上市不足 N 天，可配置)
5. 老登过滤 (V8: YearZTDay==0 & fHSL<1 & BetaValue<0.8) - 已移到清洗步骤

P1-3 依赖
----------
- ``adapter.get_stock_list(list_type)`` - 获取全市场股票列表
- ``adapter.get_snapshot(code)`` 或批量 - 获取 L2 快照
- ``adapter.get_kline(stock_list, period, start, end, count, dividend_type)`` - K 线
- ``adapter.get_financial_data(code, field, start, end)`` - 财务数据

P1-3 接口未稳定时，本步骤对 ``AttributeError`` / ``NotImplementedError`` 做兜底处理，
返回空 DataFrame 并记录警告，保证流水线不中断。
"""
from __future__ import annotations

import logging
import re
from typing import Any

import pandas as pd

from engine.pipeline.base import PipelineContext, PipelineStep, StepExecutionError

logger = logging.getLogger(__name__)

# 股票代码正则 (V8 兼容)
_STOCK_CODE_REGEX = re.compile(r"^(6|0|3|4|8)\d{5}\.(SZ|SH|BJ)$")


class LoadDataStep(PipelineStep):
    """数据加载步骤。"""

    step_id = "load_data"
    step_name = "数据加载"

    def execute(self, context: PipelineContext) -> PipelineContext:
        universe_cfg: dict[str, Any] = self.config.get("universe", {}) or {}
        factors_cfg: list[dict[str, Any]] = self.config.get("factors", []) or []
        data_cfg: dict[str, Any] = self.config.get("data", {}) or {}

        # 1. 加载全市场股票列表
        stock_list_df = self._load_stock_list()
        context.data["stock_list"] = stock_list_df
        self.logger.info("股票列表: %d 只", len(stock_list_df))

        # 2. 加载 L2 快照
        snapshot_df = self._load_snapshot(data_cfg)
        context.data["snapshot"] = snapshot_df
        self.logger.info("L2 快照: %d 条", len(snapshot_df))

        # 3. 加载 K 线
        kline_df = self._load_kline(data_cfg)
        context.data["kline"] = kline_df
        self.logger.info("K 线: %d 条", len(kline_df))

        # 4. 按需加载财务数据
        if self._needs_financial(factors_cfg):
            financial_df = self._load_financial(data_cfg)
            context.data["financial"] = financial_df
            self.logger.info("财务数据: %d 条", len(financial_df))

        # 5. 应用 universe 过滤
        universe_df = self._apply_universe(snapshot_df, universe_cfg)
        context.data["universe"] = universe_df
        self.logger.info("universe 过滤后: %d 只", len(universe_df))

        return context

    # ---- 各数据源加载（带兜底） ----
    def _load_stock_list(self) -> pd.DataFrame:
        """加载全市场股票列表。

        P1-3 真实接口: ``adapter.get_stock_list(list_type, market)``
        - ``list_type='0'`` 仅 Code, ``'1'`` Code+Name
        - ``market='5'`` 全部 A 股
        返回 ``list[str]`` 或 ``list[dict]``。
        """
        adapter = self._safe_adapter()
        if adapter is None:
            return pd.DataFrame(columns=["code", "name"])
        try:
            market = self.config.get("data", {}).get("stock_market", "5")
            stock_list = adapter.get_stock_list(list_type="1", market=market)
            return _normalize_stock_list(stock_list)
        except (AttributeError, NotImplementedError) as exc:
            self.logger.warning("get_stock_list 未实现或异常，返回空: %s", exc)
            return pd.DataFrame(columns=["code", "name"])
        except Exception as exc:  # noqa: BLE001
            raise StepExecutionError(self.step_id, f"加载股票列表失败: {exc}", exc) from exc

    def _load_snapshot(self, data_cfg: dict[str, Any]) -> pd.DataFrame:
        """加载 L2 快照（全市场）。

        P1-3 真实接口无批量快照方法，本步骤尝试以下顺序:
        1. ``adapter.get_snapshot_batch()`` (Mock 自定义批量接口，如有)
        2. ``adapter.get_market_snapshot_all()`` (Mock 自定义批量接口，如有)
        3. ``adapter.get_snapshot()`` (旧式批量接口，向后兼容)
        4. ``adapter.get_market_snapshot(code)`` 逐只调用 (慢，仅小盘)

        Mock 适配器（P1-3 完成后）应实现 1/2 之一以支持批量。
        """
        adapter = self._safe_adapter()
        if adapter is None:
            return pd.DataFrame()
        try:
            for method_name in (
                "get_snapshot_batch",
                "get_market_snapshot_all",
                "get_snapshot",
                "get_all_snapshots",
            ):
                method = getattr(adapter, method_name, None)
                if method is None:
                    continue
                df = method()
                if df is None:
                    continue
                if isinstance(df, pd.DataFrame):
                    return df
                if isinstance(df, dict):
                    # 单只 dict → 包成 DataFrame
                    return pd.DataFrame([df])
                if isinstance(df, list):
                    return pd.DataFrame(df)
            # 全部方法都不可用 → 返回空
            self.logger.warning("adapter 无可用批量快照接口，返回空 DataFrame")
            return pd.DataFrame()
        except (AttributeError, NotImplementedError) as exc:
            self.logger.warning("快照加载未实现或异常，返回空: %s", exc)
            return pd.DataFrame()
        except Exception as exc:  # noqa: BLE001
            raise StepExecutionError(self.step_id, f"加载快照失败: {exc}", exc) from exc

    def _load_kline(self, data_cfg: dict[str, Any]) -> pd.DataFrame:
        """加载 K 线数据。

        P1-3 真实接口: ``adapter.get_market_data(stock_list, period, start_time,
        end_time, count, dividend_type, field_list, fill_data)``
        返回 ``dict[field -> DataFrame]`` (index=stock, columns=time)。

        本步骤将其转置为长格式 DataFrame: ``[code, date, open, high, low, close, volume, amount]``。
        """
        adapter = self._safe_adapter()
        if adapter is None:
            return pd.DataFrame()
        try:
            period = data_cfg.get("kline_period", "1d")
            count = data_cfg.get("kline_count", -1)
            dividend_type = data_cfg.get("dividend_type", "front")
            start_time = data_cfg.get("kline_start", "")
            end_time = data_cfg.get("kline_end", "")
            stock_list = context_codes(adapter)
            if not stock_list:
                return pd.DataFrame()

            # 1. 优先用 P1-3 真实接口 get_market_data
            if hasattr(adapter, "get_market_data"):
                data_dict = adapter.get_market_data(
                    stock_list=stock_list,
                    period=period,
                    start_time=start_time,
                    end_time=end_time,
                    count=count,
                    dividend_type=dividend_type,
                )
                return _kline_dict_to_long(data_dict)
            # 2. 兜底: 旧式 get_kline 接口
            if hasattr(adapter, "get_kline"):
                df = adapter.get_kline(
                    stock_list=stock_list,
                    period=period,
                    start=start_time,
                    end=end_time,
                    count=count,
                    dividend_type=dividend_type,
                )
                if df is None:
                    return pd.DataFrame()
                return df if isinstance(df, pd.DataFrame) else pd.DataFrame(df)
            self.logger.warning("adapter 无 get_market_data / get_kline，K 线返回空")
            return pd.DataFrame()
        except (AttributeError, NotImplementedError) as exc:
            self.logger.warning("K 线加载未实现或异常，返回空: %s", exc)
            return pd.DataFrame()
        except Exception as exc:  # noqa: BLE001
            raise StepExecutionError(self.step_id, f"加载 K 线失败: {exc}", exc) from exc

    def _load_financial(self, data_cfg: dict[str, Any]) -> pd.DataFrame:
        """加载财务数据。

        P1-3 真实接口: ``adapter.get_financial_data(stock_list, field_list,
        start_time, end_time, report_type)`` 返回 DataFrame。
        """
        adapter = self._safe_adapter()
        if adapter is None:
            return pd.DataFrame()
        try:
            stock_list = context_codes(adapter)
            if not stock_list:
                return pd.DataFrame()
            fields = data_cfg.get("financial_fields", ["pe_ttm", "pb_ratio"])
            try:
                # 优先用 P1-3 真实签名
                df = adapter.get_financial_data(
                    stock_list=stock_list,
                    field_list=fields,
                    start_time=data_cfg.get("financial_start", ""),
                    end_time=data_cfg.get("financial_end", ""),
                )
                return df if isinstance(df, pd.DataFrame) else pd.DataFrame()
            except TypeError:
                # 兜底: 旧式 (code, field, start, end) 单字段签名
                frames: list[pd.DataFrame] = []
                for field in fields:
                    df = adapter.get_financial_data(
                        code=stock_list,
                        field=field,
                        start=data_cfg.get("financial_start"),
                        end=data_cfg.get("financial_end"),
                    )
                    if df is not None and not df.empty:
                        frames.append(df)
                return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        except (AttributeError, NotImplementedError) as exc:
            self.logger.warning("财务数据加载未实现或异常，返回空: %s", exc)
            return pd.DataFrame()
        except Exception as exc:  # noqa: BLE001
            raise StepExecutionError(self.step_id, f"加载财务数据失败: {exc}", exc) from exc

    # ---- universe 过滤 ----
    def _apply_universe(self, snapshot_df: pd.DataFrame, universe_cfg: dict[str, Any]) -> pd.DataFrame:
        if snapshot_df.empty:
            return snapshot_df

        df = snapshot_df.copy()

        # 1. 股票代码正则
        if "code" in df.columns:
            df = df[df["code"].astype(str).str.match(_STOCK_CODE_REGEX, na=False)]

        # 2. 排除 ST
        if universe_cfg.get("exclude_st", True):
            name_col = "股票名称" if "股票名称" in df.columns else "name" if "name" in df.columns else None
            if name_col:
                df = df[~df[name_col].astype(str).str.contains("ST", case=False, na=False)]

        # 3. 排除停牌 (V8: TPFlag=0)
        if universe_cfg.get("exclude_suspended", True):
            if "TPFlag" in df.columns:
                df = df[pd.to_numeric(df["TPFlag"], errors="coerce").fillna(0) == 0]
            if "IsT0Fund" in df.columns:
                df = df[pd.to_numeric(df["IsT0Fund"], errors="coerce").fillna(0) == 0]
            if "IsKzz" in df.columns:
                df = df[pd.to_numeric(df["IsKzz"], errors="coerce").fillna(0) == 0]
            if "SafeValue" in df.columns:
                df = df[pd.to_numeric(df["SafeValue"], errors="coerce") != -1]

        # 4. 排除新股 (上市不足 N 天)
        n_days = universe_cfg.get("exclude_new_listing_days")
        if n_days and "list_days" in df.columns:
            df = df[pd.to_numeric(df["list_days"], errors="coerce").fillna(0) >= n_days]

        # 5. 市场过滤
        market_list = universe_cfg.get("market_list")
        if market_list and "code" in df.columns:
            market_set = set(market_list)
            df = df[df["code"].astype(str).str[-2:].isin(market_set)]

        # 6. 黑名单/白名单
        exclude_codes = set(universe_cfg.get("exclude_codes", []) or [])
        include_only = set(universe_cfg.get("include_only", []) or [])
        if "code" in df.columns:
            if exclude_codes:
                df = df[~df["code"].isin(exclude_codes)]
            if include_only:
                df = df[df["code"].isin(include_only)]

        return df.reset_index(drop=True)

    # ---- 工具 ----
    def _safe_adapter(self):
        if self.adapter is None:
            self.logger.warning("数据适配器未注入，返回空数据")
            return None
        return self.adapter

    def _needs_financial(self, factors_cfg: list[dict[str, Any]]) -> bool:
        financial_factors = {"pe_ttm", "pb_ratio", "market_cap"}
        for f in factors_cfg:
            if f.get("factor_id") in financial_factors:
                return True
        return False


def context_codes(adapter: Any) -> list[str]:
    """从 adapter 获取股票代码列表（兜底返回空）。"""
    try:
        # 优先用 P1-3 真实签名 get_stock_list(list_type, market)
        try:
            stock_list = adapter.get_stock_list(list_type="0", market="5")
        except TypeError:
            stock_list = adapter.get_stock_list(list_type="all")
        df = _normalize_stock_list(stock_list)
        if not df.empty and "code" in df.columns:
            return df["code"].tolist()
    except Exception:  # noqa: BLE001
        pass
    return []


def _normalize_stock_list(stock_list: Any) -> pd.DataFrame:
    """把 adapter.get_stock_list 返回值统一成 DataFrame[code, name]。"""
    if isinstance(stock_list, pd.DataFrame):
        if "code" not in stock_list.columns and len(stock_list.columns) >= 1:
            stock_list = stock_list.rename(columns={stock_list.columns[0]: "code"})
        return stock_list
    if isinstance(stock_list, list):
        if not stock_list:
            return pd.DataFrame(columns=["code", "name"])
        first = stock_list[0]
        if isinstance(first, str):
            return pd.DataFrame({"code": stock_list, "name": stock_list})
        if isinstance(first, dict):
            return pd.DataFrame(stock_list)
        if isinstance(first, (tuple, list)):
            return pd.DataFrame(stock_list, columns=["code", "name"][:len(first)])
    return pd.DataFrame(columns=["code", "name"])


def _kline_dict_to_long(data_dict: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """把 P1-3 ``get_market_data`` 返回的 ``dict[field -> DataFrame]``
    (index=stock, columns=time) 转为长格式 DataFrame。

    输出列: ``[code, date, open, high, low, close, volume, amount]`` (按可用字段)。
    """
    if not data_dict:
        return pd.DataFrame()
    # 把每个字段 DataFrame 转为长格式
    long_frames: list[pd.DataFrame] = []
    for field, df in data_dict.items():
        if not isinstance(df, pd.DataFrame) or df.empty:
            continue
        long = df.stack().reset_index()
        long.columns = ["code", "date", field]
        long_frames.append(long)
    if not long_frames:
        return pd.DataFrame()
    # 按 code, date 合并所有字段
    result = long_frames[0]
    for f in long_frames[1:]:
        result = result.merge(f, on=["code", "date"], how="outer")
    return result.sort_values(["code", "date"]).reset_index(drop=True)
