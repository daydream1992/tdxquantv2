# TdxQuant 接口能力地图

> 本文档基于代码扫描实际产出，目的是让后续开发者**拿来就能查**——
> 加新策略 / 新预警 / 新因子 / 新通道时，可以快速定位"该调哪个接口"。
>
> - 生成日期：2026-06-17
> - 扫描范围：`engine/api/routes/*.py`、`src/app/api/**/route.ts`、`engine/` 各模块公开方法、`docs/tdx-quant/通达信量化平台说明书/`
> - 类型：只读研究产物，不含代码变更

---

## 一、总览（一页纸看全）

| 维度 | 数量 | 说明 |
|---|---|---|
| 后端 FastAPI 路由 | **40 个** | `engine/api/routes/*.py` 9 个路由文件 + `main.py` 的 `/` 与 `/health` |
| 前端 Next.js 代理路由 | **27 个文件 / ~40 个方法** | `src/app/api/**/route.ts`，全部走 `tryFastAPI()` 透传，失败降级 mock |
| Python 内部接口模块 | **10 个域** | 表达式 / 因子 / Pipeline / 通道 / 存储 / 数据适配器 / 板块 / 引擎状态 / 配置加载 / 监控引擎 |
| 通达信 tqcenter API | **6 类 ~52 个** | 行情 9 + 财务 9 + 板块 3 + 客户端 6 + 通用 13 + 公式 11 + ETF/可转债 2 |
| 已封装到 `data_adapter` | **31 个** | `RealAdapter` 实现了 `BaseDataAdapter` 全部 31 个抽象方法 |
| 未封装（后续可挖） | **~21 个** | 主要是公式类全部 11 个、市场/板块交易数据 5 个、客户端通用 5 个 |
| 因子插件 | **26 个** | 8 类（动量/趋势/涨停/突破/反转/换手/估值/量价），自动扫描注册 |
| 内置推送通道 | **4 个** | `csv_log`（强制开）/ `websocket` / `tdx_warn` / `feishu` |
| DuckDB 核心表 | **8 张** | `strategies` / `selection_results` / `signal_events` / `sector_snapshots` / `strategy_runs` / `monitor_subscriptions` / `config_changes` / `kline_cache` |

---

## 二、后端 API 路由表（按能力域分组）

### 2.1 策略管理域（`/api/strategies`，10 路由）

| # | 方法 | 路径 | 功能 | 请求参数 | 响应结构 | 依赖（Depends） | 被谁调（前端） | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/strategies` | 列出所有策略（含 last_run 信息） | — | `list[StrategyResponse]` | `get_config`, `get_storage` | `StrategyManager.tsx`、`SelectionResults.tsx`、`SignalCenter.tsx`、`page.tsx` | 未启用排后 |
| 2 | POST | `/api/strategies` | 批量操作 enable_all/disable_all/run_all | body: `{action: "enable_all"\|"disable_all"\|"run_all"}` | `OkResponse \| StrategyBatchRunResponse` | `get_config`, `get_runner` | `StrategyManager.tsx`（全部启用/禁用/运行） | run_all 自动订阅 Top 20 |
| 3 | GET | `/api/strategies/{strategy_id}` | 单策略详情（含 YAML 原文） | path: `strategy_id` | `StrategyResponse` | `get_config`, `get_storage` | `StrategyManager.tsx`（编辑回填） | 返回 `yaml_content` |
| 4 | POST | `/api/strategies/{strategy_id}` | 启用/禁用（前端兼容入参） | body: `{enabled: bool}` | `OkResponse` | `get_config` | `StrategyManager.tsx`（Switch 切换） | 修改 YAML + reload |
| 5 | POST | `/api/strategies/{strategy_id}/enable` | 启用策略 | path | `OkResponse` | `get_config` | （兼容预留） | 与 #4 等价 |
| 6 | POST | `/api/strategies/{strategy_id}/disable` | 禁用策略 | path | `OkResponse` | `get_config` | （兼容预留） | 与 #4 等价 |
| 7 | POST | `/api/strategies/{strategy_id}/run` | 执行选股 | path | `StrategyRunResponse{ok, run_id, count, duration_sec, error}` | `get_config`, `get_runner` | `StrategyManager.tsx`（单策略运行按钮） | 副作用：写 selection 信号 + 自动订阅 Top 20 |
| 8 | GET | `/api/strategies/{strategy_id}/runs` | 历史执行记录 | query: `limit=50` | `list[StrategyRunRecord]` | `get_storage` | `StrategyManager.tsx`（历史抽屉） | 从 `strategy_runs` 表 |

### 2.2 选股域（`/api/selections`，3 路由）

| # | 方法 | 路径 | 功能 | 请求参数 | 响应结构 | 依赖 | 被谁调 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 9 | GET | `/api/selections` | 列出选股结果 | query: `strategy_id, run_id, start_date, end_date, min_score(0-100), limit(1-2000, 默认 200)` | `list[SelectionRowResponse]` | `get_storage`, `get_config` | `SelectionResults.tsx` | 反查 strategy_name + factor weight |
| 10 | GET | `/api/selections/{run_id}` | 单次选股详情 | path: `run_id` | `SelectionDetailResponse{run_id, strategy_id, started_at, finished_at, duration_sec, n_stocks, status, rows[]}` | `get_storage`, `get_config` | （前端尚未直接调，预留） | 联表 `strategy_runs` |
| 11 | GET | `/api/selections/{run_id}/export` | 导出 CSV/Excel | query: `format=csv\|excel` | 二进制流（`text/csv` 或 `.xlsx`） | `get_storage` | `SelectionResults.tsx`（导出按钮） | Excel 走 `openpyxl` |

### 2.3 监控域（`/api/monitor`，4 路由）

| # | 方法 | 路径 | 功能 | 请求参数 | 响应结构 | 依赖 | 被谁调 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 12 | GET | `/api/monitor/status` | 监控状态（订阅数/今日信号/心跳） | — | `MonitorStatusResponse{engine_status, adapter_mode, monitored_count, today_signals, today_limit_up, today_alerts, uptime_seconds, last_hb}` | `get_config`, `get_state`, `get_storage` | `page.tsx`、`useRealtime.ts` | 内存计数为 0 时从 DuckDB 兜底 |
| 13 | GET | `/api/monitor/quotes` | 实时行情快照（前 N 只订阅） | query: `count=12(1-200)` | `list[QuoteSnapshot]{code, name, last, pct, change, volume, amount, ts, main_inflow, big_buy_ratio, turnover_rate}` | `get_adapter`, `get_state`, `get_storage` | `useRealtime.ts`、`SectorManager.tsx` | 优先 `get_pricevol`，回退 `get_market_snapshot`；订阅空时 fallback_top_picks |
| 14 | GET | `/api/monitor/flow-ranking` | 资金流向排行 Top 5 | query: `count=50(1-200), metric=main_inflow\|big_buy_ratio\|turnover_rate` | `list[FlowRankingItem]` | `get_adapter`, `get_state`, `get_storage` | `FlowRanking.tsx`（由 Dashboard 注入 quotes，本路由作为备用） | 复用 `get_quotes` 后排序 |
| 15 | GET | `/api/monitor/subscriptions` | 当前订阅列表 | — | `list[MonitorSubscriptionItem]` | `get_state` | （前端尚未直接调，预留） | EngineState 内存订阅 |

### 2.4 通道域（`/api/channels`，4 路由）

| # | 方法 | 路径 | 功能 | 请求参数 | 响应结构 | 依赖 | 被谁调 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 16 | GET | `/api/channels` | 通道列表与状态 | — | `ChannelListResponse{channels[], config_path}` | `get_registry()` | `ChannelSettingsDialog.tsx`、`page.tsx` | 含 enabled/config/errors |
| 17 | PUT | `/api/channels` | 批量更新通道配置（持久化到 `config/channels.yaml`） | body: `{channels: {name: {enabled, ...}}}` | `ChannelUpdateResponse{ok, errors, channels[]}` | `get_registry()` | `ChannelSettingsDialog.tsx`（保存） | 自动热重载 |
| 18 | POST | `/api/channels/{name}/test` | 发送测试消息 | path: `name(csv_log\|websocket\|tdx_warn\|feishu)` | `ChannelTestResponse{ok, message, channel}` | `get_registry()` | `ChannelSettingsDialog.tsx`（测试按钮） | 不受 enabled 限制 |
| 19 | POST | `/api/channels/signals/{signal_id}/repush` | 重新推送历史信号 | path: `signal_id` | `SignalRepushResponse{ok, signal_id, fired[], results[]}` | `get_storage`, `get_config` | `SignalCenter.tsx`（行末重推） | 从 `signal_events` 读再 dispatch |

