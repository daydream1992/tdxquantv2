---
Task ID: R6-A-Dashboard+搜索
Agent: full-stack-developer (subagent)
Task: Dashboard 策略胜率排行卡片 + 全局搜索 Cmd+K

Work Log:
- 读取上下文: worklog.md (R5 章节), Dashboard.tsx, StatCard.tsx, StrategyCard.tsx,
  page.tsx, engine/api/routes/backtest.py, src/lib/api.ts, src/lib/api-proxy.ts,
  src/app/api/backtest/history/route.ts, src/components/ui/dialog.tsx, command.tsx,
  EmptyState.tsx, LoadingState.tsx, engine/api/deps.py, schemas.py, signals.py,
  selection.py, main.py, SelectionResults.tsx
- 数据现状确认: backtest_results 表有 6 条历史回测 (4 dbqzt + 2 cslx), 可直接用作排行数据
- FastAPI 运行中 (port 8000), /api/selections + /api/signals 数据正常

### 任务 1: 后端 - GET /api/backtest/leaderboard
- 文件: `engine/api/routes/backtest.py`
- 新增 Pydantic schemas: `BacktestLeaderboardItem` + `BacktestLeaderboardResponse`
- 新增路由 `GET /leaderboard`, 放在 `GET /{run_id}` 之前 (避免路径参数匹配冲突)
- 实现:
  * 从 backtest_results 表读全部记录, 按 created_at DESC 排序
  * 按 strategy_id 分组, 每组首条即为最新
  * 解析 result_json 提取 total_return/annual_return/max_drawdown/sharpe_ratio/win_rate/total_trades
  * run_count = 每个策略历史回测总数
  * 按 sharpe_ratio 降序排序
  * 表不存在或为空时返回 `{items: [], total: 0}` (不抛 500)

### 任务 2 + 3: 后端 - GET /api/search
- 新文件: `engine/api/routes/search.py` (约 320 行)
- 新增 schemas: `SearchStrategyItem` / `SearchStockItem` / `SearchSignalItem` / `SearchResponse`
- 路由 `GET /api/search?q=<kw>&limit=<n>`:
  * 策略: 从 cfg.strategies() 匹配 strategy_name / strategy_id / description
  * 股票: 从 selection_results 表匹配 stock_code / stock_name (DISTINCT + GROUP BY)
  * 信号: 从 signal_events 表匹配 condition_expr / stock_name / stock_code / alert_type
  * 每组最多 limit 条 (默认 20), total = 三组之和
  * 反查 strategy_name 填充 (避免前端二次查找)
- 注册到 main.py: `app.include_router(search_routes.router, prefix="/api/search")`

### 任务 4 + 5: 前端代理 + API 客户端
- 新文件: `src/app/api/backtest/leaderboard/route.ts` (GET 代理, 降级返回空排行)
- 新文件: `src/app/api/search/route.ts` (GET 代理, 缺 q 返回 400, 降级返回空结果)
- 修改 `src/lib/api.ts`:
  * 新增 `BacktestLeaderboardItemDTO` + `BacktestLeaderboardDTO` 类型
  * `backtestAPI.leaderboard()` 方法
  * 新增 `SearchStrategyItemDTO` / `SearchStockItemDTO` / `SearchSignalItemDTO` / `SearchResponseDTO` 类型
  * `searchAPI.search(q, limit)` 方法

### 任务 6: GlobalSearch.tsx 组件 (Cmd+K)
- 新文件: `src/components/quant/GlobalSearch.tsx` (约 730 行)
- forwardRef + useImperativeHandle 暴露 `open()` / `close()` (供 page.tsx header 按钮触发)
- 全局键盘监听: Cmd+K (Mac) / Ctrl+K (Win/Linux) 切换 open
- 搜索框: text-lg 大号, 左侧 Search 图标, 右侧 ESC 提示 + 清空按钮
- 顶部提示条: "⌘K 打开 · ↑↓ 选择 · Enter 确认" + 实时统计 + loading 指示
- 结果分组: 策略 / 股票 / 信号 / 操作, 每组带小标题 + 数量徽章
- 每项: 左侧图标 (按 kind 染色) + 主标题 + 副标题 + 右侧 Badge + active 时的 CornerDownLeft 图标
- 选中态: 琥珀色背景 (bg-amber-500/15) + 左侧 2px 主色边框
- 键盘导航: ↑↓ 移动 activeIdx, Enter 触发 action + 保存最近搜索, Esc 清空/关闭
- 鼠标 hover 同步 activeIdx, 自动 scrollIntoView
- 空状态: "输入关键词搜索策略/股票/信号"
- 无结果: "未找到匹配结果" (排除 action 项后判断)
- 失败: "搜索失败" + 错误详情
- 最近搜索: localStorage 持久化 (key=tdxquant-recent-searches, 最多 5 条), 打开时显示
- 快捷操作 (空 query): 实时大屏 / 策略管理 / 选股结果 / 切到回测视图 / 信号中心 / 板块管理 / 运行全部 / 切换主题 / 推送通道配置
- 快捷操作 (有 query 时也展示): 运行全部 / 切到回测 / 切换主题 / 推送通道配置
- 跳转回调: onNavigate (setTab) / onToggleTheme / onOpenSettings / onRunAll
- 切到回测视图: dispatch window event `tdxquant:show-backtest` + onNavigate('selections')
- debounce 200ms (setTimeout + cleanup)
- 关闭时重置 query / result / activeIdx, 打开时聚焦输入框
- Dialog 配置: sm:max-w-2xl, top-[12%] (顶部弹出), p-0 gap-0, showCloseButton=false, bg-quant-card
- 底部 footer: "TdxQuant Global Search · 策略 · 股票 · 信号"

