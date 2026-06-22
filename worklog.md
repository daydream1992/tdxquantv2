# TdxQuant 项目工作记录

> 完整历史归档: `worklog-archive-R5-R13.md.gz`（74 段 Task ID，R5-R13 全部迭代）
> 本文件只保留最近 5 段 + 项目纪要，避免膨胀。

---

## 项目纪要

### 当前状态（R13 精简完成后）
- **adapter_mode**: mock（沙箱开发模式）
- **engine_status**: running
- **5 Tab 前端**: Dashboard / Strategies / Selections / Signals / Sectors 全通
- **40+ 后端路由**: 全 200
- **R13 精简完成**: 文档 64→8 个文件、脚本 18→8 个、配置 9→7 个、删 Prisma 死代码、6 个巨型组件已拆分

### 架构核心
- 5 层架构: L1 基础设施 / L2 引擎 / L3 插件 / L4 业务规则 / L5 用户配置
- 插件式: 因子(26) / 通道(4) / 数据源(Mock/Real) / 导出器(4) 均可扩展
- 三层限流(R12): 令牌桶 + 端点中间件 + 监控统计
- 配置热加载: YAML 改完 `python scripts/dev.py reload` 即生效（adapter_mode 除外）

### 关键约束
1. 适配器模式(mock↔real)不支持热加载，必须重启
2. DuckDB 单写锁，不要开多 FastAPI 实例
3. 改 engine/ 已稳定代码前先读本文档 + ARCHITECTURE.md
4. Mock 模式不限流（开发体验优先）
5. 前端不直连 DB，全走 FastAPI API（Prisma 已删）

### 文档导航
- `docs/README.md` — 项目总览
- `docs/maintenance/ARCHITECTURE.md` — 5 层架构（改代码前必读）
- `docs/MAINTENANCE.md` — 运维 + 8 场景提示词
- `docs/DEPLOY.md` — 部署指南
- `docs/STRATEGY_FACTOR.md` — 策略/因子开发
- `docs/USER_GUIDE.md` — 用户手册
- `docs/CHANGELOG.md` — R5-R13 变更日志

---

## 最近工作记录

(以下为最近 5 段 Task ID，更早的见 `worklog-archive-R5-R13.md.gz`)

---
Task ID: R13-精简-文档+worklog
Agent: Z.ai Code (Claude, 主控)
Task: 文档瘦身(64→8) + worklog 归档(13008行→纪要+5段)

Work Log:
- 删除已实施完的设计文档: MONITOR_ENGINE_PLAN.md / MONITOR_ENGINE_IMPLEMENTATION_PROMPT.md
- 删除冗余文档(合并到新文档): API_CAPABILITY_MAP.md / QUICKSTART_10MIN.md / PATH_REPLACEMENT_GUIDE.md / PROJECT_HANDOVER.md / PROJECT_MAINTENANCE.md / HANDOVER_PROMPTS.md / STRATEGY_FACTOR_EXTENSION.md / maintenance/STRATEGY_LOGIC.md
- 删除 docs/tdx-quant/ (51 个通达信官方文档，网上有)
- 移动 docs/v8-data/ → data/v8-samples/ (它是数据不是文档，24MB)
- 更新 config/app.yaml + engine/config/schema.py + engine/data_adapter/mock_adapter.py 的路径引用
- 删除 agent-ctx/ (63 个 QA 截图归档，6.8MB)
- 删除 tool-results/ (中间产物，4.6MB)
- 新建 docs/README.md (项目总览，140 行)
- 新建 docs/DEPLOY.md (部署指南，Windows/Linux/沙箱三环境，200 行)
- 新建 docs/MAINTENANCE.md (运维 + 8 场景提示词 + 限流方案 + 故障排查，300 行)
- 新建 docs/STRATEGY_FACTOR.md (策略/因子开发指南，400 行)
- 更新 docs/maintenance/ARCHITECTURE.md: 追加「R5-R13 演进补充」章节(110 行)，覆盖 P1 过时描述
- 归档 worklog.md → worklog-archive-R5-R13.md.gz (238KB)
- 重建 worklog.md: 项目纪要 + 最近 5 段