### 2.5 板块域（`/api/sectors`，5 路由）

| # | 方法 | 路径 | 功能 | 请求参数 | 响应结构 | 依赖 | 被谁调 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 20 | GET | `/api/sectors` | 列出所有板块（YAML + DuckDB 快照合并） | — | `list[SectorInfoResponse]` | `get_config`, `get_storage` | `SectorManager.tsx` | 含 stock_count + last_update |
| 21 | POST | `/api/sectors` | 占位（创建/更新板块） | — | `OkResponse` | `get_sector_manager` | （前端预留） | 提示走 `/refresh` |
| 22 | GET | `/api/sectors/export-all` | 导出全部板块成份股 | query: `format=csv\|excel` | 二进制流（CSV 多段 / Excel 多 Sheet） | `get_config`, `get_storage` | `SectorManager.tsx`（导出全部） | Excel 每 Sheet 一板块 |
| 23 | GET | `/api/sectors/{code}/stocks` | 板块成份股 | path: `code` | `list[SectorStockResponse]` | `get_sector_manager`, `get_storage` | `SectorManager.tsx`（展开） | 优先 DuckDB 快照，回退 `sector_manager.get_stocks` |
| 24 | POST | `/api/sectors/{code}/refresh` | 刷新板块（重跑策略 + 原子回写） | path: `code` | `SectorRefreshResponse{ok, code, count, message}` | `get_config`, `get_runner`, `get_sector_manager`, `get_storage` | `SectorManager.tsx`（刷新按钮） | 先 `run_strategy` 再 `update_stocks` |

### 2.6 信号域（`/api/signals`，3 路由）

| # | 方法 | 路径 | 功能 | 请求参数 | 响应结构 | 依赖 | 被谁调 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 25 | GET | `/api/signals` | 信号列表 | query: `type(limit_up\|drop_alert\|breakout\|selection\|system), strategy_id, start_date, end_date, limit(1-500, 默认 50)` | `list[SignalEventResponse]` | `get_storage`, `get_state`, `get_config` | `useRealtime.ts`、`SignalCenter.tsx` | 反查 strategy_name/emoji |
| 26 | GET | `/api/signals/stats` | 信号统计（按 alert_type 分组） | — | `SignalStatsResponse{total, by_type[]}` | `get_storage` | （前端尚未直接调，预留） | — |
| 27 | GET | `/api/signals/{signal_id}` | 信号详情（含 snapshot JSON） | path: `signal_id` | `SignalEventResponse` | `get_storage`, `get_config` | `SignalCenter.tsx`（抽屉详情） | R7-A 新增 |

### 2.7 回测域（`/api/backtest`，4 路由）

| # | 方法 | 路径 | 功能 | 请求参数 | 响应结构 | 依赖 | 被谁调 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 28 | POST | `/api/backtest/run` | 启动一次回测 | body: `BacktestRunRequest{strategy_id, start_date, end_date, initial_capital(默认 10w), top_n(1-30, 默认 5), hold_days(1-60, 默认 5)}` | `BacktestResultResponse{run_id, strategy_id, total_return, annual_return, max_drawdown, sharpe_ratio, win_rate, total_trades, daily_equity[], trades[], benchmark_return, alpha, beta, ...}` | `get_config`, `get_storage` | `BacktestView.tsx`（运行回测） | 简化版：mock 涨跌幅，基于 stock_code hash 确定性 |
| 29 | GET | `/api/backtest/history` | 历史回测列表 | query: `limit=50` | `list[BacktestHistoryItem]` | `get_storage` | `BacktestView.tsx`（侧边列表） | — |
| 30 | GET | `/api/backtest/leaderboard` | 策略胜率排行（按 sharpe 降序） | — | `BacktestLeaderboardResponse{items[], total}` | `get_storage` | `StrategyLeaderboard.tsx` | 每个 strategy_id 取最新一次 |
| 31 | GET | `/api/backtest/{run_id}` | 单次回测详情 | path: `run_id` | `BacktestResultResponse` | `get_storage` | `BacktestView.tsx`（点击历史） | 从 `backtest_results.result_json` 解析 |

### 2.8 配置域（`/api/config` + `/api/theme`，6 路由）

| # | 方法 | 路径 | 功能 | 请求参数 | 响应结构 | 依赖 | 被谁调 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 32 | POST | `/api/config/reload` | 热加载全部 YAML | — | `ConfigReloadResponse{ok, reloaded[], strategies_count, message}` | `get_config` | `StrategyManager.tsx`、`page.tsx`（顶栏刷新按钮） | 重扫 `config/*.yaml` + `strategies/*.yaml` |
| 33 | GET | `/api/config/strategies` | 列出策略配置文件（含原文） | — | `list[StrategyConfigFileItem]` | `get_config` | `StrategyManager.tsx`（编辑模式打开时） | 跳过 `_template.yaml` |
| 34 | POST | `/api/config/strategies` | 创建/复制策略 YAML | body: `StrategyCreateRequest{strategy_id(2-30 字母数字下划线), yaml_content, overwrite=false}` | `StrategyConfigFileItem` | `get_config` | `StrategyManager.tsx`（复制策略） | 409 文件已存在 |
| 35 | PUT | `/api/config/strategies/{strategy_id}` | 在线更新策略 YAML | body: `StrategyConfigUpdateRequest{yaml_content, enabled?}` | `StrategyConfigFileItem` | `get_config` | `StrategyManager.tsx`（编辑保存） | 422 YAML 解析失败 / strategy_id 不一致 |
| 36 | DELETE | `/api/config/strategies/{strategy_id}` | 删除策略 YAML | path | `{ok, strategy_id, deleted, message}` | `get_config` | `StrategyManager.tsx`（删除按钮） | 409 启用中不可删 |
| 37 | GET | `/api/theme` | 主题配置 | — | `ThemeResponse{mode, primary_color, up_color, down_color, flat_color, background, card_background, border_color, font_family}` | `get_config` | `src/lib/theme.ts`（初始化时拉取） | 对应 `config/theme.yaml` |

### 2.9 搜索与系统域（3 路由）

| # | 方法 | 路径 | 功能 | 请求参数 | 响应结构 | 依赖 | 被谁调 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 38 | GET | `/api/search` | 全局搜索（跨策略/股票/信号） | query: `q(必填), limit(1-100, 默认 20)` | `SearchResponse{q, strategies[], stocks[], signals[], total}` | `get_storage`, `get_config` | `GlobalSearch.tsx`（顶部搜索框） | DuckDB ILIKE 模糊匹配 |
| 39 | GET | `/health` | 健康检查 | — | `{status, uptime_seconds, last_hb}` | `engine_state_mod` | （运维/监控） | — |
| 40 | GET | `/` | 根路径 | — | `{name, version, docs, openapi, health}` | — | （运维） | — |

---

## 三、前端 API 代理路由表

> 设计要点：所有调用走 Next.js 同源 API（`/api/...`），由 route.ts 透传到 Python FastAPI（端口 8000）；FastAPI 不可达时降级到 `src/lib/mock-data.ts` 静态数据。透传工具在 `src/lib/api-proxy.ts` 的 `tryFastAPI()`，3 秒超时。

