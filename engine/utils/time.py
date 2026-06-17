"""交易日 / 时间工具。

提供：
1. 交易日列表获取（Mock 模式基于 V8 CSV 推断；Real 模式委托适配器）
2. 日期格式归一化（``YYYYMMDD`` / ``YYYY-MM-DD`` / epoch 互转）
3. 前后 N 个交易日计算

约束：本模块自身不访问网络，所有数据由调用方注入或基于 V8 CSV 推断。
"""

from __future__ import annotations

import csv
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable


# ----------------------------------------------------------------------------
# 日期归一化
# ----------------------------------------------------------------------------


def normalize_date(d: str | int | date | datetime) -> str:
    """把多种日期输入归一化为 ``YYYYMMDD`` 字符串。

    接受：
    - ``"20260616"`` / ``"2026-06-16"`` / ``"2026/06/16"``
    - ``20260616``（int）
    - ``date(2026, 6, 16)`` / ``datetime(2026, 6, 16, ...)``

    Returns:
        ``"20260616"`` 形式。
    """
    if isinstance(d, datetime):
        return d.strftime("%Y%m%d")
    if isinstance(d, date):
        return d.strftime("%Y%m%d")
    if isinstance(d, int):
        return str(d)
    if not isinstance(d, str):
        raise TypeError(f"不支持的日期类型: {type(d)}")
    s = d.strip().replace("-", "").replace("/", "").replace(" ", "")
    if not s.isdigit() or len(s) != 8:
        raise ValueError(f"日期格式非法: {d!r}")
    return s


def to_iso(d: str | int | date | datetime) -> str:
    """归一化为 ``YYYY-MM-DD`` 字符串。"""
    s = normalize_date(d)
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def to_date(d: str | int | date | datetime) -> date:
    """归一化为 ``datetime.date`` 对象。"""
    s = normalize_date(d)
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def today_str() -> str:
    """今天 ``YYYYMMDD``。"""
    return date.today().strftime("%Y%m%d")


# ----------------------------------------------------------------------------
# 交易日历（基于 V8 CSV 推断）
# ----------------------------------------------------------------------------


class TradingCalendar:
    """交易日历（基于已知交易日期集合）。

    Mock 模式从 V8 K 线 CSV 推断；Real 模式应由 ``RealAdapter.get_trading_dates``
    构造后注入。本类自身只做集合运算。
    """

    def __init__(self, trading_days: Iterable[str] | None = None) -> None:
        # 内部统一存 YYYYMMDD 字符串
        self._days: set[str] = set()
        self._sorted: list[str] = []
        if trading_days:
            for d in trading_days:
                try:
                    self._days.add(normalize_date(d))
                except ValueError:
                    continue
            self._sorted = sorted(self._days)

    @classmethod
    def from_kline_csv(cls, csv_paths: list[str | Path]) -> "TradingCalendar":
        """从 V8 K 线 CSV 推断交易日（``date`` 列）。

        CSV 头：``code,date,open,high,low,close,...``，日期可能是
        ``2026-06-16`` 或 ``20260616``。
        """
        days: set[str] = set()
        for p in csv_paths:
            path = Path(p)
            if not path.exists():
                continue
            with open(path, "r", encoding="utf-8-sig", newline="") as fp:
                reader = csv.DictReader(fp)
                for row in reader:
                    raw = (row.get("date") or "").strip()
                    if not raw:
                        continue
                    try:
                        days.add(normalize_date(raw))
                    except ValueError:
                        continue
        return cls(trading_days=days)

    def is_trading_day(self, d: str | int | date | datetime) -> bool:
        """是否交易日。"""
        return normalize_date(d) in self._days

    def trading_days(
        self, start: str | int | date | datetime | None = None, end: str | int | date | datetime | None = None
    ) -> list[str]:
        """返回 ``[start, end]`` 区间内的交易日列表（升序）。

        ``start`` / ``end`` 任一为空表示不限制。
        """
        s = normalize_date(start) if start else None
        e = normalize_date(end) if end else None
        return [d for d in self._sorted if (s is None or d >= s) and (e is None or d <= e)]

    def previous(self, d: str | int | date | datetime, n: int = 1) -> str:
        """返回 ``d`` 之前 n 个交易日（``YYYYMMDD``）。

        若 ``d`` 本身不是交易日，从最近的更早交易日算起。
        """
        if n <= 0:
            return normalize_date(d)
        target = normalize_date(d)
        earlier = [x for x in self._sorted if x < target]
        if not earlier:
            return target
        if n > len(earlier):
            return earlier[0]
        return earlier[-n]

    def next(self, d: str | int | date | datetime, n: int = 1) -> str:
        """返回 ``d`` 之后 n 个交易日。"""
        if n <= 0:
            return normalize_date(d)
        target = normalize_date(d)
        later = [x for x in self._sorted if x > target]
        if not later:
            return target
        if n > len(later):
            return later[-1]
        return later[n - 1]

    def latest_before(self, d: str | int | date | datetime | None = None) -> str | None:
        """返回不超过 ``d``（默认今天）的最近一个交易日。"""
        target = normalize_date(d) if d else today_str()
        earlier_eq = [x for x in self._sorted if x <= target]
        return earlier_eq[-1] if earlier_eq else None

    @property
    def all_days(self) -> list[str]:
        """所有已知交易日（升序）。"""
        return list(self._sorted)

    def __len__(self) -> int:
        return len(self._sorted)


# ----------------------------------------------------------------------------
# 便捷函数
# ----------------------------------------------------------------------------


def days_between(start: str | int | date | datetime, end: str | int | date | datetime) -> int:
    """自然日间隔天数（``end - start``）。"""
    d1 = to_date(start)
    d2 = to_date(end)
    return (d2 - d1).days


def shift_days(d: str | int | date | datetime, delta: int) -> str:
    """自然日加减，返回 ``YYYYMMDD``。"""
    dt = to_date(d) + timedelta(days=delta)
    return dt.strftime("%Y%m%d")
