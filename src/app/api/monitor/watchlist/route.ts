/**
 * 代理转发到 FastAPI /api/monitor/watchlist
 * 支持 GET(列表) / POST(批量加入) / DELETE(移除)
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'

export async function GET(req: Request) {
  const r = await tryFastAPI('/api/monitor/watchlist')
  if (r) return ok(await r.json())
  return ok([])
}

export async function POST(req: Request) {
  const body = await req.text().catch(() => undefined)
  const r = await tryFastAPI('/api/monitor/watchlist', {
    method: 'POST',
    body,
  })
  if (r) return ok(await r.json())
  return ok({ error: 'FastAPI 不可达' }, 502)
}