### 任务 7: Dashboard 策略胜率排行卡片
- 新文件: `src/components/quant/StrategyLeaderboard.tsx` (约 220 行)
- 标题: Trophy 图标 + "策略胜率排行" + 副标题"基于历史回测数据 · 按夏普降序"
- 右上角: "查看全部回测" 按钮 (History 图标 + ChevronRight) -> 调用 onViewAll
- 数据源: backtestAPI.leaderboard(), 取前 5 名
- 每行:
  * 左侧: 排名徽章 (🥇/🥈/🥉/4/5) + 策略 emoji + 名称 + "回测 N 次 · 起止日期"
  * 中间: 胜率进度条 (背景 bg-quant-border, 填充 bg-gradient-to-r from-amber-500 to-amber-400)
  * 右侧: 4 mini stat 卡片 (总收益率/夏普/最大回撤/交易次数)
    - 总收益: 正 var(--quant-up) / 负 var(--quant-down) / 0 var(--quant-flat)
    - 夏普: var(--quant-primary)
    - 最大回撤: var(--quant-down) (必为负)
    - 交易数: var(--quant-flat)
- 排名第 1: 金色边框 (border-amber-500/40) + 微弱 glow (box-shadow 12px)
- 其他行: 透明边框 + hover 琥珀色背景
- 加载态: Loader2 spinner
- 空态: EmptyState "暂无回测数据, 请先在选股结果 Tab 中运行回测" + "去运行回测" 按钮
- 错误态: EmptyState 显示错误信息
- 响应式: mobile 单列堆叠 (flex-col), desktop 一行展示 (lg:flex-row)

### 任务 8: 集成到 page.tsx + SelectionResults
- `src/app/page.tsx`:
  * 新增 import: Search 图标 + GlobalSearch + GlobalSearchHandle 类型
  * 新增 ref: `searchRef = useRef<GlobalSearchHandle>(null)`
  * Header 新增 "搜索" 按钮 (Search 图标, ghost variant), onClick 调 searchRef.current?.open()
    + title "全局搜索 (⌘K / Ctrl+K)"
  * Dashboard 渲染时传入 `onNavigateToBacktest`: setTab('selections') + 100ms 后 dispatch
    `tdxquant:show-backtest` 事件 (等待 SelectionResults 挂载)
  * 底部挂载 `<GlobalSearch ref={searchRef} onNavigate={setTab} onToggleTheme={toggleMode}
    onOpenSettings={() => setSettingsOpen(true)} onRunAll={handleRunAll} />`
- `src/components/quant/Dashboard.tsx`:
  * 新增 import: StrategyLeaderboard
  * 新增 prop: `onNavigateToBacktest?: () => void`
  * 在 5 策略板块概览之后渲染 `<StrategyLeaderboard onViewAll={onNavigateToBacktest} />`
- `src/components/quant/SelectionResults.tsx`:
  * 新增 useEffect: 监听 window 事件 `tdxquant:show-backtest`, 触发 setViewMode('backtest')

### QA 验证 (curl + lint)