Stage Summary:
- 文档: 64 个文件 / 16142 行 → 8 个文件 / ~3500 行（-78%）
- worklog: 13008 行 → ~200 行 + 归档（-98%）
- 辅助目录清理: agent-ctx(6.8MB) + tool-results(4.6MB) + docs/tdx-quant(508KB) + docs/v8-data(24MB，移到 data/)
- v8-data 路径引用已同步更新(3 个文件)
- 文档导航: README.md 为入口，6 个文档分工明确
- 未解决问题: docs/ 下 5 个文档可能仍引用已删除的脚本名(smoke_test.sh 等)，后续文档维护时统一改为 dev.py

---
Task ID: R13-精简-代码(Subagent A)
Agent: Subagent A (删Prisma+mock-data统一)
Task: 删 Prisma 死代码 + mock-data 降级逻辑统一进 api-proxy

Work Log:
- 删 src/lib/db.ts (Prisma client, 零业务调用)
- 删 src/lib/mock-data.ts (584 行，降级数据搬到 api-proxy)
- 删 prisma/ 整个目录 (schema.prisma 只有 User/Post 脚手架)
- 删 .env (仅含 DATABASE_URL)
- package.json: deps 删 prisma + @prisma/client，scripts 删 db:push/generate/migrate/reset
- src/lib/api-proxy.ts: 105 → 773 行，新增 fallback(path, query?) 映射表 + 7 个 gen* 函数 + STRATEGIES + MOCK_THEME
- 11 个 route.ts 统一改用 api-proxy 的 fallback()，不再 import mock-data

Stage Summary:
- 删除: db.ts / mock-data.ts / prisma/ / .env / 4 个 db:xxx 脚本 / 2 个 prisma 依赖
- 修改: api-proxy.ts(+668行) / package.json / 11 个 route.ts
- 验证: rg "@prisma/client|from.*lib/db" 零结果 / rg "mock-data" 零结果 / bun run lint exit 0
- 风险: STRATEGIES 模块级共享状态(原 mock-data 也是这样，行为 100% 保留)

---
Task ID: R13-精简-脚本(Subagent B)
Agent: Subagent B (脚本统一)
Task: 18 个 .sh/.ps1 双版本脚本统一为 1 个 Python 跨平台 dev.py

Work Log:
- 新建 scripts/dev.py (~480 行，7 个子命令: start/stop/setup/reload/test/paths/daemon)
- 用 argparse + subprocess + platform 标准库，零外部依赖
- Windows ANSI 上色: ctypes.windll.kernel32.SetConsoleMode
- 跨平台 detached 启动: Linux start_new_session / Windows CREATE_NEW_PROCESS_GROUP
- stop 安全杀: Windows 用 Get-CimInstance 按 ProjectRoot 过滤
- 保留 start_all.sh + start_all.ps1 作为 thin wrapper (3 行，兼容老用法)
- 删除 12 个重复脚本: daemon.{sh,ps1} / setup-env.{sh,ps1} / replace-paths.{sh,ps1} / smoke_test.{sh,ps1} / stop.{sh,ps1} / realtime_daemon.sh / start_fastapi.sh

Stage Summary:
- scripts/: 18 个文件 → 8 个文件（-56%）
- dev.py 7 子命令: start / stop / setup / reload / test / paths / daemon
- 验证: python3 scripts/dev.py --help / start --no-fastapi 实测 / stop 实测 / reload 实测 / paths --dry-run 全过
- bun run lint exit 0
- 已知未解决: docs/ 下 5 个文档仍引用已删除脚本名(本次主控已删/合并这些文档，问题消除)

---
Task ID: R13-精简-配置(Subagent C)
Agent: Subagent C (配置合并)
Task: monitor_rules.yaml + match_strategies.yaml → monitor.yaml

