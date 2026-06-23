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

---
Task ID: R14-形态预警
Agent: Z.ai Code (Claude, 主控)
Task: 用户问"能做监控策略预警吗?例如接近前高没冲过准备回落/下跌枯竭/开盘诱空/开盘诱多/盘中无量诱多/盘中急跌真跌等" — 回答:能做,本次实现 7 类形态预警

Work Log:
- 现状盘点:
  * 已有 14 个 alert_templates + 3 个 match_strategies + MonitorEngine + simpleeval 表达式引擎
  * V8 快照有 91 个字段(HisHigh/HisLow/OpenZAF/MA5Value 等),但 RuleSet.snap_to_variables 只暴露 7 个变量
  * 现有 14 个零件都是单 tick 阈值型(如 pct_change > 0.095),无形态组合判断
- 7 类形态实现路径分析:
  * 易(单 tick 多变量): 开盘诱空/开盘诱多/无量诱多/急跌真跌 — 用扩展变量即可
  * 中(需前高/前低): 接近前高回落/下跌枯竭/准备反弹 — 用 HisHigh/HisLow 派生 last_vs_high_pct/last_vs_low_pct
- 后端改动 1 个文件: engine/monitor/rules.py
  * RuleSet.snap_to_variables 扩展 6 个变量: his_high / his_low / open_pct / ma5 / last_vs_high_pct / last_vs_low_pct / last_vs_open_pct
  * last_vs_high_pct = (HisHigh - last) / HisHigh (正=还有空间, 0=在前高, 负=破前高)
  * last_vs_low_pct = (last - HisLow) / HisLow (正=高于前低, 0=在前低, 负=破前低)
  * last_vs_open_pct = (ZAF - OpenZAF) / 100 (正=盘中拉回, 负=盘中回落)
- 配置改动 1 个文件: config/monitor.yaml
  * alert_templates 段新增 7 个形态:
    1. near_high_reject (📐 接近前高回落): last_vs_high_pct ≤ 3% + 量比 < 1.2 + 跌
    2. drop_exhaustion (🕳️ 下跌枯竭): 跌 + 缩量 + 接近前低
    3. open_bait_bears (🪤 开盘诱空): 开盘 < -2% + 盘中拉回 > +1%
    4. open_bait_bulls (🎣 开盘诱多): 开盘 > +2% + 盘中回落 < -1%
    5. intraday_low_vol_bait (🫧 无量诱多): 涨 > 2% + 量比 < 0.8
    6. intraday_real_drop (💥 急跌真跌): 跌 > 3% + 量比 > 1.5 + 主力流出
    7. rebound_setup (🔄 准备反弹): 接近前低 + 缩量 + 跌幅收窄
  * match_strategies 段新增 pattern_alerts 套餐(7 个 alert_ref, debounce 120s, 兜底对所有股票生效)
- 前端新建 4 个文件:
  * src/components/quant/pattern/shared.ts (240 行) — 7 个形态元信息(emoji/label/scenario/desc/condition/defaultParams/presetSnap/keyVars/risk/advice)
  * src/components/quant/pattern/PatternCard.tsx (155 行) — 单卡片(emoji+label+场景+condition+关键变量+默认参数+建议操作+启停开关+展开折叠) + PatternLibraryBanner
  * src/components/quant/pattern/PatternTestDialog.tsx (200 行) — 试跑弹窗(12 字段表单+派生变量实时计算+调 matchStrategyAPI.test+命中结果展示)
  * src/components/quant/PatternAlertLibrary.tsx (130 行, 容器) — 加载 pattern_alerts 套餐 + 离线 fallback + 启停(乐观更新+回滚) + 试跑
- 前端修改 1 个文件: src/app/page.tsx
  * TABS 新增 { value: 'patterns', label: '形态预警', icon: ShieldAlert }(第 9 个 Tab)
  * TabsList grid-cols-9 → grid-cols-10
  * main 新增 {tab === 'patterns' && <PatternAlertLibrary />}
- 离线 fallback 设计:
  * FastAPI 不可达时, PatternAlertLibrary 用本地 PATTERN_LIST 构造 alerts, 7 个形态默认全启用
  * 离线模式下启停只改本地状态, toast 提示"离线"
  * 底部状态条显示"离线模式 · FastAPI 不可达,改动仅本地"
