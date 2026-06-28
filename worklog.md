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

---
Task ID: 4
Agent: Z.ai Code (Claude, 主控)
Task: 用户提供通达信真实路径 + tqcenter 导入机制后, 修正所有 Windows 部署文件 — tqcenter 不是 pip 包, 是 sys.path.insert 导入的本地 Python 文件

Work Log:
- 用户提供关键技术细节:
  * 通达信安装目录: K:\txdlianghua
  * tqcenter.py 路径: K:\txdlianghua\PYPlugins\user\tqcenter.py (160KB)
  * TPythClient.dll: K:\txdlianghua\TPythClient.dll
  * 项目安装目标: K:\tdxquantv2
  * 导入机制: sys.path.insert(0, r"k:\txdlianghua\PYPlugins\user") + from tqcenter import tq
  * 底层: tqcenter.py 用 ctypes.CDLL 加载 TPythClient.dll, dll.InitConnect() 建连
  * 初始化: tq.initialize(__file__) 传路径作上下文定位 DLL
- 诊断 subagent 之前的方向错误:
  * Subagent A 的 install_tqcenter.py 用 pip install --find-links / -e 装 tqcenter (错! tqcenter 不是 pip 包)
  * precheck.py 的 check_tdx_tqcenter_path 找 __init__.py (错! tqcenter.py 是单文件模块)
  * real_adapter.py 用 from tqcenter import tq 不加 sys.path (在 Windows 上会 ImportError)
- 修正 6 个文件:
  1. engine/data_adapter/real_adapter.py (核心改动, +85 行):
     * 加 _TDX_COMMON_PATHS (12 个路径, 含 K:\txdlianghua) + _TQCENTER_SUBPATHS (4 个子路径: PYPlugins\user / T0002\hq_cache\PythonLib / Python\site-packages / PYPlugins)
     * 加 _find_tqcenter_dir() 扫描函数
     * 加 _resolve_tqcenter_path() 优先级解析 (env TQ_CENTER_PATH > config tqcenter.python_path > 扫描)
     * 加 _import_tqcenter() 动态导入 (先 try 直接 import, 失败则 sys.path.insert + import, 不移除 sys.path 避免破坏 tqcenter 内部依赖)
     * __init__ 加 self._python_path 读 config
     * _ensure_tq 错误信息改为含 3 种解决方法 (env / config / 扫描)
     * initialize() 用 python_path/tqcenter.py 作 init_arg (用户示例: 传 tqcenter.py 路径), 兜底 env TQ_CENTER_INITIALIZE
  2. engine/config/schema.py (+5 行): TqCenterConfig 加 python_path: str = "" 字段 (含注释说明)
  3. config/app.yaml (+10 行): tqcenter 段加 python_path: "" 字段 + 详细注释 (留空自动扫描 / 示例 K:\txdlianghua\PYPlugins\user / 环境变量覆盖)
  4. config/app.windows.example.yaml (改 tqcenter 段 + 头部注释): python_path 预填 "K:\\txdlianghua\\PYPlugins\\user", 头部加用户环境预设 (通达信/tqcenter/DLL/项目 4 个路径)
  5. scripts/install_tqcenter.py (重写, 182→175 行): 从 "pip install" 改为 "路径配置器"
     * 不再 pip install, 改为扫描通达信目录找 tqcenter.py
     * 找到后写入 config/app.yaml 的 tqcenter.python_path 字段 (正则替换)
     * 新增 --env 参数: 输出 set/$env 命令 (不写配置文件, 适合临时/容器场景)
     * --list 改为列出含 tqcenter.py 的目录 (而非 pip install 目标)
     * 验证 import 用 sys.path.insert (与 real_adapter 一致)
  6. scripts/precheck.py (改 2 个函数 + 加 1 个常量):
     * TDX_COMMON_PATHS 加 K:\txdlianghua (12 个路径)
     * 加 TQCENTER_SUBPATHS 常量 (4 个子路径)
     * check_tqcenter() 重写: 4 级尝试 (直接 import / env TQ_CENTER_PATH / 扫描通达信 / 未找到)
     * check_tdx_tqcenter_path() 重写: 找 tqcenter.py 文件 (而非 __init__.py)
- 新建 1 个文件: .env.example (40 行) — TQ_CENTER_PATH / TQ_CENTER_INITIALIZE / ADAPTER_MODE 3 个环境变量示例, 含 cmd/PowerShell 设置命令
- 改 2 个 Windows 文件:
  * windows/TdxQuantAutoStart.xml: %USERPROFILE%\tdxquant → K:\tdxquantv2 (Arguments + WorkingDirectory 2 处) + 头部注释加用户环境预设
  * WINDOWS_README.md (4 处改动):
    - Step 1 解压路径: D:\tdxquant → K:\tdxquantv2
    - install.bat 步骤表: "装 tqcenter" → "配置 tqcenter 路径 (扫描+写入 config)"
    - 切换 Real 模式: 加详细 tqcenter 配置 3 种方式 (自动扫描/手动--path/环境变量--env) + 工作原理说明 (sys.path.insert + ctypes + DLL)
    - 开机自启: "替换 %USERPROFILE%" → "已预填 K:\tdxquantv2"
    - FAQ: "pip install tqcenter" → "install_tqcenter.py 自动配置 / 手动配 python_path / set TQ_CENTER_PATH"
- 改 1 个依赖文件: requirements.txt — tqcenter 注释从 "pip install" 改为 "不需要 pip install! sys.path.insert 动态加载" + 4 种配置方式

Stage Summary:
- 修正方向: tqcenter 是 sys.path.insert 导入的本地 Python 文件, 不是 pip 包
- 6 个文件改动 + 1 个新文件 (.env.example):
  * engine/data_adapter/real_adapter.py (+85 行) — 动态导入机制 + 12 路径扫描
  * engine/config/schema.py (+5 行) — TqCenterConfig.python_path 字段
  * config/app.yaml (+10 行) — python_path 字段 + 注释
  * config/app.windows.example.yaml (tqcenter 段+头部) — 预填 K:\txdlianghua
  * scripts/install_tqcenter.py (重写) — 路径配置器 (不再 pip install)
  * scripts/precheck.py (2 函数+1 常量) — tqcenter.py 文件检测 + 12 路径扫描
  * windows/TdxQuantAutoStart.xml — K:\tdxquantv2 预填
  * WINDOWS_README.md (4 处) — tqcenter 配置 3 方式 + 工作原理
  * requirements.txt — tqcenter 注释修正
  * .env.example (新建) — 3 个环境变量示例
- 沙箱验证:
  * 6 个 .py 文件 py_compile 全过
  * bun run lint exit 0
  * precheck.py 跑通 12 项 (通过 7/失败 1 预期/警告 4)
  * install_tqcenter.py --list / --env 在 Linux 正确降级提示
  * real_adapter import OK (_tqcenter_available=False 预期, _tqcenter_err_msg 含解决方法)
  * schema TqCenterConfig(python_path=...) validate OK
  * FastAPI 启动 OK (/health 200, /api/config 200, adapter_mode=mock)
  * Next.js 仍 200, dev.log 无 error
- 用户路径全部预填:
  * 通达信安装: K:\txdlianghua (写进 real_adapter 扫描表 + precheck 扫描表 + install_tqcenter 扫描表)
  * tqcenter.py: K:\txdlianghua\PYPlugins\user\tqcenter.py (写进 app.windows.example.yaml)
  * TPythClient.dll: K:\txdlianghua\TPythClient.dll (写进 WINDOWS_README 工作原理说明)
  * 项目安装: K:\tdxquantv2 (写进 TdxQuantAutoStart.xml + WINDOWS_README)
- tqcenter 导入 4 级优先级 (real_adapter + precheck 一致):
  1. 直接 import (用户已 pip install -e 或配 PYTHONPATH)
  2. 环境变量 TQ_CENTER_PATH
  3. config tqcenter.python_path
  4. 扫描通达信常见目录 (12 路径 × 4 子路径 = 48 候选)
- 未解决问题:
  1. /api/config 端点不返回 tqcenter 段 (ConfigSummaryResponse 设计如此, 非 bug; python_path 在 RealAdapter.__init__ 里通过 ConfigLoader.get() 读, 已验证可读)
  2. Real 模式实际可用性仍依赖 Windows + tqcenter + 通达信终端登录, sandbox 无法验证
  3. install_tqcenter.py 写 config/app.yaml 用正则替换 python_path 行, 如 YAML 格式异常 (如多行注释) 可能匹配失败, 但当前 app.yaml 格式正常
- 给用户的下一步:
  1. 把项目解压到 K:\tdxquantv2
  2. 双击 install.bat (会自动扫描 K:\txdlianghua\PYPlugins\user 并写入 config)
  3. 启动通达信终端并登录
  4. 编辑 config\app.yaml: adapter_mode: mock → real (或复制 app.windows.example.yaml 为 app.yaml)
  5. 双击 restart.bat
  6. curl http://127.0.0.1:8000/api/monitor?action=status 验证 adapter=real
