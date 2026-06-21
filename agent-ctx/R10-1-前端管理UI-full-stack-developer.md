# R10-1 前端管理 UI 工作记录

## Task
前端加 match-strategies 管理页 (CRUD+调参预览+test) 和 watchlist 管理页，作为两个新 tab 加到 `src/app/page.tsx`。

## 参考前置
- worklog.md R9-5a 段：后端 9 个 bug 已修(3 高 + 6 中)，含 _default 403 保护、test 路由扁平 body 兼容、watchlist DELETE 改归档 active=false
- worklog.md R9-6 段：补 match-strategies/watchlist 代理路由，GET/POST/reload/test 已通

## Work Log

### Step 0: 环境准备
- 启动 FastAPI (uvicorn 0.0.0.0:8000)，因后台进程被杀需用 `setsid` 启动；PID 2429 之后切换为 3469 (bun) + 3483 (next)
- 验证后端 3 个端点均正常：
  - GET /api/monitor/match-strategies → 200，3 项 (rzq_default/qzrfc_default/_default)
  - GET /api/monitor/watchlist → 200，~31 条订阅
  - POST /api/monitor/match-strategies/rzq_default/test 扁平 body → 200，命中 rzq_ignite
  - DELETE /api/monitor/match-strategies/_default → 403 {"detail":"不允许删除兜底套餐 _default"}
  - POST /api/monitor/watchlist + DELETE /api/monitor/watchlist/{code} → 200

### Step 1: 扩展 src/lib/api.ts (新增 6 个 DTO 接口 + 2 个 API 模块)
- MatchScopeDTO / MatchAlertDTO / MatchStrategyDTO / MatchListResponse
- MatchUpdateRequest (PUT 部分更新) / MatchCreateRequest (POST 新建)
- MatchTestParams (扁平 body: code/pct_change/volume_ratio/main_inflow/auction_pct)
- MatchTestHitDTO / MatchTestResponse (含命中条件 condition)
- matchStrategyAPI: list/create/update/remove/reload/test 共 6 个方法
- WatchlistItemDTO / WatchlistAddRequest / WatchlistAddResponse
- watchlistAPI: list/add/remove 共 3 个方法 (DELETE 走 /api/monitor/watchlist?code=xxx)

### Step 2: 改造 src/lib/api-proxy.ts (新增 2 个 helper)
- `forwardFastAPI(path, options)`: 不论 res.ok 与否都返回 Response，让 4xx 也能透传给前端
- `relayJSON(res)`: 把 FastAPI Response 转为 NextResponse，保留原 status code；
  FastAPI HTTPException 的 `detail` 字段自动展开为 `error` 以便前端 fetchAPI 解析

### Step 3: 补全代理路由
- `src/app/api/monitor/match-strategies/route.ts`: 改造 POST 透传，用 forwardFastAPI 让 409 重复等错误透传
- `src/app/api/monitor/match-strategies/[id]/route.ts` (新增): PUT 改参 + DELETE (用 `{ params }: Promise<{ id: string }>` + await params)
- `src/app/api/monitor/match-strategies/[id]/test/route.ts` (新增): POST 调参预览，透传 404 等
- `src/app/api/monitor/watchlist/route.ts`: 加 DELETE handler，把 query `?code=xxx` 转成 path param `/api/monitor/watchlist/{code}` 再透传

### Step 4: 创建 MatchStrategyManager.tsx (870 行)
- 顶部工具栏: "新建匹配策略" / "重载 YAML" / "刷新" 按钮 + 项数 Badge
- 卡片列表 (grid-cols-1 md:2 xl:3): 每张卡片显示
  * name / match_id (font-mono) + Switch (enabled 即时调 PUT)
  * strategy_id Badge (兜底时显示"全局兜底"灰色)
  * alerts 数 + high 优先级数 (destructive Badge)
  * scope 摘要 (markets/排ST/排停牌/排除码)
  * debounce_override (秒, 全局默认)
  * 前 3 条 alerts 预览 (alert_type + channels + 优先级圆点)
  * 操作: 编辑 / 测试 / 删除 ( _default 禁用删除按钮 )
- 编辑/新建 Dialog (sm:max-w-3xl):
  * 基础字段: match_id (update 不可改) / name / strategy_id 下拉(可选兜底) / debounce_override (留空=null)
  * enabled Switch
  * Scope 编辑: markets 多选按钮 (SH/SZ/BJ) + 排ST/排停牌 Switch + 排除码/仅含码 Input
  * Alerts 列表: 每条可编辑 alert_type / priority(下拉) / channels(多选按钮) / params(key-value 表单, 可加/删参数)
- 测试 Dialog (sm:max-w-2xl):
  * 5 个 Input: code (必填) / pct_change / volume_ratio / main_inflow / auction_pct
  * 测试结果 ScrollArea: 每条命中/未中卡片, 高亮命中, 显示 alert_type + priority + condition 表达式
