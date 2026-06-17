# Task ID: R7-B-策略复制+通知中心

**Agent**: full-stack-developer (subagent)
**Task**: 策略管理复制/删除 + 全局通知中心
**Date**: 2026-06-17
**Status**: ✅ 完成 (lint 0 错误, curl 测试全通过)

## 上下文
- 接续 R6 完成 (Dashboard 胜率排行 + 全局搜索 + 板块导出 + 信号筛选 + 对比导出)
- 项目当前阶段: P1+++ 稳定
- 必读文件全部读取: worklog.md / StrategyManager.tsx / page.tsx / config.py / strategies.py / api.ts / api-proxy.ts / config strategies route.ts / Providers.tsx / shadcn ui 目录
- 并行任务: R7-A 在改 Dashboard.tsx 和 SignalCenter.tsx, 本任务严格避免触碰这两个文件

## 工作记录

### 后端 (Python, 1 文件)
**engine/api/routes/config.py** - 新增 POST + DELETE 端点
- 新增 `StrategyCreateRequest` Pydantic 模型 (内联本路由文件, 与现有 StrategyConfigUpdateRequest 风格一致)
- 新增 `_STRATEGY_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_]+$")` 正则常量
- POST `/strategies`: 校验 ID 格式 + YAML 合法性 + 文件冲突 (409) + 写入 + reload
- DELETE `/strategies/{id}`: 校验 + 文件存在 (404) + 启用中阻止 (409) + unlink + reload

### 前端 (TypeScript, 7 文件)

**API 代理层**:
- `src/app/api/config/strategies/route.ts` - 新增 POST handler (保留 GET), 透传 4xx
- `src/app/api/config/strategies/[id]/route.ts` - 新增 DELETE handler (保留 PUT), 透传 4xx

**API 客户端** (`src/lib/api.ts`, 新增 ~30 行, 在 40 行预算内):
- `configAPI.createStrategy(strategy_id, yaml_content, overwrite=false)` → POST
- `configAPI.deleteStrategy(id)` → DELETE
- `StrategyCreateRequestDTO` 类型

**通知中心基础设施** (新文件):
- `src/lib/notifications.ts` (126 行) - Zustand store + notify 包装函数
  - store: items/unreadCount/add/markRead/markAllRead/clear/remove (最多 50 条 FIFO)
  - 包装: notifySuccess/Error/Warning/Info (同时调 sonner toast + 写入 store)
  - formatRelativeTime: 刚刚/X 分钟前/X 小时前/X 天前
- `src/components/quant/NotificationCenter.tsx` (191 行) - Popover UI
  - 触发: Bell 按钮 + 未读红点 (absolute -top-1 -right-1, 数字 tabular-nums)
  - PopoverContent: 360px sm:400px, align=end
  - 顶部: 标题 + 未读 Badge + "全部已读"/"清空" 按钮
  - 列表: max-h-400px 滚动, 每条图标(按类型染色)+标题(未读加粗)+描述+相对时间
  - 未读: 左侧琥珀色 2px 边框 + 琥珀色背景
  - 空状态: "暂无通知"

**策略管理 UI**:
- `src/components/quant/StrategyCard.tsx` - 新增 onCopy/onDelete props + Copy/Trash2 按钮
- `src/components/quant/StrategyManager.tsx` (515→899 行) - 新增 Copy + Delete Dialog
  - 工具函数 `transformStrategyYaml`: 行级替换 strategy_id/name/emoji + sector.code (ZD_{ID}01) + sector.name
  - Copy Dialog: 3 输入框 (ID/名/emoji) + 实时 YAML 预览 + 客户端 ID 预检 (regex + 重复)
  - Delete Dialog: 二次确认 (输入策略 ID 完全匹配) + 警告条 + 启用中阻止
  - 错误分类: 409 ID 冲突 / 409 启用中 / 400 YAML 解析 / 404 不存在

**page.tsx 集成** (`src/app/page.tsx`):
- header 在"搜索"和"运行全部"之间插入 <NotificationCenter />
- handleReloadConfig: toast.success/error → notifySuccess/notifyError
- handleRunAll: 保留 toast.loading + toast.success/error(id) 链路 (loading→success 必须用 id 串联)
  额外 useNotificationStore.getState().add() 写入通知历史
