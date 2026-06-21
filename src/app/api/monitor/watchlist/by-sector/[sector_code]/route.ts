/**
 * POST /api/monitor/watchlist/by-sector/[sector_code]
 *
 * 透传到 FastAPI POST /api/monitor/watchlist/by-sector/{sector_code}
 *
 * 后端参数 (query string, 非 body):
 *   - strategy_id  默认 "_manual"
 *   - subscriber   默认 "api_watchlist_sector"
 *
 * body 可空；query string 原样透传给 FastAPI。
 *
 * Next.js 16 动态路由 params 为 Promise, 需 await。
 */

import { forwardFastAPI, relayJSON, err } from '@/lib/api-proxy'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sector_code: string }> }
) {
  const { sector_code } = await params
  const url = new URL(req.url)
  const qs = url.search // 含 "?"
  const body = await req.text().catch(() => undefined)
  const target = `/api/monitor/watchlist/by-sector/${encodeURIComponent(sector_code)}${qs}`
  const r = await forwardFastAPI(target, {
    method: 'POST',
    body,
  })
  if (r) return relayJSON(r)
  return err('FastAPI 不可达', 502)
}