- 删除 AlertDialog 二次确认 (destructive variant)，_default 会显示警告
- _default 删除失败时友好提示 "不允许删除兜底套餐 _default"
- 所有操作有 loading + sonner toast (含 toastId 链路)
- 用 Card / CardHeader / CardTitle / CardContent / Dialog / Switch / Button / Input / Label / Select / Badge / ScrollArea / Separator / AlertDialog

### Step 5: 创建 WatchlistManager.tsx (440 行)
- 顶部状态条 Card: 总数 / active 数 / inactive 数 + "刷新"按钮
- 按策略分组统计: 可点击的 Badge (点击设为筛选条件)
- 加入表单 Card: 股票代码 Input (逗号/空格分隔) + strategy_id 下拉 (_manual 默认 + 已有策略) + 加入按钮 (回车也可触发)
- 表格 Card: 7 列 (代码/策略/订阅方/订阅时间/状态/批次/操作)
  * 筛选: strategy_id 下拉 + 仅活跃 Switch + 清筛选
  * ScrollArea + max-h-96 处理长列表
  * active 用绿色 Badge, inactive 用灰色
  * 时间用 toLocaleString 格式化
  * 移除按钮调 DELETE?code=xxx
- 删除 AlertDialog 二次确认 (destructive variant)
- 所有操作有 loading + sonner toast
- 用 Table / TableHeader / TableRow / TableCell / Card / Select / Badge / ScrollArea / Switch / AlertDialog

### Step 6: 修改 src/app/page.tsx
- import Crosshair / Star 图标 + 2 个新组件
- TABS 数组追加 2 个 tab:
  * { value: 'match-strategies', label: '匹配策略', icon: Crosshair }
  * { value: 'watchlist', label: '自选股', icon: Star }
- TabsList grid-cols-5 → grid-cols-7
- main 区域追加 {tab === 'match-strategies'} 和 {tab === 'watchlist'} 两个条件渲染

### Step 7: 验证
- bun run lint → exit_code 0 (无任何 ESLint 错误)
- 后端 6 个端点 curl 全 200 (list/test/reload/POST watchlist/DELETE watchlist) + 1 个 403 (DELETE _default)
- 前端代理 7 个端点 curl 全 200/403 正确转发 (含 _default 403 + detail 字段透传)
- 页面 / 返回 200, HTML 包含 7 个 tab 标签 (含"匹配策略"和"自选股")

## Stage Summary

### 文件变更
新增 (3):
- src/components/quant/MatchStrategyManager.tsx (870 行)
- src/components/quant/WatchlistManager.tsx (440 行)
- src/app/api/monitor/match-strategies/[id]/route.ts (PUT/DELETE)
- src/app/api/monitor/match-strategies/[id]/test/route.ts (POST test)

修改 (4):
- src/lib/api.ts (追加 matchStrategyAPI + watchlistAPI + 6 个 DTO 接口)
- src/lib/api-proxy.ts (新增 forwardFastAPI + relayJSON 2 个 helper)
- src/app/api/monitor/match-strategies/route.ts (POST 改用 forwardFastAPI 透传错误)
- src/app/api/monitor/watchlist/route.ts (加 DELETE handler)
- src/app/page.tsx (TABS 数组 +2 个, TabsList grid-cols 改 7, main 区域加 2 个条件渲染)

### 验证结果
- bun run lint: exit_code 0 (0 error)
- 后端直接 curl:
  * GET  /api/monitor/match-strategies     → 200 (3 项)
  * POST /api/monitor/match-strategies/rzq_default/test → 200 (命中 rzq_ignite)
  * DELETE /api/monitor/match-strategies/_default → 403 {"detail":"不允许删除兜底套餐 _default"}
  * GET  /api/monitor/watchlist             → 200 (~31 条订阅)
  * POST /api/monitor/watchlist + DELETE    → 200
- 前端代理 curl (端口 3000):
  * 全部 6 个端点返回与后端一致 (含 403 透传 detail 字段)
- 前端页面 GET / → 200, HTML 含全部 7 个 tab 标签
- _default 删除: 卡片按钮禁用 + 后端 403 双重保护, 删除失败时 toast 友好提示

### 设计要点
1. 三层错误透传: FastAPI HTTPException {"detail":"..."} → forwardFastAPI 不拦截 4xx → relayJSON 把 detail 展开 error → 前端 fetchAPI 抛 APIError, 组件 catch 后 toast
2. DELETE _default 双重保护: (a) 卡片删除按钮 disabled (b) 后端 403 拒绝 (c) 前端 catch 检测 _default 关键字给友好 toast
3. 测试面板 5 个参数全部支持空值, 仅 code 必填, 数字字段空值不发送 (避免 0 误判)
4. scope 编辑用按钮组而不是多选 Select, 移动端体验更好
5. alerts 编辑用嵌套表单 + 动态加/删参数, params 数字字段 type=number step=any 支持小数阈值
6. WatchlistManager 顶部"按策略分组"Badge 可点击直接设为筛选条件, 减少 Select 操作
7. 长列表用 ScrollArea + max-h-96, 配合 tabular-nums 让数字列对齐
