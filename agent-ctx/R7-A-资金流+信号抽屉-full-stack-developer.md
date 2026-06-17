# R7-A-资金流+信号抽屉 工作记录

**Task ID**: R7-A-资金流+信号抽屉
**Agent**: full-stack-developer (subagent)
**Task**: Dashboard 实时资金流向卡片 + 信号中心信号详情抽屉

## 上下文回顾

- 项目状态: P1+++ 稳定, R6 已完成胜率排行+全局搜索+板块导出+信号筛选+对比导出
- 项目栈: Next.js 16 + TypeScript + Tailwind + shadcn/ui + FastAPI Python + DuckDB
- 关键资源: V8 L2 快照 CSV 含 `Zjl`/`TotalBVol`/`TotalSVol`/`fHSL` 资金流字段
- 现有 Sheet/UI 组件齐全, 直接复用

## Work Log

### 1. 后端 - 增强 QuoteSnapshot + 新增 FlowRankingItem schema

**文件**: `engine/api/schemas.py`

- `QuoteSnapshot` 新增 3 个可选字段 (默认 0.0, 兼容旧调用方):
  - `main_inflow: float = 0.0` - 主力净流入 (万元, 来自 Zjl)
  - `big_buy_ratio: float = 0.0` - 大买占比 (0~1, TotalBVol/(TotalBVol+TotalSVol))
  - `turnover_rate: float = 0.0` - 换手率% (来自 fHSL)
- 新增 `FlowRankingItem` schema: code/name/last/pct/main_inflow/big_buy_ratio/turnover_rate/amount

### 2. 后端 - 增强 get_quotes + 新增 get_flow_ranking 端点

**文件**: `engine/api/routes/monitor.py`

- `get_quotes`: 在返回 QuoteSnapshot 时填充新字段
  - 预取 `adapter.get_more_info(code)` 批量缓存 (新增 `_batch_more_info` 函数)
  - 新增 `_extract_flow_fields(code, info)` 从 dict 提取 3 个字段
    - Zjl → main_inflow (万元)
    - TotalBVol/(TotalBVol+TotalSVol) → big_buy_ratio (0~1, clamp)
    - fHSL → turnover_rate (%)
  - 字段缺失时用确定性 mock (基于 code MD5 hash, 同一 code 永远同一值), 新增 `_deterministic_hash_float` 函数
  - 失败兜底: 单只 get_market_snapshot 路径也填充新字段
- 新增 `GET /api/monitor/flow-ranking`:
  - Query: `count` (1~200, 默认 50), `metric` (main_inflow|big_buy_ratio|turnover_rate, 默认 main_inflow)
  - 实现: 复用 get_quotes 取 count 只快照, 按 metric 降序排序, 返回 Top 5
  - 用 `pattern=` (Pydantic v2) 替代旧的 `regex=` 参数, 避免弃用警告

### 3. 后端 - 增强 SignalEventResponse + 新增信号详情端点

**文件**: `engine/api/routes/signals.py`, `engine/api/schemas.py`

- `SignalEventResponse` 新增 2 个字段:
  - `snapshot: dict | None = None` - 触发时行情快照 JSON
  - `severity: str = "info"` - 信号严重度 (info/warn/error)
- `list_signals` SQL 加 `snapshot` 列
- `_row_to_signal` 新增 snapshot JSON 解析 (失败返回 None, list 类型包装为 `{"_list": [...]}`)
- 新增 `GET /api/signals/{signal_id}` 端点:
  - 单条信号完整详情查询
  - 404 当信号不存在, 500 当 DuckDB 查询失败
  - 路由声明顺序: `/stats` → `/{signal_id}` → `""` (根 list), 不冲突
- 注: import 增加 `HTTPException` 用于错误响应

### 4. 前端 - API 客户端扩展

**文件**: `src/lib/api.ts`

- `QuoteDTO` 新增 3 个可选字段 (main_inflow/big_buy_ratio/turnover_rate)
- 新增 `FlowRankingItemDTO` 接口
- `SignalDTO` 新增 2 个可选字段 (snapshot/severity)
- `monitorAPI.getFlowRanking(count?, metric?)` 方法
- `signalAPI.getDetail(id)` 方法