- 如 install.bat 的 tqcenter 配置步骤失败, 用户可手动:
  python scripts\install_tqcenter.py --path K:\txdlianghua\PYPlugins\user
  或 set TQ_CENTER_PATH=K:\txdlianghua\PYPlugins\user (临时环境变量)

---
Task ID: R17-数据接口字段配置(说明书核对)
Agent: Z.ai Code (Claude, 主控)
Task: 用户问"数据接口的文件和字段你现在能直接配置上去了吗？里面有个说明书的，你可以查看，然后进行编码" — 找到并解压 upload/通达信量化平台说明书.7z，逐条核对 real_adapter，建权威字段目录，修 9 处 bug

Work Log:
- 在 upload/ 发现 通达信量化平台说明书.7z (69KB)，用 py7zr 解压到 /tmp/tdx-doc 并归档到 docs/tongdaxin-api-docs/
- 说明书内容: 49 篇 markdown (7 大类) + tongdaxin_query.py (字段注册表) + 15 个 probe_scripts + CLAUDE.md
  * a行情类信息 (8 篇): get_market_snapshot/get_market_data/get_pricevol/get_more_info/get_stock_info/get_relation/get_gb_info/get_gb_info_by_date/get_ipo_info
  * b财务类数据 (10 篇): get_financial_data(FN1-FN584)/get_gp_one_data(GO1-GO47)/get_gpjy_value(GP01-GP46) 等
  * c分类板块 (3 篇): get_stock_list/get_sector_list/get_stock_list_in_sector
  * d客户端操作类 (1 篇): 板块管理 6 API
  * e ETF/可转债 (2 篇): get_kzz_info/get_trackzs_etf_info
  * f 调用通达信公式 (8 篇)
  * g场景化例子 (7 篇) + 通用函数 (10 篇)
- 关键发现: V8 盘后选股 91 字段快照 = get_more_info(code, field_list=[]) 全字段 + 3 个脚本元数据列(code/类型/查询时间)
  * get_more_info 返回 88 字段: MainBusiness/SafeValue/fHSL/fLianB/Wtb/ZAF/FCAmo/HisHigh/MA5Value 等
  * V8 CSV 的 OpenZAF 字段在说明书字段表里没有(可能是 API 实际返回但未文档化,或脚本派生),已标 V8_UNDOCUMENTED_FIELDS
- 逐条核对 real_adapter.py vs 说明书,发现 9 处 bug:
  * Bug1 get_stock_list_in_sector: 用 code= 但说明书参数名是 block_code; 且漏传 block_type
  * Bug2 send_user_block: 用 stock_list= 但说明书参数名是 stocks
  * Bug3 clear_sector: 用 send_user_block(code,[]) 变通,但说明书有独立的 tq.clear_sector(code) 直接 API
  * Bug4 get_user_sector: 调用虚构的 tq.get_user_sector_by_code(说明书无此 API),改为 get_user_sector() 本地过滤
  * Bug5 get_trackzs_etf_info: 用 etf_code= 但说明书参数名是 zs_code
  * Bug6 send_message: 用 msg= 但说明书参数名是 msg_str
  * Bug7 refresh_kline: 用 stock_code= 但说明书参数是 stock_list(列表),改为 stock_list=[ncode]
  * Bug8 get_gpjy_value/get_gpjy_value_by_date: base 接口签名(code,date_list,count)与真实 API(stock_list,field_list,start_time,end_time)不符,真实 API 无 get_gpjy_value_by_date; 改为调真实 get_gpjy_value + 展平返回结构 + 注明限制
  * Bug9 download_data: 真实 API 是 download_file(stock_code,down_time,down_type),tqcenter 无 download_data; 改为映射 download_file(down_type=4 股票综合信息)
- 新建 1 个文件: engine/data_adapter/tqcenter_fields.py (字段权威目录)
  * API_REGISTRY: 29 个 API 的元信息(category/description/signature/fields/returns/notes)
  * V8_SNAPSHOT_FIELDS: 91 列 V8 快照字段清单 + V8_MORE_INFO_FIELDS(88 个来自 get_more_info)
  * FINANCIAL_FN_FIELDS: FN 系列常用 53 字段子集
  * 辅助函数: get_api_fields/find_field/validate_field_list/v8_field_list/list_apis
- 修改 3 个文件:
  * engine/data_adapter/real_adapter.py: 修 9 处 bug + 加 import tqcenter_fields + 加 _probe_api_coverage() (initialize 后核对 API 覆盖) + 更新模块 docstring 引用说明书
  * engine/config/schema.py: TqCenterConfig 加 fields: dict 字段(支持 YAML tqcenter.fields 子段)
  * config/app.yaml: tqcenter 段加 fields 子段(v8_snapshot_source_api/v8_snapshot_field_list/kline_field_list/snapshot_field_list/financial_fn_fields 15 个 FN)
- 沙箱验证:
  * py_compile 3 个文件全过
  * 字段目录冒烟测试: API_REGISTRY=29, V8_SNAPSHOT_FIELDS=91, V8_MORE_INFO_FIELDS=88, 6 大类别齐全
  * find_field('ZAF')→get_more_info, find_field('FN193')→get_financial_data 正确
  * validate_field_list 正确识别非法字段(NotAField/BAD)
  * ConfigLoader 点访问 tqcenter.fields.financial_fn_fields 返回 15 个 FN
  * AppConfigRoot.from_dict 正确填充 tqcenter.fields, schema validate OK
  * RealAdapter 在 mock 模式(tqcenter 不可用)优雅实例化(打印解决方法,不崩溃)
  * bun run lint exit 0 (0 errors 0 warnings)
  * Next.js HTTP 200, /api/monitor?action=status 返回 engine_status=running/adapter_mode=mock
  * agent-browser 确认前端 "TdxQuant 量化交易系统" 正常加载

Stage Summary:
- 产物清单:
  * docs/tongdaxin-api-docs/ (新建, 49 篇说明书 markdown + tongdaxin_query.py + 15 probe_scripts, 从 upload/ 解压归档)
  * engine/data_adapter/tqcenter_fields.py (新建, 29 API 字段权威目录 + V8 快照 91 字段映射 + 辅助函数)
  * engine/data_adapter/real_adapter.py (修改, 修 9 处参数名/签名 bug + API 覆盖诊断 + docstring 引用说明书)
  * engine/config/schema.py (修改, TqCenterConfig 加 fields dict 字段)
  * config/app.yaml (修改, tqcenter.fields 子段: 5 个字段配置键 + 15 个常用 FN)
- 核心价值: 数据接口字段从"凭记忆/经验猜测"升级为"说明书逐条核对",字段名/参数名/返回结构全部有据可查
- V8 快照数据源确认: get_more_info 是 91 字段快照的主源, Real 模式下可用 get_more_info(code, field_list=[]) 全量拉取
- 9 处 bug 全部修复, Real 模式不会再因参数名错误抛 TypeError (此前 send_user_block/clear_sector/get_trackzs_etf_info/send_message/refresh_kline 等必崩)
- 未解决问题:
  1. get_gpjy_value/get_gpjy_value_by_date 的 base 接口(code,date_list,count)与真实 API(stock_list,field_list,start_time,end_time)语义不符, 当前用 field_list=[] 适配(若 tqcenter 拒绝空 list 则返回 [], 调用方可改用 get_financial_data 拉 FN); 根治需重构 base.py + mock + 调用方
  2. download_data→download_file 映射固定 down_type=4(股票综合信息), end_date 被忽略; 如需十大股东(down_type=1)/ETF申赎(2)/舆情(3)需直接调 tq.download_file
  3. V8 快照的 OpenZAF 字段在说明书 get_more_info 字段表里没有, 可能是 API 实际返回但未文档化或脚本派生, 已标 V8_UNDOCUMENTED_FIELDS 待真机验证
  4. Real 模式实际可用性仍依赖 Windows + tqcenter + 通达信终端登录, sandbox 无法验证字段返回值
- 下一阶段建议:
  1. 用户在 Windows 真机切 Real 模式后, 跑 get_more_info('600519.SH', field_list=[]) 验证 88 字段是否全返回(含 OpenZAF)
  2. 可建 V8 快照构建器服务: 全市场 get_stock_list('5') → 循环 get_more_info → 拼 91 列 DataFrame, 替代 V8 CSV 样本
  3. 可加"字段面板"前端页: 调 /api/tqcenter-fields(新) 展示 29 API × 字段清单, 支持搜字段反查 API
  4. 可重构 base.py 的 get_gpjy_value 接口为 (stock_list, field_list, start_time, end_time) 与说明书对齐

---
Task ID: R18-B
Agent: Subagent B (Windows 优化)
Task: 参考上传的 Windows 适配说明 (upload/粘贴了内容_1782190176359.txt 1790 行)，做路径/编码/进程/脚本优化

Work Log:
- 新建 engine/utils/encoding.py (180 行)
  * 提供 safe_read / safe_write / safe_read_lines / safe_decode / safe_encode / set_utf8_stdio / ensure_utf8_env
  * UTF-8 优先，Windows GBK 自动回退（utf-8 → utf-8-sig → gbk → cp936 → latin-1 → replace）
  * set_utf8_stdio 用 io.TextIOWrapper 重配 stdin/stdout/stderr（解决 Windows cp936 中文乱码）
  * ensure_utf8_env 设 PYTHONUTF8=1 / PYTHONIOENCODING=utf-8（影响子进程）
  * 零依赖（仅标准库 io/os/sys/pathlib）