| 前端路由文件 | 方法 | 透传目标（FastAPI） | 降级行为 | 被谁调（前端组件） |
|---|---|---|---|---|
| `src/app/api/route.ts` | GET | — | 返回 `{message: "Hello, world!"}` | （根测试） |
| `src/app/api/strategies/route.ts` | GET | `GET /api/strategies` | `STRATEGIES` mock | `strategyAPI.list()` |
| 同上 | POST | `POST /api/strategies` | enable_all/disable_all/run_all 各自 mock | `strategyAPI.enableAll/disableAll/runAll()` |
| `src/app/api/strategies/[id]/route.ts` | GET | `GET /api/strategies/{id}` | `STRATEGIES.find()` mock | `strategyAPI.get()` |
| 同上 | POST | `POST /api/strategies/{id}` | mock 修改本地 enabled | `strategyAPI.enable/disable()` |
| `src/app/api/strategies/[id]/run/route.ts` | POST | `POST /api/strategies/{id}/run` | mock genSelections + 返回 run_id | `strategyAPI.run()` |
| `src/app/api/strategies/[id]/runs/route.ts` | GET | `GET /api/strategies/{id}/runs` | 空数组 `[]` | `strategyAPI.runs()` |
| `src/app/api/selections/route.ts` | GET | `GET /api/selections?{query}` | `genSelections()` + 内存筛选 | `selectionAPI.list()` |
| `src/app/api/selections/[runId]/export/route.ts` | GET | `GET /api/selections/{runId}/export?format=` | mock CSV（无 Excel） | `selectionAPI.export()` |
| `src/app/api/monitor/route.ts` | GET | `?action=status` → `GET /api/monitor/status`；`?action=quotes&count=N` → `GET /api/monitor/quotes?count=N` | `genMonitorStatus()` / `genQuotes()` | `monitorAPI.getStatus/getQuotes()` |
| `src/app/api/monitor/flow-ranking/route.ts` | GET | `GET /api/monitor/flow-ranking?count=&metric=` | 空数组 `[]` | `monitorAPI.getFlowRanking()` |
| `src/app/api/sectors/route.ts` | GET / POST | `GET/POST /api/sectors` | `genSectors()` mock | `sectorAPI.list()` |
| `src/app/api/sectors/[code]/stocks/route.ts` | GET | `GET /api/sectors/{code}/stocks` | `genSectorStocks()` mock | `sectorAPI.getStocks()` |
| `src/app/api/sectors/[code]/refresh/route.ts` | POST | `POST /api/sectors/{code}/refresh` | mock 返回 `{ok, count}` | `sectorAPI.refresh()` |
| `src/app/api/sectors/export-all/route.ts` | GET | `GET /api/sectors/export-all?format=` | 502 错误（无降级） | `sectorAPI.exportAll()` |
| `src/app/api/signals/route.ts` | GET | `GET /api/signals?{query}` | `genSignals()` mock + 内存筛选 | `signalAPI.list()` |
| `src/app/api/signals/[signalId]/route.ts` | GET | `GET /api/signals/{signalId}` | 503 错误（无降级） | `signalAPI.getDetail()` |
| `src/app/api/channels/route.ts` | GET | `GET /api/channels` | `{channels:[], config_path, fallback:true}` | `channelAPI.list()` |
| 同上 | PUT | `PUT /api/channels` | 503 错误 | `channelAPI.update()` |
| `src/app/api/channels/signals/[signalId]/repush/route.ts` | POST | `POST /api/channels/signals/{signalId}/repush` | 503 错误 | `channelAPI.repush()` |
| `src/app/api/config/route.ts` | POST | `POST /api/config/reload` | mock reloaded 文件列表 | `configAPI.reload()` |
| `src/app/api/config/strategies/route.ts` | GET | `GET /api/config/strategies` | 空数组 `[]` | `configAPI.listStrategyConfigs()` |
| 同上 | POST | `POST /api/config/strategies` | 直连 FastAPI（透传 4xx） | `configAPI.createStrategy()` |
| `src/app/api/config/strategies/[id]/route.ts` | PUT | `PUT /api/config/strategies/{id}` | 直连 FastAPI（透传 4xx） | `configAPI.updateStrategyConfig()` |
| 同上 | DELETE | `DELETE /api/config/strategies/{id}` | 直连 FastAPI（透传 4xx） | `configAPI.deleteStrategy()` |
| `src/app/api/theme/route.ts` | GET | `GET /api/theme` | `MOCK_THEME` | `themeAPI.get()`（被 `src/lib/theme.ts` 调） |
| `src/app/api/backtest/run/route.ts` | POST | `POST /api/backtest/run` | 503 错误 | `backtestAPI.run()` |
| `src/app/api/backtest/history/route.ts` | GET | `GET /api/backtest/history` | 空数组 `[]` | `backtestAPI.history()` |
| `src/app/api/backtest/leaderboard/route.ts` | GET | `GET /api/backtest/leaderboard` | `{items:[], total:0}` | `backtestAPI.leaderboard()` |
| `src/app/api/backtest/[runId]/route.ts` | GET | `GET /api/backtest/{runId}` | 503 错误 | `backtestAPI.get()` |
| `src/app/api/search/route.ts` | GET | `GET /api/search?q=&limit=` | `{q, strategies:[], stocks:[], signals:[], total:0}` | `searchAPI.search()` |
| `src/app/api/docs/[filename]/route.ts` | GET | （不走 FastAPI，直接读 `docs/<filename>`） | 404 非白名单 | 浏览器下载链接 |

> ⚠️ **`docs/[filename]` 白名单**：仅 `MONITOR_ENGINE_PLAN.md` 与 `MONITOR_ENGINE_IMPLEMENTATION_PROMPT.md` 可下载。如需开放 `API_CAPABILITY_MAP.md` 下载，需把文件名加入 `ALLOWED` Set。

---

## 四、Python 内部接口（供策略扩展调用）

> 这些是 `engine/` 内部的公开类/函数，不通过 HTTP 暴露，供后续策略 / 因子 / 监控规则 / 通道扩展时直接 import 使用。

### 4.1 表达式求值（`engine/expression/evaluator.py`）

> 用于策略 YAML 的 `scoring.formula` 与 `alert_conditions[*].condition` 字段安全求值。**不使用 eval/exec**，基于 `simpleeval` AST 解析 + 白名单。

| 接口 | 签名 | 用途 |
|---|---|---|
| `ExpressionEvaluator()` | 类构造，可传 `extra_functions` / `extra_names` | 创建求值器实例 |
| `evaluator.evaluate(expr, variables)` | `(str, dict[str, Any]) -> Any` | 求值，失败抛 `ExpressionError` |
| `evaluator.register_function(name, func)` | `(str, Callable) -> None` | 注册业务函数到白名单 |
| `evaluator.register_name(name, value)` | `(str, Any) -> None` | 注册默认变量 |
| `evaluate(expr, variables)` | 模块级便捷函数，用全局单例 | 一次性求值 |
| **`evaluate_safe(expr, variables, default=None)`** | 模块级便捷函数 | **失败返回 default 不抛异常**（推荐监控规则用） |
| `evaluator`（全局单例） | `ExpressionEvaluator` 实例 | 业务模块直接 `from engine.expression.evaluator import evaluator` |

**默认白名单函数**：`abs / min / max / sum / len / round / int / float / str / bool / any / all / sorted / clip`（`clip` 是策略评分公式专用，支持 pandas Series / numpy ndarray）。

**支持语法**：算术（`+ - * / // % **`）、比较（`== != < > <= >=`）、逻辑（`and / or / not`）、字典 key 访问（`variables["x"]`）、列表索引、字面量（`[1,2,3]`、`{"a":1}`、`(1,2)`）。
**禁止**：函数调用（除非已注册）、`import`、属性访问（`.` 在 simpleeval 中需显式注册）。

### 4.2 因子注册（`engine/factors/registry.py` + `engine/factors/base.py`）

> 因子插件自动扫描注册。在 `engine/factors/` 加 `my_factor.py`，实现 `class MyFactor(Factor): factor_id = "my_factor"`，下次启动自动注册，**无需修改本文件**。

| 接口 | 签名 | 用途 |
|---|---|---|
| `FactorRegistry(package="engine.factors", auto_scan=True)` | 构造 | 启动时自动扫描 `engine/factors/*.py` 注册所有 `Factor` 子类 |
| `registry.scan()` | `() -> None` | 重新扫描（幂等，先清空再扫） |
| `registry.get_factor(factor_id)` | `(str) -> Factor` | 获取因子实例，未注册抛 `FactorNotFoundError` |
| `registry.has_factor(factor_id)` | `(str) -> bool` | 判断因子是否注册 |
| `registry.list_factors()` | `() -> list[str]` | 所有已注册 `factor_id` 列表（排序） |
| `registry.list_factors_by_category(category)` | `(str) -> list[str]` | 按分类过滤（momentum/breakout/valuation/volume/limit_up/trend/reversal/turnover） |
| `registry.get_factor_info(factor_id)` | `(str) -> dict` | 因子元信息（含 `required_fields`、`default_params`） |
| `registry.all_factors_info()` | `() -> list[dict]` | 所有因子元信息 |

