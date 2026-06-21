/**
 * DELETE /api/monitor/watchlist/[code]    移除单只监控
 *
 * 后端实际路径: DELETE /api/monitor/watchlist/{code}
 * 前端约定:    DELETE /api/monitor/watchlist/{code}  (path 参数形式,如 600519.SH)
 *
 * 注：与上层 `src/app/api/monitor/watchlist/route.ts` 的 DELETE handler(`?code=xxx` query 形式)
 *     并存。优先使用本动态路由(path 形式)—— `src/lib/api.ts:watchlistAPI.remove` 已采用此形式。
 *     query 形式保留仅为向后兼容,若不再有调用方后续可清理。
 *
 * Next.js 16 动态路由 params 为 Promise,需 await。
 */

import { forwardFastAPI, relayJSON, err } from '@/lib/api-proxy'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  // code 形如 "600519.SH" / "000001.SZ",encodeURIComponent 处理 "."(实际不需 encode,但保险起见)
  const r = await forwardFastAPI(
    `/api/monitor/watchlist/${encodeURIComponent(code)}`,
    { method: 'DELETE' }
  )
  if (r) return relayJSON(r)
  return err('FastAPI 不可达', 502)
}
