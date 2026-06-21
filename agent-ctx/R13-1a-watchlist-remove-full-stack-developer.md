# R13-1a 修自选股"移除"按钮 404 bug

## Task
- Task ID: R13-1a
- Agent: full-stack-developer
- 日期: 2025-06-21

## Bug 根因
- `src/lib/api.ts` 的 `watchlistAPI.remove(code)` 调用 `DELETE /api/monitor/watchlist/${code}` (path 参数形式)
- 但前端代理只有 `src/app/api/monitor/watchlist/route.ts`,其 DELETE handler 处理的是 `?code=xxx` (query 参数形式)
- 缺失 `src/app/api/monitor/watchlist/[code]/route.ts` 动态路由
- 结果:前端发 `DELETE /api/monitor/watchlist/600519.SH` → Next.js 找不到匹配的代理路由 → **404**

## 文件变更
- **新增**: `src/app/api/monitor/watchlist/[code]/route.ts`
  - DELETE handler,从 `params.code` (Promise,await) 取股票代码
  - 用 `forwardFastAPI` 透传到后端 `DELETE /api/monitor/watchlist/${encodeURIComponent(code)}`
  - 结构照抄 `src/app/api/monitor/match-strategies/[id]/route.ts` (R10-1 已验证的动态路由模式)
- **修改**: `src/app/api/monitor/watchlist/route.ts`
  - 在文件顶部注释中加说明:本 DELETE handler 处理 query 形式(`?code=xxx`),仅为向后兼容保留;新代码请优先走 `[code]` 动态路由
- **未改**: `src/lib/api.ts` 的 `watchlistAPI.remove` (line 706-710) 已经是 path 形式 `fetchAPI(\`/api/monitor/watchlist/${encodeURIComponent(code)}\`, { method: 'DELETE' })`,无需修改

## 验证结果
| 验证项 | 结果 |
|--------|------|
| `bun run lint` | exit 0 ✓ |
| 后端直连 `DELETE http://localhost:8000/api/monitor/watchlist/600519.SH` | 200 ✓ |
| 后端 POST 加 `999999.SH` | added 1 ✓ |
| 前端代理 `DELETE http://localhost:3000/api/monitor/watchlist/999999.SH` | **200** ✓ (修复前 404) |
| agent-browser: 切到"自选股"tab | 选中"自选股" ✓ |
| agent-browser: 点 999999.SH 行的"移除"按钮 | 弹出确认 Dialog (含"确认移除"按钮) ✓ |
| 后端 BEFORE confirm | 999999.SH 在池中,total=32 |
| agent-browser: 点"确认移除"按钮 | ✓ |
| 后端 AFTER confirm | 999999.SH **已移除**,total=31 ✓ |
| 截图保存 | `/home/z/my-project/agent-ctx/r13-1a-watchlist-remove.png` (1440x900, 118KB) ✓ |

## 结论
- 根因:前端代理缺少 `[code]` 动态路由,导致 path 形式的 DELETE 请求 404
- 修复:新增 `src/app/api/monitor/watchlist/[code]/route.ts` 动态路由,与 `match-strategies/[id]` 模式一致
- 移除功能现已完全可用
