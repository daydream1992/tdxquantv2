# R13-3a 配置摘要页 - 工作记录

## 任务
消费后端已有的 `GET /api/config` 端点,在前端加一个"配置摘要"展示(让用户看到策略数/模板数/通道状态/路径等)。

## 实现要点

### 1. src/lib/api.ts
- 新增 `ConfigSummaryDTO` 类型,对齐后端 `ConfigSummaryResponse`
  - app/server/paths/strategies_count/strategies_enabled_count/alert_templates_count/match_strategies_count/channels
  - 可选: config_files / last_reload_at / fallback (前端代理降级标记)
- `configAPI.getSummary()` 方法: `fetchAPI<ConfigSummaryDTO>('/api/config')`

### 2. src/components/quant/ConfigSummary.tsx (~360 行)
- **触发**: `<DialogTrigger>` 包裹 Settings2 图标 ghost 按钮,头部常驻
- **Dialog**: `max-w-3xl` + `max-h-88vh`,Header 固定 + Body 滚动 (`overflow-y-auto quant-scroll`)
- **4 区块**:
  1. 应用信息 (grid 2x4 InfoCell): 应用名 / 版本 / 适配器模式 Badge (mock=amber, real=emerald) / 日志级别 / 服务地址 / 通道启用 / 配置文件数
  2. 统计概览 (grid 4 列 MiniStat): 策略总数 / 启用策略 / 预警模板 / 匹配策略
  3. 通道状态 (Card + ScrollArea max-h-40): 圆点 + name (mono) + Badge
  4. 关键路径: 5 个 KEY_PATHS (duckdb/strategies_dir/monitor_rules/match_strategies/channels) + 其他路径,每行带复制按钮
- **数据流**: Dialog open 时按需拉取,有数据不重复拉,刷新按钮强制重拉
- **状态**: Loading (Loader2 spin) / Error (AlertCircle + 重试) / Empty
- **复制**: `navigator.clipboard.writeText` → Check 图标 + toast

### 3. src/app/page.tsx
- import ConfigSummary
- 在 Actions 区域 NotificationCenter 后、运行全部按钮前插入 `<ConfigSummary />`
- 不加 tab,作为头部常驻按钮

## 验证

### bun run lint: exit 0

### 前端代理透传
```
curl http://localhost:3000/api/config
→ {app, server, paths, strategies_count:5, strategies_enabled_count:5, alert_templates_count:14, match_strategies_count:3, channels:[csv_log/websocket/tdx_warn 启用, feishu 禁用]}
```

### agent-browser
1. 打开 http://localhost:3000/
2. 头部按钮顺序: 全局搜索 / 通知中心 / **配置摘要** / 运行全部 / 热加载 / 切换主题 / 推送通道
3. 点击配置摘要 → Dialog 打开
4. 4 区块 heading 全部可见:
   - 应用信息 (h3)
   - 统计概览 (h3)
   - 通道状态 (3/4 启用) (h3)
   - 关键路径 (h3)
5. Dialog 内统计数字 (eval 提取): `13, 5, 5, 14, 3`
   - 13 = 配置文件数
   - 5 = 策略总数
   - 5 = 启用策略
   - 14 = 预警模板
   - 3 = 匹配策略
6. 通道列表可见: csv_log / websocket / tdx_warn / feishu
7. 关键路径: 5 个 + 其他路径 3 个 = 8 个复制按钮
8. 截图: `/home/z/my-project/agent-ctx/r13-3a-config-summary.png` (116KB)
9. console: 仅 HMR info,无 error
10. errors: 无输出

## 文件变更
- 新增: `src/components/quant/ConfigSummary.tsx` (~360 行)
- 修改: `src/lib/api.ts` (+24 行: ConfigSummaryDTO + configAPI.getSummary)
- 修改: `src/app/page.tsx` (+2 行: import + 在 NotificationCenter 后插入 <ConfigSummary />)
