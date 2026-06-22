# 策略与因子开发指南

> 如何新增选股策略、新增因子、配置清洗规则。基于 R5-R13 架构。

---

## 一、策略 YAML 结构

策略定义在 `strategies/*.yaml`，5 个内置策略：

| ID | 名称 | 说明 |
|---|---|---|
| `dbqzt` | 打板求涨停 | 涨停板战法 |
| `qszsl` | 趋势主升浪 | 趋势跟踪 |
| `cslx` | 错杀低吸 | 超跌反弹 |
| `rzq` | 弱转强 | 弱势转强势 |
| `qzrfc` | 强转弱反抽 | 强势回调反弹 |

### 1.1 完整模板

```yaml
# strategies/strategy_<id>.yaml
strategy_id: <id>
name: <中文名>
description: <策略描述>
enabled: true                    # 是否启用

# 数据加载
data:
  stock_pool: all                # all / main / sz50 / sz300 / zz500
  period: daily                  # daily / weekly / monthly
  count: 5                       # 拉取 K 线根数
  start_date: ""                 # 留空用 count
  end_date: ""

# 数据清洗
cleaning:
  rules_file: cleaning_rules.yaml   # 引用 config/cleaning_rules.yaml
  drop_st: true                     # 排除 ST
  drop_suspended: true              # 排除停牌
  drop_new: 5                       # 上市不足 5 日排除

# 因子计算
factors:
  - id: momentum_5d
    name: 5日动量
    weight: 0.3                     # 评分权重
  - id: volume_surge
    name: 量比放大
    weight: 0.2
  - id: limit_up_count
    name: 涨停连板数
    weight: 0.5

# 评分公式（simpleeval 表达式）
scoring:
  formula: "momentum_5d * 0.3 + volume_surge * 0.2 + limit_up_count * 0.5"
  min_score: 0.6                    # 最低入选分数

# 筛选排序
filter:
  min_score: 0.6
  max_count: 20                     # 取 Top 20
  sort_by: score
  sort_order: desc

# 导出
export:
  formats: [csv, excel, duckdb]     # 导出格式
  duckdb_table: selection_results
```

### 1.2 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `strategy_id` | str | 唯一 ID，用于 API 调用 |
| `enabled` | bool | 禁用的策略不出现在列表 |
| `data.stock_pool` | str | 股票池范围 |
| `data.count` | int | K 线根数（用于因子计算）|
| `cleaning.rules_file` | str | 引用 `config/cleaning_rules.yaml` |
| `factors[].id` | str | 因子 ID，对应 `engine/factors/<id>.py` |
| `factors[].weight` | float | 评分权重（可被 scoring.formula 覆盖）|
| `scoring.formula` | str | simpleeval 表达式，可用因子 ID 作变量 |
| `filter.max_count` | int | 最终入选数量 |

---

## 二、内置 26 个因子

因子插件在 `engine/factors/`，按类别组织：

### 2.1 动量类（engine/factors/momentum.py）
- `momentum_5d` — 5 日涨幅
- `momentum_10d` — 10 日涨幅
- `momentum_20d` — 20 日涨幅
- `rsi_14` — 14 日 RSI
- `macd_diff` — MACD 柱

### 2.2 突破类（engine/factors/breakout.py）
- `breakout_20d` — 突破 20 日新高
- `breakout_60d` — 突破 60 日新高
- `limit_up_count` — 涨停连板数
- `distance_to_ma5` — 距 5 日均线

### 2.3 换手类（engine/factors/turnover.py）
- `turnover_5d` — 5 日换手率
- `turnover_surge` — 量比放大
- `volume_ma5` — 5 日成交量均线

### 2.4 估值类（engine/factors/valuation.py）
- `pe_ttm` — 滚动市盈率
- `pb` — 市净率
- `market_cap` — 总市值

### 2.5 资金流类（engine/factors/moneyflow.py）
- `net_inflow_5d` — 5 日主力净流入
- `net_inflow_pct` — 主力净流入占比
- `big_order_pct` — 大单占比

### 2.6 形态类（engine/factors/pattern.py）
- `gap_up` — 跳空高开
- `long_lower_shadow` — 长下影线
- `doji` — 十字星
- `hammer` — 锤子线

### 2.7 板块类（engine/factors/sector.py）
- `sector_strength` — 板块强度
- `sector_rank` — 板块内排名
- `sector_linkage` — 同板块联动

### 2.8 其他
- `auction_surge` — 集合竞价涨幅
- `amplitude` — 振幅
- `turnover_rate` — 换手率

---

## 三、新增因子

### 3.1 因子插件结构

```python
# engine/factors/my_factor.py
"""<因子说明>"""
import pandas as pd
from engine.factors.base import Factor, FactorResult


class MyFactor(Factor):
    """<因子类说明>"""

    factor_id = "my_factor"
    name = "我的因子"
    category = "custom"
    description = "<因子描述>"
    dependencies = ["kline"]    # 依赖的数据字段

    def calculate(self, df: pd.DataFrame) -> FactorResult:
        """
        Args:
            df: K 线 DataFrame, 列含 open/high/low/close/volume 等
        Returns:
            FactorResult(value=float, raw=pd.Series)
        """
        # 计算逻辑
        value = (df["close"].iloc[-1] / df["close"].iloc[0] - 1) * 100
        return FactorResult(value=value, raw=df["close"])
```

### 3.2 注册

因子自动扫描注册，无需手动注册。`engine/factors/registry.py` 启动时扫描 `engine/factors/*.py`，发现 `Factor` 子类自动注册。

### 3.3 策略引用

在策略 YAML 中引用：
```yaml
factors:
  - id: my_factor
    name: 我的因子
    weight: 0.3
```