**`Factor` 抽象基类**（`engine/factors/base.py`）子类需设置类属性：`factor_id` / `factor_name` / `factor_category` / `factor_description`，并实现 `calculate(df: DataFrame, params: dict) -> pd.Series`。可选覆盖 `get_required_fields()` / `get_default_params()`。

**已注册的 26 个因子**（来自 8 个文件）：

| 类别 | factor_id 列表 |
|---|---|
| volume_price (3) | `volume_ratio`、`volume_amount`、`price_volume_score` |
| reversal (4) | `panic_depth`、`panic_volume`、`support_strength`、`catalyst_score` |
| breakout (2) | `breakout_ma20`、`breakout_platform` |
| trend (4) | `ma_alignment`、`macd_direction`、`main_inflow`、`big_buy_ratio` |
| limit_up (5) | `seal_ratio`、`seal_amount`、`consecutive_limit`、`seal_strength`、`year_limit_days` |
| momentum (3) | `momentum_5d`、`momentum_10d`、`momentum_20d` |
| turnover (2) | `turnover_rate`、`turnover_momentum` |
| valuation (3) | `market_cap`、`pe_ttm`、`pb_ratio` |

### 4.3 选股 Pipeline（`engine/pipeline/runner.py` + `engine/pipeline/base.py`）

> 策略运行器：加载策略 YAML → 构建 Pipeline → 顺序执行 6 步 → 记录 `strategy_runs` 表。

| 接口 | 签名 | 用途 |
|---|---|---|
| `StrategyRunner(adapter, storage, strategies_dir="strategies", factor_registry=None)` | 构造 | 注入 adapter / storage |
| **`runner.run_strategy(strategy_id) -> PipelineContext`** | 主入口 | 加载 YAML → 构建 Pipeline → 执行 → 记录 `strategy_runs` → 返回上下文 |
| `runner.list_strategies() -> list[str]` | — | 列出 `strategies/` 目录下所有 strategy_id |
| `SelectionPipeline(strategy_config, steps, adapter, storage).run() -> PipelineContext` | 流水线执行器 | 顺序执行 steps，单步异常默认 fail-fast，`continue_on_error=True` 可吞 |
| `PipelineContext` | 数据类 | 步骤间共享数据：`data: dict[str, DataFrame]`、`factors: dict[str, Series]`、`scores: DataFrame`、`final: DataFrame`、`metadata` |
| `PipelineStep` | 抽象基类 | 子类需设 `step_id` / `step_name` 并实现 `execute(context) -> context` |

**6 个内置步骤**（`engine/pipeline/steps/`）：

| step_id | 文件 | 职责 |
|---|---|---|
| `load_data` | `load_data.py` | 从 adapter 拉 snapshot/kline/financial，写入 `context.data` |
| `clean_data` | `clean_data.py` | 按 `cleaning_rules.yaml` 过滤 ST/停牌/退市，合并为 `context.data["cleaned"]` |
| `calc_factors` | `calc_factors.py` | 调 `FactorRegistry.get_factor().calculate()` 计算各因子，写入 `context.factors` |
| `score` | `score.py` | 按 `scoring.formula` 求值（用 `ExpressionEvaluator`），写入 `context.scores` |
| `filter_sort` | `filter_sort.py` | 按 `output.min_score` / `output.top_n` 过滤排序，写入 `context.final` |
| `export` | `export.py` | 按 `config/export.yaml` 调用启用的导出器（CSV/Excel/DuckDB/Sector） |

**4 个导出器**（`engine/exporters/`）：`CsvExporter` / `ExcelExporter`（V8 兼容 8 Sheet）/ `DuckDBExporter`（写 `selection_results` 表）/ `SectorExporter`（调 `SectorManager.update_stocks` 回写通达信板块）。

### 4.4 通道分发（`engine/channels/registry.py` + `engine/channels/base.py`）

> 推送通道插件化，4 个内置通道：`csv_log`（强制开）/ `websocket` / `tdx_warn` / `feishu`。

| 接口 | 签名 | 用途 |
|---|---|---|
| `get_registry() -> ChannelRegistry` | 单例工厂 | 返回全局 `ChannelRegistry` |
| `reload_channel_config() -> None` | 强制重载 | 重新读 `config/channels.yaml` |
| **`registry.dispatch(payload, channels=None) -> list[ChannelResult]`** | 主分发接口 | `channels=None` 发给所有 enabled=True 的通道；`channels=["feishu"]` 只发指定（即便 enabled=False 也试） |
| `registry.list_channels() -> list[dict]` | 状态查询 | 返回各通道 `{name, enabled, config, errors}` |
| `registry.get_channel(name) -> BaseChannel \| None` | — | 取单通道实例 |
| `registry.update_config(new_cfg) -> list[str]` | 持久化 + 热重载 | 返回校验错误列表（空表示成功） |
| `registry.test_channel(name) -> ChannelResult` | 测试连通性 | 发一条测试消息，不受 enabled 限制 |

**`ChannelPayload`** 统一格式（`engine/channels/base.py`）：
```python
@dataclass
class ChannelPayload:
    signal_id: str = ""
    signal_type: str = "system"  # limit_up | drop_alert | breakout | selection | system
    strategy_id: str = ""
    strategy_name: str = ""
    strategy_emoji: str = ""
    stock_code: str = ""
    stock_name: str = ""
    title: str = ""
    content: str = ""
    severity: str = "info"  # info | warn | error
    priority: str = "medium"  # high | medium | low
    extra: dict[str, Any] = field(default_factory=dict)
    triggered_at: datetime = field(default_factory=datetime.now)
```

**`ChannelResult`**：`{channel, ok, message, raw}`，含 `to_dict()` 方法。

**新增通道**：在 `engine/channels/` 加 `my_channel.py`，实现 `class MyChannel(BaseChannel): name = "my_channel"`，然后在 `registry.py` 的 `_CHANNEL_CLASSES` 注册，在 `config/channels.yaml` 加默认配置。

### 4.5 存储层（`engine/storage/duckdb_store.py`）

> DuckDB 单文件存储封装，单例 + 线程锁。8 张表 schema 在 `config/duckdb_schema.sql`。

| 接口 | 签名 | 用途 |
|---|---|---|
| `DuckDBStore(db_path=None, schema_path=None, read_only=False, auto_init=True)` | 单例构造 | 路径来自 `config/app.yaml` 的 `paths.duckdb`，默认 `./data/duckdb/quant.db` |
| `store.init_db() -> None` | 初始化 schema | 读取 `config/duckdb_schema.sql`，幂等（`CREATE TABLE IF NOT EXISTS`） |
| **`store.execute(sql, params=None) -> int`** | 写操作 | INSERT/UPDATE/DELETE/DDL，返回 -1（DuckDB 不返回 rowcount） |
| `store.executemany(sql, params_list) -> int` | 批量写 | 多行 INSERT |
| **`store.query(sql, params=None) -> pd.DataFrame`** | 查询 | 返回 DataFrame，空结果也有正确列名 |
| `store.fetchone(sql, params=None) -> tuple \| None` | 单行查询 | — |
| `store.fetchall(sql, params=None) -> list[tuple]` | 多行查询 | — |
| `store.transaction()` | 上下文管理器 | `with store.transaction() as s: s.execute(...)` 自动 commit/rollback |
| **`store.table_exists(table_name) -> bool`** | 表是否存在 | 用 `information_schema.tables` 查 |
| `store.list_tables() -> list[str]` | 列出所有表 | — |
| `store.close() / reconnect()` | 连接管理 | — |

**8 张核心表**（`config/duckdb_schema.sql`）：
1. `strategies` — 策略注册
2. `selection_results` — 选股结果（run_id + strategy_id + stock_code + total_score + factor_scores JSON）
3. `signal_events` — 信号事件（event_id UUID + alert_type + snapshot JSON + channels_fired JSON）
4. `sector_snapshots` — 板块快照（stock_list JSON）
5. `strategy_runs` — 策略执行日志（run_id + status + duration_ms）
6. `monitor_subscriptions` — 监控订阅（stock_code + active + batch_no）
7. `config_changes` — 配置变更审计
8. `kline_cache` — K 线缓存（UNIQUE: stock_code + period + dividend_type + trade_date）

