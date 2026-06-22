# TdxQuant 量化系统 - 架构文档（AI 维护必读）

> **本文档是 AI 维护者的第一手资料。修改任何代码前，请先完整阅读本文档。**
> **最后更新**: R13 阶段（见末尾「R5-R13 演进补充」章节）
> **维护原则**: 变与不变分离，配置驱动，绝不硬编码

---

## 一、项目概述

### 1.1 系统目标
基于通达信 TdxQuant API 的量化交易系统，核心能力：
1. **选股**：5 大策略选股（打板求涨停/趋势主升浪/错杀低吸/弱转强/强转弱反抽）
2. **监控**：实时行情监控 + 信号预警 + 多通道推送
3. **回测**：历史数据回测验证
4. **交易**：半自动交易（send_warn 推送 + 人工确认下单）

### 1.2 运行环境
- **Python 引擎**：Windows + Python 3.13 + 通达信金融终端（必须预启动）
- **Web 前端**：Next.js 16，跨平台
- **数据库**：DuckDB（单文件，零运维）
- **本开发环境**：Linux 沙箱，使用 Mock 适配器模拟（无通达信）

### 1.3 数据源
- **生产**：tqcenter API（通达信终端）
- **开发/测试**：Mock 适配器（基于 V8 系统 CSV 样本数据）
- **切换方式**：`config/app.yaml` 中 `adapter_mode: mock` 或 `real`

---

