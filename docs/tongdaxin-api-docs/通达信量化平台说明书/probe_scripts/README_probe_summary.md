# 接口能力边界系统性探测任务 —— 总结报告

> 生成时间: 2025-07-01
> 目录: `k:\通达信量化平台说明书\probe_scripts\`
> 执行入口: `python run_all_probes.py`（无人值守模式）
> 输出目录: `probe_scripts\csv_outputs\*.csv`

---

## 一、任务目标

本次任务对 TQ（通达信量化平台）的全部核心数据接口进行系统性探测，覆盖：

1. **历史数据回溯窗口 —— 每个主要接口分别测试 30/60/90/120/180/250/365 天窗口的可返回记录
2. **批量 vs 单条获取 —— 对提供 `get_*_value` vs `get_*_value_by_date` 等成对接口进行同一天数据一致性校验
3. **跨接口数据一致性 —— 例如 `get_more_info` vs `get_relation` vs `get_stock_info`；`get_scjy_value` vs `get_market_snapshot` vs `get_pricevol` 等
4. **接口字段覆盖率 —— 每个主要接口 field_list=[] 的全量字段返回
5. **不同市场/板块覆盖 —— 主板/创业板/科创板/ETF/可转债/指数

## 二、探测脚本总览（按编号）

| # | 脚本文件 | 探测接口 | 主要任务
|---|----------|---------|--------
| 01 | `probe_01_sector_list_and_constituent.py` | `get_sector_list`, `get_stock_list_in_sector` | 板块列表 + 成份股映射，测试板块类型矩阵、跨接口一致性
| 02 | `probe_02_market_snapshot.py` | `get_market_snapshot`, `get_market_snapshot_by_date` | 行情快照字段全量、单日期 vs 区间、循环批量 vs 单条
| 03 | `probe_03_pricevol_vs_snapshot.py` | `get_pricevol` vs `get_market_snapshot` | 价格/成交量批量 vs 快照一致性、跨市场矩阵
| 04 | `probe_04_gb_info_history.py` | `get_gb_info`, `get_gb_info_by_date` | 股本历史窗口（30/60/90/120/180/250/365）
| 05 | `probe_05_ipo_info.py` | `get_ipo_info` | 新股申购：ipo_type × ipo_date 模式矩阵
| 06 | `probe_06_more_info_vs_relation.py` | `get_more_info`, `get_relation`, `get_stock_info` | 三接口字段交叉对比
| 07 | `probe_07_match_stkinfo.py` | `get_match_stkinfo` | 模糊检索：关键字命中率、max_count 生效
| 08 | `probe_08_financial_vs_one.py` | `get_financial_data`, `get_gp_one_data` | 财务字段一致性（report_type=announce_time vs tag_time）
| 09 | `probe_09_scjy_value.py` | `get_scjy_value`, `get_scjy_value_by_date` | 市场交易：单日期 vs 区间、市场矩阵
| 10 | `probe_10_gpjy_value.py` | `get_gpjy_value`, `get_gpjy_value_by_date` | 个股交易：4 类市场 × 7 窗口
| 11 | `probe_11_bkjy_value.py` | `get_bkjy_value`, `get_bkjy_value_by_date` | 板块交易：板块类型矩阵、一致性
| 12 | `probe_12_user_sector.py` | `get_user_sector`, `get_user_sector_by_code` | 自定义板块：成份股 vs 通用 get_stock_list_in_sector
| 13 | `probe_13_kzz_info.py` | `get_kzz_info` | 可转债：字段覆盖
| 14 | `probe_14_etf_trackzs.py` | `get_trackzs_etf_info` | ETF 跟踪指数：代码映射
| 15 | `probe_15_stock_info_full.py` | `get_stock_info` | 证券基本信息：全量字段、不同市场字段差异

## 三、各接口探测维度

### 3.1 历史回溯窗口矩阵

所有需要历史回溯的接口都测试以下窗口（天）: 30, 60, 90, 120, 180, 250, 365。

测试股票/板块/指数均覆盖：
- `get_gb_info_by_date`（股本）
- `get_scjy_value_by_date`（市场交易）
- `get_gpjy_value_by_date`（个股交易）
- `get_bkjy_value_by_date`（板块交易）

输出 CSV 中 `csv_outputs/*_window_matrix.csv` 和 `*_market_matrix.csv`

### 3.2 单日期 vs 区间一致性

提供成对接口：
- `get_gb_info(stock_code, date_list=[d], count=1)` vs `get_gb_info_by_date(start=d, end=d)`
- `get_scjy_value` vs `get_scjy_value_by_date`
- `get_gpjy_value` vs `get_gpjy_value_by_date`
- `get_bkjy_value` vs `get_bkjy_value_by_date`

输出 CSV: `*_single_vs_range.csv

### 3.3 跨接口一致性

- `get_more_info` vs `get_relation` vs `get_stock_info`（基础字段名称/市值等）
- `get_pricevol` vs `get_market_snapshot`（价格/成交量）
- `get_financial_data` vs `get_gp_one_data`（财务数据 vs 单条财务）

输出 CSV: `*_consistency.csv / `*_cross.csv

### 3.4 接口参数模式矩阵

- `get_ipo_info`: ipo_type × ipo_date 交叉组合（仅新股、仅新发债、新股+新债）
- `get_financial_data`: report_type=announce_time vs tag_time
- `get_match_stkinfo`: max_count=1/5/20/50/100/200/500/1000

### 3.5 字段覆盖率

- `get_stock_info`, `get_more_info`, `get_kzz_info`, `get_trackzs_etf_info` 等

输出各接口全量字段探测，按市场（SH/SZ）聚合字段集合对比

## 四、关键结论要点（在实际运行后填充）

### 4.1 历史回溯窗口上限

| 接口 | 测试窗口上限 | 备注 |
|-----|-----------|------|
| `get_gb_info_by_date | 待执行后填 |  |
| `get_scjy_value_by_date | 待执行后填 |  |
| `get_gpjy_value_by_date | 待执行后填 |  |
| `get_bkjy_value_by_date | 待执行后填 |  |

### 4.2 单日期 vs 区间一致性

| 接口 | 同一日期返回一致比例 | 不一致字段 |
|-----|------------------|---------|
| `get_gb_info | 待执行后填 |  |
| `get_scjy_value | 待执行后填 |  |
| `get_gpjy_value | 待执行后填 |  |
| `get_bkjy_value | 待执行后填 |  |

### 4.3 字段覆盖率

| 接口 | 全量字段数 | 空值率 | 典型返回字段 |
|-----|----------|--------|-----------|
| `get_stock_info` | 待执行后填 |  |  |
| `get_more_info` | 待执行后填 |  |  |
| `get_kzz_info` | 待执行后填 |  |  |
| `get_trackzs_etf_info` | 待执行后填 |  |  |

## 五、执行方法

```bash
cd k:\通达信量化平台说明书\probe_scripts
python run_all_probes.py
```

每个脚本独立运行，互不影响。单个脚本错误不影响其他脚本。