- footer sticky 不变

## QA 结果

| 验证项 | 结果 |
|--------|------|
| bun run lint (最终) | ✓ EXIT=0 |
| FastAPI /health (重启后) | ✓ 200 uptime=1s |
| POST /api/config/strategies (test_copy) | ✓ 200 返回 StrategyConfigFileItem |
| DELETE /api/config/strategies/test_copy | ✓ 200 {ok:true, deleted:...} |
| DELETE 已删除的策略 | ✓ 404 |
| POST 重复 ID | ✓ 409 |
| POST 非法 ID | ✓ 400 |
| POST 非法 YAML | ✓ 400 (含 YAML 解析错误详情) |
| DELETE 启用中的策略 | ✓ 409 |
| Next.js POST/DELETE 代理 | ✓ 200 + 409 透传 |
| 现有 GET/PUT 未破坏 | ✓ 200 |
| dev.log 编译 | ✓ Compiled in 176ms 无错误 |

## 文件清单 (8 个文件: 2 新增 + 6 修改)

### 新增
1. `/home/z/my-project/src/lib/notifications.ts` (126 行)
2. `/home/z/my-project/src/components/quant/NotificationCenter.tsx` (191 行)

### 修改
3. `/home/z/my-project/engine/api/routes/config.py` (+165 行)
4. `/home/z/my-project/src/app/api/config/strategies/route.ts` (新增 POST)
5. `/home/z/my-project/src/app/api/config/strategies/[id]/route.ts` (新增 DELETE)
6. `/home/z/my-project/src/lib/api.ts` (+30 行)
7. `/home/z/my-project/src/components/quant/StrategyCard.tsx` (+25 行)
8. `/home/z/my-project/src/components/quant/StrategyManager.tsx` (+384 行)
9. `/home/z/my-project/src/app/page.tsx` (+15 行)

## 严格约束遵守情况
- ✓ 不用 indigo/blue, 全用 var(--quant-primary) 琥珀金 + red/green/sky 语义色
- ✓ 不新建 test 文件
- ✓ 所有改动文件先 Read 再 Edit
- ✓ shadcn 组件全部直接 import (popover/dialog/input/label/button/badge)
- ✓ 不运行 bun run build, 用 bun run lint (EXIT=0)
- ✓ 不运行 bun run dev (系统自动)
- ✓ Footer sticky 未破坏
- ✓ 响应式: mobile 单列, desktop 多列 (grid-cols-1 sm:grid-cols-...)
- ✓ YAML 文件操作用 pathlib (Path.write_text / Path.unlink / Path.exists)
- ✓ 未修改 engine/api/main.py
- ✓ 未修改 src/components/quant/Dashboard.tsx (R7-A 保护区)
- ✓ 未修改 src/components/quant/SignalCenter.tsx (R7-A 保护区)
- ✓ src/lib/api.ts 新增 ~30 行 (在 40 行预算内)

## 未解决问题 / 后续建议
1. 通知历史仅存内存, 刷新页面后清空 → 可加 localStorage 持久化
2. notify* 仅迁移了 page.tsx, 其他组件保持 toast.* (按"渐进迁移"规范)
3. transformStrategyYaml 用行级正则替换, 对非常规格式可能失效 (现有 5 策略格式统一, 实测可用)
4. 复制时 excel_sheet_name 未自动更新 (用户可手动编辑)
5. 通知中心未做"按类型筛选" (success/error/warning/info)

## 给后续 subagent 的提示
- 通知 store API: `useNotificationStore.getState().add(type, title, desc)` (非 React 上下文也可调)
- 包装函数: `import { notifySuccess, notifyError, notifyWarning } from '@/lib/notifications'`
- 后端创建/删除策略 API 已就绪, 路径: POST/DELETE `/api/config/strategies[/{id}]`
- 复制策略时 sector.code 格式约定: `ZD_{STRATEGY_ID.upper()}01`