### 4.6 数据适配器（`engine/data_adapter/`）

> 抽象基类 `BaseDataAdapter` 定义全部 31 个 tqcenter API；`MockAdapter`（基于 V8 CSV 静态数据）与 `RealAdapter`（生产用，调 tqcenter）双实现；`factory.get_adapter()` 按 `app.adapter_mode` 切换。

| 接口 | 签名 | 用途 |
|---|---|---|
| **`get_adapter(force_reload=False) -> BaseDataAdapter`** | 工厂函数（`factory.py`） | 按 `config/app.yaml` 的 `app.adapter_mode`（mock/real）返回单例 |
| `reset_adapter() -> None` | 重置单例 | 测试用 |
| `adapter.initialize() -> bool` | 生命周期 | Real 模式调 `tq.initialize(__file__)` |
| `adapter.close() -> None` | 生命周期 | 取消订阅、关闭连接 |

**31 个数据接口**（按域分组，详见 §五 通达信API清单）：
- 行情类（9）：`get_market_snapshot` / `get_pricevol` / `get_market_data` / `get_more_info` / `get_stock_info` / `get_gb_info` / `get_gb_info_by_date` / `get_relation` / `get_ipo_info`
- 板块/成份股（3）：`get_stock_list` / `get_sector_list` / `get_stock_list_in_sector`
- 财务类（4）：`get_gpjy_value` / `get_gpjy_value_by_date` / `get_financial_data` / `get_gp_one_data`
- ETF/可转债（2）：`get_kzz_info` / `get_trackzs_etf_info`
- 板块管理（6）：`create_sector` / `delete_sector` / `rename_sector` / `clear_sector` / `send_user_block` / `get_user_sector`
- 通用函数（7）：`get_trading_dates` / `send_warn` / `send_message` / `subscribe_hq` / `unsubscribe_hq` / `refresh_kline` / `download_data`

**RealAdapter 关键约束**：
- `subscribe_hq` 单次最多 100 只，默认分批 50（`config/app.yaml` 的 `tqcenter.subscribe_batch_size`）
- `get_market_data` 单次最多 24000 条（`tqcenter.kline_max_count`），超出自动按 end_time 倒推分批续传并合并
- `clear_sector` 在 tqcenter 无原生 API，用 `send_user_block(code, [])` 推空列表实现
- `get_user_sector(code)` 实际调 `tq.get_user_sector_by_code(sector_code=code)`，无参时调 `tq.get_user_sector()`

### 4.7 板块管理（`engine/sector/manager.py`）

> 封装"原子操作"，杜绝 `send_user_block` 追加语义导致的成份股累积陷阱。

| 接口 | 签名 | 用途 |
|---|---|---|
| `SectorManager(adapter)` | 构造 | 注入 adapter |
| **`ensure_sector(code, name) -> bool`** | 幂等创建 | 不存在则 `create_sector`，已存在直接返回 True |
| **`update_stocks(code, stock_list) -> bool`** | **原子替换** | 先 `clear_sector` 再 `send_user_block`，两步都成功才 True |
| `get_stocks(code) -> list[str]` | 查询成份股 | 调 `get_user_sector(code)` |
| `add_stocks(code, stock_list) -> bool` | 追加（不清空） | 直接 `send_user_block`，注意是追加语义 |
| `remove_stocks(code, stock_list) -> bool` | 移除 | 取当前成份股 → 减去待移除 → `update_stocks` |
| `rename(code, new_name) -> bool` | 重命名 | 调 `rename_sector` |
| `delete(code) -> bool` | 删除板块 | 调 `delete_sector` |

### 4.8 引擎状态（`engine/api/state.py`）

> 进程级单例，记录心跳、信号计数、监控订阅缓存。**不持久化**，重启清零（FastAPI 重启后从 DuckDB 兜底）。

| 接口 | 签名 | 用途 |
|---|---|---|
| `get_engine_state() -> EngineState` | 单例工厂 | — |
| `state.heartbeat() -> None` | 心跳 | 更新 `last_hb`（每次 `/api/monitor/*` 调用都会触发） |
| `state.uptime_seconds() -> int` | 启动时长 | — |
| **`state.record_signal(signal_type) -> None`** | 信号计数 | `signal_type` 为 `limit_up` / `drop_alert` / `breakout` / `selection` / `system`，累加 today_signals/today_limit_up/today_alerts |
| `state.today_signal_counts() -> dict` | 取今日计数 | `{today_signals, today_limit_up, today_alerts}` |
| `state.reset_daily() -> None` | 跨日清零 | 由调度器调用（目前手动触发，未来主循环自动） |
| **`state.upsert_subscription(stock_code, *, strategy_id, subscriber, batch_no) -> None`** | 添加/更新订阅 | 写内存 `_subscriptions` dict，key=stock_code |
| `state.remove_subscription(stock_code) -> None` | 移除订阅 | — |
| `state.list_subscriptions() -> list[dict]` | 列出订阅 | 返回 `[{'strategy_id', 'stock_code', 'subscriber', 'subscribed_at', 'active', 'batch_no'}, ...]` |
| `state.monitored_count() -> int` | 监控股票数 | `len(_subscriptions)` |

### 4.9 配置加载（`engine/config/loader.py`）

> YAML 配置加载器，单例 + 热加载 + mtime 后台监听（2 秒轮询，无需 watchdog）。

| 接口 | 签名 | 用途 |
|---|---|---|
| `ConfigLoader(config_dir=None)` | 单例构造 | 默认读 `config/*.yaml` + `strategies/*.yaml` |
| **`cfg.get(key, default=None) -> Any`** | 点路径取值 | 如 `cfg.get("app.adapter_mode")` / `cfg.get("paths.duckdb", "./data/duckdb/quant.db")` |
| `cfg.set(key, value) -> None` | 点路径设值 | 仅内存，不持久化（测试用） |
| `cfg.all() -> dict` | 深拷贝快照 | 防止外部修改内部状态 |
| **`cfg.reload() -> None`** | 主动重载 | 重扫 `config/*.yaml` 与 `strategies/*.yaml`，合并到 `_data` |
| `cfg.app_config() -> AppConfigRoot` | 强类型 | 返回 `config/app.yaml` 对应 dataclass |
| `cfg.theme_config() -> ThemeConfig` | 强类型 | 返回 `config/theme.yaml` 对应 dataclass |
| **`cfg.strategies() -> dict[str, StrategyConfig]`** | 强类型 | 返回所有策略 dataclass 字典 |
| `cfg.strategy(strategy_id) -> StrategyConfig \| None` | 强类型 | 返回单个策略 |
| `cfg.start_watcher(interval=2.0) -> None` | 后台监听 | 启动 daemon 线程，发现 mtime 变化自动 reload |
| `cfg.stop_watcher() -> None` | 停止监听 | — |
| `cfg.add_listener(callback) -> None` | 注册回调 | `callback(changed_paths: list[str])`，配置变更时触发 |

**监听的配置文件**（`config/*.yaml`，共 7 个）：
- `app.yaml` — 全局参数（端口、adapter_mode、tqcenter 配置）
- `channels.yaml` — 推送通道配置
- `cleaning_rules.yaml` — ST/停牌/退市过滤规则
- `duckdb_schema.sql` — 数据库 schema（不热加载，仅启动时 init）
- `export.yaml` — 导出器配置
- `monitor_rules.yaml` — 监控预警规则 + `alert_templates`
- `sector_mapping.yaml` — 板块代码映射
- `theme.yaml` — 前端主题

### 4.10 监控引擎（`engine/monitor/`）—— ⚠️ **当前为空壳**

> ⚠️ **重要发现**：`engine/monitor/__init__.py` 导出 `MonitorEngine` / `RuleSet` / `AlertRule` / `MatchRegistry`，但 `engine/monitor/` 目录下**只有 `__init__.py`，没有 `engine.py` / `match_registry.py` / `rules.py` 实现文件**。当前 import 会失败。
>
> 该模块对应 `docs/MONITOR_ENGINE_PLAN.md` 第四章 / 第十四章 / 第十五章的方案，**方案就绪但尚未实施**。实施提示词在 `docs/MONITOR_ENGINE_IMPLEMENTATION_PROMPT.md`。

**计划中的接口**（来自方案文档，待实施）：