| 验证项 | 结果 |
|--------|------|
| `bun run lint` (最终) | ✓ EXIT=0 (0 错误 0 警告) |
| FastAPI /health (重启后) | ✓ 200 uptime_seconds=2 |
| GET /api/backtest/leaderboard | ✓ 200, 返回 2 个策略 (dbqzt sharpe=9.47 / cslx sharpe=1.97) |
| GET /api/search?q=弱转强 | ✓ 200, 命中 1 策略 + 2 信号 |
| GET /api/search?q=庄园 | ✓ 200, 命中 1 股票 (庄园牧场) + 多条信号 |
| GET /api/search?q=002910 | ✓ 200, 按股票代码命中 |
| GET /api/search?q=打板 | ✓ 200, 命中策略"打板求涨停" |
| GET /api/search?q=zxz (无匹配) | ✓ 200, 全 0 (不报错) |
| GET /api/search?q= (空) | ✓ 422 string_too_short (符合 Pydantic min_length=1) |
| Next.js /api/backtest/leaderboard 代理 | ✓ 200 |
| Next.js /api/search?q=打板 代理 | ✓ 200 |
| dev.log 编译 | ✓ 无错误, GET / 200 |
| Dashboard 轮询 leaderboard | ✓ dev.log 显示 200 in 12ms |

### 文件变更清单
```
后端 (Python) - 3 个文件:
  engine/api/routes/backtest.py    # 修改: 新增 /leaderboard 端点 + 2 个 schema
  engine/api/routes/search.py      # 新增: 全局搜索路由 (策略/股票/信号)
  engine/api/main.py               # 修改: 注册 search_routes

前端 (TypeScript) - 8 个文件:
  src/app/api/backtest/leaderboard/route.ts   # 新增: GET 代理
  src/app/api/search/route.ts                 # 新增: GET 代理
  src/lib/api.ts                              # 修改: backtestAPI.leaderboard + searchAPI + 7 个 DTO 类型
  src/components/quant/GlobalSearch.tsx       # 新增: 全局搜索组件 (Cmd+K, 约 730 行)
  src/components/quant/StrategyLeaderboard.tsx # 新增: 策略胜率排行卡片 (约 220 行)
  src/components/quant/Dashboard.tsx          # 修改: 新增 onNavigateToBacktest prop + 渲染排行卡片
  src/components/quant/SelectionResults.tsx   # 修改: 监听 tdxquant:show-backtest 事件
  src/app/page.tsx                            # 修改: header 搜索按钮 + GlobalSearch 集成 + Dashboard onNavigateToBacktest
```

Stage Summary:
- 已完成:
  1. 后端 /api/backtest/leaderboard: 按 strategy_id 聚合最新回测, 按 sharpe 降序, 返回 run_count + 完整指标
  2. 后端 /api/search: 跨策略/股票/信号搜索, ILIKE 大小写不敏感, 反查 strategy_name
  3. 前端 API 代理: leaderboard + search route.ts
  4. 前端 api.ts: backtestAPI.leaderboard() + searchAPI.search() + 7 个 DTO 类型
  5. GlobalSearch 组件: Cmd+K 打开, debounce 200ms, 键盘导航, 最近搜索 localStorage, 4 类分组 (策略/股票/信号/操作)
  6. StrategyLeaderboard 组件: 5 行排行 + 胜率进度条 + 4 mini stat + 第 1 名金色 glow
  7. Dashboard 集成: 底部新增排行卡片, onViewAll 跳转到选股结果 Tab 的回测视图
  8. page.tsx 集成: header 搜索按钮 + GlobalSearch ref + 4 个回调 (navigate/theme/settings/runAll)
  9. SelectionResults 监听 tdxquant:show-backtest 事件自动切到回测视图
- 文件变更: 3 后端 + 8 前端 = 11 个文件 (5 新增 + 6 修改)
- 未解决问题:
  1. 排行榜仅显示有回测数据的策略 (dbqzt + cslx), 其余 3 个策略需用户主动运行回测后才会出现
  2. GlobalSearch 的"切到回测视图"通过 window event 通信, SelectionResults 100ms 后才挂载,
     若用户切换 tab 速度极快可能错过事件 (已加 100ms 延迟, 实测可用)
  3. 搜索 DuckDB ILIKE 查询未加索引, 大数据量下可能慢 (当前 selection_results ~150 条, signal_events ~50 条, 无性能问题)
  4. GlobalSearch 在移动端键盘导航体验有限 (建议触摸点击), 但桌面端完整支持
- 下一阶段建议:
  1. R6-B subagent 接续: 因子插件补全 + K线图真实数据 + 策略对比导出
  2. 排行榜增加"按胜率/总收益切换排序"功能 (目前固定按 sharpe)
  3. GlobalSearch 增加搜索历史下拉, 已实现但可扩展"清空历史"按钮
  4. 搜索后端可加 FTS5 全文索引提升性能 (DuckDB 支持)