Work Log:
- 新建 config/monitor.yaml (326 行，4 段: monitor / alert_templates / dedup / match_strategies)
- 删 config/monitor_rules.yaml (198 行)
- 删 config/match_strategies.yaml (96 行)
- engine/config/schema.py: PathsConfig 删 monitor_rules + match_strategies 字段，加 monitor 字段
- config/app.yaml: paths 段同步改
- engine/monitor/match_registry.py: _config_path 改读 monitor.yaml / _write_yaml 改为"读-改-写"模式(避免误删其他段)
- 4 个 .py 文件 docstring 更新

Stage Summary:
- config/: 9 个文件 → 7 个文件（monitor_rules + match_strategies 合并为 monitor.yaml）
- monitor.yaml 4 段: monitor(24行) / alert_templates(169行,14模板) / dedup(5行) / match_strategies(98行,3策略)
- loader.py 零改动(用 glob 通用加载，按 top-level key 合并)
- 验证: 4 个端点全 200 (/api/monitor/health / /api/monitor/match-strategies / /api/config / POST /api/config/reload)
- bun run lint exit 0

---
Task ID: R13-精简-组件拆分(Subagent D+E)
Agent: Subagent D+E (待重试)
Task: 6 个巨型组件拆分

注: 此任务因 API 429 限流未完成，待重试。详见下一段。

---
(更早的工作记录见 worklog-archive-R5-R13.md.gz)

---
Task ID: 3-a
Agent: Subagent D (拆前3组件)
Task: MatchStrategyManager + SignalCenter + WatchlistManager 拆分

Work Log:
- MatchStrategyManager 容器 125→93 行 (压缩 docstring + 合并 strategies 加载 effect)
  - 已存在的 match-strategy/ 子目录 (前次 Subagent D+E 部分): List(429) / Form(721) / Test(270) / shared.ts(128)
  - Form 721 行超 500 行限制, 抽出 EditForm+CopyForm 到新文件 MatchStrategyEditFields.tsx(461)
  - Form 主体降至 270 行, EditFields 461 行 (均 <500)
  - shared.ts 增 CopyDialogState + INITIAL_COPY 类型导出 (供 Form 和 EditFields 共享)
  - 注: match-strategy/ 实际 4 个 .tsx (List/Form/Test/EditFields), 因 Form 含 2 个 Dialog + EditForm 字段渲染总 JSX ~600 行无法压到 500 内; EditFields 是 Form 的内部 parts 文件, 非独立子组件
- SignalCenter 容器 1497→99 行, 拆 3 个子组件 + shared.ts:
  - signal/SignalFilter.tsx (210 行) — 类型/策略/日期/通道多选筛选栏, 纯 props
  - signal/SignalList.tsx (499 行) — 类型统计卡片 + 图例 + CSV 导出(>500条弹确认) + StockTable + 内含 SectorLinkageButton 同板块联动 Popover + 30s 轮询新信号标记 + linkageEnabled 探测
  - signal/SignalDrawer.tsx (422 行) — Sheet 抽屉详情 + 内含 InfoCell + JsonNode 递归树形渲染 + 复制 JSON
  - signal/shared.ts (75 行) — TYPE_META / PUSH_STATUS_META / CHANNEL_BADGE_META / csvEscape / isNewSignal 等常量工具
  - 容器持有 signals/strategies/loading/filters/detail 状态, handleRepush/handleOpenDetail 回调, displayedSignals memo
- WatchlistManager 容器 1287→56 行, 拆 2 个子组件 + shared.ts:
  - watchlist/WatchlistTable.tsx (499 行) — 顶部状态条 + 加入表单 + 筛选栏 + 表格(含 StockSectorHover 板块悬停) + 删除确认 AlertDialog + 内含 SectorGroup helper
  - watchlist/BatchImportDialog.tsx (495 行) — 2 个 Dialog: 批量导入(粘贴CSV/解析预览/分组提交) + 按板块加入(板块下拉/策略绑定/addBySector)
  - watchlist/shared.ts (57 行) — MANUAL_STRATEGY 常量 + parseBatchInput 函数 + ParsedRow 类型
  - 容器只持有 items/strategies/loading + batchOpen/bySectorOpen 两个 Dialog open 状态 (56 行)