| 计划接口 | 签名 | 用途 |
|---|---|---|
| `MonitorEngine(adapter, storage, state, ruleset, match_registry)` | daemon 线程主循环 | 订阅行情 → 求值规则 → 落库 → 推送 |
| `RuleSet` | alert_templates 加载与求值 | 参数化、可热加载 |
| `MatchRegistry` | 匹配策略层 | 绑定 strategy_id + scope + params + alerts |
| `AlertRule` | 单条预警规则 | 含 condition / alert_type / channels / priority |

实施完成后，建议在 `engine/api/routes/` 新增 `match_strategy.py`（CRUD match + 调参 + test 预览），并在 `main.py` 注册路由。

---

## 五、通达信 API 能力清单

> 来源：`docs/tdx-quant/通达信量化平台说明书/tongdaxin_query.py`（字段映射字典） + `docs/tdx-quant/通达信量化平台说明书/` 各分类目录下的 markdown 文档。

### 5.1 已封装（`data_adapter` 对接，31 个）

#### A. 行情类（9 个）

| tqcenter API | data_adapter 方法 | 用途 | 关键字段 |
|---|---|---|---|
| `tq.get_market_snapshot` | `get_market_snapshot(code, field_list)` | 单只证券快照 | `LastClose/Open/Max/Min/Now/Volume/Amount/Buyp/Buyv/Sellp/Sellv` |
| `tq.get_pricevol` | `get_pricevol(stock_list)` | 批量价量 | `LastClose/Now/Volume` |
| `tq.get_market_data` | `get_market_data(stock_list, period, start_time, end_time, count, dividend_type, field_list, fill_data)` | K 线行情（超 24000 条自动分批续传） | `Date/Time/Open/High/Low/Close/Volume/Amount/ForwardFactor/VolInStock` |
| `tq.get_more_info` | `get_more_info(code, field_list)` | 股票更多信息（资金流/封板/估值/关键日期） | `fHSL/Zjl/TotalBVol/TotalSVol/FCb/FCAmo/ZAF/ZAFPre5/ZAFPre20/DynaPE/PB_MRQ` 等 |
| `tq.get_stock_info` | `get_stock_info(code, field_list)` | 证券基本信息（名称/分类/股本/财务摘要） | `Name/BelongRZRQ/BelongHSGT/IsSTGP/J_zgb/J_zzc/J_jzc` 等 |
| `tq.get_gb_info` | `get_gb_info(code, date_list, count)` | 每天股本数据（离散日期） | `Date/Zgb/Ltgb` |
| `tq.get_gb_info_by_date` | `get_gb_info_by_date(code, start_date, end_date)` | 时间段股本数据 | `Date/Zgb/Ltgb` |
| `tq.get_relation` | `get_relation(code)` | 股票所属板块 | `BlockCode/BlockName/BlockType/GPNume` |
| `tq.get_ipo_info` | `get_ipo_info(ipo_type, ipo_date)` | 新股申购信息 | `Code/Name/SGDate` |

#### B. 分类板块（3 个）

| tqcenter API | data_adapter 方法 | 用途 | 关键字段 |
|---|---|---|---|
| `tq.get_stock_list` | `get_stock_list(list_type, market)` | 系统分类成份股 | `Code/Name` |
| `tq.get_sector_list` | `get_sector_list(list_type)` | A 股板块代码列表 | `Code/Name` |
| `tq.get_stock_list_in_sector` | `get_stock_list_in_sector(block_code, block_type, list_type)` | 板块成份股 | `Code/Name` |

#### C. 财务类（4 个，部分未封装见 §5.2）

| tqcenter API | data_adapter 方法 | 用途 | 关键字段 |
|---|---|---|---|
| `tq.get_financial_data` | `get_financial_data(stock_list, field_list, start_time, end_time, report_type)` | 专业财务数据（FN 系列） | `FN1~FN266`（每股指标/资产/负债/权益/现金流/财务指标） |
| `tq.get_gp_one_data` | `get_gp_one_data(stock_list, field_list)` | 股票单个财务数据（GO 系列） | `GO1~GO41`（发行价/解禁/机构持股/业绩预告） |
| `tq.get_gpjy_value` | `get_gpjy_value(code, date_list, count)` | 个股交易数据（GP 系列，离散日期） | `GP01/GP02/GP03/GP14/GP15/GP16/GP25` |
| `tq.get_gpjy_value_by_date` | `get_gpjy_value_by_date(code, start_date, end_date)` | 个股交易数据（时间段） | 同上 |

#### D. ETF / 可转债（2 个）

| tqcenter API | data_adapter 方法 | 用途 |
|---|---|---|
| `tq.get_kzz_info` | `get_kzz_info(code, field_list)` | 可转债信息 |
| `tq.get_trackzs_etf_info` | `get_trackzs_etf_info(index_code)` | 跟踪指数的 ETF 信息 |

#### E. 客户端操作类（6 个，自定义板块管理）

| tqcenter API | data_adapter 方法 | 用途 | 注意 |
|---|---|---|---|
| `tq.create_sector` | `create_sector(block_code, block_name)` | 创建自定义板块 | — |
| `tq.delete_sector` | `delete_sector(block_code)` | 删除自定义板块 | — |
| `tq.rename_sector` | `rename_sector(block_code, new_name)` | 重命名自定义板块 | — |
| `tq.clear_sector` | `clear_sector(block_code)` | 清空成份股 | tqcenter 无原生 clear，用 `send_user_block(code, [])` 推空实现 |
| `tq.send_user_block` | `send_user_block(block_code, stock_list)` | 推送成份股（**追加语义**） | ⚠️ 必须先 clear，否则成份股累积 |
| `tq.get_user_sector` / `tq.get_user_sector_by_code` | `get_user_sector(block_code)` | 自定义板块列表 / 指定板块成份股 | 无参返回全部，有参返回单板块 |

#### F. 通用函数（7 个，订阅/推送/下载）

| tqcenter API | data_adapter 方法 | 用途 | 注意 |
|---|---|---|---|
| `tq.initialize` | `RealAdapter.initialize()` | 初始化（Real 模式必调） | tqcenter 要求传入 `__file__` 上下文 |
| `tq.subscribe_hq` | `subscribe_hq(stock_list, callback, batch_size)` | 订阅行情 | 单次上限 100 只，默认分批 50 |
| `tq.unsubscribe_hq` | `unsubscribe_hq(stock_list)` | 取消订阅 | 空列表取消全部 |
| `tq.get_trading_dates` | `get_trading_dates(market, start, end)` | 交易日列表 | 需先在客户端下载上证指数盘后数据 |
| `tq.send_warn` | `send_warn(stock_list, **kwargs)` | 推送预警信号（半自动交易下单入口） | 详见 `docs/tdx-quant/.../通用函数/发送消息与信号.md` |
| `tq.send_message` | `send_message(msg)` | 推送消息到 TQ 策略界面 | `\|` 分隔多行 |
| `tq.refresh_kline` | `refresh_kline(stock_code, period)` | 刷新历史 K 线缓存 | period 仅支持 `1d`/`1m`/`5m` |
| `tq.download_data` | `download_data(stock_code, start_date, end_date)` | 下载特定数据文件 | — |

### 5.2 未封装（后续可挖，~21 个）

#### A. 财务类（5 个，板块/市场交易数据）

| tqcenter API | 用途 | 字段示例 | 挖掘建议 |
|---|---|---|---|
| `tq.get_financial_data_by_date` | 指定日期专业财务数据 | 同 `get_financial_data` | 单日快照场景可用，比时间段更精确 |
| `tq.get_bkjy_value` | 板块交易数据（时间段） | `BK5:市盈率TTM / BK6:市净率MRQ / BK7:市销率TTM / BK9:涨跌数 / BK12:涨停数 / BK13:跌停数` | **板块情绪监控可用**，配合 `alert_templates` 做板块涨停潮预警 |
| `tq.get_bkjy_value_by_date` | 板块交易数据（指定日期） | 同上 | 单日板块快照 |
| `tq.get_scjy_value` | 市场交易数据（时间段） | `SC01:融资融券余额 / SC03:涨停股个数 / SC04:跌停股个数 / SC11:大宗交易 / SC15:打板资金 / SC31:涨跌家数` | **市场情绪指标**，配合 `alert_templates` 做大盘温度计 |
| `tq.get_scjy_value_by_date` | 市场交易数据（指定日期） | 同上 | 单日市场快照 |

