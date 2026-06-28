/**
 * GET /api/monitor/status — 监控状态
 * GET /api/monitor/quotes — 实时行情快照（mock）
 * GET /api/monitor?action=health — 引擎健康度（P1）
 * GET /api/monitor?action=subscriptions — 订阅列表
 */

import { tryFastAPI, ok, fallback } from '@/lib/api-proxy'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const path = url.searchParams.get('action') || 'status'

  if (path === 'quotes') {
    // 透传 count 参数（默认 12，最大 200）
    const count = url.searchParams.get('count') || '12'
    const r = await tryFastAPI(`/api/monitor/quotes?count=${count}`)
    if (r) return ok(await r.json())
    return ok(fallback('/api/monitor/quotes', { count }))
  }

  if (path === 'health') {
    // P1: 引擎健康度
    const r = await tryFastAPI('/api/monitor/health')
    if (r) return ok(await r.json())
    return ok({ status: 'unknown', error: 'FastAPI 不可达' })
  }

  if (path === 'subscriptions') {
    const r = await tryFastAPI('/api/monitor/subscriptions')
    if (r) return ok(await r.json())
    return ok([])
  }

  // status
  const r = await tryFastAPI('/api/monitor/status')
  if (r) return ok(await r.json())
  return ok(fallback('/api/monitor/status'))
}