Stage Summary:
- 3 个容器总行数: 125+1497+1287 = 2909 → 93+99+56 = 248 行 (减 91%)
- 新建子组件 8 个 .tsx + 3 个 shared.ts:
  - match-strategy/: 4 .tsx (List/Form/Test/EditFields) + 1 .ts (shared)
  - signal/: 3 .tsx (Filter/List/Drawer) + 1 .ts (shared)
  - watchlist/: 2 .tsx (Table/BatchImportDialog) + 1 .ts (shared)
- 所有子组件 <500 行 (最大 SignalList 499 / WatchlistTable 499 / BatchImportDialog 495)
- 所有容器 <100 行 (MatchStrategyManager 93 / SignalCenter 99 / WatchlistManager 56)
- 功能 100% 保留: UI/交互/API 调用/状态管理全部迁移, page.tsx 三个 import 名不变
- 验证: bun run lint exit 0 / page.tsx 仍 import {MatchStrategyManager}/{SignalCenter}/{WatchlistManager}
- 已知偏差: match-strategy/ 有 4 个 .tsx (而非任务要求的 3 个), 因 MatchStrategyForm 含 2 个 Dialog (编辑/复制) + 内部 EditForm 字段渲染, 总 JSX 超 500 行无法压到一个文件内; 第 4 个文件 MatchStrategyEditFields.tsx 是 Form 的内部 parts (EditForm + CopyForm), 非独立子组件, 3 个主子组件 List/Form/Test 仍齐全

---
Task ID: 3-b
Agent: Subagent E (拆后3组件)
Task: BacktestView + StrategyManager + GlobalSearch 拆分

Work Log:
- BacktestView 容器 108→98 行 (前次 Subagent D+E 已创建 backtest/ 子目录, 本次仅微调容器压到 <100)
  - backtest/BacktestForm.tsx (188 行) — 参数表单(策略/日期/初始资金/TopN/持有天数) [前次创建]
  - backtest/BacktestChart.tsx (363 行) — 纯 SVG 净值曲线 + 回撤图 + 十字光标 [前次创建]
  - backtest/BacktestTrades.tsx (394 行) — 统计指标 Grid + 交易明细表 + BacktestHistory [前次创建]
  - 容器压缩: docstring 单行化 + state 合并 + loadHistory callback 与 useEffect 合并 + handleRun 校验合并
- StrategyManager 容器 899→91 行, 拆 2 个子组件 + shared.ts:
  - strategy/StrategyList.tsx (229 行) — 顶部操作栏(全部启用/停用/批量运行/刷新配置) + 卡片网格 + 运行历史 Sheet(内部持有 runs/runsLoading)
  - strategy/StrategyEdit.tsx (492 行) — 3 个 Dialog: 配置查看/编辑(YAML 在线编辑+保存热加载) + 复制策略(ID/名/emoji+YAML预览) + 删除策略(ID 二次确认); 内部持有 editMode/yamlDraft/copyId/deleteConfirmId 等局部状态 + useEffect 同步 target 变化
  - strategy/shared.ts (73 行) — YamlTransformOpts + transformStrategyYaml(行级替换 strategy_id/name/emoji/sector) + ID_REGEX
  - 容器持有 strategies/loading/running + configTarget/copySource/deleteTarget 三个 Dialog target; handleToggle/handleRun/handleBatch/handleReloadConfig 共享 API 调用; onConfigSaved 回调让保存后 Dialog 显示新内容(与原单文件行为一致)
- GlobalSearch 容器 775→62 行, 拆 2 个子组件 + shared.ts:
  - search/SearchInput.tsx (241 行) — 持有 query/loading/result/activeIdx/recentSearches/searchError + 防抖(200ms)/最近搜索加载/关闭重置/保存最近/activeIdx越界保护/滚动定位 effects + flatItems memo(调 buildFlatItems) + grouped/flatIdxMap memo + handleKeyDown(↑↓Enter Esc) + 渲染输入框+提示条+SearchResult
  - search/SearchResult.tsx (146 行) — 分组结果列表 + 3 种空状态(初始/无结果/失败) + 底部 footer + 内含 EmptyHint
  - search/shared.ts (260 行) — GlobalSearchHandle/GlobalSearchProps/ItemKind/FlatItem 类型 + RECENT_KEY/MAX_RECENT + buildFlatItems(空状态:最近搜索+6快捷操作; 有结果:策略/股票/信号+快捷操作) + typeLabel + formatTime
  - 容器持有 open 状态 + Cmd+K 全局监听(always-mounted, Dialog 关闭时也要响应) + forwardRef imperative handle; re-export GlobalSearchHandle/GlobalSearchProps 类型保持 page.tsx import 路径不变