#### B. 通用函数（5 个，客户端操作）

| tqcenter API | 用途 | 挖掘建议 |
|---|---|---|
| `tq.get_subscribe_hq_stock_list` | 获取当前订阅列表 | 监控引擎健康度检查（与 `EngineState._subscriptions` 对账） |
| `tq.refresh_cache` | 刷新行情缓存（snapshot + K 线） | 冷启动前主动刷新，避免首次取数慢 |
| `tq.download_file` | 下载 10 大股东 / ETF 申赎清单 / 舆情 / 综合信息 | 价值投资因子可挖（股东数据） |
| `tq.get_match_stkinfo` | 检索证券信息（关键词） | 前端搜索框可对接（当前 `GlobalSearch.tsx` 仅搜 DuckDB） |
| `tq.exec_to_tdx` | 调用客户端功能（功能串） | 一键跳转到指定股票/板块/指标公式，**自动化交易工作流可挖** |

#### C. 客户端数据导出（2 个）

| tqcenter API | 用途 | 挖掘建议 |
|---|---|---|
| `tq.send_file` | 发送文件到客户端（txt/pdf/html） | 回测报告导出到客户端打开 |
| `tq.send_bt_data` | 发送回测数据到客户端 | 把 `BacktestResultDTO.daily_equity` 推到客户端图表展示 |

#### D. 数据展示（1 个）

| tqcenter API | 用途 | 挖掘建议 |
|---|---|---|
| `tq.print_to_tdx` | 导出多组 DataFrame 到客户端展示 | 多策略共振面板、资金流向面板可直接推到通达信界面 |

#### E. 公式类（11 个，**全部未封装**）

> ⚠️ **重要发现**：通达信公式调用类 API 完全没有封装到 `data_adapter`。这是 V8 选股的"另一半能力"——很多 V8 因子是基于通达信公式（MACD/KDJ/布林带等）计算的，目前 TdxQuant 用 pandas 重写了一遍，存在与客户端公式结果不一致的风险。

| tqcenter API | 用途 | 挖掘建议 |
|---|---|---|
| `tq.formula_zb` | 调用技术指标公式（MACD/KDJ/布林带） | **趋势/突破类因子可直接调公式**，保证与客户端一致 |
| `tq.formula_xg` | 调用条件选股公式（UPN/涨停板等） | 选股 pipeline 可作为预筛步骤 |
| `tq.formula_exp` | 调用专家系统公式 | — |
| `tq.formula_set_data` | 向公式设置数据（K 线 List） | 配合 `formula_zb` 使用 |
| `tq.formula_set_data_info` | 向公式设置数据信息（时间段） | 配合 `formula_zb` 使用，比 `set_data` 更方便 |
| `tq.formula_get_data` | 获取公式中已设置的 K 线数据 | 调试用 |
| `tq.formula_get_all` | 获取指定种类的公式列表 | 前端可加"公式选择器"下拉 |
| `tq.formula_get_info` | 获取指定公式信息（参数个数/默认值） | 前端公式参数表单 |
| `tq.formula_format_data` | 格式化 `get_market_data` 的 K 线为公式可用格式 | `get_market_data` → `formula_format_data` → `formula_set_data` |
| `tq.formula_process_mul_xg` | **批量调用选股公式**（无需 `set_data` 预设） | **多股票批量选股**，效率最高 |
| `tq.formula_process_mul_zb` | **批量调用指标公式** | **多股票批量算指标**，效率最高 |

#### F. 数据库相关（保留项）

| tqcenter API | 用途 | 备注 |
|---|---|---|
| （`tqcenter.tqconst`） | 常量（市场代码/周期/订单类型/价格类型/委托状态） | `RealAdapter` 已 import 但未对外暴露方法，可后续封装 `get_market_code(code)` / `get_period_list()` 等工具方法 |

---

## 六、策略扩展指引（怎么用这些接口加策略）

### 6.1 加一个新选股策略需要调哪些接口

**目标**：新增一个策略 `my_strategy`，前端可启用/禁用/运行/查看结果。

**步骤与对应接口**：

1. **写策略 YAML**（`strategies/strategy_my_strategy.yaml`）
   - 参考 `strategies/_template.yaml`，必填字段：`strategy_id` / `strategy_name` / `enabled` / `factors[]` / `scoring.formula` / `output` / `sector`
   - 因子从 §4.2 的 26 个中选，或新建因子（见 §6.3）
   - 评分公式用 §4.1 的表达式语法，如 `clip(momentum_5d * 0.4 + turnover_rate * 0.3 + main_inflow * 0.3, 0, 100)`

2. **热加载配置**：前端点"刷新配置" → `POST /api/config/reload`（路由 #32）→ `ConfigLoader.reload()`（§4.9）

3. **前端启用/运行**：
   - 启用：`POST /api/strategies/{id}` body `{enabled: true}`（路由 #4）→ 修改 YAML + reload
   - 运行：`POST /api/strategies/{id}/run`（路由 #7）→ `StrategyRunner.run_strategy()`（§4.3）→ 6 步 pipeline → 写 `selection_results` 表 → 自动订阅 Top 20 → 写 `signal_events` selection 信号 → dispatch 到 channels

4. **查看结果**：
   - 列表：`GET /api/selections?strategy_id=my_strategy`（路由 #9）
   - 导出：`GET /api/selections/{run_id}/export?format=excel`（路由 #11）
   - 历史执行：`GET /api/strategies/{id}/runs`（路由 #8）

5. **回测验证**：`POST /api/backtest/run` body `{strategy_id: "my_strategy", start_date, end_date, ...}`（路由 #28）

6. **板块回写**（可选）：在策略 YAML 配 `sector.code`，pipeline 的 `export` 步骤会自动调 `SectorManager.update_stocks()`（§4.7）回写通达信板块；或前端手动调 `POST /api/sectors/{code}/refresh`（路由 #24）

**关键依赖链**：`ConfigLoader` → `StrategyRunner` → `BaseDataAdapter`（取数）→ `FactorRegistry`（算因子）→ `ExpressionEvaluator`（评分）→ `DuckDBStore`（落库）→ `ChannelRegistry.dispatch`（推信号）→ `SectorManager.update_stocks`（回写板块）

### 6.2 加一个新预警规则需要调哪些接口

**目标**：新增一条预警规则，如"5 分钟内涨幅 > 5%"触发推送。

**前置**：⚠️ **监控引擎尚未实施**（§4.10），目前 `monitor_rules.yaml` 的 `alert_templates` 仅作为配置存在，无人读取。需先实施 `docs/MONITOR_ENGINE_IMPLEMENTATION_PROMPT.md` 的 Step 1-6。

**实施后步骤**：

1. **写预警模板**（`config/monitor_rules.yaml` 的 `alert_templates`）：
   ```yaml
   alert_templates:
     my_surge:
       condition: "pct_change > 0.05"   # 用 §4.1 表达式语法
       alert_type: my_surge
       channels: [tdx_warn, websocket, feishu]
       priority: high
       description: 5分钟内涨幅突破5%
   ```

2. **绑定到策略**（`strategies/strategy_xxx.yaml` 的 `monitor.alert_conditions`）：
   ```yaml
   monitor:
     alert_conditions:
       - alert_type: my_surge          # 引用模板
         channels: [tdx_warn, feishu]  # 可覆盖模板 channels
   ```
   或在未来的 `match_strategies.yaml` 中绑定（见 `MONITOR_ENGINE_PLAN.md` 第十四章）。

3. **热加载**：`POST /api/config/reload`（路由 #32）

4. **监控引擎自动订阅**：实施后，`MonitorEngine` 会从 `EngineState.list_subscriptions()` 取订阅列表，调 `adapter.subscribe_hq(codes, callback)`（§4.6）订阅行情，回调中用 `ExpressionEvaluator.evaluate_safe(condition, snapshot_vars)`（§4.1）求值，命中则 `state.record_signal(alert_type)`（§4.8）+ `registry.dispatch(payload, channels)`（§4.4）+ 写 `signal_events` 表。

5. **前端查看信号**：`GET /api/signals?type=my_surge`（路由 #25）

6. **重推**：`POST /api/channels/signals/{signal_id}/repush`（路由 #19）

