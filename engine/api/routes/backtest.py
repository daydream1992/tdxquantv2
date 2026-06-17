"""``/api/backtest`` 路由 - 简化版回测引擎。

端点清单
--------
- ``POST  /api/backtest/run``         - 启动一次回测
- ``GET   /api/backtest/history``     - 历史回测列表
- ``GET   /api/backtest/{run_id}``    - 单次回测详情

简化版回测逻辑
--------------
- 用户选择策略 + 日期范围 + 初始资金 + top_n + hold_days
- 从 ``selection_results`` 表读该策略历史选股（按 run_date 升序）
  - 若无数据则 mock 20 个交易日，每日 3-5 只股票
- 每个选股日：等权买入 top_n 只股票，持有 N 天后卖出
- 用 mock 涨跌幅（基于 stock_code md5 hash 确定性生成 -3%~+5%）
  - 同一股票每次回测涨幅一致（确定性）
- 计算每日总资产 / 收益率 / 最大回撤 / 夏普 / 胜率
- 写入 DuckDB ``backtest_results`` 表（惰性创建）
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import uuid
from datetime import datetime, timedelta
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from engine.api.deps import get_config, get_storage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["backtest"])


# ============================================================================
# Schemas
# ============================================================================


class BacktestRunRequest(BaseModel):
    """``POST /api/backtest/run`` 入参。"""

    strategy_id: str = Field(..., description="策略 ID")
    start_date: str = Field(..., description="开始日期 YYYY-MM-DD")
    end_date: str = Field(..., description="结束日期 YYYY-MM-DD")
    initial_capital: float = Field(100_000.0, ge=1_000.0, description="初始资金")
    top_n: int = Field(5, ge=1, le=30, description="每次选股持仓数")
    hold_days: int = Field(5, ge=1, le=60, description="持仓天数")


class BacktestDailyEquity(BaseModel):
    """回测每日权益点。"""

    date: str
    equity: float
    return_pct: float
    drawdown: float


class BacktestTrade(BaseModel):
    """回测单笔交易。"""

    stock_code: str
    stock_name: str
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    pnl_pct: float
    pnl_amount: float
    hold_days: int


class BacktestResultResponse(BaseModel):
    """回测完整结果。"""

    run_id: str
    strategy_id: str
    strategy_name: str
    strategy_emoji: str
    start_date: str
    end_date: str
    initial_capital: float
    final_capital: float
    total_return: float
    annual_return: float
    max_drawdown: float
    sharpe_ratio: float
    win_rate: float
    total_trades: int
    profit_trades: int
    loss_trades: int
    avg_hold_days: float
    daily_equity: list[BacktestDailyEquity] = Field(default_factory=list)
    trades: list[BacktestTrade] = Field(default_factory=list)
    benchmark_return: float
    alpha: float
    beta: float
    top_n: int = 5
    hold_days: int = 5
    created_at: str = ""


class BacktestHistoryItem(BaseModel):
    """历史回测列表单条。"""

    run_id: str
    strategy_id: str
    strategy_name: str
    strategy_emoji: str
    start_date: str
    end_date: str
    total_return: float
    max_drawdown: float
    sharpe_ratio: float
    created_at: str


# ============================================================================
# 路由
# ============================================================================


@router.post(
    "/run",
    response_model=BacktestResultResponse,
    summary="启动一次回测",
)
async def run_backtest(
    req: BacktestRunRequest,
    cfg: Any = Depends(get_config),
    storage: Any = Depends(get_storage),
) -> BacktestResultResponse:
    """基于策略历史选股模拟回测，返回收益曲线 + 交易记录 + 统计指标。"""
    # 校验策略存在
    strategy_id = req.strategy_id
    strategy_name = strategy_id
    strategy_emoji = ""
    try:
        sc = cfg.strategy(strategy_id)
        if sc is not None:
            strategy_name = getattr(sc, "strategy_name", "") or strategy_id
            strategy_emoji = getattr(sc, "strategy_emoji", "") or ""
    except Exception as exc:  # noqa: BLE001
        logger.warning("反查策略 %s 失败: %s", strategy_id, exc)

    # 校验日期
    try:
        start_dt = datetime.strptime(req.start_date, "%Y-%m-%d").date()
        end_dt = datetime.strptime(req.end_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"日期格式错误: {exc}") from exc
    if end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="end_date 必须晚于 start_date")

    # 加载该策略的历史选股（按 run_date 升序）
    picks = _load_strategy_picks(storage, strategy_id, req.start_date, req.end_date, req.top_n)
    if not picks:
        # 没有真实选股数据，mock 20 个交易日 × 3-5 只股票
        picks = _mock_strategy_picks(strategy_id, start_dt, end_dt, req.top_n)

    # 执行回测
    result = _run_backtest(
        strategy_id=strategy_id,
        strategy_name=strategy_name,
        strategy_emoji=strategy_emoji,
        start_date=req.start_date,
        end_date=req.end_date,
        initial_capital=req.initial_capital,
        top_n=req.top_n,
        hold_days=req.hold_days,
        picks=picks,
    )

    # 持久化到 DuckDB
    _persist_backtest(storage, result)

    return result


@router.get(
    "/history",
    response_model=list[BacktestHistoryItem],
    summary="历史回测列表",
)
async def list_backtests(
    storage: Any = Depends(get_storage),
    limit: int = 50,
) -> list[BacktestHistoryItem]:
    """列出最近 N 条回测。"""
    if not _table_exists(storage, "backtest_results"):
        return []
    sql = (
        "SELECT run_id, strategy_id, strategy_name, strategy_emoji, "
        "       start_date, end_date, total_return, max_drawdown, sharpe_ratio, created_at "
        "FROM backtest_results ORDER BY created_at DESC LIMIT ?"
    )
    try:
        df = storage.query(sql, [int(limit)])
    except Exception as exc:  # noqa: BLE001
        logger.warning("查询 backtest_results 失败: %s", exc)
        return []
    out: list[BacktestHistoryItem] = []
    for _, row in df.iterrows():
        out.append(
            BacktestHistoryItem(
                run_id=str(row.get("run_id", "")),
                strategy_id=str(row.get("strategy_id", "")),
                strategy_name=str(row.get("strategy_name", "")),
                strategy_emoji=str(row.get("strategy_emoji", "")),
                start_date=_to_str(row.get("start_date")) or "",
                end_date=_to_str(row.get("end_date")) or "",
                total_return=float(row.get("total_return") or 0.0),
                max_drawdown=float(row.get("max_drawdown") or 0.0),
                sharpe_ratio=float(row.get("sharpe_ratio") or 0.0),
                created_at=_to_str(row.get("created_at")) or "",
            )
        )
    return out


@router.get(
    "/{run_id}",
    response_model=BacktestResultResponse,
    summary="单次回测详情",
)
async def get_backtest(
    run_id: str,
    storage: Any = Depends(get_storage),
) -> BacktestResultResponse:
    """根据 run_id 取回测完整结果。"""
    if not _table_exists(storage, "backtest_results"):
        raise HTTPException(status_code=404, detail=f"run_id={run_id} 不存在（无 backtest_results 表）")
    sql = "SELECT result_json FROM backtest_results WHERE run_id = ? LIMIT 1"
    try:
        df = storage.query(sql, [run_id])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"查询失败: {exc}") from exc
    if df.empty:
        raise HTTPException(status_code=404, detail=f"run_id={run_id} 不存在")
    raw = df.iloc[0].get("result_json", "{}")
    try:
        data = json.loads(str(raw)) if raw else {}
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"结果解析失败: {exc}") from exc
    return BacktestResultResponse(**data)


# ============================================================================
# 内部 - 数据加载
# ============================================================================


def _load_strategy_picks(
    storage: Any,
    strategy_id: str,
    start_date: str,
    end_date: str,
    top_n: int,
) -> list[dict[str, Any]]:
    """从 selection_results 读该策略的选股历史。

    返回结构：[{"run_date": "2025-01-01", "stocks": [{code, name, score, rank}, ...]}, ...]
    按 run_date 升序。
    """
    if not _table_exists(storage, "selection_results"):
        return []
    sql = (
        "SELECT run_id, run_date, stock_code, stock_name, total_score, rank "
        "FROM selection_results "
        "WHERE strategy_id = ? AND run_date >= ? AND run_date <= ? "
        "ORDER BY run_date ASC, rank ASC"
    )
    try:
        df = storage.query(sql, [strategy_id, start_date, end_date])
    except Exception as exc:  # noqa: BLE001
        logger.warning("查询 selection_results 失败: %s", exc)
        return []
    if df.empty:
        return []

    # 按 run_date 分组（每个 run_date 取 top_n）
    grouped: dict[str, list[dict[str, Any]]] = {}
    for _, row in df.iterrows():
        rd = _to_str(row.get("run_date"))
        if not rd:
            continue
        rd = rd[:10] if len(rd) >= 10 else rd
        grouped.setdefault(rd, []).append(
            {
                "stock_code": str(row.get("stock_code", "")),
                "stock_name": str(row.get("stock_name", "") or ""),
                "score": float(row.get("total_score") or 0.0),
                "rank": int(row.get("rank") or 0),
            }
        )
    picks: list[dict[str, Any]] = []
    for rd in sorted(grouped.keys()):
        stocks = sorted(grouped[rd], key=lambda s: s["rank"] or 999)[:top_n]
        picks.append({"run_date": rd, "stocks": stocks})
    return picks


def _mock_strategy_picks(
    strategy_id: str,
    start_dt: Any,
    end_dt: Any,
    top_n: int,
) -> list[dict[str, Any]]:
    """无 selection_results 时，mock 20 个交易日 × 3-5 只股票。"""
    # 用策略 ID 做种子，保证同一策略每次回测 mock 出的股票池一致
    seed_base = int(hashlib.md5(strategy_id.encode()).hexdigest()[:8], 16)
    # mock 股票池
    mock_codes = [
        ("600519.SH", "贵州茅台"), ("000858.SZ", "五粮液"), ("002594.SZ", "比亚迪"),
        ("300750.SZ", "宁德时代"), ("600036.SH", "招商银行"), ("601318.SH", "中国平安"),
        ("000333.SZ", "美的集团"), ("002415.SZ", "海康威视"), ("600276.SH", "恒瑞医药"),
        ("000001.SZ", "平安银行"), ("601166.SH", "兴业银行"), ("002910.SZ", "庄园牧场"),
        ("300059.SZ", "东方财富"), ("600900.SH", "长江电力"), ("601888.SH", "中国中免"),
        ("600030.SH", "中信证券"), ("000725.SZ", "京东方A"), ("601012.SH", "隆基绿能"),
        ("300760.SZ", "迈瑞医疗"), ("002475.SZ", "立讯精密"),
    ]
    picks: list[dict[str, Any]] = []
    # 每 5 个交易日一个选股日
    cur = start_dt
    idx = 0
    while cur <= end_dt and len(picks) < 20:
        # 跳过周末
        if cur.weekday() < 5:
            n = 3 + (seed_base + idx) % 3  # 3-5 只
            chosen = []
            for i in range(n):
                k = (seed_base + idx * 7 + i * 3) % len(mock_codes)
                code, name = mock_codes[k]
                chosen.append({
                    "stock_code": code,
                    "stock_name": name,
                    "score": 80.0 - i * 5,
                    "rank": i + 1,
                })
            picks.append({"run_date": cur.strftime("%Y-%m-%d"), "stocks": chosen[:top_n]})
            idx += 1
        cur += timedelta(days=5)
    return picks


# ============================================================================
# 内部 - 回测引擎
# ============================================================================


def _run_backtest(
    strategy_id: str,
    strategy_name: str,
    strategy_emoji: str,
    start_date: str,
    end_date: str,
    initial_capital: float,
    top_n: int,
    hold_days: int,
    picks: list[dict[str, Any]],
) -> BacktestResultResponse:
    """执行回测主循环。"""
    run_id = uuid.uuid4().hex[:12]
    created_at = datetime.now().isoformat(timespec="seconds")

    # 每只股票 entry_day → 确定性价格
    # entry_price 用 10~100 之间基于 code hash 的确定性值
    def _entry_price(code: str) -> float:
        h = hashlib.md5(code.encode()).hexdigest()
        v = int(h[:6], 16) / 0xFFFFFF  # 0~1
        return round(10.0 + v * 90.0, 2)

    # 确定性日涨幅 -3%~+5% (基于 code + day_index)
    def _daily_pct(code: str, day_index: int) -> float:
        h = hashlib.md5(f"{code}|{day_index}".encode()).hexdigest()
        v = int(h[:6], 16) / 0xFFFFFF  # 0~1
        return -0.03 + v * 0.08  # -3% ~ +5%

    # 解析所有日期
    start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
    trading_days = _trading_days(start_dt, end_dt)
    if not trading_days:
        trading_days = [start_dt]

    # 把 picks 按 run_date 映射到 trading_day 索引
    pick_by_date: dict[str, list[dict[str, Any]]] = {p["run_date"]: p["stocks"] for p in picks}
    # 持仓: list of {code, name, entry_date_idx, entry_price, shares, cost}
    holdings: list[dict[str, Any]] = []
    trades: list[BacktestTrade] = []
    cash = float(initial_capital)
    # 每日权益
    daily_equity: list[BacktestDailyEquity] = []
    peak_equity = float(initial_capital)
    max_dd = 0.0
    daily_returns: list[float] = []
    prev_equity = float(initial_capital)

    for di, day in enumerate(trading_days):
        # 1. 卖出：持有到期的仓位
        to_sell: list[int] = []
        for hi, h in enumerate(holdings):
            if di - h["entry_date_idx"] >= hold_days:
                to_sell.append(hi)
        # 倒序卖出避免索引错位
        for hi in sorted(to_sell, reverse=True):
            h = holdings[hi]
            # 累计涨幅 = ∏(1 + r_t) - 1
            cum = 1.0
            for t in range(h["entry_date_idx"], di):
                cum *= (1.0 + _daily_pct(h["stock_code"], t))
            exit_price = round(h["entry_price"] * cum, 4)
            proceeds = exit_price * h["shares"]
            cash += proceeds
            pnl_amount = proceeds - h["cost"]
            pnl_pct = (pnl_amount / h["cost"]) * 100.0 if h["cost"] > 0 else 0.0
            trades.append(BacktestTrade(
                stock_code=h["stock_code"],
                stock_name=h["stock_name"],
                entry_date=trading_days[h["entry_date_idx"]].strftime("%Y-%m-%d"),
                exit_date=day.strftime("%Y-%m-%d"),
                entry_price=h["entry_price"],
                exit_price=exit_price,
                pnl_pct=round(pnl_pct, 2),
                pnl_amount=round(pnl_amount, 2),
                hold_days=di - h["entry_date_idx"],
            ))
            holdings.pop(hi)

        # 2. 买入：当日有选股信号
        day_str = day.strftime("%Y-%m-%d")
        stocks = pick_by_date.get(day_str)
        if stocks and holdings == []:
            # 等权买入（用当前 cash 平分 top_n）
            n = min(len(stocks), top_n)
            if n > 0 and cash > 0:
                budget_per = cash / n
                for s in stocks[:n]:
                    ep = _entry_price(s["stock_code"])
                    if ep <= 0:
                        continue
                    shares = math.floor(budget_per / ep)
                    if shares <= 0:
                        continue
                    cost = ep * shares
                    cash -= cost
                    holdings.append({
                        "stock_code": s["stock_code"],
                        "stock_name": s["stock_name"],
                        "entry_date_idx": di,
                        "entry_price": ep,
                        "shares": shares,
                        "cost": cost,
                    })

        # 3. 计算当日总资产 = cash + ∑(current_price * shares)
        position_value = 0.0
        for h in holdings:
            cum = 1.0
            for t in range(h["entry_date_idx"], di + 1):
                cum *= (1.0 + _daily_pct(h["stock_code"], t))
            cur_price = h["entry_price"] * cum
            position_value += cur_price * h["shares"]
        equity = cash + position_value
        return_pct = (equity / prev_equity - 1.0) * 100.0 if prev_equity > 0 else 0.0
        if equity > peak_equity:
            peak_equity = equity
        drawdown = (equity / peak_equity - 1.0) * 100.0 if peak_equity > 0 else 0.0
        if drawdown < max_dd:
            max_dd = drawdown
        daily_equity.append(BacktestDailyEquity(
            date=day_str,
            equity=round(equity, 2),
            return_pct=round(return_pct, 2),
            drawdown=round(drawdown, 2),
        ))
        daily_returns.append(return_pct / 100.0)
        prev_equity = equity

    # 清仓最后未平仓位
    for h in holdings:
        di = len(trading_days) - 1
        cum = 1.0
        for t in range(h["entry_date_idx"], di + 1):
            cum *= (1.0 + _daily_pct(h["stock_code"], t))
        exit_price = round(h["entry_price"] * cum, 4)
        proceeds = exit_price * h["shares"]
        cash += proceeds
        pnl_amount = proceeds - h["cost"]
        pnl_pct = (pnl_amount / h["cost"]) * 100.0 if h["cost"] > 0 else 0.0
        trades.append(BacktestTrade(
            stock_code=h["stock_code"],
            stock_name=h["stock_name"],
            entry_date=trading_days[h["entry_date_idx"]].strftime("%Y-%m-%d"),
            exit_date=trading_days[-1].strftime("%Y-%m-%d"),
            entry_price=h["entry_price"],
            exit_price=exit_price,
            pnl_pct=round(pnl_pct, 2),
            pnl_amount=round(pnl_amount, 2),
            hold_days=di - h["entry_date_idx"] + 1,
        ))

    final_capital = cash
    total_return = (final_capital / initial_capital - 1.0) * 100.0 if initial_capital > 0 else 0.0

    # 年化收益率
    n_days = (end_dt - start_dt).days or 1
    years = max(n_days / 365.0, 1.0 / 365.0)
    annual_return = ((final_capital / initial_capital) ** (1.0 / years) - 1.0) * 100.0 if initial_capital > 0 and final_capital > 0 else 0.0

    # 夏普比率（无风险利率假设 0，按日收益标准差）
    if len(daily_returns) > 1:
        mean_r = sum(daily_returns) / len(daily_returns)
        var_r = sum((r - mean_r) ** 2 for r in daily_returns) / (len(daily_returns) - 1)
        std_r = math.sqrt(var_r) if var_r > 0 else 0.0
        sharpe = (mean_r / std_r) * math.sqrt(252) if std_r > 0 else 0.0
    else:
        sharpe = 0.0

    # 胜率
    profit_trades = sum(1 for t in trades if t.pnl_amount > 0)
    loss_trades = sum(1 for t in trades if t.pnl_amount < 0)
    total_trades = len(trades)
    win_rate = (profit_trades / total_trades * 100.0) if total_trades > 0 else 0.0
    avg_hold = (sum(t.hold_days for t in trades) / total_trades) if total_trades > 0 else 0.0

    # 基准（mock -2%~+8）
    bench_seed = int(hashlib.md5(f"{strategy_id}|{start_date}|{end_date}".encode()).hexdigest()[:8], 16)
    benchmark_return = round(-2.0 + (bench_seed / 0xFFFFFFFF) * 10.0, 2)
    alpha = round(total_return - benchmark_return, 2)
    # beta mock 0.8~1.2
    beta = round(0.8 + (bench_seed % 41) / 100.0, 2)

    return BacktestResultResponse(
        run_id=run_id,
        strategy_id=strategy_id,
        strategy_name=strategy_name,
        strategy_emoji=strategy_emoji,
        start_date=start_date,
        end_date=end_date,
        initial_capital=round(initial_capital, 2),
        final_capital=round(final_capital, 2),
        total_return=round(total_return, 2),
        annual_return=round(annual_return, 2),
        max_drawdown=round(max_dd, 2),
        sharpe_ratio=round(sharpe, 2),
        win_rate=round(win_rate, 2),
        total_trades=total_trades,
        profit_trades=profit_trades,
        loss_trades=loss_trades,
        avg_hold_days=round(avg_hold, 1),
        daily_equity=daily_equity,
        trades=trades,
        benchmark_return=benchmark_return,
        alpha=alpha,
        beta=beta,
        top_n=top_n,
        hold_days=hold_days,
        created_at=created_at,
    )


def _trading_days(start_dt: Any, end_dt: Any) -> list[Any]:
    """生成 start~end 之间的交易日（跳过周末）。"""
    days: list[Any] = []
    cur = start_dt
    while cur <= end_dt:
        if cur.weekday() < 5:  # Mon-Fri
            days.append(cur)
        cur += timedelta(days=1)
    return days


# ============================================================================
# 内部 - 持久化
# ============================================================================


def _persist_backtest(storage: Any, result: BacktestResultResponse) -> None:
    """把回测结果写入 DuckDB ``backtest_results`` 表（惰性创建）。"""
    if storage is None or not hasattr(storage, "execute"):
        return
    try:
        storage.execute(
            """
            CREATE TABLE IF NOT EXISTS backtest_results (
                run_id           VARCHAR PRIMARY KEY,
                strategy_id      VARCHAR NOT NULL,
                strategy_name    VARCHAR DEFAULT '',
                strategy_emoji   VARCHAR DEFAULT '',
                start_date       VARCHAR,
                end_date         VARCHAR,
                initial_capital  DOUBLE,
                final_capital    DOUBLE,
                total_return     DOUBLE,
                max_drawdown     DOUBLE,
                sharpe_ratio     DOUBLE,
                win_rate         DOUBLE,
                total_trades     INTEGER,
                top_n            INTEGER DEFAULT 5,
                hold_days        INTEGER DEFAULT 5,
                result_json      VARCHAR,
                created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("创建 backtest_results 表失败: %s", exc)
        return

    payload = json.dumps(result.model_dump(), ensure_ascii=False, default=str)
    sql = (
        "INSERT INTO backtest_results "
        "(run_id, strategy_id, strategy_name, strategy_emoji, "
        " start_date, end_date, initial_capital, final_capital, "
        " total_return, max_drawdown, sharpe_ratio, win_rate, total_trades, "
        " top_n, hold_days, result_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    params = [
        result.run_id,
        result.strategy_id,
        result.strategy_name,
        result.strategy_emoji,
        result.start_date,
        result.end_date,
        result.initial_capital,
        result.final_capital,
        result.total_return,
        result.max_drawdown,
        result.sharpe_ratio,
        result.win_rate,
        result.total_trades,
        result.top_n,
        result.hold_days,
        payload,
        result.created_at,
    ]
    try:
        storage.execute(sql, params)
    except Exception as exc:  # noqa: BLE001
        logger.warning("写 backtest_results 失败 (非致命): %s", exc)


# ============================================================================
# 内部 - 工具
# ============================================================================


def _table_exists(storage: Any, name: str) -> bool:
    if storage is None:
        return False
    try:
        return storage.table_exists(name)
    except Exception:  # noqa: BLE001
        return False


def _to_str(v: Any) -> str | None:
    if v is None:
        return None
    try:
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return str(v)
    except Exception:  # noqa: BLE001
        return None


# 避免 pandas 仅用于类型导入但未使用的告警（这里实际用到 df.iterrows）
_ = pd