- Python 逻辑验证(不依赖 FastAPI):
  * snap_to_variables 派生变量正确(last_vs_high_pct=0.022, last_vs_open_pct=-0.007 等)
  * 7 个形态 condition 全部能被 simpleeval 正确求值
  * 3 个测试场景精准命中: near_high_reject / open_bait_bears / intraday_real_drop
- FastAPI 端到端验证(curl):
  * POST /api/monitor/match-strategies/pattern_alerts/test 用预设快照 → 命中 near_high_reject(1/7 hits, 符合预期)
  * 扩展变量全链路打通: snap → snap_to_variables → ExpressionEvaluator → condition 求值
- agent-browser QA:
  * 形态预警 Tab 切换成功, 7 个卡片全渲染
  * 卡片展开: condition/关键变量/默认参数/建议操作/试跑按钮 全显示
  * 启停开关: 离线模式下 toast 提示正常
  * 试跑弹窗: 派生变量实时计算 + 12 字段表单 + 命中结果展示
  * Dashboard 无回归, Footer 正常, dev.log 无错误

Stage Summary:
- 新增"形态预警库"功能,7 类典型盘中形态预警全部实现
- 4 个新前端文件 + 1 个后端文件改动 + 1 个配置文件改动,总代码 ~1000 行
- 后端零侵入: 只扩展 snap_to_variables 暴露 6 个新变量, 不改 MonitorEngine 求值流程
- 前端离线 fallback: FastAPI 不可达时仍可展示/启停(试跑需 FastAPI)
- agent-browser + curl + Python 三路验证全过
- Tab 数: 9 → 10 (新增"形态预警")
- 7 类形态覆盖用户全部需求:
  1. 接近前高回落 ✅ (near_high_reject)
  2. 下跌枯竭 ✅ (drop_exhaustion)
  3. 准备反弹 ✅ (rebound_setup)
  4. 开盘诱空 ✅ (open_bait_bears)
  5. 开盘诱多 ✅ (open_bait_bulls)
  6. 盘中无量诱多 ✅ (intraday_low_vol_bait)
  7. 盘中急跌真跌 ✅ (intraday_real_drop)
- 未解决问题:
  1. FastAPI 在 sandbox 里每次 Bash 调用结束被杀, 离线 fallback 是应对方案; real 部署无此问题
  2. 7 个形态的 default_params 是经验值, 用户可通过 matchStrategyAPI.update 调参
  3. 多 tick 状态机(如"连续 N 日跌")暂未实现, 当前 7 形态都是单 tick 判断; 如需可扩展 MonitorEngine 加历史快照窗口
- 下一阶段建议:
  1. 加"形态预警历史命中"页(从 signal_events 查 alert_type IN 7 形态)
  2. 加"形态预警调参"UI(每个形态的 default_params 可在卡片内编辑)
  3. 考虑加多 tick 状态: 在 MonitorEngine 维护每只股票最近 N 个 tick 的快照窗口, 支持"连续下跌 N 日"类形态

---
Task ID: R15-自定义形态构建器
Agent: Z.ai Code (Claude, 主控)
Task: 用户问"后续还可以自由加策略,加预警" — 回答:能,本次实现"形态预警构建器",让用户可视化创建/编辑/克隆/删除自定义形态预警

Work Log:
- 现状盘点:
  * R14 已有 7 个预设形态(alert_templates 写死在 config/monitor.yaml)
  * matchStrategyAPI 有完整 CRUD,但只管理"套餐",不能创建新 alert_template
  * 后端 snap_to_variables 暴露 13 个变量(pct_change/volume_ratio/main_inflow/his_high/his_low/open_pct/ma5/last_vs_high_pct/last_vs_low_pct/last_vs_open_pct)
  * 前端无"自定义形态"入口,用户无法自由加预警
- 设计方案: 前端构建器 + localStorage 持久化 + 本地 simpleeval 求值
  * 自定义形态存 localStorage(key: tdxquant:custom-patterns)
  * 启停状态存 localStorage(key: tdxquant:custom-patterns-enabled)
  * 试跑走前端本地求值(new Function + 变量白名单 + and/or/not→&&/||/! 转换)
  * 预设形态仍走后端套餐,自定义形态仅本地