**变量字典**（求值时注入）：`pct_change` / `volume_ratio` / `main_inflow` / `auction_pct` / `last` / `volume` / `amount` 等（来自 `QuoteSnapshot` + `get_more_info` 字段）。

### 6.3 加一个新因子需要调哪些接口

**目标**：新增一个因子 `my_factor`，可在策略 YAML 的 `factors[]` 中引用。

**步骤**：

1. **新建因子文件**（`engine/factors/my_factor.py`）：
   ```python
   from engine.factors.base import Factor
   import pandas as pd

   class MyFactor(Factor):
       factor_id = "my_factor"
       factor_name = "我的因子"
       factor_category = "momentum"  # momentum/breakout/valuation/volume/limit_up/trend/reversal/turnover
       factor_description = "5日动量与换手率的乘积"

       def get_required_fields(self) -> list[str]:
           # 声明需要的数据列，LoadDataStep 会据此拉取
           return ["ZAFPre5", "fHSL"]

       def get_default_params(self) -> dict:
           return {"scale": 1.0}

       def calculate(self, df: pd.DataFrame, params: dict) -> pd.Series:
           scale = params.get("scale", 1.0)
           return (df["ZAFPre5"] * df["fHSL"] * scale).fillna(0)
   ```

2. **自动注册**：`FactorRegistry` 启动时扫描 `engine/factors/*.py`，自动实例化注册（§4.2）。**无需修改 registry.py**。

3. **在策略 YAML 引用**：
   ```yaml
   factors:
     - factor_id: my_factor
       weight: 0.3
       params:
         scale: 2.0
   ```

4. **热加载**：`POST /api/config/reload`（路由 #32）

5. **运行策略验证**：`POST /api/strategies/{id}/run`（路由 #7）→ 检查 `selection_results.factor_scores` JSON 中是否含 `my_factor` 字段

**字段依赖**：`get_required_fields()` 返回的字段名必须与 `get_more_info` / `get_market_snapshot` / `get_market_data` 返回的字段对齐（参见 `tongdaxin_query.py` 的字段字典）。如需 K 线派生字段（如 `KL_MA20`），需在 `LoadDataStep` 中预处理。

### 6.4 加一个新推送通道需要调哪些接口

**目标**：新增一个推送通道（如钉钉机器人 / 企业微信 / 邮件）。

**步骤**：

1. **新建通道文件**（`engine/channels/dingtalk.py`）：
   ```python
   from engine.channels.base import BaseChannel, ChannelPayload, ChannelResult
   import requests

   class DingTalkChannel(BaseChannel):
       name = "dingtalk"
       # force_enabled = False  # 是否强制开启（csv_log 是 True）

       def validate_config(self) -> list[str]:
           errs = []
           if self.enabled and not self.config.get("webhook_url"):
               errs.append("webhook_url 必填")
           return errs

       def send(self, payload: ChannelPayload) -> ChannelResult:
           try:
               # 把 payload 转成钉钉协议格式
               title = payload.display_title
               content = payload.content
               resp = requests.post(
                   self.config["webhook_url"],
                   json={"msgtype": "markdown", "markdown": {"title": title, "text": f"### {title}\n\n{content}"}},
                   timeout=5,
               )
               data = resp.json()
               if data.get("errcode") == 0:
                   return ChannelResult(channel=self.name, ok=True, message="ok")
               return ChannelResult(channel=self.name, ok=False, message=str(data))
           except Exception as exc:
               return ChannelResult(channel=self.name, ok=False, message=str(exc))
   ```

2. **在注册表登记**（`engine/channels/registry.py`）：
   ```python
   from engine.channels.dingtalk import DingTalkChannel
   _CHANNEL_CLASSES: dict[str, type[BaseChannel]] = {
       "csv_log": CsvLogChannel,
       "websocket": WebSocketChannel,
       "tdx_warn": TdxWarnChannel,
       "feishu": FeishuChannel,
       "dingtalk": DingTalkChannel,  # 新增
   }
   _DEFAULT_CONFIG: dict[str, Any] = {
       # ... 原有 ...
       "dingtalk": {"enabled": False, "webhook_url": "", "secret": ""},
   }
   ```

3. **配置文件**（`config/channels.yaml` 自动生成默认模板，或手动加）：
   ```yaml
   dingtalk:
     enabled: false
     webhook_url: ""
     secret: ""
   ```

4. **热重载**：`PUT /api/channels` body `{channels: {dingtalk: {enabled: true, webhook_url: "..."}}}`（路由 #17）→ `registry.update_config()` 持久化 + 热重载（§4.4）

5. **测试**：`POST /api/channels/dingtalk/test`（路由 #18）→ `registry.test_channel("dingtalk")` 发一条测试消息

6. **在策略 YAML 引用**：`alert_conditions[].channels` 或 `monitor_rules.yaml` 的 `alert_templates.*.channels` 加入 `dingtalk`

7. **触发推送**：策略运行 / 监控命中 → `registry.dispatch(payload, channels=["dingtalk"])`（§4.4）

**关键约束**：
- `ChannelPayload`（§4.4）是统一格式，各通道负责转自己的协议
- `csv_log` 通道 `force_enabled=True`，永远开启（审计要求）
- `send()` 必须返回 `ChannelResult`，不能抛异常（异常会被 registry 捕获并转成 `ok=False`）
- 单通道失败不影响其他通道（registry 遍历 dispatch）

---

## 附录 A：关键约束备忘（来自 ARCHITECTURE.md §12）

1. **`send_user_block` 是追加非覆盖** → 必须先 `clear_sector`（`SectorManager.update_stocks` 已封装原子操作）
2. **`subscribe_hq` 上限 100 只** → 分批 50（`config/app.yaml` 的 `tqcenter.subscribe_batch_size`）
3. **`get_market_data` 单次 24000 条** → 自动分批续传（`RealAdapter._call_market_data`）
4. **`EngineState` 不持久化** → 重启清零，从 DuckDB `signal_events` / `monitor_subscriptions` 兜底
5. **`csv_log` 通道强制开启** → 审计要求，不可关闭
6. **配置热加载** → 修改 `config/*.yaml` 或 `strategies/*.yaml` 后调 `POST /api/config/reload` 或等 watcher 2 秒自动触发
7. **`expression` 不用 eval/exec** → 基于 `simpleeval` AST 解析 + 白名单函数
8. **因子插件自动扫描** → `engine/factors/*.py` 加文件即注册，无需修改 registry

## 附录 B：环境要求

| 模式 | 操作系统 | 依赖 | 适用场景 |
|---|---|---|---|
| Mock | 任意（Linux 沙箱可跑） | 无外部依赖，基于 V8 CSV 静态数据 | 开发 / 演示 / 前端联调 |
| Real | Windows + 通达信终端 | `tqcenter` Python 包（通达信量化平台） | 生产 / 真实行情 / 实盘推送 |

切换：修改 `config/app.yaml` 的 `app.adapter_mode: mock|real`，调 `POST /api/config/reload` 热生效。

## 附录 C：文档交叉引用

| 主题 | 文档 |
|---|---|
| 项目架构总览 | `docs/maintenance/ARCHITECTURE.md` |
| 项目交接 | `docs/PROJECT_HANDOVER.md` |
| 用户使用指南 | `docs/USER_GUIDE.md` |
| 项目维护手册 | `docs/PROJECT_MAINTENANCE.md` |
| 策略逻辑详解 | `docs/maintenance/STRATEGY_LOGIC.md` |
| 策略因子扩展 | `docs/STRATEGY_FACTOR_EXTENSION.md` |
| 监控引擎方案 | `docs/MONITOR_ENGINE_PLAN.md`（一~十五章 + 附录 A/B，~1383 行） |
| 监控引擎实施提示词 | `docs/MONITOR_ENGINE_IMPLEMENTATION_PROMPT.md`（~430 行，可整体喂给实施 AI） |
| 通达信 API 说明书 | `docs/tdx-quant/通达信量化平台说明书/`（a 行情 / b 财务 / c 板块 / d 客户端 / e ETF / f 公式 / g 场景 + 通用函数） |
| 字段映射字典 | `docs/tdx-quant/通达信量化平台说明书/tongdaxin_query.py`（含 `find_field_in_apis` / `get_api_fields` / `find_duplicates` 工具函数） |
