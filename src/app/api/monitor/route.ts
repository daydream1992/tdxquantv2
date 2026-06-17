/**
 * GET /api/monitor/status — 监控状态
 * GET /api/monitor/quotes — 实时行情快照（mock）
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'
import { genMonitorStatus, genQuotes } from '@/lib/mock-data'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const path = url.searchParams.get('action') || 'status'

  if (path === 'quotes') {
    const r = await tryFastAPI('/api/monitor/quotes')
    if (r) return ok(await r.json())
    return ok(genQuotes(12))
  }

  // status
  const r = await tryFastAPI('/api/monitor/status')
  if (r) return ok(await r.json())
  return ok(genMonitorStatus())
}