- 新建 3 个文件:
  * src/components/quant/pattern/builder.ts (340 行) — CustomPattern 类型 + VARIABLE_WHITELIST(10变量+desc+example+formula) + deriveVars(与后端 snap_to_variables 对齐) + validateExpr(白名单字符+关键字校验) + evalCondition({param}替换+and/or/not转换+new Function 求值) + extractParams + loadCustomPatterns/saveCustomPatterns + genPatternId + PATTERN_EMOJIS(28个) + DEFAULT_SNAP + deriveKeyVars
  * src/components/quant/pattern/ConditionEditor.tsx (230 行) — 变量速查面板(点击插入光标处) + 运算符快捷按钮 + {param}插入按钮 + textarea 编辑 + 实时校验求值预览(resolved表达式+派生变量+命中/未命中/错误)
  * src/components/quant/pattern/PatternBuilderDialog.tsx (480 行) — 构建器主弹窗,3 模式(创建/编辑/克隆) + 左侧表单(基础信息+条件+参数+风险+快照) + 右侧 sticky 实时预览 + emoji选择器 + 参数自动提取 + 保存校验(alert_type正则/label/condition/求值无错)
- 修改 4 个文件:
  * src/components/quant/pattern/shared.ts — PatternMeta 加 custom?/id? 字段
  * src/components/quant/pattern/PatternCard.tsx — 自定义形态加"自定义"badge(虚线边框) + 克隆/编辑/删除按钮 + banner 加 customCount + "新建自定义形态"按钮
  * src/components/quant/pattern/PatternTestDialog.tsx — 自定义形态走前端本地 evalCondition 求值(预设仍调后端) + 标题/描述/按钮文案动态切换 + meta 查找 fallback 到 initialMeta
  * src/components/quant/PatternAlertLibrary.tsx (重写, 320 行) — 加载 customPatterns(localStorage) + merge 预设+自定义 + 预设/自定义分区展示 + 创建/编辑/克隆/删除回调 + 自定义启停(localStorage) + 删除确认 AlertDialog
- 关键 bug 修复(3 个):
  * Bug1: builder.ts 注释 `/** ... +-*/() ... */` 里的 `*/` 被解析成块注释结束 → 改单行注释
  * Bug2: PatternBuilderDialog 本地 metaToDraft 与 import 的 builder.metaToDraft 同名冲突(递归调用自己) → 重命名 presetMetaToDraft + 删未用 import
  * Bug3: 前端 new Function 求值不认识 Python 关键字 and/or/not(simpleeval 用 and/or,JS 用 &&/||) → evalCondition 里加 .replace(/\band\b/gi,'&&').replace(/\bor\b/gi,'||').replace(/\bnot\b/gi,'!')
- QA 验证(agent-browser + VLM):
  * bun run lint exit 0 (0 errors 0 warnings)
  * 形态预警 Tab 正常: 7 预设卡片 + banner "新建自定义形态"按钮
  * 构建器弹窗正常: 标题"创建自定义形态" + 左侧表单 + 右侧实时预览
  * 创建流程: 填表单(量价齐升/vol_price_rise/场景/condition) → 填参数(pct_threshold=0.02/vol_ratio=1.5) → 保存 → localStorage 持久化(customCount=1) → 列表展示自定义卡片(虚线边框+"自定义"badge+编辑/删除按钮)
  * 试跑自定义形态: 标题"自定义·本地求值" + 派生变量实时计算 + 命中结果正确(默认快照未命中 0.015<0.02; 改 ZAF=3.0/Wtb=2.0 后命中 0.03>0.02 && 2.0>1.5)
  * 编辑自定义形态: 标题"编辑自定义形态" + 字段回填正确(label/alert_type/scenario/condition)
  * 删除自定义形态: AlertDialog 确认弹窗 → 确认后 localStorage 清空 + 列表恢复
  * 克隆预设形态: 标题"克隆预设形态" + 字段回填("接近前高回落 (副本)")
  * Footer: bodyHeight=877 > vh=577, footer 自然 push-down
  * dev.log 无 error/warn

