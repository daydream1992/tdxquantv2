"""股票代码工具。

提供：
1. 代码格式校验（``600519.SH`` / ``000001.SZ`` / ``830508.BJ`` / ``510300.SH`` ETF 等）
2. 市场判断（沪 / 深 / 北 / 港 / 期 / 基金 / 可转债 / 指数）
3. 拼音检索（基于名称映射 CSV，用于 Mock 适配器与 Web 模糊搜索）
4. 代码归一化（处理无后缀 / 大小写 / 前导零缺失等输入）

约束：本模块不访问网络，所有数据来自静态映射或运行时传入。
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

# ----------------------------------------------------------------------------
# 常量
# ----------------------------------------------------------------------------

# 标准代码格式：6 位数字 + .SH/.SZ/.BJ
_CODE_PATTERN = re.compile(r"^\d{6}\.(SH|SZ|BJ)$", re.IGNORECASE)

# 指数代码：000001.SH（上证综指）等
_INDEX_PATTERN = re.compile(r"^(000001|000002|000003|000009|000010|000016|000300|000905|399001|399006|399300)\.(SH|SZ)$")

# 可转债：113xxx.SH / 127xxx.SZ / 128xxx.SZ / 110xxx.SH
_KZZ_PATTERN = re.compile(r"^(11[0-9]{4}|12[78][0-9]{3})\.(SH|SZ)$")

# ETF：5xxxxx.SH / 1xxxxx.SZ
_ETF_PATTERN = re.compile(r"^(5[0-9]{5})\.SH$|^(15[0-9]{4}|16[0-9]{4})\.SZ$")


@dataclass(frozen=True)
class StockCodeInfo:
    """股票代码解析结果。"""

    code: str  # 归一化后的代码，如 "600519.SH"
    pure_code: str  # 不带后缀的 6 位数字
    market: str  # SH / SZ / BJ
    category: str  # stock / index / etf / kzz / fund
    board: str  # main / star / gem / bj / ""


# ----------------------------------------------------------------------------
# 校验与归一化
# ----------------------------------------------------------------------------


def normalize(code: str) -> str:
    """归一化股票代码。

    - 全角字符 / 空格清理
    - 小写后缀转大写
    - 无后缀时按规则补全（6 开头 SH，0/3 开头 SZ，8/4 开头 BJ）

    Args:
        code: 用户输入代码，可能形如 "  600519.sh " / "600519" / "sz000001"。

    Returns:
        归一化后的 ``"600519.SH"`` 形式。

    Raises:
        ValueError: 代码非法（非 6 位数字 / 后缀缺失且无法推断）。
    """
    if not code or not isinstance(code, str):
        raise ValueError(f"代码不能为空: {code!r}")
    s = code.strip().upper().replace(" ", "")
    # 处理 sz000001 / sh600519 这类前缀写法
    m = re.match(r"^(SH|SZ|BJ)(\d{6})$", s)
    if m:
        s = f"{m.group(2)}.{m.group(1)}"
    if "." not in s:
        # 无后缀，按规则推断
        if not re.match(r"^\d{6}$", s):
            raise ValueError(f"代码格式非法（需 6 位数字）: {code!r}")
        head = s[0]
        if head == "6":
            s = f"{s}.SH"
        elif head in ("0", "3"):
            s = f"{s}.SZ"
        elif head in ("8", "4"):
            s = f"{s}.BJ"
        else:
            raise ValueError(f"代码前缀无法推断市场: {code!r}")
    # 大小写
    s = s.upper()
    if not _CODE_PATTERN.match(s):
        raise ValueError(f"代码格式非法: {code!r}")
    return s


def is_valid(code: str) -> bool:
    """代码是否合法（不抛异常）。"""
    try:
        normalize(code)
        return True
    except ValueError:
        return False


def parse(code: str) -> StockCodeInfo:
    """解析代码，返回 ``StockCodeInfo``。"""
    ncode = normalize(code)
    pure, market = ncode.split(".")
    category = _classify(pure, market)
    board = _board(pure, market, category)
    return StockCodeInfo(
        code=ncode,
        pure_code=pure,
        market=market,
        category=category,
        board=board,
    )


def _classify(pure: str, market: str) -> str:
    if _INDEX_PATTERN.match(f"{pure}.{market}"):
        return "index"
    if _ETF_PATTERN.match(f"{pure}.{market}"):
        return "etf"
    if _KZZ_PATTERN.match(f"{pure}.{market}"):
        return "kzz"
    # 北交所 8/4 开头
    if market == "BJ":
        return "stock"
    return "stock"


def _board(pure: str, market: str, category: str) -> str:
    if category != "stock":
        return ""
    head = pure[0]
    if market == "SH":
        if head == "6" and pure.startswith("688"):
            return "star"  # 科创板
        if head == "6":
            return "main"  # 沪主板
    if market == "SZ":
        if head == "3":
            return "gem"  # 创业板
        if head == "0":
            return "main"  # 深主板
    if market == "BJ":
        return "bj"
    return ""


# ----------------------------------------------------------------------------
# 批量过滤
# ----------------------------------------------------------------------------


def filter_stocks(
    codes: Iterable[str],
    *,
    exclude_st: bool = False,
    exclude_kzz: bool = False,
    exclude_etf: bool = False,
    exclude_index: bool = True,
    markets: tuple[str, ...] | None = None,
    boards: tuple[str, ...] | None = None,
    name_map: dict[str, str] | None = None,
) -> list[str]:
    """批量过滤股票代码。

    Args:
        codes: 待过滤代码列表。
        exclude_st: 排除 ST/*ST 股（依赖 name_map 判断名称是否含 "ST"）。
        exclude_kzz: 排除可转债。
        exclude_etf: 排除 ETF。
        exclude_index: 排除指数（默认 True）。
        markets: 仅保留这些市场（``SH``/``SZ``/``BJ``）。
        boards: 仅保留这些板块（``main``/``star``/``gem``/``bj``）。
        name_map: ``code -> name`` 映射，用于 ST 判断。

    Returns:
        过滤后的代码列表（已归一化）。
    """
    out: list[str] = []
    for c in codes:
        try:
            info = parse(c)
        except ValueError:
            continue
        if exclude_index and info.category == "index":
            continue
        if exclude_kzz and info.category == "kzz":
            continue
        if exclude_etf and info.category == "etf":
            continue
        if markets and info.market not in markets:
            continue
        if boards and info.board and info.board not in boards:
            continue
        if exclude_st and name_map:
            name = name_map.get(info.code, "")
            if name and ("ST" in name.upper() or "*" in name):
                continue
        out.append(info.code)
    return out


# ----------------------------------------------------------------------------
# 拼音检索（基于 stock_name_mapping.csv）
# ----------------------------------------------------------------------------


class PinyinIndex:
    """拼音 / 名称 / 代码模糊检索索引。

    基于 V8 系统的 ``stock_name_mapping.csv``（仅 ``code,name`` 两列）。
    高级拼音检索（首字母 / 全拼）需要外部词库，本类只做名称子串 + 代码子串匹配。
    """

    def __init__(self, name_map: dict[str, str] | None = None) -> None:
        self._name_map: dict[str, str] = name_map or {}
        # 反向索引：name -> code
        self._reverse: dict[str, str] = {n: c for c, n in self._name_map.items()}

    @classmethod
    def from_csv(cls, csv_path: str | Path) -> "PinyinIndex":
        """从 ``stock_name_mapping.csv`` 加载索引。

        CSV 列：``code,name``，UTF-8 with BOM。
        """
        path = Path(csv_path)
        name_map: dict[str, str] = {}
        if path.exists():
            with open(path, "r", encoding="utf-8-sig", newline="") as fp:
                reader = csv.DictReader(fp)
                for row in reader:
                    code = (row.get("code") or "").strip()
                    name = (row.get("name") or "").strip()
                    if code and name:
                        name_map[code.upper()] = name
        return cls(name_map=name_map)

    def search(self, keyword: str, max_count: int = 50) -> list[tuple[str, str]]:
        """模糊检索。

        匹配规则（按优先级）：
        1. 代码完全匹配
        2. 代码前缀匹配
        3. 名称完全匹配
        4. 名称子串匹配

        Args:
            keyword: 关键字（代码 / 名称 / 拼音首字母等任意字符串）。
            max_count: 最多返回条数。

        Returns:
            ``[(code, name), ...]`` 列表。
        """
        if not keyword:
            return []
        kw = keyword.strip().upper()
        # 1) 代码完全匹配
        exact: list[tuple[str, str]] = []
        prefix: list[tuple[str, str]] = []
        name_exact: list[tuple[str, str]] = []
        name_sub: list[tuple[str, str]] = []

        for code, name in self._name_map.items():
            if code == kw:
                exact.append((code, name))
            elif code.startswith(kw):
                prefix.append((code, name))
            if name == keyword:
                name_exact.append((code, name))
            elif keyword in name:
                name_sub.append((code, name))

        out: list[tuple[str, str]] = []
        out.extend(exact)
        out.extend(prefix)
        out.extend(name_exact)
        out.extend(name_sub)
        # 去重保序
        seen: set[str] = set()
        result: list[tuple[str, str]] = []
        for c, n in out:
            if c not in seen:
                seen.add(c)
                result.append((c, n))
            if len(result) >= max_count:
                break
        return result

    def get_name(self, code: str) -> str:
        """取股票名称，找不到返回空串。"""
        try:
            ncode = normalize(code)
        except ValueError:
            ncode = code.upper()
        return self._name_map.get(ncode, "")

    @property
    def size(self) -> int:
        """索引大小。"""
        return len(self._name_map)