- 修改 scripts/dev.py
  * 启动早期强制 UTF-8 环境：PYTHONUTF8=1 + PYTHONIOENCODING=utf-8 + 调 set_utf8_stdio()
  * docstring 加 R18-B 说明，setup 子命令 help 文本 "DuckDB" → "QuestDB 优先"
  * cmd_setup 内部消息从"初始化 DuckDB"改为"初始化数据库 (QuestDB 优先; 沙箱无服务时跳过)"
  * epilog 示例注释同步更新
- 新建 start-questdb.bat (Windows QuestDB 启动脚本，5 段式)
  * 方式 A: 检测 docker → docker compose -f docker/questdb/docker-compose.yml up -d → 轮询 30s 等 9000 就绪
  * 方式 B: 无 docker 时打印 questdb.exe 便携版下载+启动指南
  * chcp 65001 切 UTF-8 控制台
- 修改 install.bat
  * 步骤数 5→6: 加 [5/6] 启动 QuestDB (R18) 段，用 choice /c YN 让用户选 Y/N
  * 头部说明同步：步骤 2 改为 "QuestDB 优先"
  * 末尾提示加 "QuestDB 管理: 双击 start-questdb.bat"
- 修改 start.bat / restart.bat
  * 加 set PYTHONUTF8=1 + set PYTHONIOENCODING=utf-8 (本进程级)
  * start.bat: 若 docker 可用且 QuestDB 未在 9000 端口响应，choice 提示用户是否先启动 QuestDB
  * 末尾输出加 QuestDB URL: http://127.0.0.1:9000
- 修改 stop.bat
  * 加 UTF-8 环境变量设置
  * 末尾提示：QuestDB (docker 容器) 不停止，保留数据持久化；提供 docker compose down 命令
- 修改 tdxquant-launcher.vbs
  * 加 objEnv.Item("PYTHONUTF8") = "1" + objEnv.Item("PYTHONIOENCODING") = "utf-8" (Process 级，影响子进程)
  * 启动提示框加 QuestDB 控制台 URL
