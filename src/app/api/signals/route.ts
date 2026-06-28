/**
 * GET /api/signals — 信号列表
 *   query: type, strategy_id, start_date, end_date, limit
 */

import { tryFastAPI, ok, fallback } from '@/lib/api-proxy'
import type { SignalEvent } from '@/lib/api-proxy'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const params = Object.fromEntries(url.searchParams.entries())

  const r = await tryFastAPI(`/api/signals?${url.searchParams.toString()}`)
  if (r) return ok(await r.json())

  // 降级 mock：fallback 内部按 limit 生成（genSignals(limit * 2)），外层做后过滤
  const limit = params.limit ? Number(params.limit) : 50
  let signals = fallback('/api/signals', params) as SignalEvent[]

  if (params.type && params.type !== 'all') {
    signals = signals.filter((s) => s.type === params.type)
  }
  if (params.strategy_id && params.strategy_id !== 'all') {
    signals = signals.filter((s) => s.strategy_id === params.strategy_id)
  }
  if (params.start_date) {
    signals = signals.filter((s) => new Date(s.time) >= new Date(params.start_date))
  }
  if (params.end_date) {
    signals = signals.filter((s) => new Date(s.time) <= new Date(params.end_date + 'T23:59:59'))
  }

  return ok(signals.slice(0, limit))
}