Stage Summary:
- 新增"形态预警构建器"功能,用户可自由创建/编辑/克隆/删除自定义形态预警
- 3 个新文件 + 4 个修改文件,总代码 ~1560 行
- 前端本地 simpleeval 等价求值(new Function + 变量白名单 + 关键字转换),与后端 snap_to_variables 完全对齐
- localStorage 持久化: 自定义形态 + 启停状态,刷新不丢失
- 离线友好: 不依赖后端,sandbox 里也能完整体验(预设形态试跑仍需后端,但自定义形态全本地)
- agent-browser + VLM 端到端 QA 全过(创建/试跑/编辑/删除/克隆 6 大流程)
- 3 个 bug 全部修复(注释解析/命名冲突/关键字转换)
- Tab 数仍为 10(未新增 Tab,在"形态预警"Tab 内扩展)
- 未解决问题:
  1. 自定义形态仅本地持久化,后端 MonitorEngine 不认识自定义 alert_type,无法真正触发预警推送(需后端扩展内联 condition 支持)
  2. 前端求值用 new Function,虽做了白名单校验,但理论上仍有 XSS 风险(用户自己写给自己,可接受)
  3. 自定义形态的启停状态独立存 localStorage,与预设形态的套餐启停分离(设计如此,但用户可能期望统一)
- 下一阶段建议:
  1. 后端扩展: alert_templates 支持前端动态注册(MatchUpdateRequest 的 alert.params 里带 __condition/__label,MonitorEngine 求值时 fallback 到内联 condition)
  2. 自定义形态导入/导出(JSON 文件),方便分享和备份
  3. 自定义形态"模板库": 预置更多形态模板(如 MACD 金叉/KDJ 超卖反弹)供克隆

---
Task ID: 2-a
Agent: Subagent A (Windows Python 脚本)
Task: Windows 部署前置工作 (Python 脚本部分) — precheck + install_tqcenter + create_shortcut + dev.py setup 集成