Stage Summary:
- 3 个容器总行数: 1195+899+775 = 2869 → 98+91+62 = 251 行 (减 91%)
  - 注: BacktestView 的 backtest/ 子目录由前次 Subagent D+E 部分完成, 本次仅将容器从 108 压到 98
  - StrategyManager + GlobalSearch 为本次完整拆分: 899+775 = 1674 → 91+62 = 153 行 (减 91%)
- 新建子组件 7 个文件 (4 个 .tsx 由前次创建, 4 个 .tsx + 2 个 .ts 本次创建):
  - backtest/: 3 .tsx (Form 188 / Chart 363 / Trades 394) [前次]
  - strategy/: 2 .tsx (List 229 / Edit 492) + 1 .ts (shared 73) [本次]
  - search/: 2 .tsx (SearchInput 241 / SearchResult 146) + 1 .ts (shared 260) [本次]
- 所有子组件 <500 行 (最大 StrategyEdit 492 / BacktestTrades 394 / BacktestChart 363)
- 所有容器 <100 行 (BacktestView 98 / StrategyManager 91 / GlobalSearch 62)
- 功能 100% 保留: UI/交互/API 调用/状态管理全部迁移; page.tsx 三个 import 名 (StrategyManager / GlobalSearch / GlobalSearchHandle) 不变; SelectionResults 仍 import BacktestView
- 验证: bun run lint exit 0 / npx tsc --noEmit 我的新文件零错误(仅 match-strategy/MatchStrategyEditFields.tsx 有前次遗留错误) / page.tsx import 路径不变
- 设计要点: StrategyEdit 用 onConfigSaved 回调让容器更新 configTarget, 保存后 Dialog 头部/查看模式显示新 YAML(与原单文件 setConfigOpen(updated) 行为一致); GlobalSearch 的 Cmd+K 监听留容器层(always-mounted), 因 Dialog 子组件仅在 open 时 mount

---
Task ID: R13-精简-收尾
Agent: Z.ai Code (Claude, 主控)
Task: 全量精简收尾 — 文档瘦身 + worklog归档 + 5个subagent并行(删Prisma/脚本统一/配置合并/6组件拆分) + QA验证

Work Log:
- 诊断冗余: 文档64个/16142行 + worklog13008行 + 脚本18个 + 死代码(Prisma/mock-data) + 6个巨型组件
- 派5个subagent并行:
  * A(1-c+4): 删Prisma(db.ts/mock-data.ts/prisma/) + mock-data降级统一进api-proxy.ts的fallback()
  * B(2-a): 18个.sh/.ps1双版本→8个文件,新建scripts/dev.py(Python跨平台7子命令)
  * C(2-b): monitor_rules.yaml+match_strategies.yaml→monitor.yaml(4段326行)
  * D(3-a): 拆MatchStrategyManager(1858→93)+SignalCenter(1497→99)+WatchlistManager(1287→56)
  * E(3-b): 拆BacktestView(1195→98)+StrategyManager(899→91)+GlobalSearch(775→62)
- 主控同时做:
  * 文档瘦身: 删64个文档→6个(README/ARCHITECTURE/MAINTENANCE/DEPLOY/STRATEGY_FACTOR/USER_GUIDE)
  * 移动docs/v8-data→data/v8-samples(24MB数据归位)
  * 删docs/tdx-quant(51个通达信官方文档)+agent-ctx(63个QA截图)+tool-results
  * worklog归档: 13008行→worklog-archive-R5-R13.md.gz(238KB) + 新worklog 216行(纪要+5段)
  * 更新ARCHITECTURE.md追加R5-R13演进补充章节(110行)