### 5. 前端 - API 代理路由

**新文件**:
- `src/app/api/monitor/flow-ranking/route.ts` (GET 代理, 降级返回 [])
- `src/app/api/signals/[signalId]/route.ts` (GET 代理, 失败返回 503)

### 6. 前端 - useRealtime Hook 增强

**文件**: `src/lib/useRealtime.ts`

- 状态新增 `lastUpdated: number | null` (最近一次成功 fetch 时间戳)
- 状态新增 `refreshing: boolean` (fetch 进行中标记)
- 暴露 `refresh()` 方法 (供 Dashboard 刷新按钮触发)
- 不破坏既有调用方 (Dashboard 等不需要改也照常工作)

### 7. 前端 - FlowRanking 组件 (新文件)

**文件**: `src/components/quant/FlowRanking.tsx`

- 数据源: 直接复用 `useRealtimeQuotes` 的 quotes (含新字段), 减少 1 次 API 请求
- 3 列 Top5 卡片:
  - 主力净流入 (红色调): 数值带 +/- 符号, 正数 var(--quant-up) 红, 负数 var(--quant-down) 绿
  - 大买占比 (琥珀色调): 进度条 0~max
  - 换手率 (青色调 #06b6d4): 进度条 0~max
- 排名徽章: 前 3 名 🥇🥈🥉 金/银/铜色, 4-5 灰色
- 行 hover: 左侧 2px 主色边框 + 背景变浅
- 列头: icon + label + "Top5" Badge
- 顶部: Activity 图标 + 标题 + 副标题 + 时间戳 + 刷新按钮
- 响应式: grid-cols-1 / sm:grid-cols-2 / lg:grid-cols-3
- 数值格式化:
  - main_inflow: ±万 / ±亿 (abs>=10000 时换亿)
  - big_buy_ratio: 百分比 (1 位小数)
  - turnover_rate: 百分比 (2 位小数)
- 空态: "暂无数据"
- 加载态: 刷新按钮 spinner

### 8. 前端 - Dashboard 集成

**文件**: `src/components/quant/Dashboard.tsx`

- import FlowRanking 组件
- 在中部 (行情+信号流 grid) 与底部 (5 策略板块概览) 之间插入 `<FlowRanking>`
- 传入 `rt.quotes` / `rt.lastUpdated` / `rt.refreshing` / `rt.refresh`

### 9. 前端 - SignalCenter 信号详情抽屉

**文件**: `src/components/quant/SignalCenter.tsx`

- 新增 state: `detailOpen` / `detailSignal` / `detailLoading` / `detailError`
- `handleOpenDetail(signal)`: 立即显示行内已有信息 + 异步拉取完整详情 (含 snapshot)
- `handleCopyJson()`: `navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))` + toast 反馈
- StockTable 新增 `onRowClick={handleOpenDetail}` (既有"重推"按钮已 `e.stopPropagation()`)
- 新增 `SignalDetailSheet` 组件 (~270 行):
  - Sheet from right, `sm:max-w-lg`, mobile 全屏
  - 顶部: 类型 Badge + 时间 + 策略 emoji+name (SheetHeader + SheetTitle + SheetDescription)
  - 加载态: Loader2 spinner
  - 错误态: 红色提示条 (不阻断, 仍显示行内已有信息)
  - 基本信息 section: 6 个 InfoCell (信号 ID / 股票代码 / 股票名称 / 策略 ID / 推送状态 / 严重度)
  - 推送通道 section: 通道徽章列表 (复用 CHANNEL_BADGE_META 颜色)
  - 信号内容 section: whitespace-pre-wrap 完整文本
  - **Snapshot JSON 树形展示**:
    - `<pre>` + `<JsonNode>` 递归组件
    - key 琥珀色 `var(--quant-primary)`
    - string 绿色 `var(--quant-down)`
    - number 蓝色 `#38bdf8`
    - boolean 紫色 `#c084fc`
    - null 灰色 `var(--quant-flat)`
    - object/array 递归, 1rem padding-left 缩进
    - 长 string (>200 字符) 截断 + `…`
    - 空 object/array 单行 `{}`
    - max-h-80 + overflow-y-auto + quant-scroll
  - 底部操作栏 (sticky bottom-0):
    - "重新推送"按钮 (复用 handleRepush, repushing 状态显示 spinner)
    - "复制 JSON"按钮 (调 handleCopyJson)
    - "关闭"按钮 (ml-auto, 调 onOpenChange(false))

## QA 验证

### curl 测试 (FastAPI 直连 8000 端口)

| 测试项 | 结果 |
|--------|------|
| `bun run lint` | ✓ EXIT=0 (0 错误 0 警告) |
| FastAPI 重启 | ✓ spawned pid 20774, uptime 4s |
| `GET /api/monitor/quotes?count=3` | ✓ 200, 3 条返回新字段 main_inflow=19835.9/big_buy_ratio=0.4586/turnover_rate=7.3 (真实 Zjl/fHSL 数据) |
| `GET /api/monitor/flow-ranking?count=50&metric=main_inflow` | ✓ 200, Top5 按 main_inflow 降序 (隆扬电子 19835.9 万居首) |
| `GET /api/monitor/flow-ranking?count=50&metric=big_buy_ratio` | ✓ 200, Top5 按 big_buy_ratio 降序 (返利科技 1.0 居首) |
| `GET /api/monitor/flow-ranking?count=50&metric=turnover_rate` | ✓ 200, Top5 按 turnover_rate 降序 (返利科技 12.95% 居首) |
| `GET /api/monitor/flow-ranking?metric=invalid` | ✓ 422 string_pattern_mismatch (Pydantic v2 pattern 校验生效) |
| `GET /api/signals?limit=1` (回归) | ✓ 200, 返回新字段 snapshot + severity (snapshot 含 run_id/strategy_id/result_count/duration_sec/top_picks 数组) |
| `GET /api/signals/{id}` 详情 | ✓ 200, 完整返回含 snapshot JSON 树形结构 |
| `GET /api/signals/nonexistent-id` | ✓ 404 "信号 nonexistent-id 不存在" |
| `GET /api/signals/stats` (回归) | ✓ 200 total=11 by_type 1 项 (无回归) |

### Next.js 代理测试 (3000 端口)

| 测试项 | 结果 |
|--------|------|
| `GET /api/monitor/flow-ranking?count=50&metric=main_inflow` | ✓ 200, 数据透传正确 |
| `GET /api/signals/{id}` | ✓ 200, snapshot JSON 完整透传 |

### dev.log 监控

- `GET /api/monitor/flow-ranking?count=50&metric=main_inflow` → 200 in 117ms (首次 compile 104ms)
- `GET /api/signals/ba1869c0-79d0-4589-bc2a-1ee19b1688c8` → 200 in 551ms (首次 compile 538ms)
- 后续轮询: status/quotes/signals 全部 200, 无错误

### 资金流数据真实性验证

`/api/monitor/quotes?count=3` 返回的 3 只股票资金流数据来自 V8 L2 快照 CSV 真实字段:
- 301389.SZ 隆扬电子: main_inflow=19835.9 万 (Zjl 字段), big_buy_ratio=0.4586 (TotalBVol/(TotalBVol+TotalSVol)), turnover_rate=7.3% (fHSL 字段)
- 600228.SH 返利科技: main_inflow=2284.96 万, big_buy_ratio=1.0 (TotalSVol=0 时全部为买盘), turnover_rate=12.95%
- 600301.SH 华锡有色: main_inflow=12039.0 万, big_buy_ratio=0.4181, turnover_rate=9.27%

非 mock 数据 - 完全来自 V8 CSV 真实字段。

## Stage Summary

### 已完成

1. 后端 `QuoteSnapshot` schema 新增 3 个资金流字段 (main_inflow/big_buy_ratio/turnover_rate, 默认 0.0 兼容旧调用)
2. 后端 `FlowRankingItem` schema 新增
3. 后端 `get_quotes` 增强: 调 `adapter.get_more_info` 取真实 Zjl/TotalBVol/TotalSVol/fHSL, 字段缺失时用 MD5 hash 确定性 mock
4. 后端 `GET /api/monitor/flow-ranking` 端点: 按 3 种 metric 排序返回 Top 5
5. 后端 `SignalEventResponse` schema 新增 snapshot + severity 字段
6. 后端 `list_signals` SQL 加 snapshot 列, `_row_to_signal` 解析 JSON
7. 后端 `GET /api/signals/{signal_id}` 端点: 单条详情查询, 404/500 错误处理
8. 前端 `QuoteDTO` + `SignalDTO` + `FlowRankingItemDTO` 类型扩展
9. 前端 `monitorAPI.getFlowRanking` + `signalAPI.getDetail` 方法
10. 前端 API 代理 `flow-ranking/route.ts` + `signals/[signalId]/route.ts`
11. 前端 `useRealtime` Hook 暴露 `refresh()` + `lastUpdated` + `refreshing`
12. 前端 `FlowRanking.tsx` 组件 (~260 行): 3 列 Top5 + 排名徽章 + 进度条 + 响应式
13. 前端 Dashboard 集成 FlowRanking (在 Top3 涨跌榜与策略胜率排行之间)
14. 前端 `SignalCenter` 信号详情抽屉 (~270 行 SignalDetailSheet + ~130 行 JsonNode 递归):
    - Sheet 从右侧滑出, sm:max-w-lg
    - 类型/时间/策略/基本信息/推送通道/信号内容/Snapshot JSON 树
    - JSON 树形展示: key 琥珀/string 绿/number 蓝/boolean 紫/null 灰
    - 底部 sticky 操作栏: 重新推送 + 复制 JSON + 关闭

### 文件变更

```
后端 (Python) - 3 个文件:
  engine/api/schemas.py              # 修改: QuoteSnapshot +3 字段, SignalEventResponse +2 字段, 新增 FlowRankingItem
  engine/api/routes/monitor.py       # 修改: get_quotes 增强 + 新增 get_flow_ranking + 3 个工具函数
  engine/api/routes/signals.py       # 修改: list_signals SQL +snapshot, _row_to_signal 解析, 新增 get_signal_detail 端点

前端 (TypeScript) - 8 个文件:
  src/lib/api.ts                                # 修改: QuoteDTO +3, SignalDTO +2, 新增 FlowRankingItemDTO, monitorAPI.getFlowRanking, signalAPI.getDetail
  src/lib/useRealtime.ts                        # 修改: 暴露 refresh + lastUpdated + refreshing
  src/app/api/monitor/flow-ranking/route.ts     # 新增: GET 代理 (降级返回 [])
  src/app/api/signals/[signalId]/route.ts       # 新增: GET 代理 (失败 503)
  src/components/quant/FlowRanking.tsx          # 新增: 实时资金流向 3 列 Top5 卡片 (~260 行)
  src/components/quant/Dashboard.tsx            # 修改: import + 渲染 FlowRanking
  src/components/quant/SignalCenter.tsx         # 修改: 行点击抽屉 + SignalDetailSheet + JsonNode 组件 (+~400 行)

工作记录:
  /agent-ctx/R7-A-资金流+信号抽屉-full-stack-developer.md  # 本文件
  worklog.md                                                 # 追加 R7-A 章节
```

### 未解决问题

1. V8 快照 CSV `Zjl` 字段单位假设为"万元"输出 (与通达信文档一致), 真实 RealAdapter 模式下若 `tq.get_more_info` 返回的 Zjl 单位是"元", main_inflow 会偏大 10000 倍; 当前未做单位换算 (Mock 模式下数据正确)
2. `big_buy_ratio` 当 TotalSVol=0 时返回 1.0 (全买盘), 不做特殊处理
3. 信号详情抽屉的"重新推送"按钮复用 handleRepush, 与表格内"重推"按钮共用 repushing 状态; 若两处同时操作同一信号, 状态会同步 (目前无冲突)
4. JsonNode 递归渲染未做 key 唯一性校验 (DuckDB snapshot JSON 中 key 重复概率低), 若有重复 key 会 React warning (不影响功能)
5. Snapshot JSON 树当前不支持折叠展开 (始终全展开), 大 snapshot 会比较长; 后续可加 `<details>` 折叠
6. `/api/monitor/flow-ranking` 默认 count=50 (取样股票数), 若订阅股票数 < 50, Top5 可能少于 5 条
