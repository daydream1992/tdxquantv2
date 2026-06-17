# Task P1-5 · Web 前端骨架

**Agent**: frontend-general
**Stage**: P1（Web 骨架，可独立展示，含降级 Mock）
**Date**: 2026-06-17

## 目标
搭建 Next.js 16 单页应用，5 Tab 切换，专业金融深色风（琥珀金主色 + 红涨绿跌），主题可配置化，API routes 转发 FastAPI（带降级），让 P1 阶段前端可独立演示。

## 完成内容

### 1. 主题系统 `src/lib/theme.ts`
- `ThemeConfig` 接口 + `defaultTheme`（与 `config/theme.yaml` 对应）
- `ThemeProvider` 客户端组件：挂载后从 `/api/theme` 拉取，注入到 CSS 变量 `--quant-*` + 同步 shadcn 变量
- `useTheme()` / `useThemeMode()` 两个 Hook，支持运行时切换 dark/light
- 因 `.ts` 文件含 React Element，用 `React.createElement` 而非 JSX（避免 lint parse error）

### 2. Mock 数据 `src/lib/mock-data.ts`
- 完整 5 策略定义（与 `strategies/*.yaml` 一一对应），含 `yaml_content`
- 模拟股票池 30 只（贵州茅台、宁德时代等真实标的）
- `genSelections / genSignals / genSectors / genSectorStocks / genMonitorStatus / genQuotes` 生成器
- `MOCK_THEME` 默认主题（琥珀金 / 红涨 / 绿跌 / 深色背景）

### 3. API 客户端 `src/lib/api.ts`
- `fetchAPI<T>` 通用请求函数（no-store，统一错误处理）
- 6 个 API 模块：`strategyAPI / selectionAPI / signalAPI / sectorAPI / monitorAPI / themeAPI / configAPI`
- 完整 TypeScript DTO 类型定义
- `APIError` 错误类

### 4. 全局样式 `src/app/globals.css`
- `:root` + `.dark` 双套 CSS 变量（深色金融风）
- 量化专用语义色：`--quant-up/down/flat/primary/card/border/bg/font`
- 自定义滚动条样式（细 + 暗色 thumb）
- `.quant-table` 紧凑表格样式（sticky thead）
- 动画：`flash-up/down`（涨跌闪烁）、`slide-in`（信号流）、`status-pulse`（状态灯）、`ticker-enter`
- 工具类：`.text-up/down/flat/tabular-nums`

### 5. 量化专用组件 `src/components/quant/`
| 组件 | 功能 |
|------|------|
| `StockPrice.tsx` | 价格 + 涨跌幅（红涨绿跌）+ `PctBadge` 紧凑徽章 |
| `ScoreBadge.tsx` | 评分徽章（按阈值变色：高分暖红、中分橙黄、低分灰） |
| `StrategyCard.tsx` | 策略卡片（emoji + 状态 + 板块code + 上次选股 + 运行/查看按钮） |
| `SignalToast.tsx` | 信号弹窗（带类型图标 + 推送状态） + `SignalRow` 紧凑行 |
| `StockTable.tsx` | 通用表格（排序 + 分页 + 行展开 + max-h-96 滚动 + Skeleton 加载） |
| `TabLayout.tsx` | Tab 容器（移动端横向滚动 + 桌面等分） |
| `StatCard.tsx` | 统计卡片（含 trend 趋势 + 底部装饰条） |
| `EmptyState.tsx` | 空状态（可定制 icon + action） |
| `LoadingState.tsx` | 加载骨架（table / cards / list 三种 variant） |
| `Providers.tsx` | 客户端 Providers 聚合（ThemeProvider + Sonner） |

### 6. 5 个 Tab 页面
| Tab | 文件 | 关键能力 |
|-----|------|---------|
| 实时大屏 | `Dashboard.tsx` | 4 统计卡 + 实时行情滚动（10s 轮询）+ 信号流 + 5 策略概览 |
| 策略管理 | `StrategyManager.tsx` | 5 策略卡片网格 + 启停开关 + 运行 + YAML 配置 Dialog + 批量操作 + 刷新配置 |
| 选股结果 | `SelectionResults.tsx` | 筛选（策略/日期/最低分）+ 排序分页表 + 行展开因子详情 + CSV/Excel 导出 |
| 信号中心 | `SignalCenter.tsx` | 5 类型统计卡 + 筛选（类型/策略/日期）+ 信号流表 |
| 板块管理 | `SectorManager.tsx` | 策略↔板块映射卡 + 查看股票 Dialog + 手动刷新 |

### 7. 主页面 `src/app/page.tsx`
- `min-h-screen flex flex-col` + Footer `mt-auto`（sticky 底部）
- Header：Logo + 引擎状态指示灯（脉冲）+ 适配器模式 + 监控/今日信号数 + 主题切换 + 刷新配置 + 设置按钮
- Tab：5 个，移动端横向滚动，桌面等分；active 状态用琥珀金下划线
- Footer：版本/技术栈/适配器/涨跌色图例/心跳时间

### 8. API routes 转发层 `src/app/api/`
统一通过 `src/lib/api-proxy.ts` 的 `tryFastAPI()` 转发到 Python FastAPI（`XTransformPort=8000`，3s 超时），失败降级返回 Mock：