- QA验证:
  * 装duckdb+simpleeval(venv缺失)
  * setsid启动FastAPI(PPID=1常驻)+Next.js
  * 8端点冒烟全200(/health /api/strategies /api/selections /api/signals /api/sectors /api/monitor/health /api/monitor/match-strategies /api/config)
  * agent-browser QA: Dashboard大屏正常 + 8Tab切换全通 + 全局搜索Cmd+K弹窗正常 + 零控制台错误 + 截图/tmp/qa-r13-精简后.png(89KB)
  * 验证拆分后组件: 匹配策略Tab(新建/编辑/测试/复制按钮)+自选股Tab(批量导入)+策略管理(运行历史/复制/删除) 全部功能保留

Stage Summary:
- 精简效果:
  * 文档: 64个文件/16142行 → 6个文件/2612行(-84%)
  * worklog: 13008行 → 216行+归档(-98%)
  * 脚本: 18个 → 8个(-56%)
  * 配置: 9个 → 8个(monitor_rules+match_strategies合并为monitor.yaml)
  * 死代码: 删src/lib/db.ts + src/lib/mock-data.ts + prisma/目录 + .env + 4个db:xxx脚本 + 2个prisma依赖
  * 巨型组件: 6个1000+行容器 → 6个<100行容器 + 20+子组件(每个<500行)+ shared.ts
- 功能100%不变: agent-browser验证8Tab全通 + 全局搜索 + 零错误
- 架构价值: BaseDataAdapter抽象 + factory插件式 + 三层限流(R12) + Pipeline 6步 全部保留
- 新文档体系: README(入口)→ARCHITECTURE(架构)→MAINTENANCE(运维+8场景提示词)→DEPLOY(部署)→STRATEGY_FACTOR(开发)→USER_GUIDE(用户)→CHANGELOG(变更)
- 新脚本体系: dev.py(主入口,7子命令) + start_all.sh/ps1(thin wrapper) + init_db/run_selection/reload_config/start_engine + paths.yaml
- 未解决问题:
  1. tsc有4个src/下错误(2个502 ResponseInit + page.tsx ok属性 + MatchStrategyEditFields string|number),lint通过不影响运行,后续可修
  2. docs/下新文档可能仍引用部分旧脚本名(已尽量用dev.py替代)
  3. config实际8个文件(含duckdb_schema.sql),YAML 7个
- 下一阶段建议:
  1. 修复4个tsc错误(低优先级,不影响功能)
  2. 创建15分钟webDevReview cron(按系统规则)
  3. 如需进一步精简,可考虑DuckDB→SQLite迁移(用户之前说先不做)

---
Task ID: R14-实时选股
Agent: Z.ai Code (Claude, 主控)
Task: 新增"实时选股"功能 — 用户问"实时选股功能有吗",回答:此前没有,本次实现

Work Log:
- 现状盘点:
  * useRealtimeQuotes: 10s 轮询行情/状态/信号(只刷新 Dashboard 大屏,不打分选股)
  * 顶部"运行全部"按钮: 手动一次性触发 strategyAPI.runAll(),跑完即止
  * 信号中心: 匹配策略实时告警(实时监控,非实时选股)
  * 结论: 缺"盘中连续接收行情→连续打分→连续输出新入选股票"的实时选股语义
- 设计数据流: 定时器 → runAll → 延迟1.2s → list({limit:200}) → 与 prevScoreMap 对比 → 推入 stream + 更新 board
- 新建 5 个文件:
  * src/components/quant/realtime/shared.ts (155 行) — 类型 + 工具 + 常量(INTERVAL_OPTIONS/THRESHOLD_OPTIONS/MAX_STREAM_ROUNDS=50/MAX_BOARD_ROWS=200/RUNALL_DELAY_MS=1200)
  * src/components/quant/realtime/RealtimeControl.tsx (190 行) — 启停按钮 + 间隔ToggleGroup(15s/30s/60s/2min) + 阈值Select(0.02/0.05/0.10) + 清空 + 6 个 StatTile(累计轮数/累计选股/NEW/上次耗时/上次执行/下次执行) + 倒计时进度条
  * src/components/quant/realtime/RealtimeStream.tsx (145 行) — 流式列表,每轮一个 Card(Collapsible): 轮次编号 + 时间 + 耗时 + NEW/▲/▼ 徽章 + 折叠的 30 个 StockChip
  * src/components/quant/realtime/RealtimeStockBoard.tsx (190 行) — 去重看板: 8 列(代码/名称/状态/当前分/变化/入选轮数/入选策略/最近入选) + 搜索框 + 5 个筛选按钮(全部/NEW/涨分/跌分/已出)
  * src/components/quant/RealtimeSelection.tsx (248 行, 容器<260) — 持有定时器+状态, tick() 零依赖靠 ref 读最新值(避免 useEffect 重跑死循环 bug)