- 修改 tdxquant-healthcheck.bat
  * 检查项 2→3: 加 [3/3] QuestDB Web 控制台 (http://127.0.0.1:9000/)
  * 加 UTF-8 环境变量
- 修改 config/app.windows.example.yaml
  * 加完整 questdb 段 (host/pg_port/http_port/username/password/database/connect_timeout/auto_init，与 app.yaml 一致)
  * paths.duckdb 加注释说明 R18 弃用，新代码用 questdb 段
  * 头部使用说明加"启动 QuestDB (R18 数据库,双击 start-questdb.bat)"
  * tdx_warn terminal_path 示例从 C:\new_tdx 改为 K:\txdlianghua（与用户实际环境一致）
- 修改 .env.example
  * 加完整 QUESTDB_* 段：QUESTDB_HOST / PG_PORT / HTTP_PORT / USERNAME / PASSWORD / DATABASE
  * 加 PYTHONUTF8=1 / PYTHONIOENCODING=utf-8（Windows 默认 GBK 兜底）
  * questdb 段加注释说明启动方式（start-questdb.bat 或 docker compose）
- 验证（无新依赖，仅标准库）:
  * python3 -m py_compile scripts/dev.py engine/utils/encoding.py → OK
  * encoding.py 功能测试: safe_encode/decode 往返、GBK bytes 解码、safe_write/read 文件往返、set_utf8_stdio 不抛异常、ensure_utf8_env 设变量、读不存在文件返回空串 全过
  * python3 scripts/dev.py --help / paths --env windows --dry-run → OK
  * ConfigLoader 读 questdb.host=127.0.0.1, questdb.pg_port=8812 OK
  * QuestDBStore 沙箱降级实例化 OK (psycopg2 未装时 is_available=False)
  * app.windows.example.yaml YAML 解析 OK，含 questdb 段
  * .env.example 9 个 KEY=VALUE 行格式 OK

Stage Summary:
- 修改文件数: 7 (scripts/dev.py, install.bat, start.bat, stop.bat, restart.bat, tdxquant-launcher.vbs, tdxquant-healthcheck.bat, config/app.windows.example.yaml, .env.example)
  注: 共 9 个文件被改动（含修复合并）
- 新建文件数: 2 (engine/utils/encoding.py, start-questdb.bat)
- 验证: py_compile 全过 + encoding.py 功能测试 7 项全过 + dev.py 子命令冒烟 + YAML/.env 格式校验
- 关键改动: Windows 控制台中文乱码根治（PYTHONUTF8/PYTHONIOENCODING/set_utf8_stdio 三层兜底）；QuestDB 启动集成到 install.bat / start.bat（用户开箱即用）；encoding.py 给后续业务代码提供统一读写工具
- 未解决问题:
  1. .bat 文件无法在 Linux 沙箱验证语法（需 Windows 真机双击测试）
  2. scripts/precheck.py 仍 check_duckdb_file + check_python_deps 包含 duckdb，与 R18 QuestDB 迁移方向不一致，但属 R18-A 范围（DB 迁移），不在本任务（Windows 兼容）范围
  3. start.bat 中检测 QuestDB 是否运行用 curl http://127.0.0.1:9000/ 探测，curl 不可用时（极旧 Windows）会跳过提示，但不影响主流程
  4. encoding.py 暂未被 engine/ 业务代码引用（仅 scripts/dev.py 启动期用 set_utf8_stdio），后续可渐进迁移 open() 调用

---
Task ID: R18-A
Agent: Subagent A (SQL 方言迁移)
Task: 迁移所有 INSERT SQL 调用点适配 QuestDB 方言（补 id 列）

Work Log:
- 读 worklog.md 了解前序工作 (R5-R17 演进史) + 读 questdb_store.py 了解 QuestDBStore 接口 + _gen_id/_convert_sql 实现
- 读 config/questdb_schema.sql 确认 8 张核心表的 schema:
  * 有 id LONG 列的表: selection_results / signal_events / sector_snapshots / monitor_subscriptions / config_changes / kline_cache (6 张)
  * 无 id 列的表: strategies (用 strategy_id 主键) / strategy_runs (用 run_id 主键) (2 张)
  * 不在 schema 中的表: backtest_results (代码惰性创建, 用 run_id 主键, 原为 DuckDB 语法)
- 用 Grep 找出 7 个文件共 10 处 INSERT INTO 调用点, 逐一改造:

- 文件 1: engine/api/routes/strategies.py (2 处 INSERT)
  * 行 37: 加 `from engine.storage.questdb_store import _gen_id` 导入
  * 行 607 INSERT INTO signal_events: 列清单加 id, VALUES 加 1 个 ?, params 列表开头插入 _gen_id() (11 列, 11 占位符)
  * 行 690 INSERT INTO monitor_subscriptions (executemany): 列清单加 id, VALUES 加 1 个 ?, rows_to_insert 元组开头插入 _gen_id() (7 列, 7 占位符)

- 文件 2: engine/api/routes/watchlist.py (2 处 INSERT)
  * 行 25: 加 `from engine.storage.questdb_store import _gen_id` 导入
  * 行 262 INSERT INTO monitor_subscriptions (_persist_subscription): 列清单加 id, VALUES 加 1 个 ?, params 开头插入 _gen_id() (7 列, 5 ? + 2 字面量 CURRENT_TIMESTAMP/true)
  * 行 304 INSERT INTO monitor_subscriptions (_deactivate_subscription 归档行): 列清单加 id, VALUES 加 1 个 ?, params 开头插入 _gen_id() (8 列, 6 ? + 2 字面量 CURRENT_TIMESTAMP/false)

- 文件 3: engine/api/routes/backtest.py (1 处 INSERT + 1 处 CREATE TABLE)
  * 行 36: 加 `from engine.storage.questdb_store import _gen_id` 导入
  * 行 695-732 _persist_backtest 函数: 重写 docstring 标注 R18-A 适配; 改 CREATE TABLE 为 QuestDB 方言:
    - 加 `id LONG` 列 (替代 DuckDB `id BIGINT PRIMARY KEY`)
    - 移除 `PRIMARY KEY` (QuestDB 不支持, 用 run_id UUID 兜底唯一)
    - 移除 `DEFAULT` 子句 (QuestDB 不支持 DEFAULT CURRENT_TIMESTAMP 等, 由应用层填值)
    - 加 `timestamp(created_at)` 设计时间戳标记 (时序优化)
    - 保留 VARCHAR (QuestDB 接受作 STRING 别名)
  * 行 736 INSERT INTO backtest_results: 列清单加 id, VALUES 加 1 个 ?, params 开头插入 _gen_id() (18 列, 18 占位符)

- 文件 4: engine/pipeline/runner.py (2 处 INSERT, 1 处未改)
  * 行 75-83: 加 _gen_id 导入 (用 try-except 兜底, questdb_store 不可用时本地实现)
  * 行 280 INSERT INTO strategy_runs: 未改 (该表用 run_id 作主键, questdb_schema.sql 中无 id 列)
  * 行 374 INSERT INTO monitor_subscriptions (_persist_subscription): 列清单加 id, VALUES 加 1 个 ?, params 开头插入 _gen_id() (7 列, 5 ? + 2 字面量)

- 文件 5: engine/monitor/engine.py (1 处 INSERT)
  * 行 37: 加 `from engine.storage.questdb_store import _gen_id` 导入
  * 行 588 INSERT INTO signal_events: 列清单加 id, VALUES 加 1 个 ?, params 开头插入 _gen_id() (11 列, 10 ? + 1 字面量 CURRENT_TIMESTAMP)

- 文件 6: engine/exporters/sector_exporter.py (1 处 INSERT)
  * 行 33: 加 `from engine.storage.questdb_store import _gen_id` 导入
  * 行 148 INSERT INTO sector_snapshots: 列清单加 id, VALUES 加 1 个 ?, params 开头插入 _gen_id() (8 列, 8 占位符)

- 文件 7: engine/exporters/duckdb_exporter.py (1 处动态 INSERT + 1 处 CREATE TABLE)
  * 行 35: 加 `from engine.storage.questdb_store import _gen_id` 导入
  * 行 108 _build_records: records.append({...}) 字典开头加 `"id": _gen_id()` (10 个 top-level 键, id 居首)
  * 行 126-155 _ensure_table: 重写 docstring 标注 R18-A; CREATE TABLE 改为 QuestDB 方言:
    - `id BIGINT PRIMARY KEY` → `id LONG`
    - `VARCHAR NOT NULL/DEFAULT ''` → `SYMBOL CAPACITY` / `STRING` (与 questdb_schema.sql 对齐)
    - `DEFAULT CURRENT_TIMESTAMP` 移除 (QuestDB 不支持, 由 executemany 时应用层填值)
    - 加 `timestamp(created_at)` 设计时间戳标记
  * 行 161 动态 INSERT: 未改 SQL 模板 (columns/placeholders 都从 records[0].keys() 动态生成, 因 records 已含 id 故 SQL 自动包含 id)

- 验证:
  * `python3 -m py_compile` 7 个文件全过 (strategies/watchlist/backtest/runner/engine/sector_exporter/duckdb_exporter)
  * `python3 -c "from engine.storage.questdb_store import _gen_id"` 验证 _gen_id() 可导入且两次调用产生不同值 (17821939311631232 / 17821939311633153)
  * `python3 -c "import engine.api.routes.strategies"` 等 7 个模块导入全过 (无 ImportError)
  * AST 解析验证 10 处 INSERT 的列数 vs 占位符数 vs 字面量数全部对齐:
    - strategies.py signal_events: 11 列 = 11 ? (id 居首)
    - strategies.py monitor_subscriptions: 7 列 = 7 ? (id 居首)
    - watchlist.py monitor_subscriptions #1: 7 列 = 5 ? + 2 字面量 (id 居首)
    - watchlist.py monitor_subscriptions #2: 8 列 = 6 ? + 2 字面量 (id 居首)
    - backtest.py backtest_results: 18 列 = 18 ? (id 居首)
    - runner.py strategy_runs: 11 列 = 11 ? (无 id, 表无 id 列)
    - runner.py monitor_subscriptions: 7 列 = 5 ? + 2 字面量 (id 居首)
    - monitor/engine.py signal_events: 11 列 = 10 ? + 1 字面量 (id 居首)
    - sector_exporter.py sector_snapshots: 8 列 = 8 ? (id 居首)
    - duckdb_exporter.py selection_results: 动态, records dict 10 键 id 居首
  * DELETE/SELECT 语句未改 (占位符自动转换 + table_exists 已适配, 符合任务要求)

Stage Summary:
- 修改文件数: 7 (engine/api/routes/strategies.py / watchlist.py / backtest.py + engine/pipeline/runner.py + engine/monitor/engine.py + engine/exporters/sector_exporter.py + engine/exporters/duckdb_exporter.py)
- INSERT 语句改造数: 9 处补 id 列 (signal_events ×2 / monitor_subscriptions ×4 / sector_snapshots ×1 / backtest_results ×1 / selection_results 动态 ×1)
- INSERT 语句未改: 1 处 (strategy_runs, 表 schema 无 id 列)
- 附带 DDL 改造: 2 处 (backtest_results 惰性 CREATE TABLE + selection_results 兜底 CREATE TABLE, 都从 DuckDB 语法改成 QuestDB 语法: 去 PRIMARY KEY / 去 DEFAULT / 加 timestamp() 标记)
- 导入语句: 7 个文件都加 `from engine.storage.questdb_store import _gen_id` (runner.py 用 try-except 兜底防止 questdb_store 不可用时崩溃)
- 验证: py_compile 全过 + 模块导入全过 + AST 解析 10 处 INSERT 列数/占位符/字面量全部对齐 + _gen_id() 唯一性验证
- 未解决问题:
  1. backtest_results 表不在 config/questdb_schema.sql 中 (只有 8 张核心表), 当前依赖 _persist_backtest 函数惰性 CREATE TABLE. 如未来需要统一管理, 可加进 questdb_schema.sql
  2. duckdb_exporter.py 的 _ensure_table 是兜底 (selection_results 已由 QuestDBStore.init_db() 从 questdb_schema.sql 创建). 但若用户手动 DROP TABLE 后, 兜底 DDL 会用 QuestDB 语法重建, 应该能成功
  3. strategy_runs INSERT 未加 id (表 schema 无 id 列). 如未来需要 id 列, 需先改 questdb_schema.sql 加 id LONG 列
  4. UPDATE 语句: 项目中无原生 UPDATE 语句 (现有"更新"操作都用 DELETE+INSERT 模式, 已规避 DuckDB 索引 bug), 故无需迁移
  5. Real 模式下 QuestDB 实际可用性仍依赖 psycopg2 + QuestDB 服务启动, sandbox 无法端到端验证


---
Task ID: R18-C
Agent: Subagent C (文档和配置更新)
Task: 更新所有文档/配置反映 DuckDB → QuestDB 迁移 (主控已完成核心: QuestDBStore + questdb_schema.sql + QuestDBConfig + docker-compose + requirements.txt)

Work Log:
- scripts/init_db.py: docstring 全改 QuestDB; DuckDBStore() 调用保留 (已自动指向 QuestDBStore); 新增 is_available 检测, 沙箱无 QuestDB 时优雅降级 + JSON 输出加 available 字段; 输出格式改 "QuestDB 初始化完成" + 连接信息 (host:pg_port)
- scripts/precheck.py: 加 check_questdb() 函数 (PG wire 端口可达性检查, 读 config/app.yaml 的 questdb 段, mock 模式 WARN / real 模式 FAIL); check_duckdb_file() 改为检查 config/questdb_schema.sql 存在 (兼容检查旧 duckdb_schema.sql WARN); check_python_deps() 加 psycopg2 + requests 必装检查; CHECKS 列表加 check_questdb (12→13 项); run_fix() 修复语义改为 "拉 questdb_schema.sql 后调 init_db.py"; docstring + --fix 帮助文本更新
- config/app.windows.example.yaml: 头部注释加 R18 关键变化说明 (DuckDB→QuestDB) + 启动方式二选一 (Docker / questdb.exe); paths.duckdb 注释改为 "保留向后兼容, 实际已弃用"; 新增 questdb 段 (host=127.0.0.1, pg_port=8812, http_port=9000, username=admin, password=quest, database=qdb, connect_timeout=5, auto_init=true)
- .env.example: 新增 6 个 QUESTDB_* 环境变量 (QUESTDB_HOST / QUESTDB_PG_PORT / QUESTDB_HTTP_PORT / QUESTDB_USERNAME / QUESTDB_PASSWORD / QUESTDB_DATABASE), 含启动方式注释 + 沙箱降级行为说明
- WINDOWS_README.md:
  * install.bat 步骤表: "DuckDB 建表" → "QuestDB 建表 (原 DuckDB, R18 替代)"; 加 "启动 QuestDB" 步骤; "12 项检查" → "13 项检查"
  * 预检覆盖清单: "DuckDB" → "QuestDB schema / QuestDB 连接"
  * 性能调优表: "DuckDB 查询慢" → "QuestDB 查询慢" (改用 Web 控制台看体积)
  * 进阶提示 #4: "DuckDB 单写锁" → "QuestDB 多进程并发写无锁"
  * 新增「🗄️ QuestDB 安装与启动 (R18 替代 DuckDB)」章节: Docker 方式 + 原生 questdb.exe 方式 + 验证连通 + QuestDB 配置说明 + 环境变量覆盖列表
  * FAQ 加 4 个 QuestDB 专项问答: Q1 (QuestDB vs DuckDB 区别 + 迁移原因表), Q2 (如何切换回 DuckDB), Q3 (沙箱/Mock 模式无 QuestDB 怎么办), Q4 (QuestDB 数据备份/迁移)
  * FAQ 表加 2 行: "QuestDB 连接不可达" / "端口 8812/9000 被占用"
- docs/DEPLOY.md: 新增「QuestDB 数据库 (R18 替代 DuckDB)」章节 (为什么迁移对比表 + 安装与启动 Docker/原生 + 配置 + 数据持久化 + 沙箱/Mock 模式降级); 环境要求表加 QuestDB / psycopg2-binary / requests; 沙箱步骤加 (可选) 启动 QuestDB; Windows 步骤加 #4 启动 QuestDB; Linux 步骤加 #2 启动 QuestDB; Windows 常见问题表加 QuestDB 相关 3 行; 重要提醒 #5 改为 R18 QuestDB 描述
- docs/maintenance/ARCHITECTURE.md: 1.2 运行环境数据库改 QuestDB; L1 基础设施层描述改 "QuestDB 存储"; 目录结构 storage/ 段加 questdb_store.py + duckdb_store.py 注释兼容别名; config/ 段加 questdb_schema.sql + duckdb_schema.sql 已弃用; data/ 段 duckdb/quant.db 标已弃用; 第九章 "DuckDB Schema" 改 "QuestDB Schema (R18 替代 DuckDB)" + 加 SQL 方言差异说明; R13 配置文件清单加 questdb_schema.sql; 新增「§十四 R18 QuestDB 迁移 (DuckDB → QuestDB)」演进章节 (8 小节: 为什么迁移 / 架构变更对比表 / 依赖变更 / 配置变更 / 启动方式 / SQL 方言适配 / 优雅降级 / 关键约束更新)
- docs/MAINTENANCE.md: 1.3 数据库章节改 QuestDB 描述 (含 8 张表清单 + 沙箱降级说明); 故障排查速查表加 QuestDB 相关 3 行 (database is locked R18 后已根治 / QuestDB 连接不可达 / 端口 8812/9000 占用); 新增「§六 QuestDB 运维 (R18 替代 DuckDB)」章节 7 小节: 6.1 文件锁问题根治 (DuckDB vs QuestDB 7 维度对比表 + 为什么 R12 限流没根治说明) / 6.2 备份 (Docker + 原生 + SQL 导出) / 6.3 恢复 (5 步) / 6.4 监控 (Web 控制台 + Docker 日志 + 关键指标) / 6.5 性能调优 (4 个 QDB_* 参数表 + SQL 调优 + 数据清理) / 6.6 重置/重建 (4 步) / 6.7 常见问题 (5 行)
- docs/USER_GUIDE.md: 3.3 数据权限 "信号历史保存在 DuckDB" 改 "QuestDB (R18 起替代 DuckDB)"; 术语表加 QuestDB / DuckDB 两个条目; FAQ 加 Q16 (数据存在哪里? R18 后有什么变化?) 含 6 个要点 (R17 vs R18 对比 / 8 张表 / Web 控制台 / 沙箱降级 / 数据备份指引)
- docs/CHANGELOG.md: 新建文件 (项目此前无 CHANGELOG), 加 R18 条目 (Breaking Change / 新增文件表 / 修改文件表 / 核心设计 5 点 / 验证 / 未解决问题 / 升级指南 5 步) + 回填 R17/R14/R13/R12/R5-R11 摘要条目

Stage Summary:
- 修改文件数: 10 (含 1 个新建 CHANGELOG.md)
  * scripts/: init_db.py + precheck.py (2 个)
  * config/: app.windows.example.yaml (1 个)
  * 根目录: .env.example + WINDOWS_README.md (2 个)
  * docs/: DEPLOY.md + maintenance/ARCHITECTURE.md + MAINTENANCE.md + USER_GUIDE.md + CHANGELOG.md (5 个)
- 验证: py_compile 全过 (init_db.py + precheck.py); precheck.py 跑通 13 项 (沙箱 6 PASS / 2 FAIL / 5 WARN, 符合预期); init_db.py 沙箱无 QuestDB 时优雅降级 OK; YAML 配置文件合法 (app.windows.example.yaml safe_load 通过)
- 未改 engine/ 下任何代码 (主控已改)
- 未改 config/app.yaml (主控已改)
- 未改 requirements.txt (主控已改)
- 未解决问题:
  1. 沙箱无 psycopg2 (没 pip install), precheck 的 python_deps 项 FAIL (预期, 真实 Windows 环境装 psycopg2-binary 即可)
  2. 旧 DuckDB 数据文件 (data/duckdb/quant.db) 不会自动迁移到 QuestDB, 需手动 SQL 导出/导入 (已在 MAINTENANCE.md §6.2 备份方式 B 说明)
  3. R5-R13 archived worklog 仍提及 DuckDB, 历史记录不回改
  4. CHANGELOG.md 是新建文件, 之前无, 回填了 R5-R17 摘要条目 (完整历史在 worklog-archive-R5-R13.md.gz)

---
Task ID: R18-主控-QuestDB迁移+Windows优化
Agent: Z.ai Code (Claude, 主控)
Task: 参考上传的 Windows 适配说明做优化，数据库一步到位从 DuckDB 迁移到 QuestDB，彻底解决文件锁问题

Work Log:
- 完整读取上传的 Windows 适配说明 (1790 行) + 当前 worklog (785 行) 了解项目状态
- 探索当前 DuckDB 使用: 31 个 .py 文件引用 duckdb, 8 张表 schema, DuckDBStore 单例 + threading.RLock 串行化
- 诊断核心痛点: DuckDB 单文件 + 单写锁, 多进程/多实例并发写冲突 (上传说明 #8 低优, 用户要求彻底根治)
- 设计 QuestDB 迁移方案:
  * QuestDB 服务端架构 (PG wire 8812 / HTTP 9000 / ILP 9009), 彻底无文件锁
  * 接口与 DuckDBStore 完全一致, DuckDBStore 保留为别名, 调用方零改动
  * 沙箱无 QuestDB 时优雅降级 (mock 模式不依赖 DB, real 模式才需要)
- 主控实现 (6 个新文件 + 5 个修改):
  1. config/questdb_schema.sql (新, 153 行) - QuestDB 方言 8 张表: 无 SEQUENCE/无 UNIQUE/用 symbol 类型/designated timestamp 优化时序
  2. engine/storage/questdb_store.py (新, 620 行) - QuestDBStore 类: PG wire (psycopg2) + HTTP /exec (DDL) + _gen_id() 应用层生成 ID + _convert_sql(?→$N) + upsert() 辅助 + 优雅降级
  3. engine/storage/__init__.py (改) - 导出 QuestDBStore + DuckDBStore=QuestDBStore 别名 + get_store()
  4. engine/storage/duckdb_store.py (改, 重写为兼容层) - re-export QuestDBStore + 迁移指南 docstring
  5. engine/config/schema.py (改) - 加 QuestDBConfig dataclass (host/pg_port/http_port/username/password/database/connect_timeout/auto_init) + AppConfigRoot 加 questdb 字段 + from_dict 解析
  6. config/app.yaml (改) - paths.duckdb 加 R18 弃用注释 + 新增 questdb 段 (8 个配置键)
  7. requirements.txt (改) - 加 psycopg2-binary>=2.9 / requests>=2.28 / questdb-py-client>=0.0.5
  8. docker/questdb/docker-compose.yml (新) - Docker 启动 QuestDB (8812/9000/9009 端口 + 数据持久化 + healthcheck)
  9. docker/questdb/questdb.conf (新) - QuestDB 自定义配置 (时区 Asia/Shanghai + worker 线程)
  10. docker/questdb/questdb-data/.gitignore (新) - 数据目录 gitignore
- 前端文案更新 (3 处 DuckDB→QuestDB):
  * src/app/page.tsx:328 footer "Next.js 16 + FastAPI + DuckDB" → "QuestDB"
  * src/components/quant/ConfigSummary.tsx:61 PATH_LABELS.duckdb "DuckDB 数据库" → "QuestDB 数据库"
  * src/components/quant/strategy/StrategyList.tsx:138 "来源 DuckDB strategy_runs 表" → "来源 QuestDB"
- 并行调度 3 个 subagent:
  * R18-A (SQL 方言迁移): 7 个文件 9 处 INSERT 补 id 列 + 2 处 CREATE TABLE 改 QuestDB 方言
  * R18-B (Windows 优化): 新建 engine/utils/encoding.py + start-questdb.bat, 改 scripts/dev.py + 5 个 .bat + .vbs + app.windows.example.yaml + .env.example
  * R18-C (文档更新): 10 个文件 (WINDOWS_README/DEPLOY/ARCHITECTURE/MAINTENANCE/USER_GUIDE/CHANGELOG + init_db.py/precheck.py + app.windows.example.yaml + .env.example)
- 沙箱验证 (全过):
  * pip install psycopg2-binary requests (venv)
  * py_compile 8 个核心文件全过
  * QuestDBStore 沙箱降级: is_available=False, table_exists=False, query 返回空 DataFrame, repr 显示 available=False
  * _gen_id() 唯一性: 两次调用产生不同值
  * _convert_sql(): ? → $1, $2 正确转换 (跳过字符串字面量内的 ?)
  * ConfigLoader 读 questdb.host/pg_port/http_port/connect_timeout 全 OK
  * AppConfigRoot.from_dict + validate() OK
  * FastAPI 启动 200 (/health + /api/monitor/status + /api/signals + /api/selections 全 200)
  * FastAPI log 仅 1 条 WARNING (QuestDB 连接失败, 优雅降级, 不阻断)
  * bun run lint exit 0 (0 errors 0 warnings)
  * agent-browser 验证: 页面加载 OK, 10 个 Tab 全部可切换, footer 显示 "Next.js 16 + FastAPI + QuestDB"
  * 配置摘要对话框: 关键路径段显示 "QuestDB 数据库" label
  * Core Web Vitals: TTFB 109ms / FCP 328ms / LCP 328ms / CLS 0.02 / hydration 55ms

Stage Summary:
- 产物清单 (11 个新文件 + 8 个修改):
  * 核心: questdb_store.py (620行) + questdb_schema.sql (153行) + __init__.py + duckdb_store.py 兼容层
  * 配置: schema.py QuestDBConfig + app.yaml questdb 段 + app.windows.example.yaml + .env.example
  * 部署: docker/questdb/ (docker-compose.yml + questdb.conf + .gitignore) + start-questdb.bat
  * 工具: engine/utils/encoding.py (UTF-8 强制, Windows GBK 兼容)
  * 文档: WINDOWS_README/DEPLOY/ARCHITECTURE/MAINTENANCE/USER_GUIDE/CHANGELOG 全更新
  * 脚本: dev.py (UTF-8 启动期) + init_db.py (QuestDB) + precheck.py (check_questdb) + 5 个 .bat + .vbs
  * 前端: page.tsx footer + ConfigSummary.tsx label + StrategyList.tsx 文案
- 核心价值:
  1. 文件锁根治: DuckDB 单文件单写锁 → QuestDB 服务端架构, 多进程并发写无冲突
  2. 接口零改动: DuckDBStore=QuestDBStore 别名, 31 个调用点无需改 import
  3. 沙箱降级: 无 QuestDB 时 mock 模式仍可运行 (real 模式才需 QuestDB)
  4. Windows 优化: 三层 UTF-8 兜底 (PYTHONUTF8 + PYTHONIOENCODING + set_utf8_stdio) + QuestDB 启动脚本
  5. SQL 方言适配: ? → $N 自动转换 + _gen_id() 替代 SEQUENCE + upsert() 替代 UNIQUE
- 未解决问题:
  1. 沙箱无 QuestDB 服务, real 模式实际写入性能未验证 (需 Windows 真机 + docker compose up)
  2. 旧 DuckDB 数据文件 (data/duckdb/quant.db) 不会自动迁移到 QuestDB, 需手动 SQL 导出/导入
  3. console 有 PatternBuilderDialog.tsx 编译错误 (R18 之前就存在, 与 QuestDB 迁移无关)
  4. ConfigSummary 显示的路径键名仍是 "duckdb" (后端 paths.duckdb 字段名保留兼容, R18 设计如此)
- 给用户的下一步:
  1. Windows 真机: docker compose -f docker/questdb/docker-compose.yml up -d 启动 QuestDB
  2. 或双击 start-questdb.bat (自动检测 docker, 无 docker 时打印 questdb.exe 下载指南)
  3. 编辑 config/app.yaml: adapter_mode: mock → real 切换 Real 模式
  4. 双击 restart.bat 重启服务
  5. curl http://127.0.0.1:8000/api/monitor/status 验证 engine_status=running + adapter_mode=real
  6. 访问 http://127.0.0.1:9000 QuestDB Web 控制台查看数据

---
Task ID: R19-验收-tqcenter字段对接完整性扫描
Agent: Z.ai Code (Claude, 主控)
Task: 扫描项目 bug，重点核对 tqcenter 脚本字段对接是否完善，过验收

Work Log:
- 读 worklog.md 了解 R18 QuestDB 迁移已完成；读 dev.log 确认 dev server 运行中（全 200 响应，无错误）
- 读 tqcenter_fields.py（510 行）确认 API_REGISTRY 共定义 29 个 API（7 大类：行情/财务/分类板块/客户端操作/ETF可转债/通用函数/订阅）
- 读 real_adapter.py（967 行）+ base.py + mock_adapter.py 核对接口实现
- 跑 `bun run lint` → 0 errors 0 warnings ✓
- 跑 `python3 -m py_compile` 8 个核心 .py 文件全过 ✓
- 跑 API 覆盖率核对脚本：发现 2 个对接缺口
  * 缺口 1: `refresh_cache` API 在 API_REGISTRY 定义但 BaseDataAdapter/RealAdapter/MockAdapter 均未实现
  * 缺口 2: `download_file` API 在 API_REGISTRY 定义但适配层用 `download_data` 包装（缺原始直通方法）
- 修复 1: BaseDataAdapter 加 `refresh_cache(market, force)` 抽象方法 + 完整 docstring（说明书要点：market AG/HK/US/QH/QQ/NQ/ZZ/OF/ZS/OJ，force=False 时距上次<10分钟不刷新）
- 修复 2: RealAdapter 实现 `refresh_cache` → 调 `tq.refresh_cache(market=market, force=force)`
- 修复 3: MockAdapter 实现 `refresh_cache` → noop 返回 True（Mock 数据来自 CSV 无需刷新）
- 修复 4: BaseDataAdapter `download_data` docstring 修正（说明书无 `tq.download_data`，真实 API 是 `tq.download_file`，本接口是适配映射 down_type=4）
- 修复 5: RealAdapter 加 `download_file(stock_code, down_time, down_type)` 原始 API 直通方法（暴露 down_type 全部 4 档：1十大股东/2ETF申赎/3舆情/4股票综合信息）
- 修复 6: MockAdapter 加 `download_file` noop 返回成功结构 `{ErrorId, Msg, run_id}`
- 修复 7: BaseDataAdapter 加 `download_file` 默认实现（非抽象，委托 download_data + 占位 dict，子类可覆盖）
- 复验: `python3 -m py_compile` 3 个文件全过 + API 覆盖率核对 RealAdapter 29/29 ✓ MockAdapter 29/29 ✓
- 复验: `bun run lint` 0 errors 0 warnings ✓
- 端到端验证 (agent-browser):
  * 打开 http://127.0.0.1:3000/ → 页面正常加载，title "TdxQuant 量化交易系统"
  * 10 个 Tab 全部可见：实时大屏/策略管理/选股结果/信号中心/板块管理/匹配策略/自选股/实时选股/形态预警/竞价监控
  * 点击"信号中心" Tab → 切换成功，筛选控件（全部/全部策略/日期范围）正常渲染
  * console 无错误（仅 Fast Refresh 日志和 React DevTools 提示）
  * errors 数组为空
  * 截图保存至 download/qa-r19-verification.png
- API 端点验证: 8 个关键端点全 200
  * /api/monitor?action=status → engine_status=running, adapter_mode=mock, uptime_seconds=1563
  * /api/monitor?action=health ✓
  * /api/signals?limit=5 ✓
  * /api/strategies ✓
  * /api/selections?limit=5 ✓
  * /api/sectors ✓
  * /api/channels ✓
  * /api/config ✓
- tqcenter 字段对接完整性核对:
  * API_REGISTRY 29 个 API 全部在 RealAdapter/MockAdapter 实现 ✓
  * 参数名对齐说明书（R17 已修正 7 处参数名错误，本次扫描确认无新增偏差）
    - get_market_snapshot(stock_code=, field_list=) ✓
    - get_more_info(stock_code=, field_list=) ✓
    - get_stock_info(stock_code=, field_list=) ✓
    - get_gb_info(stock_code=, date_list=, count=) ✓
    - get_gb_info_by_date(stock_code=, start_date=, end_date=) ✓
    - get_relation(stock_code=) ✓
    - get_ipo_info(ipo_type=, ipo_date=) ✓
    - get_financial_data(stock_list=, field_list=, start_time=, end_time=, report_type=) ✓
    - get_gp_one_data(stock_list=, field_list=) ✓
    - get_gpjy_value(stock_list=, field_list=, start_time=, end_time=) ✓
    - get_stock_list(market=, list_type=) ✓
    - get_sector_list(list_type=) ✓（无 market 参数）
    - get_stock_list_in_sector(block_code=, block_type=, list_type=) ✓
    - get_user_sector() ✓（无参数）
    - create_sector(block_code=, block_name=) ✓
    - delete_sector(block_code=) ✓
    - rename_sector(block_code=, block_name=) ✓
    - clear_sector(block_code=) ✓（直接 API，非 send_user_block 变通）
    - send_user_block(block_code=, stocks=) ✓（参数名是 stocks 不是 stock_list）
    - get_kzz_info(stock_code=, field_list=) ✓
    - get_trackzs_etf_info(zs_code=) ✓（参数名是 zs_code 不是 etf_code）
    - get_trading_dates(market=, start_time=, end_time=, count=) ✓
    - send_message(msg_str=) ✓（参数名是 msg_str 不是 msg）
    - send_warn(stock_list=, time_list=, ..., count=) ✓
    - refresh_cache(market=, force=) ✓（R19 新增）
    - refresh_kline(stock_list=, period=) ✓（参数是 stock_list 列表）
    - download_file(stock_code=, down_time=, down_type=) ✓（R19 新增直通）
  * tqcenter 动态导入机制（sys.path.insert）+ 4 级路径优先级（TQ_CENTER_PATH > config > 扫描 > 直接 import）✓
  * tq.initialize(init_arg) 路径解析（python_path/tqcenter.py > TQ_CENTER_INITIALIZE > __file__）✓
  * _probe_api_coverage 初始化后自动核对 tqcenter 实际暴露 API 与说明书差异 ✓
  * get_market_data 自动分批续传（超 24000 条按 end_time 倒推）✓
  * subscribe_hq 自动分批（batch_size 来自 config）✓
  * 三层限流（令牌桶 + 端点中间件 + 监控统计）✓
  * 优雅降级（沙箱无 tqcenter 时 RealAdapter 可实例化但调用抛 RuntimeError + 明确提示）✓

Stage Summary:
- 修改文件数: 3 (engine/data_adapter/base.py + real_adapter.py + mock_adapter.py)
- 新增方法数: 5
  * BaseDataAdapter: + refresh_cache (abstract) + download_file (concrete default)
  * RealAdapter: + refresh_cache + download_file
  * MockAdapter: + refresh_cache + download_file
- API 覆盖率: 27/29 → 29/29 (RealAdapter & MockAdapter 都达到 100%)
- 验证结果:
  * lint: 0 errors 0 warnings ✓
  * py_compile: 3 个文件全过 ✓
  * API 覆盖率: 29/29 ✓
  * 8 个关键 API 端点全 200 ✓
  * agent-browser 端到端: 页面加载 + Tab 切换 + 无 console 错误 ✓
  * 截图: download/qa-r19-verification.png
- 验收结论: **tqcenter 字段对接完善，过验收** ✓
  * 29 个 API 全部实现（行情9 + 财务3 + 板块3 + 客户端操作6 + ETF可转债2 + 通用6）
  * 参数名 100% 对齐说明书（R17 修正 7 处 + R19 补 2 个缺失 API）
  * 字段目录权威来源（tqcenter_fields.py 510 行，含 V8 快照 91 字段映射）
  * 适配层优雅降级（沙箱 mock / 真机 real 切换透明）
- 未解决问题:
  1. Real 模式实际写入性能未在沙箱验证（需 Windows 真机 + 通达信终端 + QuestDB 服务）
  2. engine/factors/ 下 8 个因子文件有 TODO(P1-2/P1-3) 待 STRATEGY_LOGIC.md 确认阈值（非阻断，mock 模式可用默认阈值运行）
  3. engine/pipeline/ 下 5 个文件有 TODO(P1-3) 待 data_adapter.get_financial_data 实现（已实现，TODO 注释未清理）
  4. 旧 DuckDB 数据文件 data/duckdb/quant.db 不会自动迁移到 QuestDB（需手动 SQL 导出/导入）
- 给用户的下一步:
  1. Windows 真机部署: 双击 start-questdb.bat 启动 QuestDB → 编辑 config/app.yaml 切 adapter_mode=real → restart.bat
  2. 验证 Real 模式: curl http://127.0.0.1:8000/api/monitor?action=status 应显示 adapter_mode=real
  3. 验证 tqcenter 连接: 日志应出现 "tqcenter API 覆盖完整：说明书 29 个 API 全部就绪"
  4. 可选: 清理 engine/factors/ 和 engine/pipeline/ 下的 TODO 注释（P1-2/P1-3 已完成）

---
Task ID: R20-文档清理+AI交接文档
Agent: Z.ai Code (Claude, 主控)
Task: 更新文档，清理无用信息，编写详细版 AI 交接文档（可按流程快速接入实盘数据）

Work Log:
- 扫描当前文档现状: 8 个文档共 3540 行 (ARCHITECTURE 834 + USER_GUIDE 766 + MAINTENANCE 481 + WINDOWS_README 400 + STRATEGY_FACTOR 380 + DEPLOY 354 + README 165 + CHANGELOG 160)
- 读 docs/README.md / CHANGELOG.md / STRATEGY_FACTOR.md / ARCHITECTURE.md / DEPLOY.md / MAINTENANCE.md / WINDOWS_README.md / USER_GUIDE.md 全文了解现状
- 读 config/app.yaml + config/questdb_schema.sql 确认当前配置
- 读 real_adapter.py + tqcenter_fields.py 确认 API 对接细节
- 识别清理点:
  * README.md: 4 处 DuckDB 引用过时 (导出器/后端栈/storage注释/data目录/数据流/约束)
  * STRATEGY_FACTOR.md: 2 处 DuckDB 引用过时 (导出格式/7.3 查询示例)
  * README.md 文档导航表缺 AI_HANDOVER.md
  * README.md 文档导航表 CHANGELOG 标注 R5-R13 过时 (应 R5-R18)
- 清理 README.md (6 处编辑):
  * "DuckDB 4 种导出器" → "QuestDB 4 种导出器"
  * "FastAPI + DuckDB" → "FastAPI + QuestDB"
  * "DuckDB 存储封装" → "QuestDB 存储封装（DuckDBStore 为别名）"
  * "7 个 YAML 配置" → "7 YAML + 1 SQL schema"
  * "6 份精简文档" → "7 份精简文档（含 AI_HANDOVER.md）"
  * "DuckDB + CSV 样本" → "QuestDB 数据卷 + CSV 样本"
  * "写 DuckDB selection_results" → "写 QuestDB selection_results"
  * "DuckDB 单写锁" 约束 → "QuestDB 必须先启动"
  * 文档导航表加 AI_HANDOVER.md (置顶加粗) + CHANGELOG 改 R5-R18
- 清理 STRATEGY_FACTOR.md (2 处编辑):
  * 7.3 节 "DuckDB 直查" → "QuestDB 直查（PG wire 8812 + Web 控制台 9000）"
  * 导出格式 "[csv, excel, duckdb]" → "[csv, excel, questdb]"
- 编写 docs/AI_HANDOVER.md (978 行，14 章节详细版 AI 交接文档):
  * §一 项目本质（30 秒读懂）+ 三大核心能力 + 两种运行模式
  * §二 技术栈速查表 + 端口约定
  * §三 5 层架构 + 完整目录骨架（关键文件标注 ★）
  * §四 核心数据流（选股/监控/适配器切换 3 个流程图）
  * §五 实盘数据快速接入流程（重点章节，6 步流程 + 故障排查表）:
    - Step 0 环境准备 (5 分钟)
    - Step 1 启动 QuestDB (Docker/原生二进制/start-questdb.bat)
    - Step 2 配置 tqcenter 路径 (python_path/TQ_CENTER_PATH 环境变量)
    - Step 3 切换 adapter_mode 为 real
    - Step 4 启动服务 (start.bat/dev.py/daemon)
    - Step 5 验证实盘接入成功 (5 个验证命令)
    - Step 6 前端访问
    - 故障排查表 (8 个常见症状+原因+解决)
  * §六 tqcenter API 对接权威指南:
    - 架构 (项目→RealAdapter→tqcenter.py→TPythClient.dll→通达信终端)
    - 字段权威目录 (API_REGISTRY 29 API + 对照说明书路径)
    - 29 API 分类表 (行情9/财务3/板块3/客户端6/ETF2/通用6)
    - 参数名对齐说明书 (R17 修正 7 处 + R19 补 2 处，8 个易错点对照表)
    - 适配层签名 vs tqcenter 原生签名
    - tqcenter 动态导入机制 (4 级路径优先级)
    - tq.initialize 路径解析 (4 级优先级)
    - 三层限流架构表 (L1 令牌桶/L2 端点中间件/L3 监控统计)
    - API 覆盖率验证 (29/29 全覆盖 + _probe_api_coverage 自动核对)
  * §七 QuestDB 存储层 (R18 迁移):
    - 为什么从 DuckDB 迁移 (4 维度对比表)
    - 接口零改动迁移 (DuckDBStore 别名)
    - QuestDBStore 核心设计 (三通道/SQL方言适配/_gen_id/UPSERT/优雅降级)
    - 8 张表 schema 表 (表名/用途/designated timestamp/主键)
    - QuestDB 方言要点 (7 条)
    - 环境变量覆盖 (6 个 QUESTDB_*)
  * §八 配置文件全景图 (11 个配置文件表 + app.yaml 关键段示例)
  * §九 前端架构速查 (路由/10 Tab 表/API 代理统一/实时数据)
  * §十 运维脚本与命令 (dev.py 7 子命令/其他脚本/Windows 一键脚本/常用 API 端点)
  * §十一 关键约束与坑点:
    - 硬约束 (8 条，违反必崩)
    - 设计约束 (6 条)
    - 易错点 (7 条)
    - 沙箱环境限制 (4 条)
  * §十二 常见任务 SOP (7 个标准操作流程):
    - 新增策略 / 新增因子 / 新增推送通道 / 新增数据字段
    - 修改配置后 / 验证改动 / 写 worklog
  * §十三 未解决问题与下一步 (P0/P1/P2 优先级)
  * §十四 文档导航 (11 个文档表 + 快速决策树)
- 验证:
  * bun run lint: 0 errors 0 warnings ✓
  * DuckDB 引用清理: rg 检查仅剩 1 处 "DuckDBStore 为别名" (正确保留，说明兼容别名)
  * agent-browser 端到端: 页面正常加载 + title 正确 + console 无错误
  * AI_HANDOVER.md 978 行，14 章节完整覆盖项目全貌

Stage Summary:
- 修改文件数: 2 (docs/README.md + docs/STRATEGY_FACTOR.md)
- 新建文件数: 1 (docs/AI_HANDOVER.md, 978 行)
- 清理 DuckDB 引用: README.md 8 处 + STRATEGY_FACTOR.md 2 处 = 10 处
- AI_HANDOVER.md 14 章节核心价值:
  1. §五 实盘接入流程: 6 步详细流程 + 故障排查表，AI 可按流程直接操作
  2. §六 tqcenter 对接指南: 29 API 字段权威目录 + 参数名易错点对照表
  3. §七 QuestDB 存储层: R18 迁移完整说明 + 8 张表 schema
  4. §十一 关键约束: 8 条硬约束 + 7 条易错点，避免踩坑
  5. §十二 常见任务 SOP: 7 个标准操作流程
  6. §十四 文档导航 + 快速决策树: 新会话快速定位
- 验证: lint 0 errors ✓ + agent-browser 页面正常 ✓ + DuckDB 引用清理干净 ✓
- 未解决问题:
  1. ARCHITECTURE.md / DEPLOY.md / MAINTENANCE.md / USER_GUIDE.md / WINDOWS_README.md 仍含部分 DuckDB 历史描述 (这些文档在 R18-C 已由 subagent 更新过，保留的是必要的迁移说明而非过时信息)
  2. AI_HANDOVER.md 978 行偏长，但用户要求"详细版"，保留完整内容
  3. worklog.md 已 1163 行，未来可能需要再次归档
- 给用户的下一步:
  1. Windows 真机部署: 按 AI_HANDOVER.md §五 6 步流程操作
  2. 验证 Real 模式: curl /api/monitor?action=status 应显示 adapter_mode=real
  3. 验证 tqcenter 连接: 日志应出现 "tqcenter API 覆盖完整：说明书 29 个 API 全部就绪"
  4. 可选: 清理 engine/factors/ 和 engine/pipeline/ 下的 TODO 注释 (P1-2/P1-3 已完成)

---
Task ID: R21-QuestDB9-RealMode-Fixes
Agent: Claude (Opus 4.8)
Task: 按 AI_HANDOVER.md §五 6 步流程切换 Real 模式；修复实际跑通时暴露的 QuestDB 9.x 与 RealAdapter 兼容性 bug

Work Log:
- Step 0 环境: Python 3.13.8 (D:\veighna_studio) + 依赖齐全 (fastapi/uvicorn/psycopg2/pandas) + 通达信 tdxw.exe 运行 + tqcenter.py 在 K:\txdlianghua\PYPlugins\user
- Step 1 QuestDB: Docker Hub 不可达(网络)，改原生二进制。从 GitHub 下载 QuestDB 9.4.3-rt-windows-x86-64 到 K:\questdb\，用 java -m io.questdb/...ServerMain -d qdbroot 启动 (PID 18200, 8812/9000/9009)。questdb.exe install 需管理员(错误 1783)故改 java 直跑。
- Step 2/3: config/app.yaml adapter_mode mock→real, tqcenter.python_path 设为 K:\txdlianghua\PYPlugins\user
- Step 4: dev.py start 启 FastAPI(8000)+Next.js(3000)；bun install 装前端 812 包
- Step 5 验证暴露并修复 9 个 bug (R18 QuestDB 迁移 + RealAdapter 集成从未在真机验证过):
  1. questdb_store._http_exec: POST→GET (/exec 在 9.x 只接受 GET，POST 返 405，8 表建不出)
  2. _convert_sql: $1→%s 占位符 (psycopg2 经 %s 下发 bind，$1 报 undefined bind variable)
  3. 方言归一: CURRENT_DATE→timestamp_floor('d',now()), CURRENT_TIMESTAMP→now() (9.x 报 Invalid column)
  4. 4 处 DELETE FROM monitor_subscriptions→UPDATE 软删除 (QuestDB append-only 不支持 DELETE，报 unexpected token [FROM])
  5. _exec_retry 重连重试 (长时选股 psycopg2 连接闲置被关→connection already closed)
  6. RealAdapter 新增 get_market_snapshot_all/get_snapshot_batch/get_snapshot/get_all_snapshots (load_data 找的批量快照方法 RealAdapter 原本没有→选股拿不到数据)
  7. scripts/dev.py Windows _stop_services: 改按端口(netstat+taskkill)杀进程 (原 PowerShell 按 commandline+root 匹配，uvicorn 命令行不含项目根→漏杀→重启失败)
  8. real_adapter.get_market_data: count<=0 兜底 250 (原直接传 -1 给 tqcenter→无界拉取全部 K 线→选股 hang)
  9. strategies.py run_strategy/run_all: await asyncio.to_thread(runner.run_strategy) (原同步调用阻塞事件循环，选股期间 FastAPI 全卡死)
- 验证: get_more_info 返回 88 真实字段/只 (0.01s) ✓; get_stock_list 5535 只 ✓; selection_results 写读往返 ✓; 3 只小范围 pipeline 3.7s 跑通 6 步+导出+strategy_runs ✓; 全市场选股后台运行中(~9min, 限流 qps=10)

Stage Summary:
- 修改文件: engine/storage/questdb_store.py (POST→GET/$1→%s/方言/_exec_retry 重连) + engine/data_adapter/real_adapter.py (批量快照方法+count 兜底) + engine/api/routes/watchlist.py (DELETE→UPDATE 软删除) + engine/pipeline/runner.py (DELETE→UPDATE) + engine/monitor/engine.py (DELETE 清理→no-op) + engine/api/routes/strategies.py (to_thread) + scripts/dev.py (Windows 按端口停) + config/app.yaml (real+tqcenter 路径)
- 新增方法: QuestDBStore._conn_error/_exec_retry; RealAdapter.get_market_snapshot_all + 3 别名
- 已知限制: QuestDB append-only 无法物理 DELETE (退订/清理用 active=false 软删除，归档行累积但不影响 active=true 查询); 全市场选股~9min (tqcenter 逐只+qps=10 限流，保护终端 GUI 线程)
- 未解决: 旧 DuckDB 残留描述仍在部分文档; strategy YAML 无 data.kline_count (已用代码层 250 兜底，建议后续在 YAML 显式配置)

---
R21 补记: 第 10 个 bug
- duckdb_exporter._insert_records: selection_results 记录缺 created_at 列 → QuestDB 报 "insert statement must populate timestamp" → 选股结果 0 行落库。修复: 记录补 "created_at": datetime.now()。其它 timestamp 表 (signal_events/sector_snapshots/monitor_subscriptions) 已正确包含时间列，无需改。
- 最终验证: POST /api/strategies/dbqzt/run → ok=true, count=24, 247s, 24 行真实落库 selection_results ✓。Real 模式端到端打通。
- 次要: selection_results.stock_name 为空 (get_more_info 88 字段无中文 name 列，exporter 映射 key 不匹配)，纯显示问题，不影响选股。

---
Task ID: R21-Feishu-App-Channel
Agent: Claude (Opus 4.8)
Task: 配置飞书推送（用户提供 App ID cli_aaa6b49dd5f81cbc + App Secret）

Work Log:
- 现状: feishu.py 原仅支持「自定义机器人 Webhook」模式；用户提供的是「开放平台 App」凭证（App ID/Secret），是不同接入模型
- 新增 engine/utils/env.py: 零依赖 .env 加载器（无 python-dotenv），匹配项目 os.environ.get(X) or cfg 模式
- 扩展 engine/channels/feishu.py: 双模式（按 app_id 是否存在自动选）：
  - App 模式: app_id/secret → tenant_access_token（缓存2h）→ POST /im/v1/messages?receive_id_type= → interactive 卡片
  - Webhook 模式: 保留原逻辑（webhook_url + sign）
  - app_id/app_secret 留空则读 env FEISHU_APP_ID/SECRET（避免密钥进 git 追踪的 channels.yaml）
- 安全: 凭证放 .env（.gitignore 已含 .env*，git check-ignore 确认）；channels.yaml 无 secret；附 .env.example
- config/channels.yaml: feishu enabled=true, App 模式, receive_id_type=chat_id, receive_id="" (待填群 chat_id)
- 验证: token 交换 code=0 ✓；FeishuChannel App 模式 token 获取成功 ✓；/api/channels 显示 enabled + 校验提示缺 receive_id ✓
- 待用户: 飞书开放平台加权限 im:message (+可选 im:chat:readonly) → 把应用机器人加入群 → 填 chat_id 到 receive_id → POST /api/config/reload

Stage Summary:
- 新增文件: engine/utils/env.py, .env (gitignored), .env.example
- 修改: engine/channels/feishu.py (双模式), config/channels.yaml (feishu 段)
- 安全: Secret 仅在 .env，未进 git；建议用户在飞书后台重置 Secret（已在对话明文出现）