| 路径 | 方法 | 转发目标 |
|------|------|---------|
| `/api/strategies` | GET/POST | `/api/strategies` (+ 批量操作) |
| `/api/strategies/[id]` | GET/POST | `/api/strategies/{id}` (启停) |
| `/api/strategies/[id]/run` | POST | `/api/strategies/{id}/run` |
| `/api/selections` | GET | `/api/selections` (筛选) |
| `/api/selections/[runId]/export` | GET | `/api/selections/{runId}/export` (CSV mock) |
| `/api/signals` | GET | `/api/signals` (筛选) |
| `/api/sectors` | GET/POST | `/api/sectors` |
| `/api/sectors/[code]/stocks` | GET | `/api/sectors/{code}/stocks` |
| `/api/sectors/[code]/refresh` | POST | `/api/sectors/{code}/refresh` |
| `/api/monitor` | GET | `/api/monitor/status` / `/api/monitor/quotes` |
| `/api/theme` | GET | `/api/theme` |
| `/api/config` | POST | `/api/config/reload` |

### 9. layout.tsx 更新
- 默认 `<html className="dark">` + `lang="zh-CN"`
- metadata 更新为 TdxQuant
- 包裹 `<Providers>` 注入 ThemeProvider + Sonner Toaster

## 验证结果
- ✅ `bun run lint` 0 错误 0 警告
- ✅ `bun run dev` 启动正常（端口 3000）
- ✅ `GET /` 返回 200
- ✅ 所有 7 个 API 端点（含 mock 降级）返回 200
- ✅ 数据格式：策略 JSON / 选股 JSON / 信号 JSON / 板块 JSON / 监控状态 JSON 全部正常

## 创建的所有文件路径

```
src/lib/theme.ts                              # 主题系统
src/lib/api.ts                                # API 客户端
src/lib/api-proxy.ts                          # API 转发 + 降级工具
src/lib/mock-data.ts                          # Mock 数据 + 类型定义
src/app/globals.css                           # 全局样式（CSS 变量 + 滚动条 + 动画）
src/app/layout.tsx                            # 根 layout（更新）
src/app/page.tsx                              # 主页面（5 Tab + Header + Footer）
src/app/api/strategies/route.ts               # 策略列表 + 批量操作
src/app/api/strategies/[id]/route.ts          # 策略详情 + 启停
src/app/api/strategies/[id]/run/route.ts      # 触发运行
src/app/api/selections/route.ts               # 选股结果列表
src/app/api/selections/[runId]/export/route.ts # 导出 CSV/Excel
src/app/api/signals/route.ts                  # 信号列表
src/app/api/sectors/route.ts                  # 板块列表
src/app/api/sectors/[code]/stocks/route.ts    # 板块股票
src/app/api/sectors/[code]/refresh/route.ts   # 板块刷新
src/app/api/monitor/route.ts                  # 监控状态 + 行情
src/app/api/theme/route.ts                    # 主题配置
src/app/api/config/route.ts                   # 配置热加载
src/components/quant/Providers.tsx            # 客户端 Providers
src/components/quant/StockPrice.tsx           # 股票价格
src/components/quant/ScoreBadge.tsx           # 评分徽章
src/components/quant/StrategyCard.tsx         # 策略卡片
src/components/quant/SignalToast.tsx          # 信号弹窗
src/components/quant/StockTable.tsx           # 通用表格
src/components/quant/TabLayout.tsx            # Tab 容器
src/components/quant/StatCard.tsx             # 统计卡片
src/components/quant/EmptyState.tsx           # 空状态
src/components/quant/LoadingState.tsx         # 加载状态
src/components/quant/Dashboard.tsx            # Tab1: 实时大屏
src/components/quant/StrategyManager.tsx      # Tab2: 策略管理
src/components/quant/SelectionResults.tsx     # Tab3: 选股结果
src/components/quant/SignalCenter.tsx         # Tab4: 信号中心
src/components/quant/SectorManager.tsx        # Tab5: 板块管理
```

## 设计要点备忘
1. **降级策略**：所有 API route 调用 `tryFastAPI()` 3s 超时，失败返回 mock，保证 P1 阶段前端可独立演示，不阻塞 Python 团队
2. **A股惯例配色**：红涨绿跌（与西方相反），通过 CSS 变量 `--quant-up/down` 注入，主题切换时一并更新
3. **无 indigo/blue**：除少数系统级图标（如 cyan 用于「选股」类型徽章），主色严格用琥珀金
4. **Footer sticky**：根容器 `min-h-screen flex flex-col` + Footer `mt-auto`，内容不足一屏时贴底，超出时自然下推
5. **响应式**：Tab 在 sm 以下横向滚动，统计卡 grid-cols-2 → lg:grid-cols-4，策略卡 grid-cols-1 → xl:grid-cols-5
6. **信息密度**：表格用 0.8125rem 字号 + 0.5rem padding，`max-h-96 overflow-y-auto` + 自定义细滚动条
7. **动效**：行情行刷新 flash-up/down，信号流 slide-in，状态灯 status-pulse，按钮 hover 反馈
8. **可访问性**：所有按钮有 title / aria-label，表格 thead sticky，状态色同时辅以图标避免色盲困扰

## 后续阶段衔接
- **P1-6**（Python FastAPI）：API routes 中 `tryFastAPI()` 会自动转发到 8000 端口，无需改前端
- **P2**（WebSocket）：Dashboard 实时行情当前用 10s 轮询，可平滑替换为 `io('/?XTransformPort=3003')`，组件已预留 `QuoteDTO` 类型
- **P2**（多用户/权限）：可加 NextAuth.js，当前 layout 已支持扩展 Providers