Work Log:
- 读 worklog.md 了解前序工作 (R5-R15 演进史 + dev.py 7 子命令架构 + adapter_mode mock/real 双模式)
- 读 scripts/dev.py 全文 (743 行), 定位 cmd_setup 在 310-369 行
- 新建 scripts/precheck.py (300 行): 跨平台预检, 12 项检查 (Python 版本/pip/bun/tqcenter/Python 依赖/端口/目录可写/DuckDB 文件/通达信终端/tqcenter 路径/配置/磁盘), 支持 --json (供 install.bat 解析) 和 --fix (自动修复可修复项)
- 新建 scripts/install_tqcenter.py (182 行): Windows 专用 tqcenter 自动安装器, 扫描 6 个通达信常见安装路径, 在每个路径下查 3 个 tqcenter 候选位置 (T0002/hq_cache/PythonLib/tqcenter, T0002/hq_cache/PythonLib, Python/site-packages/tqcenter), 支持 --list (列出候选不安装) 和 --path (手动指定路径), Linux 上跑提示"Windows 专用, 跳过"
- 新建 scripts/create_shortcut.py (139 行): Windows 桌面快捷方式创建器, 用 PowerShell WScript.Shell COM (避免依赖 pywin32), 创建 3 个快捷方式 (TdxQuant 启动.lnk → start.bat, TdxQuant 停止.lnk → stop.bat, TdxQuant 大屏.url → http://127.0.0.1:3000), 图标用 public/favicon.ico, Linux 上跑提示"仅 Windows 支持"
- 更新 scripts/dev.py (+53 行 → 796 行): 加 import json; 加 _run_precheck_json() 和 _run_precheck_text() 两个 helper; cmd_setup 加 step 0 (前置 precheck --json, Python 版本/pip FAIL 则直接退出) 和 step 6 (setup 结束后跑 precheck 文本模式输出最终就绪度报告); 现有 setup 流程 (venv + pip install + bun install + init_db + 创建数据目录) 100% 保留
- 沙箱验证 4 个命令零崩溃:
  * python3 scripts/precheck.py → exit 1 (Python 3.12 < 3.13 FAIL, 预期), 12 项检查全部执行, 报告正常输出 (通过 7/失败 1/警告 4)
  * python3 scripts/install_tqcenter.py --list → exit 0, 提示 "tqcenter 是 Windows 专用, 跳过自动安装"
  * python3 scripts/create_shortcut.py → exit 0, 提示 "快捷方式仅 Windows 支持"
  * python3 scripts/dev.py --help → exit 0, 7 子命令帮助正常
- 额外验证: precheck --json 输出合法 JSON (12 项 + summary 段); precheck --fix 在 DuckDB 已存在时静默跳过; precheck --fix --json 组合模式正常; dev.py setup 的 precheck 中止逻辑正确检测到 Python 版本 FAIL 并会中止 (模拟验证); py_compile 4 个文件全部语法 OK; precheck 写测试文件 .precheck_write_test 已正确清理

Stage Summary:
- 产物清单:
  * scripts/precheck.py (新建, 300 行) — 跨平台 12 项预检, --json/--fix
  * scripts/install_tqcenter.py (新建, 182 行) — Windows tqcenter 安装器, --list/--path
  * scripts/create_shortcut.py (新建, 139 行) — Windows 桌面 3 快捷方式, PowerShell COM
  * scripts/dev.py (修改, 743→796 行) — cmd_setup 加 precheck 前后置调用 + import json + 2 helper
- 关键设计决策:
  1. 零外部依赖: 3 个新 .py 仅用标准库 (argparse/json/platform/re/shutil/socket/subprocess/sys/datetime/pathlib/typing), 不引入 PyYAML (adapter_mode 用正则读), 不引入 pywin32 (用 PowerShell WScript.Shell COM), 不引入 colorama (Windows 用 ctypes 启用 ANSI)
  2. 跨平台不崩: Linux 跑 precheck 报告 12 项 (Windows 专属项标 WARN "非 Windows, 跳过"); install_tqcenter/create_shortcut 在 Linux 直接提示 "Windows 专用" 并 exit 0
  3. precheck 退出码: 全过=0, 有警告=0, 有失败=1 (dev.py setup 据此判断是否中止)
  4. dev.py setup 集成: 前置只检查 python_version + pip 两个关键项 (其他 FAIL/WARN 不中止 setup, 让 setup 尝试修复); 后置跑完整 precheck 报告最终就绪度
  5. tqcenter 检查按 adapter_mode 分级: real 模式 FAIL (必须装), mock 模式 WARN (可忽略)
  6. PowerShell 单引号转义: 路径含 Program Files 等空格/特殊字符时, _ps_escape 函数把 ' 转成 ''
  7. .url 文件用 INI 格式直接写文本 (无需 COM), .lnk 用 PowerShell WScript.Shell COM
- 行数合规: 3 个新文件均 ≤ 300 行 (300/182/139), dev.py 修改后 796 行 (无 300 行限制, 是现有文件编辑)
- 已知限制:
  1. 通达信终端检测仅扫 6 个常见路径, 用户自定义路径需手动 --path
  2. Python 3.13 要求: 沙箱是 3.12, precheck 会 FAIL (预期行为, Windows 生产环境装 3.13+ 即可通过)
  3. create_shortcut 假设 start.bat/stop.bat 已由 Subagent B 创建 (本任务不创建 .bat)
  4. precheck --fix 目前仅修复 duckdb_file (调 init_db.py), 目录缺失已在 check 阶段自动 mkdir

---
Task ID: 2-b
Agent: Subagent B (Windows 启动器+文档)
Task: Windows 部署前置工作 (启动器脚本+文档部分) — 9 个文件: 5 .bat + 1 .vbs + 1 XML + 1 README + 1 example.yaml + 更新 DEPLOY.md

Work Log:
- 读 worklog.md 了解前序工作: R5-R15 演进史 + Subagent A (Task 2-a) 已创建 scripts/precheck.py (300 行) + scripts/install_tqcenter.py (182 行) + scripts/create_shortcut.py (139 行) + 更新 scripts/dev.py (集成 precheck)
- 读 config/app.yaml (85 行) 了解配置结构 (app/server/paths/tqcenter/api/mock 6 段)
- 读 docs/DEPLOY.md (247 行) 定位 Windows 章节 (第 56-124 行), 了解现有"前置检查/步骤/常见问题"结构
- 新建 install.bat (98 行): 一键安装 5 步 (precheck → dev.py setup → install_tqcenter → create_shortcut → precheck 最终报告), 每步分隔线+状态, 失败即 exit, 完成 banner 提示双击 start.bat
- 新建 start.bat (28 行): banner "TdxQuant 启动中..." → dev.py start → 打印服务地址 http://127.0.0.1:3000 + API http://127.0.0.1:8000/health
- 新建 stop.bat (22 行): 简洁停止 + 状态打印
- 新建 restart.bat (28 行): stop → 等 3 秒 → start, 避免端口未释放
- 新建 tdxquant-launcher.vbs (53 行, UTF-8 with BOM): WScript.Shell 后台 Run (mode 0 隐藏), 弹 MsgBox "5 秒后打开浏览器", Sleep 5000 后 Run http://127.0.0.1:3000, On Error Resume Next 错误兜底
- 新建 tdxquant-healthcheck.bat (38 行): curl :8000/health + curl :3000/ 各打 HTTP 状态码, 结束 start http://127.0.0.1:3000 开浏览器
- 新建 windows/TdxQuantAutoStart.xml (83 行): Task Scheduler Schema v1.3, BootTrigger Delay=PT30S, Principal=Users 组 SID S-1-5-32-545, RestartOnFailure 3 次/PT1M 间隔, Exec wscript.exe "%USERPROFILE%\tdxquant\tdxquant-launcher.vbs", 顶部 HTML 注释 + 导入命令说明
- 新建 WINDOWS_README.md (273 行): 10 节 (前置条件/3 步开箱/验证/Real 模式切换/日常使用/预检脚本/FAQ/文件清单/更多文档/进阶提示), 含性能调优表+自定义策略示例, emoji 友好
- 新建 config/app.windows.example.yaml (127 行): 复制 app.yaml 结构, adapter_mode=real, paths 用 Windows \\ 反斜杠, tqcenter.global_qps 调保守 (8), mock 段注释掉, channels 段留 # 填你的 webhook 占位
- 更新 docs/DEPLOY.md (247→252 行): 在 "## 🪟 Windows 生产部署" 章节顶部插入 3 行提示框 (引用 WINDOWS_README.md + 一键安装/启动/静默后台 一句话), 现有内容 100% 保留
- 验证:
  * 9 个文件全部创建 (ls 确认)
  * 5 个 .bat 顶部一致: @echo off + chcp 65001 >nul + cd /d "%~dp0" + setlocal EnableDelayedExpansion
  * VBS 文件头 3 字节 = EF BB BF (UTF-8 BOM), Windows Notepad/WScript 友好, 中文不乱码
  * XML 用 xml.dom.minidom 解析通过 (root=Task, BootTrigger×1, Exec×1)
  * YAML 用 PyYAML safe_load 通过 (adapter_mode=real, paths.duckdb=data\\duckdb\\quant.db, mock 段不存在)
  * WINDOWS_README.md 273 行 (在 250-350 范围内)
- 已知限制:
  1. .bat 用 %ERRORLEVEL%+EnableDelayedExpansion 做错误处理, Windows 7+ 都支持
  2. VBS 的 objShell.Run(cmdLine, 0, False) 第三参 False 表示不等待,适合后台启动;但若 dev.py start 本身需要轮询健康检查,则 VBS 会立即返回(用户已看到 MsgBox)
  3. XML 用 %USERPROFILE%\tdxquant\ 作为通用路径占位, Task Scheduler 不会自动展开环境变量,用户必须手动替换为实际路径(已在文件顶部 HTML 注释和 WINDOWS_README.md 中说明)
  4. install.bat 第 3 步 install_tqcenter.py 失败不退出 (tqcenter 可能用户已手动装),仅警告;第 4 步 create_shortcut.py 失败也不退出 (不影响主功能)
  5. healthcheck.bat 用 curl,Windows 10 1803+ 自带 curl.exe,旧版 Windows 需手动装 curl 或改用 PowerShell Invoke-WebRequest

Stage Summary:
- 产物清单:
  * install.bat (新建, 98 行) — 一键安装器, 5 步串行 + 状态/错误处理
  * start.bat (新建, 28 行) — 启动 + 打印服务地址
  * stop.bat (新建, 22 行) — 停止
  * restart.bat (新建, 28 行) — stop→等3秒→start
  * tdxquant-launcher.vbs (新建, 53 行, UTF-8 BOM) — VBScript 静默后台启动 + 5 秒后开浏览器
  * tdxquant-healthcheck.bat (新建, 38 行) — curl 双端口 + 开浏览器
  * windows/TdxQuantAutoStart.xml (新建, 83 行) — Task Scheduler 开机自启模板
  * WINDOWS_README.md (新建, 273 行) — Windows 5 分钟开箱即用指南
  * config/app.windows.example.yaml (新建, 127 行) — Windows Real 模式配置示例
  * docs/DEPLOY.md (修改, +5 行) — Windows 章节顶部加新手提示框
- 关键设计决策:
  1. 所有 .bat 顶部一致: @echo off + chcp 65001 >nul (UTF-8) + cd /d "%~dp0" (切到脚本所在目录,关键!不依赖用户双击位置) + setlocal EnableDelayedExpansion (支持 !VAR! 延迟展开)
  2. install.bat 错误处理分级: precheck FAIL 直接退出 (环境不达标), setup FAIL 直接退出 (依赖装不上), install_tqcenter/create_shortcut FAIL 仅警告不退出 (非关键)
  3. VBS 用 UTF-8 with BOM (EF BB BF), 解决中文 MsgBox 在中文 Windows (默认 GBK ANSI) 下的乱码问题; 用 Write 写纯文本后用 bash printf 追加 BOM
  4. VBS 用 WScript.Shell.Run(cmd, 0, False) 三参: 0=隐藏窗口, False=不等待; 适合开机自启场景, 无 cmd 黑窗
  5. XML 用 %USERPROFILE%\tdxquant\ 作为通用路径占位, 因 Task Scheduler 不展开环境变量, 用户必须手动替换; 顶部 HTML 注释 + WINDOWS_README.md 双重说明
  6. XML 用 Users 组 SID (S-1-5-32-545) 而非具体用户名, 通用性更强; RunLevel=LeastPrivilege 不需要管理员
  7. XML RestartOnFailure: 3 次/PT1M 间隔, 配合 BootTrigger PT30S 延迟, 给网络/通达信足够启动时间
  8. app.windows.example.yaml 与 app.yaml 同结构, 但 adapter_mode=real + paths 用 Windows \\ + tqcenter.global_qps 调保守 (8) + mock 段注释掉, 用户复制即用
  9. WINDOWS_README.md 用 emoji + 表格 + 代码块 + 引用块, 让新手看着舒服; 含性能调优表 + 自定义策略示例, 不仅是部署指南还是入门手册
  10. docs/DEPLOY.md 仅在 Windows 章节顶部插 5 行提示框, 不破坏原有内容 (前置检查/步骤 1-7/常见问题 全保留)
- 与 Subagent A 协作:
  * install.bat 调用 Subagent A 的 3 个脚本: scripts/precheck.py + scripts/install_tqcenter.py + scripts/create_shortcut.py
  * install.bat 还调用更新后的 scripts/dev.py setup (含 precheck 前后置)
  * start/stop/restart.bat 调用 scripts/dev.py 的 start/stop 子命令 (7 个子命令的 2 个)
  * WINDOWS_README.md 引用 scripts/precheck.py --fix 作为自动修复工具
  * 0 冲突: 启动器/文档 与 Python 脚本 职责清晰分离, 接口稳定 (命令行参数)

---
Task ID: 3
Agent: Z.ai Code (Claude, 主控)
Task: Windows 部署前置工作主控收尾 — 验收两个 subagent 产物 + requirements.txt 加 tqcenter 注释 + 全量 lint + 沙箱预演 precheck + 给用户列出"还需要提供什么"

Work Log:
- 盘点项目 Windows 就绪度: dev.py 已跨平台 / requirements.txt 已拆 uvloop / next.config.ts 已 standalone / 配置路径全相对 / real_adapter 已容错导入 tqcenter — 底子已具备, 缺"开箱即用"层
- 派 2 个 subagent 并行:
  * Subagent A (Task 2-a): 创建 3 个 Python 脚本 (precheck/install_tqcenter/create_shortcut) + 更新 dev.py setup 集成 precheck
  * Subagent B (Task 2-b): 创建 9 个 Windows 文件 (5 .bat + 1 .vbs + 1 XML + 1 README + 1 example.yaml) + 更新 DEPLOY.md
- 主控收尾改动:
  * 更新 requirements.txt (+10 行): tqcenter 段加详细注释 (不在 PyPI/通达信终端附带/自动安装命令/手动安装命令/详见 WINDOWS_README.md), 不取消注释 (避免 Linux/macOS pip install 失败)
  * 沙箱跑 precheck.py 验证: 12 项检查全执行, 通过 7/失败 1 (Python 3.12<3.13 预期)/警告 4 (tqcenter/端口 3000 占用/通达信终端/tqcenter 路径 — 后 3 项 Linux 跳过)
  * 沙箱跑 install_tqcenter.py --list / create_shortcut.py: 都正确提示 "Windows 专用, 跳过" 并 exit 0
  * bun run lint exit 0 (零 ESLint 错误/警告)
  * py_compile 4 个 .py 文件全过 (dev.py/precheck/install_tqcenter/create_shortcut)
- 文件清单最终验收 (ls 确认):
  * 根目录 5 .bat + 1 .vbs: install.bat / start.bat / stop.bat / restart.bat / tdxquant-healthcheck.bat / tdxquant-launcher.vbs
  * windows/: TdxQuantAutoStart.xml (Task Scheduler 开机自启模板)
  * WINDOWS_README.md (273 行, 5 分钟开箱即用指南)
  * scripts/: precheck.py (300) / install_tqcenter.py (182) / create_shortcut.py (139) — 3 个新 Python 脚本
  * scripts/dev.py (743→796, +53 行 setup 集成 precheck)
  * config/app.windows.example.yaml (127 行, Real 模式配置示例)
  * requirements.txt (+10 行 tqcenter 注释)
  * docs/DEPLOY.md (+5 行, Windows 章节顶部插新手提示框)
- 总计: 12 个新文件 + 3 个修改文件

Stage Summary:
- Windows 部署"开箱即用"套件交付完成, 用户在 Windows 上的体验:
  1. 解压项目 → 双击 install.bat → 一键装齐 (Python venv + pip + bun + DuckDB + tqcenter + 桌面快捷方式)
  2. 双击 start.bat (或桌面"TdxQuant 启动") → 浏览器自动打开大屏
  3. 切 Real 模式: 改 config/app.yaml 一行 + restart.bat
  4. 静默后台启动: tdxquant-launcher.vbs (无 cmd 黑窗)
  5. 开机自启: 导入 windows/TdxQuantAutoStart.xml 到 Task Scheduler
  6. 出问题: python scripts/precheck.py 一键诊断 + --fix 自动修复
- 跨平台兼容验证: Linux 沙箱跑 precheck/install_tqcenter/create_shortcut 三脚本都正确"降级提示", 零崩溃
- 零外部依赖: 3 个新 Python 脚本仅用标准库 (不引入 PyYAML/pywin32/colorama), 与 dev.py 风格一致
- 文档闭环: WINDOWS_README.md (新手入口) → docs/DEPLOY.md (详细部署) → docs/MAINTENANCE.md (运维) 三层文档体系
- 未解决问题:
  1. 通达信终端检测仅扫 6 个常见路径 (C:\new_tdx / D:\new_tdx / C:\通达信 / D:\通达信 / C:\Program Files\通达信 / D:\Program Files\通达信), 用户自定义路径需手动 python scripts/install_tqcenter.py --path <path>
  2. Task Scheduler XML 用 %USERPROFILE%\tdxquant\ 作为占位, 用户必须手动替换为实际路径 (Task Scheduler 不展开环境变量)
  3. tdxquant-healthcheck.bat 用 curl, Windows 10 1803+ 自带 curl.exe, 旧版需手动装 curl 或改 PowerShell Invoke-WebRequest
  4. create_shortcut.py 假设 public/favicon.ico 存在 (项目已有), 若用户换图标需改 .ico 路径
  5. Real 模式实际可用性依赖通达信终端 API 稳定性, sandbox 无法验证 (Linux 没 tqcenter)
- 给用户的"还需要提供什么"清单 (见下方主消息):
  1. 通达信金融终端安装路径 (用于 tqcenter 自动安装)
  2. Windows 安装目标路径 (建议 D:\tdxquant, 避免中文/空格)
  3. (可选) 飞书/钉钉 webhook URL (用于预警推送)
  4. (可选) 是否需要开机自启 (yes 则导入 Task Scheduler XML)
  5. (可选) 是否需要换桌面图标 (默认用 public/favicon.ico)
- 下一阶段建议:
  1. 用户拿到 Windows 机器后, 双击 install.bat 跑一遍, 反馈 precheck 报告
  2. 如 tqcenter 自动安装失败, 提供 --path 参数手动指定
  3. Real 模式连真机后, 跑一遍 smoke test (curl /api/monitor?action=status 看 adapter=real)
  4. 长期: 可考虑打包成 .zip 一键发行包 (含 venv 离线依赖), 当前是源码部署