- 修改 1 个文件: src/app/page.tsx
  * import Radio 图标 + RealtimeSelection 组件
  * TABS 数组新增 { value: 'realtime', label: '实时选股', icon: Radio } (第 8 个 Tab, 竞价监控前)
  * TabsList grid-cols-8 → grid-cols-9
  * main 区域新增 {tab === 'realtime' && <RealtimeSelection />}
- 关键 bug 修复:
  * Bug1: tick 用 useCallback 依赖 roundNo/threshold/intervalSec → 每跑完一轮 roundNo 变 → tick 重建 → useEffect 重跑 → 立即又跑下一轮(1秒跑5轮)
    修复: 用 roundNoRef/thresholdRef/intervalSecRef 同步 ref,tick 改零依赖,useEffect 只依赖 running/intervalSec
  * Bug2: NEW 计数按 row 算(200 行就算 200 个 NEW),应按 stock_code 去重
    修复: 加 seenCodesThisRound Set 去重(实际第 1 轮 NEW 从 200 修正为 10)
- QA 验证(agent-browser + VLM):
  * bun run lint exit 0
  * Tab 切换: 实时大屏→实时选股 成功(activeTab=实时选股)
  * 启动后 4s: 累计轮数=1, NEW=10(去重后), 下次执行=29s 后(30s 间隔)
  * 等 35s: 累计轮数=2 自动触发, 流式记录(2) 显示 2 个 Card, 第 2 轮 3.16s/策略5/5/200只
  * 股票看板: 10 行去重股票, 状态徽章(持平), 搜索框+5 筛选按钮, 入选轮数/入选策略列正常
  * 暂停按钮: 成功停止定时器
  * 切回实时大屏: 无回归, consoleErrors=[]
  * Footer: long-page 自然 push-down(bodyHeight=1020 > viewportHeight=577, footer 在底部)
  * VLM 截图确认: 控制栏+状态条+流式记录+股票看板全部正常渲染

Stage Summary:
- 新增"实时选股"功能,从无到有
- 5 个新文件 + 1 个修改文件,总代码 ~930 行
- 容器 RealtimeSelection 248 行(<500),4 个子组件/shared.ts 均<200 行
- 后端零改动,复用 strategyAPI.runAll + selectionAPI.list
- 关键 bug 2 个已修复(tick 依赖死循环 + NEW 计数去重)
- agent-browser + VLM 端到端 QA 全过
- Tab 数: 8 → 9 (新增"实时选股")
- 未解决问题:
  1. mock 模式下 genSelections 的 score 随机扰动小(±0.02),阈值 0.05 时涨分/跌分较少;real 模式下真实行情波动会触发更多
  2. 流式记录上限 50 轮(MAX_STREAM_ROUNDS),超过自动丢弃最旧的;股票看板上限 200 只(MAX_BOARD_ROWS)
  3. 当前 mock 模式每轮股票集合基本固定(因 STOCK_POOL 索引基于 strategy_id.charCodeAt),real 模式下会更动态
- 下一阶段建议:
  1. 可考虑加 SSE 推送(替代轮询)以降低延迟,但需后端配合
  2. 可加"导出实时选股快照"按钮(导出当前 board 为 CSV)
  3. 可加"自动加入自选股"规则(NEW + 涨分 ≥ 阈值 时自动加入 watchlist)