### 3.4 需要新数据字段时

如果因子需要 `df` 里没有的字段（如财务数据）：

1. 读 `engine/data_adapter/base.py` 看是否有对应获取接口
2. 若无，在 3 个文件同步添加：
   - `base.py` — 加抽象方法 `get_xxx()`
   - `mock_adapter.py` — 从 CSV 读 or hash 生成
   - `real_adapter.py` — 调 tqcenter API（加 `acquire_or_skip` 守卫）
3. `engine/pipeline/steps/load_data.py` — 在数据加载时调用并注入 df
4. 因子 `calculate` 即可从 `df["xxx"]` 读取

---

## 四、清洗规则

清洗规则在 `config/cleaning_rules.yaml`，被策略 YAML 的 `cleaning.rules_file` 引用。

### 4.1 规则类型

```yaml
rules:
  # 过滤负值
  - rule_id: filter_wtb_negative
    rule_type: filter_negative
    field: Wtb
    action: set_nan      # set_nan / set_zero / drop
    also_zero: true      # 0 也视为异常
    description: 过滤 Wtb 量比负值与 0

  # 过滤范围
  - rule_id: filter_price_range
    rule_type: filter_range
    field: close
    min: 1
    max: 10000
    action: drop

  # 填充缺失值
  - rule_id: fill_volume
    rule_type: fillna
    field: volume
    value: 0
```

### 4.2 V8.1 5 项 Bug 修复规则

`config/cleaning_rules.yaml` 内置 5 项数据清洗（V8.1 系统遗留 Bug）：
- `filter_wtb_negative` — Wtb 量比负值/0 → set_nan
- `filter_fcb_negative` — FCb 封成比负值 → set_zero
- `filter_fcamo_negative` — FCAmo 封单额负值 → set_zero
- `filter_high_price` — 超高价股（>1000）→ drop
- `filter_zero_volume` — 零成交量 → drop

---

## 五、评分公式

评分用 `simpleeval` 表达式引擎，`engine/expression/evaluator.py` 封装。

### 5.1 可用变量

- 所有因子 ID（如 `momentum_5d`、`volume_surge`）
- 常量：`pi`、`e`
- 数学函数：`abs`、`min`、`max`、`sum`、`avg`、`sqrt`、`log`

### 5.2 示例

```yaml
# 线性加权
scoring:
  formula: "momentum_5d * 0.3 + volume_surge * 0.2 + limit_up_count * 0.5"

# 条件评分
scoring:
  formula: "if(momentum_5d > 5, momentum_5d * 2, momentum_5d) + volume_surge"

# 非线性
scoring:
  formula: "sqrt(momentum_5d) * log(volume_surge + 1)"
```

### 5.3 表达式安全

simpleeval 沙箱执行，禁止：
- `import` / `exec` / `eval`
- 访问 `__` 开头属性
- 调用未注册的函数

---

## 六、监控规则

监控规则在 `config/monitor.yaml`（R13 合并自 monitor_rules.yaml + match_strategies.yaml），分 4 段：

### 6.1 monitor 段（监控引擎配置）
```yaml
monitor:
  subscribe_batch_size: 50       # 订阅批量大小
  poll_interval_seconds: 10      # 轮询间隔
  alert_debounce_seconds: 30     # 信号防抖
  trading_hours:                 # 交易时段
    morning_start: "09:25"
    morning_end: "11:30"
    afternoon_start: "13:00"
    afternoon_end: "15:00"
```

### 6.2 alert_templates 段（14 个信号模板）
```yaml
alert_templates:
  - alert_type: limit_up
    prefix: "📈 涨停"
    template: "{stock_name} 触发涨停..."
  - alert_type: rzq_ignite
    prefix: "🔥 弱转强点火"
    template: "..."
```

### 6.3 match_strategies 段（5 个匹配策略）
```yaml
match_strategies:
  - match_id: rzq_default
    name: 弱转强默认监控
    strategy_id: rzq
    enabled: true
    scope:
      markets: [SH, SZ, BJ]
      exclude_st: true
    alerts:
      - alert_type: rzq_ignite
        params:
          pct_threshold: 0.03
        channels: [tdx_warn]
```

### 6.4 dedup 段（信号去重）
```yaml
dedup:
  key_fields: [stock_code, alert_type]
  bypass_priority: high
```

---

## 七、调试技巧

### 7.1 单独跑因子

```bash
python -c "
from engine.factors.momentum import Momentum5dFactor
import pandas as pd
df = pd.DataFrame({'close': [10, 11, 12, 11, 13]})
f = Momentum5dFactor()
print(f.calculate(df))
"
```

### 7.2 命令行选股

```bash
python scripts/run_selection.py --strategy dbqzt --date 2025-06-22
```

### 7.3 查看选股结果

```bash
# API
curl http://127.0.0.1:8000/api/selections?strategy_id=dbqzt

# DuckDB 直查
python -c "
from engine.storage.duckdb_store import DuckDBStore
s = DuckDBStore()
print(s.query('SELECT * FROM selection_results ORDER BY run_date DESC LIMIT 5'))
"
```

### 7.4 热加载策略

改策略 YAML 后：
```bash
python scripts/dev.py reload
# 或: curl -X POST http://127.0.0.1:8000/api/config/reload
```

---

## 八、约束

1. **不要在因子 `calculate` 内调 tqcenter** — 数据由 Pipeline 预先注入 df
2. **因子必须纯函数** — 同输入同输出，不要存状态
3. **评分公式必须可序列化** — simpleeval 支持，不要用 lambda
4. **新增因子后跑 lint** — `bun run lint`（虽然因子是 Python，但确保没破坏前端）
5. **改清洗规则后热加载** — `python scripts/dev.py reload`