## 二、5 层架构模型（核心设计哲学）

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: 用户配置层（每天可能变）                          │
│  策略阈值 / 监控条件 / 推送开关 / 板块映射                  │
│  实现: strategies/*.yaml + config/*.yaml                    │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: 业务规则层（每周可能变）                          │
│  策略定义 / 因子组合 / 清洗规则 / 评分函数                  │
│  实现: YAML 引用因子插件 + 表达式引擎                       │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 组件抽象层（每月可能变）                          │
│  因子插件 / 推送通道插件 / 数据源插件 / 导出器插件          │
│  实现: factors/ channels/ exporters/ 目录下插件文件          │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 核心引擎层（半年不变）                            │
│  选股流水线 / 监控调度 / 消息总线 / 板块管理器              │
│  实现: engine/pipeline/ engine/monitor/ engine/messaging/   │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 基础设施层（一年不变）                            │
│  数据适配器 / DuckDB存储 / WebSocket网关 / FastAPI          │
│  实现: engine/data_adapter/ engine/storage/ engine/api/     │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 变与不变的判断准则

**修改前先问自己：这属于哪一层？**
- 改阈值/开关 → L5，改 YAML，**不改代码**
- 增删策略 → L4，加/删 YAML 文件，**不改引擎代码**
- 新增因子 → L3，加 factor 插件文件，**不改引擎代码**
- 新增推送通道 → L3，加 channel 插件文件，**不改引擎代码**
- 改选股流程 → L2，改引擎代码（**慎重，影响所有策略**）
- 换数据库/API → L1，改基础设施代码（**极少**）

---

## 三、目录结构详解

```
/home/z/my-project/
│
├── engine/                          # 【Python 引擎】核心代码
│   ├── data_adapter/                # L1: 数据适配器（tqcenter 封装）
│   │   ├── base.py                  #   适配器抽象基类 BaseDataAdapter
│   │   ├── mock_adapter.py          #   Mock 适配器（基于CSV样本）
│   │   ├── real_adapter.py          #   Real 适配器（tqcenter API）
│   │   ├── factory.py               #   适配器工厂（按配置切换）
│   │   └── cache.py                 #   数据缓存层
│   │
│   ├── pipeline/                    # L2: 选股流水线框架
│   │   ├── base.py                  #   Pipeline 抽象 + Step 基类
│   │   ├── steps/                   #   内置步骤
│   │   │   ├── load_data.py         #   数据加载步骤
│   │   │   ├── clean_data.py        #   数据清洗步骤
│   │   │   ├── calc_factors.py      #   因子计算步骤
│   │   │   ├── score.py             #   评分步骤
│   │   │   ├── filter_sort.py       #   筛选排序步骤
│   │   │   └── export.py            #   结果导出步骤
│   │   └── runner.py                #   流水线执行器
│   │
│   ├── factors/                     # L3: 因子插件（每个因子一个文件）
│   │   ├── base.py                  #   Factor 基类
│   │   ├── registry.py              #   因子注册表（自动扫描）
│   │   ├── momentum.py              #   动量类因子
│   │   ├── breakout.py              #   突破类因子
│   │   ├── turnover.py              #   换手类因子
│   │   ├── valuation.py             #   估值类因子
│   │   └── ...                      #   新增因子只需加文件
│   │
│   ├── channels/                    # L3: 推送通道插件
│   │   ├── base.py                  #   Channel 基类
│   │   ├── registry.py              #   通道注册表
│   │   ├── tdx_warn.py              #   通达信预警通道
│   │   ├── websocket.py             #   WebSocket 推送通道
│   │   ├── feishu.py                #   飞书通道（预留骨架）
│   │   ├── csv_log.py               #   CSV 日志通道
│   │   └── ...                      #   新增通道只需加文件
│   │
│   ├── exporters/                   # L3: 数据导出插件
│   │   ├── base.py                  #   Exporter 基类
│   │   ├── csv_exporter.py          #   CSV 导出
│   │   ├── excel_exporter.py        #   Excel 导出（V8 兼容 8-Sheet）
│   │   ├── sector_exporter.py       #   回写通达信板块
│   │   └── duckdb_exporter.py       #   DuckDB 持久化
│   │
│   ├── monitor/                     # L2: 监控引擎
│   │   ├── subscriber.py            #   subscribe_hq 管理（分批）
│   │   ├── alert_engine.py          #   预警条件计算
│   │   └── scheduler.py             #   定时任务调度
│   │
│   ├── sector/                      # L2: 板块管理器
│   │   └── manager.py               #   原子操作封装
│   │
│   ├── messaging/                   # L2: 消息总线
│   │   ├── bus.py                   #   MessageBus
│   │   └── events.py                #   事件类型定义
│   │
│   ├── storage/                     # L1: 存储层
│   │   ├── duckdb_store.py          #   DuckDB 封装
│   │   └── migrations/              #   Schema 迁移
│   │
│   ├── expression/                  # L4: 表达式引擎
│   │   └── evaluator.py             #   安全表达式求值
│   │
│   ├── config/                      # L1: 配置加载器
│   │   ├── loader.py                #   YAML 配置热加载
│   │   └── schema.py                #   配置 Schema 校验
│   │
│   ├── api/                         # FastAPI 服务
│   │   ├── main.py                  #   FastAPI 入口（端口 8000）
│   │   └── routes/                  #   API 路由
│   │       ├── strategies.py
│   │       ├── selection.py
│   │       ├── monitor.py
│   │       ├── sectors.py
│   │       ├── signals.py
│   │       └── config.py
│   │
│   └── utils/                       # 工具函数
│       ├── logger.py                #   日志
│       ├── stock_code.py            #   股票代码工具
│       └── time.py                  #   时间工具
│
├── strategies/                      # 【L4】策略 YAML 配置
│   ├── _template.yaml               #   策略模板（复制即用）
│   ├── strategy_dbqzt.yaml          #   打板求涨停
│   ├── strategy_qszsl.yaml          #   趋势主升浪
│   ├── strategy_cslx.yaml           #   错杀低吸
│   ├── strategy_rzq.yaml            #   弱转强
│   └── strategy_qzrfc.yaml          #   强转弱反抽
│
├── config/                          # 【L5】全局配置
│   ├── app.yaml                     #   应用配置（端口/路径/模式）
│   ├── sector_mapping.yaml          #   策略↔板块映射
│   ├── channels.yaml                #   推送通道配置
│   ├── cleaning_rules.yaml          #   通用清洗规则
│   ├── monitor_rules.yaml           #   监控预警规则
│   ├── export.yaml                  #   导出配置
│   ├── theme.yaml                   #   前端主题配置（可切换）
│   └── duckdb_schema.sql            #   DuckDB 建表 SQL
│
├── src/                             # 【Web 前端】Next.js 16
│   ├── app/
│   │   ├── page.tsx                 #   唯一用户可见路由（5 Tab）
│   │   ├── layout.tsx
│   │   └── api/                     #   Next.js API routes（转发到 Python）
│   ├── components/
│   │   ├── ui/                      #   shadcn/ui 组件
│   │   └── quant/                   #   量化专用组件
│   │       ├── Dashboard.tsx        #   实时大屏
│   │       ├── StrategyManager.tsx  #   策略管理
│   │       ├── SelectionResults.tsx #   选股结果
│   │       ├── SignalCenter.tsx     #   信号中心
│   │       └── SectorManager.tsx    #   板块管理
│   └── lib/
│       ├── api.ts                   #   API 客户端
│       └── theme.ts                 #   主题系统
│
├── data/                            # 运行时数据（gitignore）
│   ├── duckdb/quant.db              #   DuckDB 文件
│   ├── csv/                         #   CSV 导出
│   ├── excel/                       #   Excel 导出
│   └── logs/                        #   日志
│
├── docs/                            # 文档
│   ├── maintenance/                 # AI 维护文档
│   │   ├── ARCHITECTURE.md          #   本文档（架构总览）
│   │   ├── MAINTENANCE.md           #   维护手册（常见操作）
│   │   ├── API_REFERENCE.md         #   tqcenter API 速查
│   │   ├── STRATEGY_CONFIG_GUIDE.md #   策略配置指南
│   │   └── TROUBLESHOOTING.md       #   故障排查
│   ├── tdz-quant/                   # 原始 TdxQuant 文档
│   └── v8-data/                     # V8 选股系统源码
│
├── scripts/                         # 运维脚本
│   ├── run_selection.py             #   手动触发选股
│   ├── start_engine.py              #   启动 Python 引擎
│   └── reload_config.py             #   热加载配置
│
├── worklog.md                       # 工作日志（AI 必读）
└── package.json                     # Next.js 依赖
```

---

## 四、5 策略与板块命名规范

### 4.1 策略清单

| 策略中文名 | 拼音首字母 | 策略 ID | YAML 文件 | 板块 Code | 板块名 |
|-----------|-----------|---------|-----------|-----------|--------|
| 🔥 打板求涨停 | DBQZT | `dbqzt` | `strategy_dbqzt.yaml` | `ZD_DBQZT01` | 打板求涨停选股 |
| 📈 趋势主升浪 | QSZSL | `qszsl` | `strategy_qszsl.yaml` | `ZD_QSZSL01` | 趋势主升浪选股 |
| 🩹 错杀低吸 | CSLX | `cslx` | `strategy_cslx.yaml` | `ZD_CSLX01` | 错杀低吸选股 |
| ⚡ 弱转强 | RZQ | `rzq` | `strategy_rzq.yaml` | `ZD_RZQ01` | 弱转强选股 |
| 🔄 强转弱反抽 | QZRFC | `qzrfc` | `strategy_qzrfc.yaml` | `ZD_QZRFC01` | 强转弱反抽选股 |

### 4.2 板块 Code 命名规则
- 格式：`ZD_<策略拼音首字母大写><两位序号>`
- 前缀 `ZD` = 自定义（Zhiding）板块
- 序号 `01` 为默认，同一策略的变体可用 `02`/`03`
- 系统保留板块：`ZXG`（自选股）、`TJG`（条件股）

### 4.3 新增策略流程
1. 确定策略中文名 → 取拼音首字母 → 生成 `strategy_id` 和 `sector_code`
2. 复制 `strategies/_template.yaml` → 命名 `strategy_<id>.yaml`
3. 编辑 YAML：因子组合、阈值、评分公式、板块映射
4. 在 `config/sector_mapping.yaml` 添加映射
5. 执行 `python scripts/reload_config.py` 热加载
6. 系统自动注册策略 + 创建板块

---

## 五、配置文件规范

### 5.1 配置文件清单与职责

| 文件 | 职责 | 修改频率 |
|------|------|----------|
| `config/app.yaml` | 应用级配置（端口/路径/模式） | 极低 |
| `config/sector_mapping.yaml` | 策略↔板块映射 | 新增策略时 |
| `config/channels.yaml` | 推送通道开关与参数 | 中 |
| `config/cleaning_rules.yaml` | 通用数据清洗规则 | 中 |
| `config/monitor_rules.yaml` | 监控预警条件 | 高 |
| `config/export.yaml` | 导出格式与路径 | 低 |
| `config/theme.yaml` | 前端主题（颜色/字体） | 中 |
| `strategies/strategy_*.yaml` | 各策略完整定义 | 高（调参） |

### 5.2 策略 YAML 结构规范（必读）

```yaml
# strategies/strategy_dbqzt.yaml
strategy_id: dbqzt                    # 必填，全局唯一，拼音首字母小写
strategy_name: 打板求涨停              # 必填，中文显示名
strategy_emoji: "🔥"                  # 可选，UI显示emoji
version: "1.0"                        # 必填，版本号
enabled: true                         # 必填，是否启用

# 板块映射（也可在 sector_mapping.yaml 统一配置）
sector:
  code: ZD_DBQZT01
  name: 打板求涨停选股
  auto_update: true                   # 选股结果自动回写板块
  update_mode: replace                # replace(清空重写) / append(追加)

# 股票池筛选（基础过滤，不变的部分）
universe:
  exclude_st: true                    # 排除ST
  exclude_suspended: true             # 排除停牌
  exclude_new_listing_days: 5         # 上市不足N天排除
  market_list: [SH, SZ, BJ]           # 允许的市场
  exclude_codes: []                   # 黑名单（可配置）
  include_only: []                    # 白名单（优先级高于黑名单）

# 数据清洗规则（引用 cleaning_rules.yaml 或内联）
cleaning:
  rules_file: cleaning_rules.yaml     # 引用通用规则
  custom_rules:                       # 策略专属规则
    - rule: filter_negative
      field: Wtb
      action: drop
    - rule: filter_negative
      field: FCb
      action: drop

# 因子组合（核心可配置部分）
factors:
  - factor_id: momentum_5d            # 引用 factors/momentum.py
    weight: 0.3                       # 权重（评分用）
    params:                           # 因子参数（不硬编码）
      window: 5
  - factor_id: fc_amo_ratio
    weight: 0.4
    params:
      threshold: 0.5
  - factor_id: turnover_rate
    weight: 0.3
    params:
      window: 5

# 评分逻辑（表达式引擎，非硬编码）
scoring:
  formula: "sum(factor_score * weight) * penalty"
  normalization: rank_percentile      # rank_percentile/zscore/minmax
  penalties:
    - condition: "fc_amo_ratio < 0.3"
      multiplier: 0.5
      reason: 封板资金不足
    - condition: "turnover_rate > 0.3"
      multiplier: 0.7
      reason: 换手过高

# 选股结果配置
output:
  top_n: 20                           # 选前N只
  min_score: 0.6                      # 最低得分门槛
  sort_by: total_score
  sort_order: desc

# 监控配置（该策略选出的股票如何监控）
monitor:
  enabled: true
  subscribe_hq: true
  batch_size: 50                      # subscribe_hq 分批大小（不硬编码）
  alert_conditions:
    - condition: "pct_change > 0.095"
      alert_type: limit_up
      channels: [tdx_warn, websocket, feishu]
    - condition: "pct_change < -0.05"
      alert_type: drop_alert
      channels: [websocket, feishu]

# 导出配置（覆盖 export.yaml 默认值）
export:
  csv: true
  excel: true
  excel_sheet_name: 打板求涨停
```

### 5.3 配置热加载机制
- 所有 YAML 文件支持热加载（无需重启引擎）
- 修改 YAML 后调用 `POST /api/config/reload` 或执行 `scripts/reload_config.py`
- 引擎监听文件变更，自动重新注册策略/通道/因子

---

## 六、不硬编码清单（Code Review 强制检查）

### 6.1 绝对禁止硬编码

| ❌ 禁止 | ✅ 正确做法 | 配置位置 |
|---------|------------|----------|
| `if strategy == "dbqzt"` | 配置驱动，`strategy_id` 作 key | YAML |
| `subscribe_hq(stocks[:50])` | `batch_size` 来自配置 | YAML `monitor.batch_size` |
| `if pct > 0.095` | 阈值在 YAML | YAML `alert_conditions` |
| `webhook_url = "https://..."` | 配置 | `config/channels.yaml` |
| `output_dir = "/data/csv"` | 配置 | `config/export.yaml` |
| `SECTOR_CODE = "ZD_DBQZT01"` | 配置 | `config/sector_mapping.yaml` |
| `factors = [mom, breakout]` | YAML 列表 | YAML `factors` |
| `score = w1*f1 + w2*f2` | YAML 表达式 | YAML `scoring.formula` |
| `db_path = "quant.db"` | 配置 | `config/app.yaml` |
| `PORT = 8000` | 配置 | `config/app.yaml` |

### 6.2 必须配置化的内容
- 所有路径（output_dir / db_path / log_dir）
- 所有阈值（涨幅 / 跌幅 / 换手 / 封板比）
- 所有权重（因子权重 / 策略权重）
- 所有时间参数（订阅批次 / 轮询间隔 / 超时）
- 所有 URL（网关 / 飞书 / SMTP）
- 所有股票代码（黑名单 / 白名单 / 基准指数）
- 所有板块 code（策略↔板块映射）
- 所有字段名（CSV 字段映射 / 清洗规则）
- 所有开关（通道启用 / 导出启用 / 监控启用）

---

## 七、插件机制详解

### 7.1 因子插件

**位置**: `engine/factors/<factor_id>.py`

**接口**:
```python
from engine.factors.base import Factor

class Momentum5DFactor(Factor):
    factor_id = "momentum_5d"
    factor_name = "5日动量"
    
    def calculate(self, df: pd.DataFrame, params: dict) -> pd.Series:
        """
        df: 输入数据（含K线/快照等）
        params: 来自YAML的参数（如window=5）
        return: 每只股票的因子值（pd.Series, index=stock_code）
        """
        window = params.get("window", 5)
        return df["close"].pct_change(window)
```

**注册**: `engine/factors/registry.py` 自动扫描 `factors/` 目录所有 `.py` 文件

**新增因子**: 在 `factors/` 加文件 → 实现 `Factor` 接口 → YAML 引用

### 7.2 推送通道插件

**位置**: `engine/channels/<channel_id>.py`

**接口**:
```python
from engine.channels.base import NotificationChannel

class FeishuChannel(NotificationChannel):
    channel_id = "feishu"
    channel_name = "飞书推送"
    
    def send(self, message: NotificationMessage) -> bool:
        webhook_url = self.config.get("webhook_url")
        if not webhook_url:
            return False
        # 实现飞书推送
        ...
```

### 7.3 导出器插件

**位置**: `engine/exporters/<exporter_id>.py`

**接口**:
```python
from engine.exporters.base import DataExporter

class CsvExporter(DataExporter):
    exporter_id = "csv"
    
    def export(self, data: dict, context: RunContext) -> str:
        output_dir = self.config.get("output_dir")
        filename = self.config.get("filename_pattern").format(...)
        path = os.path.join(output_dir, filename)
        data["df"].to_csv(path, index=False)
        return path
```

---

## 八、数据适配器双模式

### 8.1 切换机制
```yaml
# config/app.yaml
adapter_mode: mock    # mock | real
```

### 8.2 Mock 适配器（开发/测试用）
- 基于 V8 系统的 CSV 样本数据（`docs/v8-data/.../data/`）
- 返回与 Real 适配器相同结构的 DataFrame
- 用于本 Linux 沙箱环境开发验证

### 8.3 Real 适配器（生产用）
- 调用 tqcenter API
- 必须在 Windows + 通达信终端环境运行
- 封装了所有 tqcenter API（见 `docs/maintenance/API_REFERENCE.md`）

### 8.4 适配器接口
```python
class BaseDataAdapter(ABC):
    @abstractmethod
    def get_snapshot(self, code: str) -> dict: ...
    
    @abstractmethod
    def get_kline(self, stock_list, period, start, end, count, dividend_type) -> dict: ...
    
    @abstractmethod
    def get_more_info(self, code: str) -> dict: ...
    
    @abstractmethod
    def get_pricevol(self, stock_list) -> dict: ...
    
    @abstractmethod
    def get_stock_list(self, list_type: str) -> list: ...
    
    @abstractmethod
    def get_sector_stocks(self, block_code, block_type) -> list: ...
    
    @abstractmethod
    def get_financial_data(self, code, field, start, end) -> pd.DataFrame: ...
    
    # ... 完整接口见 engine/data_adapter/base.py
```

---

## 九、DuckDB Schema

详见 `config/duckdb_schema.sql`，核心表：
- `strategies` - 策略注册表
- `selection_results` - 选股结果
- `signal_events` - 信号事件
- `sector_snapshots` - 板块快照
- `strategy_runs` - 执行日志
- `monitor_subscriptions` - 监控订阅
- `config_changes` - 配置变更审计
- `kline_cache` - K线缓存

---

## 十、Web 前端主题可配置化

### 10.1 主题配置
```yaml
# config/theme.yaml
theme:
  mode: dark                    # dark | light
  primary_color: "#f59e0b"      # 主色（琥珀金，金融风）
  up_color: "#ef4444"           # 涨色（红，A股惯例）
  down_color: "#22c55e"         # 跌色（绿）
  flat_color: "#6b7280"         # 平色
  background: "#0a0a0a"         # 背景
  card_background: "#171717"    # 卡片背景
  border_color: "#262626"       # 边框
  font_family: "ui-sans-serif, system-ui"
```

### 10.2 主题切换
- Web 前端通过 `/api/theme` 获取主题配置
- 修改 `theme.yaml` + 热加载 → 前端自动刷新
- 预留多主题切换能力（用户可保存个人主题）

---

## 十一、AI 维护者操作指南

### 11.1 修改前必读
1. 读 `worklog.md` 了解项目进展
2. 读本 `ARCHITECTURE.md` 了解架构
3. 读 `docs/maintenance/MAINTENANCE.md` 了解常见操作
4. 判断修改属于哪一层（见 2.1）

### 11.2 常见操作流程

**调整策略阈值**:
1. 编辑 `strategies/strategy_xxx.yaml`
2. 执行 `python scripts/reload_config.py`
3. 无需改代码

**新增策略**:
1. 按 4.3 流程操作
2. 加 YAML 文件 + 板块映射
3. 无需改代码

**新增因子**:
1. 在 `engine/factors/` 加文件实现 `Factor` 接口
2. YAML 中引用
3. 无需改引擎代码

**新增推送通道**:
1. 在 `engine/channels/` 加文件实现 `NotificationChannel` 接口
2. `config/channels.yaml` 配置
3. 无需改引擎代码

**修改选股流程**:
1. **慎重！** 影响 all 策略
2. 改 `engine/pipeline/` 代码
3. 充分测试

### 11.3 代码规范
- TypeScript 严格模式（前端）
- Python 类型注解（后端）
- 所有配置走 YAML，不硬编码
- 每个模块有 docstring
- 公共函数有类型注解
- 提交前跑 `bun run lint`

### 11.4 验证清单
- [ ] Mock 模式选股能跑通
- [ ] Web 前端 5 Tab 可访问
- [ ] 策略可在线启停
- [ ] CSV/Excel 能导出
- [ ] 板块能回写
- [ ] 配置热加载生效
- [ ] Agent Browser 验证无报错

---

## 十二、关键约束备忘

- `subscribe_hq` 上限 100 只 → 分批 50（可配置）
- `get_market_data` 单次 24000 条 → 自动分批续传
- `send_user_block` 是追加非覆盖 → 必须先 `clear_sector`
- 前复权对比客户端必须 `count=-1`
- 无直接下单 API → 半自动 `send_warn` 推送
- TdxQuant 必须 Windows + 通达信终端预启动
- 本环境用 Mock 适配器，`adapter_mode: mock`

---

**本文档随项目演进持续更新。每次重大修改后，维护者需更新对应章节。**

---

## 十三、R5-R13 演进补充（覆盖 P1 阶段描述）

> 以下章节反映 R5-R13 迭代后的最新架构，与上文 P1 描述冲突时**以下文为准**。

### 13.1 新增模块（R5-R13）

| 模块 | 位置 | 说明 |
|---|---|---|
| 回测引擎 | `engine/api/routes/backtest.py` + `src/components/quant/BacktestView.tsx` | 历史回测 + 净值曲线 + 多策略对比 |
| 导出器框架 | `engine/exporters/` | CSV / Excel / Sector / DuckDB 4 种 |
| 板块管理 | `engine/sector/` + `engine/api/routes/sectors.py` | 板块映射 + 个股归属 + 热力图 |
| 全局搜索 | `src/components/quant/GlobalSearch.tsx` | Cmd+K 搜索股票/策略/板块 |
| 信号中心 | `src/components/quant/SignalCenter.tsx` | 信号列表 + 详情抽屉 + 30s 轮询 |
| 监控匹配 | `engine/monitor/match_registry.py` + `config/monitor.yaml` | 5 个匹配策略 + 14 个信号模板 |
| **三层限流（R12）** | `engine/data_adapter/rate_limiter.py` + `engine/api/middleware/rate_limit.py` | 令牌桶 + 端点中间件 + 监控统计 |
| 引擎健康卡 | `src/components/quant/EngineHealthCard.tsx` | Dashboard 大屏，15s 刷新 |
| 竞价监控 | `src/components/quant/AuctionPanel.tsx` | 集合竞价实时面板 |

### 13.2 配置文件变更

**R13 合并**：`monitor_rules.yaml` + `match_strategies.yaml` → `monitor.yaml`（4 段：monitor / alert_templates / dedup / match_strategies）

**当前 config/ 目录**（7 个文件，从 9 个精简）：
- `app.yaml` — 主配置（adapter_mode / paths / tqcenter / api 限流）
- `monitor.yaml` — 监控配置（合并自 monitor_rules + match_strategies）
- `channels.yaml` — 4 个推送通道
- `cleaning_rules.yaml` — V8.1 5 项数据清洗
- `sector_mapping.yaml` — 板块映射
- `export.yaml` — 导出配置
- `theme.yaml` — 主题
- `duckdb_schema.sql` — DuckDB 8 张表 schema

### 13.3 脚本统一（R13）

**18 个 .sh/.ps1 双版本 → 8 个文件**，主入口 `scripts/dev.py`（Python 跨平台）：

```bash
python scripts/dev.py start|stop|setup|reload|test|paths|daemon
```

保留 `start_all.sh` / `start_all.ps1` 作为 thin wrapper（兼容老用法）。

### 13.4 三层限流架构（R12）

```
Layer 1: 令牌桶（tqcenter 调用守卫）
  - engine/data_adapter/rate_limiter.py (TokenBucket 单例 + acquire_or_skip)
  - real_adapter.py 20 个查询方法加守卫
  - 配置: config/app.yaml → tqcenter.rate_limit (qps=10, burst=20)

Layer 2: 端点中间件（API 限流）
  - engine/api/middleware/rate_limit.py (7 条规则, fail-open)
  - 超限返回 429 + Retry-After header
  - 配置: config/app.yaml → api.rate_limit (rules + enabled)

Layer 3: 监控统计
  - engine/api/state.py (api_call_total/rejected/avg_latency + tqcenter_call_total/rejected)
  - GET /api/monitor/health 透出 api_stats + rate_limit
  - 前端 EngineHealthCard.tsx 展示
```

**设计要点**：
- Mock 模式不限流（开发体验优先，real_adapter 不被调用）
- fail-open：中间件异常放行，不误杀
- 开关可控：`tqcenter.rate_limit.enabled` / `api.rate_limit.enabled` 独立

### 13.5 前端 API 代理统一（R13）

- 37 个 `src/app/api/*/route.ts` 统一用 `src/lib/api-proxy.ts` 的 `tryFastAPI/ok/err/fallback` 4 个 helper
- 降级数据统一在 `api-proxy.ts` 的 `fallback(path)` 映射表（原 `mock-data.ts` 已删除）
- Prisma 死代码已删（`src/lib/db.ts` + `prisma/` 目录），前端不直连数据库，全走 FastAPI

### 13.6 数据流（R5-R13 完整版）

```
用户点"执行选股"
  → POST /api/strategies/{id}/run (经 Layer2 限流, qpm=10)
  → StrategyRunner.run_strategy()
  → Pipeline 6 步: load_data → clean → factors(26个) → score(simpleeval) → filter_sort → export
  → 结果写 DuckDB selection_results 表
  → 自动订阅 Top 20 到 MonitorEngine
  → MonitorEngine 后台线程:
    - Mock 模式: subscribe_hq → MockAdapter._push_loop (3s/次)
    - Real 模式: subscribe_hq 优先, 失败降级 10s 轮询 (Layer1 限流守卫)
  → on_quote → RuleSet 求值 → 命中规则 → 写 signal_events
  → 4 通道推送 (飞书/Webhook/WS/站内)
  → 前端 SignalCenter 30s 轮询展示 + SignalToast 推送
```

### 13.7 关键约束更新

- **适配器模式不支持热加载**（mock ↔ real 必须重启）
- **api.rate_limit.rules 变更需重启**（中间件启动时加载）
- **tqcenter.rate_limit.qps/burst 支持热加载**（reset_limiter 已接入 reload 链）
- **DuckDB monitor_subscriptions 有 UNIQUE(stock_code, active) 约束**（R11 新增）
- **config/monitor.yaml 的 match_strategies 段写入用"读-改-写"**（避免误删其他段）

### 13.8 已尝试并回滚的方案

**R13 AKShare 真实数据源**：
- 沙箱环境验证 AKShare 不可用（东财断连 + 全量 OOM + py_mini_racer 内存大）
- 方案已完整回滚，`adapter_mode` 回到 mock
- 架构价值验证通过：`BaseDataAdapter` 抽象层 + `factory.get_adapter()` 插件式切换设计 OK
- 未来切真实数据走 Windows + tqcenter（adapter_mode: real）

---

**R5-R13 演进结束** · 有疑问先查 `worklog.md` + `docs/CHANGELOG.md`。
