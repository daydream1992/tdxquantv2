# TdxQuant — 策略与因子扩展完整指南

> **文档定位**：本文档是 **策略与因子扩展的操作手册**，接手 AI 照着做即可。
> **配套文档**：
> - `docs/maintenance/STRATEGY_LOGIC.md` — 5 策略公式与阈值唯一依据（实现因子公式时必须对照）
> - `docs/maintenance/ARCHITECTURE.md` — 5 层架构（策略属 L4，因子属 L3）
> - `docs/PROJECT_HANDOVER.md` — AI 接手总纲（本文档是其第六章的详尽版）
>
> **最后更新**：R8 轮次

---

## 目录

1. [扩展场景总览](#一扩展场景总览)
2. [扩展前必读：架构与设计原则](#二扩展前必读架构与设计原则)
3. [场景 A：调整现有策略阈值](#三场景-a调整现有策略阈值)
4. [场景 B：新增策略](#四场景-b新增策略)
5. [场景 C：新增因子插件](#五场景-c新增因子插件)
6. [场景 D：新增推送通道](#六场景-d新增推送通道)
7. [场景 E：新增导出格式](#七场景-e新增导出格式)
8. [评分公式与表达式引擎详解](#八评分公式与表达式引擎详解)
9. [因子公式实现依据与对照表](#九因子公式实现依据与对照表)
10. [完整示例：从零实现一个新策略](#十完整示例从零实现一个新策略)
11. [验证与 QA 清单](#十一验证与-qa-清单)
12. [常见问题与陷阱](#十二常见问题与陷阱)

---

## 一、扩展场景总览

### 1.1 五种扩展场景

| 场景 | 改什么 | 生效方式 | 难度 | 本章 |
|------|--------|----------|------|------|
| **A. 调策略阈值** | `strategies/strategy_*.yaml` | 热加载（2s） | ⭐ | 第三章 |
| **B. 新增策略** | 复制 `_template.yaml` | 热加载（2s） | ⭐⭐ | 第四章 |
| **C. 新增因子** | `engine/factors/` 加 `.py` | 重启 FastAPI | ⭐⭐⭐ | 第五章 |
| **D. 新增通道** | `engine/channels/` 加 `.py` | 重启 FastAPI | ⭐⭐⭐ | 第六章 |
| **E. 新增导出** | `engine/exporters/` 加 `.py` | 重启 FastAPI | ⭐⭐ | 第七章 |

### 1.2 决策流程图

```
需求是什么？
│
├─「改某策略的阈值/权重」→ 场景 A（改 YAML）
│
├─「加一个新策略」
│   ├─ 现有因子够用？ → 场景 B（加 YAML）
│   └─ 需要新因子？ → 场景 C（加因子）+ 场景 B（加 YAML）
│
├─「加一个新因子」→ 场景 C（加 .py 插件）
│
├─「加推送通道（钉钉/企微/短信）」→ 场景 D（加 .py 插件）
│
└─「加导出格式（PDF/JSON）」→ 场景 E（加 .py 插件）
```

---

## 二、扩展前必读：架构与设计原则

### 2.1 5 层架构定位

```
策略与因子扩展涉及三层：

Layer 5（用户配置）：strategies/*.yaml — 每天可能变
Layer 4（业务规则）：scoring.formula / pool.expression — 每周可能变
Layer 3（组件抽象）：engine/factors/ · engine/channels/ — 每月可能变
```

**判断准则**：
- 改阈值 → L5，改 YAML，不改代码
- 加策略 → L4，加 YAML 文件，不改引擎
- 加因子 → L3，加 factor 插件，不改引擎
- 加通道 → L3，加 channel 插件，不改引擎
- 改选股流程 → L2，改 `engine/pipeline/`（慎重，影响所有策略）

### 2.2 六大设计原则（必须遵守）

| 原则 | 说明 | 违反后果 |
|------|------|----------|
| **1. 配置驱动** | 阈值/权重/系数全从 YAML 读，绝不硬编码 | 无法热加载，改阈值要改代码 |
| **2. 纯函数式因子** | `calculate(df, params) -> Series`，不改 df，无内部状态 | 并行/缓存失效，结果不可复现 |
| **3. 声明依赖字段** | `get_required_fields()` 返回因子需要的列，pipeline 据此拉数据 | 数据缺失导致 NaN，结果错误 |
| **4. 评分必含 clip** | `scoring.formula` 每个维度必须 `clip(score, lo, hi)` | 累加超上限，评分失真 |
| **5. 不用 eval/exec** | 表达式用 `simpleeval` 白名单求值 | 安全漏洞（代码注入） |
| **6. 因子 ID 全局唯一** | `factor_id` 全局唯一，策略 YAML 引用 | 注册冲突，后注册覆盖先注册 |

### 2.3 关键代码位置

| 组件 | 文件 | 关键类/函数 |
|------|------|-------------|
| 因子基类 | `engine/factors/base.py` | `Factor`（ABC） |
| 因子注册表 | `engine/factors/registry.py` | `FactorRegistry`（自动扫描） |
| 现有因子 | `engine/factors/momentum.py` / `breakout.py` / `limit_up.py` / ... | 26 个因子 |
| 通道基类 | `engine/channels/base.py` | `BaseChannel` / `ChannelPayload` / `ChannelResult` |
| 通道注册表 | `engine/channels/registry.py` | `ChannelRegistry`（自动扫描） |
| 现有通道 | `engine/channels/csv_log.py` / `tdx_warn.py` / `websocket.py` / `feishu.py` | 4 通道 |
| 表达式引擎 | `engine/expression/evaluator.py` | `ExpressionEvaluator`（simpleeval） |
| 选股流水线 | `engine/pipeline/steps/` | `load_data` → `clean_data` → `calc_factors` → `score` → `filter_sort` → `export` |
| 策略 YAML | `strategies/strategy_*.yaml` | 5 策略 + 1 模板 |
| 策略模板 | `strategies/_template.yaml` | 复制即用 |
| 策略逻辑依据 | `docs/maintenance/STRATEGY_LOGIC.md` | 5 策略 4 维度公式（唯一依据） |

---

## 三、场景 A：调整现有策略阈值

### 3.1 适用场景

- 调整因子权重
- 调整因子参数（窗口期、阈值）
- 调整评分公式
- 调整预警条件
- 启用/禁用策略

### 3.2 操作步骤

#### Step 1：定位策略文件

```bash
ls strategies/
# strategy_dbqzt.yaml    打板求涨停
# strategy_qszsl.yaml    趋势主升浪
# strategy_cslx.yaml     错杀低吸
# strategy_rzq.yaml      弱转强
# strategy_qzrfc.yaml    强转弱反抽
```

#### Step 2：编辑 YAML

以「打板求涨停」调整 `seal_ratio` 因子阈值为例：

```yaml
# strategies/strategy_dbqzt.yaml
factors:
  - factor_id: seal_ratio
    weight: 1.0
    params:
      field: FCb
      clip_min: 0.0          # ← 改这里
```

调整评分公式：

```yaml
scoring:
  formula: clip(
    (consecutive_limit>=1)*10
    + (seal_ratio>=0.5)*20         # ← 改 0.5 → 0.6
    + (seal_ratio>=0.2 and seal_ratio<0.5)*14
    + ...
    , 0, 40)
  + clip(..., 0, 30)    # 维度2
  + clip(..., 0, 20)    # 维度3
  + clip(..., -10, 0)   # 维度4（风险扣分）
```

#### Step 3：热加载

```bash
# 方式 1：API
curl -X POST http://127.0.0.1:8000/api/config/reload

# 方式 2：脚本
python scripts/reload_config.py

# 方式 3：等 2 秒自动重载（ConfigLoader mtime 监听）

# 方式 4：前端 UI 顶部「热加载配置」按钮
```

#### Step 4：验证

```bash
# 确认策略加载
curl http://127.0.0.1:8000/api/strategies | python -m json.tool

# 运行策略看效果
curl -X POST http://127.0.0.1:8000/api/strategies/dbqzt/run

# 查看结果
curl http://127.0.0.1:8000/api/selections?strategy_id=dbqzt&limit=1
```

### 3.3 注意事项

| 事项 | 说明 |
|------|------|
| YAML 缩进 | 必须用空格，不能 Tab；缩进错误会导致 `yaml.safe_load` 失败 |
| 公式换行 | `formula:` 后的值可用 `>` 或 `|` 多行，或单行加 `\` 续行（实测 YAML 支持 `clip(... +` 换行） |
| clip 必填 | 每个评分维度必须 `clip(score, lo, hi)`，防止累加超上限 |
| 字段名 | `params.field` 的值（如 `FCb`/`FCAmo`/`ZAF`）必须与数据源字段一致，见 `STRATEGY_LOGIC.md` |
| 启用中禁删 | 删除策略前必须 `enabled: false`，否则后端 409 |

---

## 四、场景 B：新增策略

### 4.1 适用场景

- 在 5 大策略之外新增自定义策略
- 基于现有策略复制改造

### 4.2 操作步骤

#### Step 1：复制模板

```bash
# 方式 1：命令行
cp strategies/_template.yaml strategies/strategy_mystr.yaml

# 方式 2：前端 UI（推荐）
# 策略管理 Tab → 选源策略 → 点 📋 复制 → 填新 ID/名/emoji → 确认
# 后端 POST /api/config/strategies 自动创建
```

#### Step 2：编辑必填字段

```yaml
# strategies/strategy_mystr.yaml

# ---- 必填：策略元信息 ----
strategy_id: mystr              # ★ 拼音首字母小写，2-30 字符，[a-zA-Z0-9_]
strategy_name: 我的策略          # ★ 中文名
strategy_emoji: "🚀"            # UI 显示 emoji
version: "1.0"
enabled: true                   # ★ 复制后改 true

# ---- 板块映射 ----
sector:
  code: ZD_MYSTR01              # ★ ZD_<拼音大写><两位序号>
  name: 我的策略选股              # ★ <中文名>选股
  auto_update: true
  update_mode: replace          # replace(清空重写) / append(追加)

# ---- 股票池筛选 ----
universe:
  exclude_st: true
  exclude_suspended: true
  exclude_new_listing_days: 5
  market_list: [SH, SZ, BJ]
  exclude_codes: []
  include_only: []

# ---- 策略专属股票池 ----
pool:
  expression: ""                # 空=不额外过滤；如 "is_limit_up or ZAF >= 7"

# ---- 数据清洗 ----
cleaning:
  rules_file: cleaning_rules.yaml
  custom_rules: []

# ---- 因子组合 ----
factors:
  - factor_id: momentum_5d      # ★ 必须是 engine/factors/ 已注册的因子
    weight: 1.0
    params:
      window: 5
  - factor_id: turnover_rate
    weight: 0.5
    params: {}

# ---- 评分公式 ----
scoring:
  formula: clip(momentum_5d * 20 + turnover_rate * 10, 0, 40) + clip(..., 0, 30)
  # ★ 每维度必含 clip；变量名 = factor_id

# ---- 预警条件 ----
monitor:
  alert_conditions:
    - condition: pct_change > 0.095
      alert_type: limit_up
      channels: [tdx_warn, websocket, feishu]
      priority: high

# ---- 导出 ----
export:
  csv: true
  excel: true
  sector_writeback: true
```

#### Step 3：热加载 + 验证

```bash
# 热加载（或等 2s）
curl -X POST http://127.0.0.1:8000/api/config/reload

# 验证加载
curl http://127.0.0.1:8000/api/strategies | python -m json.tool
# 应包含 mystr

# 运行策略
curl -X POST http://127.0.0.1:8000/api/strategies/mystr/run

# 查看结果
curl http://127.0.0.1:8000/api/selections?strategy_id=mystr&limit=1
```

### 4.3 命名规范（强制）

| 字段 | 规则 | 示例 |
|------|------|------|
| 文件名 | `strategy_<拼音>.yaml` | `strategy_mystr.yaml` |
| `strategy_id` | 拼音首字母小写，2-30 字符，`[a-zA-Z0-9_]` | `mystr` |
| `sector.code` | `ZD_<拼音大写><两位序号>` | `ZD_MYSTR01` |
| `sector.name` | `<中文名>选股` | `我的策略选股` |
| `strategy_emoji` | 单个 emoji | `🚀` |

### 4.4 前端创建（推荐）

```
策略管理 Tab → 找相似策略 → 点 📋 复制
→ 填新 ID（mystr）/ 新名（我的策略）/ emoji（🚀）
→ YAML 预览自动替换 strategy_id/name/emoji/sector.code/sector.name
→ 确认创建
→ 新策略默认禁用 → 开启启用开关
→ 运行验证
```

后端 `POST /api/config/strategies` 会校验：
- ID 格式（正则 `^[a-zA-Z0-9_]{2,30}$`）
- YAML 合法性（`yaml.safe_load`）
- 文件冲突（`overwrite=false` 时存在则 409）

---

## 五、场景 C：新增因子插件

### 5.1 适用场景

- 现有 26 个因子不够用
- 需要实现 `STRATEGY_LOGIC.md` 中定义但尚未实现的因子公式

### 5.2 现有因子清单

```
engine/factors/
├── momentum.py      → momentum_5d / momentum_10d / momentum_20d
├── breakout.py      → breakout_ma20 / breakout_platform
├── limit_up.py      → seal_ratio / seal_amount / seal_strength / consecutive_limit / year_limit_days
├── turnover.py      → turnover_rate / turnover_momentum
├── valuation.py     → market_cap / pe_ttm / pb_ratio
├── volume_price.py  → volume_ratio / amount / price_volume_score / main_inflow / big_buy_ratio
├── trend.py         → ma_alignment / macd_direction
└── reversal.py      → panic_depth / panic_volume / support_strength / catalyst_score
```

> ⚠️ **重要**：当前因子多为「骨架实现」（P1-4），公式需对照 `STRATEGY_LOGIC.md` 补全。见第九章对照表。

### 5.3 因子基类（`engine/factors/base.py`）

```python
class Factor(ABC):
    # ---- 子类必须覆盖的类属性 ----
    factor_id: str = ""           # 全局唯一，策略 YAML 引用
    factor_name: str = ""         # 中文名，UI/日志显示
    factor_category: str = ""     # momentum/breakout/valuation/volume/limit_up/trend/reversal/turnover
    factor_description: str = ""  # 说明（可选）

    # ---- 子类可选覆盖 ----
    def get_required_fields(self) -> list[str]:
        """声明依赖的数据列。pipeline 据此拉数据。"""
        return []

    def get_default_params(self) -> dict[str, Any]:
        """默认参数，被 YAML params 覆盖。"""
        return {}

    # ---- 子类必须实现 ----
    @abstractmethod
    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        """计算因子值。纯函数：不改 df，无内部状态。"""
        raise NotImplementedError
```

### 5.4 新增因子完整步骤

#### Step 1：创建文件

```bash
# 新建 engine/factors/my_factor.py
```

#### Step 2：实现因子

```python
"""我的因子。

说明：基于 XXX 字段计算 YYY 维度。
依据：docs/maintenance/STRATEGY_LOGIC.md 第 X 章 YYY 节。
"""
from __future__ import annotations
from typing import Any
import pandas as pd
from engine.factors.base import Factor


class MyFactor(Factor):
    factor_id = "my_factor"               # ★ 全局唯一
    factor_name = "我的因子"
    factor_category = "momentum"          # ★ 选一个分类
    factor_description = "示例：5日动量放大版"

    def get_required_fields(self) -> list[str]:
        # ★ 声明依赖列，pipeline 会确保 df 含这些列
        return ["ZAFPre5", "fHSL"]

    def get_default_params(self) -> dict[str, Any]:
        return {"multiplier": 2.0, "clip_min": 0.0}

    def calculate(self, df: pd.DataFrame, params: dict[str, Any]) -> pd.Series:
        # ★ 纯函数：不修改 df，不存内部状态
        params = {**self.get_default_params(), **params}

        zaf = pd.to_numeric(df["ZAFPre5"], errors="coerce")
        hsl = pd.to_numeric(df["fHSL"], errors="coerce")

        result = zaf * (1 + hsl / 100) * params["multiplier"]
        result = result.clip(lower=params["clip_min"])
        return result
```

#### Step 3：重启 FastAPI（因子注册不热加载）

```bash
# 沙箱
pkill -f "uvicorn engine.api.main"
/home/z/.venv/bin/python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload &

# Windows
# Ctrl+C 停止，重新 python scripts\start_engine.py --reload
```

#### Step 4：验证注册

```bash
curl http://127.0.0.1:8000/api/strategies
# 响应中应能查到 my_factor（在因子注册表里）
```

或直接 Python 验证：
```python
from engine.factors.registry import FactorRegistry
r = FactorRegistry()
print(r.list_factors())  # 应包含 my_factor
```

#### Step 5：策略 YAML 引用

```yaml
# strategies/strategy_mystr.yaml
factors:
  - factor_id: my_factor
    weight: 1.0
    params:
      multiplier: 3.0       # 覆盖默认 2.0
      clip_min: 0.0
```

#### Step 6：热加载策略 + 运行验证

```bash
curl -X POST http://127.0.0.1:8000/api/config/reload
curl -X POST http://127.0.0.1:8000/api/strategies/mystr/run
curl http://127.0.0.1:8000/api/selections?strategy_id=mystr&limit=1
```

### 5.5 因子实现规范（必须遵守）

| 规范 | 说明 |
|------|------|
| **纯函数** | `calculate` 不修改 `df`，不存 `self.xxx` 状态，结果只依赖输入 |
| **声明依赖** | `get_required_fields` 返回所有用到的列名，pipeline 据此拉数据 |
| **参数化** | 阈值/窗口/系数全从 `params` 读，不硬编码；`get_default_params` 给默认值 |
| **容错** | `pd.to_numeric(..., errors="coerce")` 处理脏数据；缺失列返回 NaN Series |
| **类型** | 返回 `pd.Series`，index 与 df 对齐 |
| **ID 全局唯一** | `factor_id` 不能与现有 26 个因子重复 |

### 5.6 因子分类对照

| `factor_category` | 含义 | 典型因子 |
|-------------------|------|----------|
| `momentum` | 动量 | momentum_5d/10d/20d |
| `breakout` | 突破 | breakout_ma20/platform |
| `limit_up` | 涨停 | seal_ratio/amount/strength/consecutive_limit |
| `turnover` | 换手 | turnover_rate/momentum |
| `valuation` | 估值 | market_cap/pe_ttm/pb_ratio |
| `volume` | 量价 | volume_ratio/amount/price_volume_score |
| `trend` | 趋势 | ma_alignment/macd_direction |
| `reversal` | 反转 | panic_depth/volume/support_strength |

---

## 六、场景 D：新增推送通道

### 6.1 适用场景

- 现有 4 通道（tdx_warn/websocket/feishu/csv_log）不够
- 需要钉钉 / 企业微信 / 短信 / 邮件等通道

### 6.2 通道基类（`engine/channels/base.py`）

```python
class BaseChannel(ABC):
    name: str = "base"              # ★ 通道唯一标识
    force_enabled: bool = False     # True=强制开启（如 csv_log）

    def __init__(self, config: dict | None = None):
        self.config = config or {}

    @property
    def enabled(self) -> bool:
        if self.force_enabled:
            return True
        return bool(self.config.get("enabled", False))

    def validate_config(self) -> list[str]:
        """校验配置，返回错误信息列表（空=通过）。"""
        return []

    @abstractmethod
    def send(self, payload: ChannelPayload) -> ChannelResult:
        """发送消息，返回结果。"""
        raise NotImplementedError

    def status(self) -> dict[str, Any]:
        """返回状态摘要，供 /api/channels 查询。"""
        return {...}
```

### 6.3 ChannelPayload 结构

```python
@dataclass
class ChannelPayload:
    signal_id: str = ""
    signal_type: str = "system"     # limit_up | drop_alert | breakout | selection | system
    strategy_id: str = ""
    strategy_name: str = ""
    strategy_emoji: str = ""
    stock_code: str = ""
    stock_name: str = ""
    title: str = ""
    content: str = ""
    severity: str = "info"          # info | warn | error
    priority: str = "medium"        # high | medium | low
    extra: dict = field(default_factory=dict)
    triggered_at: datetime = field(default_factory=datetime.now)
```

### 6.4 新增通道完整步骤

#### Step 1：创建文件

```bash
# 新建 engine/channels/dingtalk.py
```

#### Step 2：实现通道

```python
"""钉钉推送通道。

调用钉钉群机器人 webhook，支持 text / markdown 消息。
配置见 config/channels.yaml 的 dingtalk 段。
"""
from __future__ import annotations
import logging
import hmac
import hashlib
import base64
import time
import urllib.parse
import requests  # 或用标准库 urllib
from engine.channels.base import BaseChannel, ChannelPayload, ChannelResult

logger = logging.getLogger(__name__)


class DingtalkChannel(BaseChannel):
    name = "dingtalk"
    # force_enabled = False  # 用户可关闭

    def validate_config(self) -> list[str]:
        errors = []
        if self.enabled:
            if not self.config.get("webhook_url"):
                errors.append("webhook_url 不能为空")
            if not self.config.get("secret"):
                errors.append("secret 不能为空")
        return errors

    def send(self, payload: ChannelPayload) -> ChannelResult:
        if not self.enabled:
            return ChannelResult(success=False, message="通道未启用")

        try:
            webhook = self.config["webhook_url"]
            secret = self.config["secret"]

            # 钉钉签名
            timestamp = str(round(time.time() * 1000))
            string_to_sign = f"{timestamp}\n{secret}"
            hmac_code = hmac.new(
                secret.encode("utf-8"),
                string_to_sign.encode("utf-8"),
                digestmod=hashlib.sha256
            ).digest()
            sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))

            url = f"{webhook}&timestamp={timestamp}&sign={sign}"
            body = {
                "msgtype": "markdown",
                "markdown": {
                    "title": payload.display_title,
                    "text": self._format_markdown(payload),
                }
            }
            resp = requests.post(url, json=body, timeout=5)
            data = resp.json()

            if data.get("errcode") == 0:
                return ChannelResult(success=True, message="钉钉推送成功")
            return ChannelResult(success=False, message=f"钉钉错误: {data}")

        except Exception as exc:
            logger.error("钉钉推送异常: %s", exc)
            return ChannelResult(success=False, message=str(exc))

    def _format_markdown(self, payload: ChannelPayload) -> str:
        return (
            f"## {payload.strategy_emoji} {payload.display_title}\n\n"
            f"- **策略**: {payload.strategy_name}\n"
            f"- **股票**: {payload.stock_name}({payload.stock_code})\n"
            f"- **时间**: {payload.triggered_at:%Y-%m-%d %H:%M:%S}\n"
            f"- **严重度**: {payload.severity}\n\n"
            f"{payload.content}"
        )
```

#### Step 3：配置 `config/channels.yaml`

```yaml
channels:
  # ... 现有通道 ...
  - channel_id: dingtalk
    channel_name: 钉钉推送
    enabled: false                  # 先关，配好 webhook 再开
    config:
      webhook_url: ""               # 填钉钉机器人 webhook
      secret: ""                    # 填加签密钥
```

#### Step 4：重启 FastAPI

```bash
# 通道注册不热加载，需重启
pkill -f "uvicorn engine.api.main"
/home/z/.venv/bin/python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --reload &
```

#### Step 5：验证

```bash
# 查通道列表
curl http://127.0.0.1:8000/api/channels
# 应包含 dingtalk

# 测试发送
curl -X POST http://127.0.0.1:8000/api/channels/dingtalk/test
```

#### Step 6：策略引用

```yaml
# strategies/strategy_dbqzt.yaml
monitor:
  alert_conditions:
    - condition: pct_change > 0.095
      alert_type: limit_up
      channels: [tdx_warn, websocket, dingtalk]   # ← 加 dingtalk
      priority: high
```

热加载策略后即生效。

### 6.5 通道实现规范

| 规范 | 说明 |
|------|------|
| **导入容错** | 第三方库（requests 等）用 try-import，缺失时 `validate_config` 报错而非崩溃 |
| **超时** | `send` 必须设超时（如 `timeout=5`），避免阻塞消息总线 |
| **异常捕获** | `send` 内部 try-except，失败返回 `ChannelResult(success=False)`，不抛异常 |
| **配置校验** | `validate_config` 返回错误列表，前端 UI 展示 |
| **不阻塞** | 慢通道（短信/邮件）考虑异步，避免拖慢主流程 |

---

## 七、场景 E：新增导出格式

### 7.1 适用场景

- 现有 CSV / Excel 不够
- 需要 PDF / JSON / Parquet 等格式

### 7.2 操作步骤

#### Step 1：创建文件

```bash
# 新建 engine/exporters/json_exporter.py
```

#### Step 2：实现导出器（参考现有 `engine/exporters/csv.py`）

```python
"""JSON 导出器。"""
from __future__ import annotations
import json
from pathlib import Path
from engine.exporters.base import BaseExporter  # 若有基类


class JsonExporter(BaseExporter):
    name = "json"

    def export(self, df, output_path: str) -> str:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        records = df.to_dict(orient="records")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2, default=str)
        return str(path)
```

#### Step 3：注册（若需手动注册）

查看 `engine/exporters/__init__.py` 是否自动扫描；若否，手动注册。

#### Step 4：重启 + 验证

```bash
# 重启 FastAPI
# 策略 YAML 引用：
```

```yaml
# strategies/strategy_mystr.yaml
export:
  csv: true
  excel: true
  json: true       # ← 新增
```

---

## 八、评分公式与表达式引擎详解

### 8.1 表达式引擎（`engine/expression/evaluator.py`）

**技术**：`simpleeval` 库（AST 解析 + 白名单求值，**不用 eval/exec**）

**支持语法**：
- 算术：`+ - * / // % **`
- 比较：`== != < > <= >=`
- 逻辑：`and or not`
- 列表：`[1, 2, 3]` / 索引 `list[0]`
- 字典：`{"a": 1}` / 访问 `dict["a"]`
- `in` / `not in`

**白名单函数**：

| 函数 | 说明 |
|------|------|
| `clip(value, lo, hi)` | **评分必用**，限制区间 |
| `abs` / `min` / `max` / `sum` / `len` | 常用 |
| `round` / `int` / `float` / `str` / `bool` | 类型转换 |
| `any` / `all` / `sorted` | 集合操作 |

**禁止**：函数调用（白名单外）/ `import` / 属性访问 `.`（simpleeval 中需显式注册）

### 8.2 评分公式结构

策略 YAML 的 `scoring.formula` 是一个表达式字符串，变量名 = `factor_id`：

```yaml
scoring:
  formula: |
    clip(
      (consecutive_limit>=1)*10
      + (seal_ratio>=0.5)*20
      + (seal_ratio>=0.2 and seal_ratio<0.5)*14
      + (seal_ratio>=0.05 and seal_ratio<0.2)*8
      , 0, 40
    )
    + clip(
      (consecutive_limit>=7)*30
      + (consecutive_limit>=5 and consecutive_limit<7)*26
      + ...
      , 0, 30
    )
    + clip(..., 0, 20)
    + clip(..., -10, 0)
```

**结构要点**：
1. 每个维度一个 `clip(..., lo, hi)`，`hi` 是该维度上限
2. 维度间用 `+` 连接
3. 变量名 = 因子的 `factor_id`（如 `seal_ratio`、`consecutive_limit`）
4. 布尔条件 `(seal_ratio>=0.5)` 返回 0/1，乘以分数实现条件加分
5. 风险扣分维度用负区间 `clip(..., -10, 0)`

### 8.3 预警条件表达式

`monitor.alert_conditions[].condition` 同样用表达式引擎：

```yaml
monitor:
  alert_conditions:
    - condition: pct_change > 0.095           # 涨幅 > 9.5%
      alert_type: limit_up
      channels: [tdx_warn, websocket, feishu]
      priority: high
    - condition: pct_change < -0.05           # 跌幅 > 5%
      alert_type: drop_alert
      channels: [websocket, feishu]
      priority: medium
    - condition: auction_pct > 0.03           # 竞价涨幅 > 3%
      alert_type: auction_surge
      channels: [websocket]
      priority: medium
```

变量名 = 实时行情字段（`pct_change` / `volume` / `amount` / `auction_pct` 等）。

---

## 九、因子公式实现依据与对照表

> ⚠️ **关键**：当前 26 个因子多为「骨架实现」（P1-4 阶段），公式需对照 `STRATEGY_LOGIC.md` 补全。补全因子时**必须**对照此文档，不要自己编公式。

### 9.1 STRATEGY_LOGIC.md 结构

```
一、12 步选股总流程
二、通用数据清洗规则（5 项 Bug 修复）
三、K 线技术指标计算
四、老登过滤逻辑
五、涨停判断逻辑
六、行业统计 + 辅助字段
七、压力位计算
八、5 策略详解
   - 策略 1: 打板求涨停 (dbqzt) — 4 维度：封板强度/连板辨识度/竞价抢筹/风险扣分
   - 策略 2: 趋势主升浪 (qszsl) — 4 维度：...
   - 策略 3: 错杀低吸 (cslx) — 4 维度：...
   - 策略 4: 弱转强 (rzq) — 4 维度：...
   - 策略 5: 强转弱反抽 (qzrfc) — 4 维度：...
```

### 9.2 因子补全对照表

| 因子 ID | 文件 | 当前状态 | 依据章节 | 补全要点 |
|---------|------|----------|----------|----------|
| `momentum_5d/10d/20d` | `momentum.py` | 骨架（用 ZAFPre5） | §三 K线指标 | 确认是否需去极值/中性化 |
| `breakout_ma20` | `breakout.py` | 骨架 | §三 K线指标 | MA20 突破判断 + 量能确认 |
| `breakout_platform` | `breakout.py` | 骨架 | §三 K线指标 | 平台突破 + 振幅收缩 |
| `seal_ratio` | `limit_up.py` | 骨架（用 FCb） | §五 涨停判断 | 封单比 = FCb，clip_min=0 |
| `seal_amount` | `limit_up.py` | 骨架（用 FCAmo） | §五 涨停判断 | 封单金额，Bug2 清洗负值 |
| `seal_strength` | `limit_up.py` | 骨架（用「封板强度系数」） | §五 涨停判断 | 综合封板强度 |
| `consecutive_limit` | `limit_up.py` | 骨架（用 fLianB） | §五 涨停判断 | Bug4：fLianB 语义重定义 |
| `year_limit_days` | `limit_up.py` | 骨架 | §五 涨停判断 | 年内涨停天数 |
| `turnover_rate` | `turnover.py` | 骨架（用 fHSL） | §六 辅助字段 | 换手率 = fHSL |
| `turnover_momentum` | `turnover.py` | 骨架 | §三 K线指标 | 换手率动量 |
| `market_cap` | `valuation.py` | 骨架 | §一 数据加载 | 总市值 |
| `pe_ttm` | `valuation.py` | 骨架 | §一 数据加载 | PE TTM |
| `pb_ratio` | `valuation.py` | 骨架 | §一 数据加载 | PB |
| `volume_ratio` | `volume_price.py` | 骨架（用 Wtb） | §六 辅助字段 | Bug1：Wtb 负值过滤 |
| `amount` | `volume_price.py` | 骨架 | §六 辅助字段 | 成交额 |
| `price_volume_score` | `volume_price.py` | 骨架 | §三 K线指标 | 量价综合评分 |
| `main_inflow` | `volume_price.py` | 骨架（用 Zjl） | §六 辅助字段 | 主力净流入 |
| `big_buy_ratio` | `volume_price.py` | 骨架 | §六 辅助字段 | 大买占比 = TotalBVol/(TotalBVol+TotalSVol) |
| `ma_alignment` | `trend.py` | 骨架 | §三 K线指标 | 均线多头排列 |
| `macd_direction` | `trend.py` | 骨架 | §三 K线指标 | MACD 金叉/方向 |
| `panic_depth` | `reversal.py` | 骨架 | §八 策略3 错杀低吸 | 恐慌深度 |
| `panic_volume` | `reversal.py` | 骨架 | §八 策略3 | 恐慌量能 |
| `support_strength` | `reversal.py` | 骨架 | §七 压力位 | 支撑强度 |
| `catalyst_score` | `reversal.py` | 骨架 | §八 策略4 弱转强 | 催化剂评分 |

### 9.3 补全因子的工作流

```
1. 读 STRATEGY_LOGIC.md 对应章节，理解公式
2. 读现有骨架实现（engine/factors/xxx.py），看 TODO(P1-2) 注释
3. 读 V8 源码 docs/v8-data/stock_selection_v8_1_standalone/run.py 确认细节
4. 实现公式（纯函数，参数化，容错）
5. Mock 模式下用 V8 样本数据验证
6. Real 模式下用真实行情验证
7. worklog 记录补全情况
```

---

## 十、完整示例：从零实现一个新策略

**目标**：新增一个「放量突破」策略，用 `volume_ratio` + `breakout_ma20` 因子。

### Step 1：确认因子已存在

```bash
curl http://127.0.0.1:8000/api/strategies | python -m json.tool | grep -E "volume_ratio|breakout_ma20"
# 两个因子都已注册（骨架实现）
```

### Step 2：创建策略 YAML

```yaml
# strategies/strategy_flptp.yaml
strategy_id: flptp
strategy_name: 放量突破
strategy_emoji: "🚀"
version: "1.0"
enabled: true

sector:
  code: ZD_FLPTP01
  name: 放量突破选股
  auto_update: true
  update_mode: replace

universe:
  exclude_st: true
  exclude_suspended: true
  exclude_new_listing_days: 5
  market_list: [SH, SZ, BJ]
  exclude_codes: []
  include_only: []

pool:
  # 放量突破 pool：量比 > 2 且 当日涨幅 > 3%
  expression: "volume_ratio > 2 and ZAF > 3"

cleaning:
  rules_file: cleaning_rules.yaml
  custom_rules: []

factors:
  - factor_id: volume_ratio
    weight: 1.0
    params:
      field: Wtb
      invalid_to_nan: true
  - factor_id: breakout_ma20
    weight: 1.5
    params: {}

scoring:
  # 维度1：量价（0-40）
  # 维度2：突破强度（0-30）
  # 维度3：趋势确认（0-20）
  # 维度4：风险扣分（-10~0）
  formula: |
    clip(
      (volume_ratio>=5)*40
      + (volume_ratio>=3 and volume_ratio<5)*30
      + (volume_ratio>=2 and volume_ratio<3)*20
      + (volume_ratio>=1.5 and volume_ratio<2)*10
      , 0, 40
    )
    + clip(
      (breakout_ma20>=1)*30
      + (breakout_ma20>=0.5 and breakout_ma20<1)*20
      + (breakout_ma20>0 and breakout_ma20<0.5)*10
      , 0, 30
    )
    + clip(0, 0, 20)
    + clip(0, -10, 0)

monitor:
  alert_conditions:
    - condition: "volume_ratio > 3 and pct_change > 0.05"
      alert_type: breakout
      channels: [tdx_warn, websocket]
      priority: high

export:
  csv: true
  excel: true
  sector_writeback: true
```

### Step 3：热加载 + 验证

```bash
# 热加载
curl -X POST http://127.0.0.1:8000/api/config/reload

# 确认加载
curl http://127.0.0.1:8000/api/strategies | python -m json.tool | grep flptp

# 运行
curl -X POST http://127.0.0.1:8000/api/strategies/flptp/run

# 查结果
curl "http://127.0.0.1:8000/api/selections?strategy_id=flptp&limit=5"
```

### Step 4：前端验证

```
1. 策略管理 Tab → 应看到「🚀 放量突破」卡片
2. 点 ▶️ 运行
3. 切到选股结果 Tab 查看结果
4. 切到板块管理 Tab 确认 ZD_FLPTP01 板块已回写
```

### Step 5：worklog 记录

```markdown
---
Task ID: R8-新策略
Agent: main
Task: 新增「放量突破」策略

Work Log:
- 创建 strategies/strategy_flptp.yaml
- 热加载验证
- 运行选股成功

Stage Summary:
- 已完成: 新策略 flptp 放量突破
- 文件变更: strategies/strategy_flptp.yaml（新增）
- 未解决: 因子 volume_ratio/breakout_ma20 为骨架实现，公式待补全
- 下一阶段: 对照 STRATEGY_LOGIC.md 补全因子公式
```

---

## 十一、验证与 QA 清单

### 11.1 策略扩展 QA

```bash
# 1. 策略加载
curl http://127.0.0.1:8000/api/strategies | python -m json.tool

# 2. 策略详情
curl http://127.0.0.1:8000/api/strategies/<id>

# 3. 运行选股
curl -X POST http://127.0.0.1:8000/api/strategies/<id>/run

# 4. 查看结果
curl "http://127.0.0.1:8000/api/selections?strategy_id=<id>&limit=5"

# 5. 导出
curl http://127.0.0.1:8000/api/selections/<run_id>/export?format=csv -o result.csv

# 6. 前端验证
# 策略管理 Tab → 看到新策略卡片 → 运行 → 选股结果 Tab
```

### 11.2 因子扩展 QA

```bash
# 1. 因子注册（重启后）
python -c "from engine.factors.registry import FactorRegistry; print(FactorRegistry().list_factors())"

# 2. 因子计算（单测，非必须）
python -c "
import pandas as pd
from engine.factors.my_factor import MyFactor
df = pd.DataFrame({'ZAFPre5': [0.05, 0.1], 'fHSL': [3, 5]})
print(MyFactor().calculate(df, {}))
"

# 3. 策略引用后运行
curl -X POST http://127.0.0.1:8000/api/strategies/<id>/run
```

### 11.3 通道扩展 QA

```bash
# 1. 通道列表
curl http://127.0.0.1:8000/api/channels

# 2. 测试发送
curl -X POST http://127.0.0.1:8000/api/channels/<name>/test

# 3. 触发预警（运行策略）
curl -X POST http://127.0.0.1:8000/api/strategies/<id>/run

# 4. 查信号
curl http://127.0.0.1:8000/api/signals?limit=3
```

---

## 十二、常见问题与陷阱

### 12.1 策略相关

| 问题 | 原因 | 解决 |
|------|------|------|
| 策略不加载 | YAML 语法错 | `python -c "import yaml; yaml.safe_load(open('strategies/strategy_xxx.yaml'))"` 检查 |
| `factor_id` 未注册 | 因子文件没重启加载 | 重启 FastAPI（因子注册不热加载） |
| 评分全 0 | 公式变量名与 factor_id 不一致 | 检查 `scoring.formula` 变量名 = `factor_id` |
| 评分超上限 | 缺 clip | 每维度加 `clip(..., 0, 上限)` |
| 选股结果空 | pool.expression 过滤太严 | 临时改 `expression: ""` 排查 |
| 板块回写失败 | Real 模式终端未启动 | 启动通达信终端 |

### 12.2 因子相关

| 问题 | 原因 | 解决 |
|------|------|------|
| `FactorNotFoundError` | factor_id 拼错或未重启 | 重启 FastAPI；核对 factor_id 拼写 |
| 因子返回 NaN | 依赖字段缺失 | 检查 `get_required_fields` 返回的列是否在数据源中 |
| 因子结果不稳定 | 有内部状态 | 改为纯函数，不存 `self.xxx` |
| 因子报错 | 脏数据 | `pd.to_numeric(..., errors="coerce")` 容错 |

### 12.3 通道相关

| 问题 | 原因 | 解决 |
|------|------|------|
| 通道不推送 | `enabled: false` | 改 `config/channels.yaml` + 热加载 |
| 飞书签名失败 | secret 拼错 | 对照飞书机器人配置 |
| 钉钉 errcode 310000 | IP 白名单 | 钉钉后台加服务器 IP |
| 推送阻塞主流程 | 未设超时 | `requests.post(..., timeout=5)` |

### 12.4 表达式相关

| 问题 | 原因 | 解决 |
|------|------|------|
| `NameNotDefined` | 变量名拼错 | 变量名 = factor_id 或行情字段 |
| `FunctionNotDefined` | 用了白名单外函数 | 只用 `clip/abs/min/max/sum/round/...` |
| 属性访问报错 | simpleeval 默认禁 `.` | 用 `dict["key"]` 而非 `dict.key` |

### 12.5 Windows 相关

| 问题 | 原因 | 解决 |
|------|------|------|
| `ModuleNotFoundError: tqcenter` | tqcenter 未装 | `pip install tqcenter` |
| `tq.initialize()` 失败 | 终端未启动 | 启动通达信终端并登录 |
| 路径反斜杠 | 单 `\` 转义 | YAML 用 `/` 或 `\\` |

---

## 附录：扩展工作流速查

```
需求来了
│
├─ 改阈值？ → 改 strategies/*.yaml → 热加载 → 验证（第三章）
│
├─ 加策略？
│   ├─ 因子够？ → 复制 _template.yaml → 编辑 → 热加载 → 验证（第四章）
│   └─ 因子不够？ → 加因子（第五章）→ 加策略（第四章）
│
├─ 加因子？ → engine/factors/ 加 .py → 重启 → 策略引用 → 验证（第五章）
│           └─ 公式依据？ → 查 STRATEGY_LOGIC.md（第九章）
│
├─ 加通道？ → engine/channels/ 加 .py → 配 channels.yaml → 重启 → 测试（第六章）
│
└─ 加导出？ → engine/exporters/ 加 .py → 重启 → 策略引用（第七章）

每步都要：
  1. QA（curl + 前端验证）
  2. worklog append（--- + Task ID + Stage Summary）
```

---

**文档结束** · 实现因子公式时**必须**对照 `docs/maintenance/STRATEGY_LOGIC.md`，不要自己编公式。有疑问先查 `worklog.md` + `ARCHITECTURE.md`。
