/**
 * GET /api/selections — 选股结果列表
 *   query: strategy_id, start_date, end_date, min_score, limit, run_id
 *
 * POST /api/selections — 批量操作（占位）
 */

import { tryFastAPI, ok, fallback } from '@/lib/api-proxy'
import type { SelectionRow } from '@/lib/api-proxy'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const params = Object.fromEntries(url.searchParams.entries())

  const r = await tryFastAPI(`/api/selections?${url.searchParams.toString()}`)
  if (r) return ok(await r.json())

  // 降级 mock：fallback 内部按 strategy_id/limit 生成，外层做后过滤
  let rows = fallback('/api/selections', params) as SelectionRow[]

  if (params.run_id) {
    rows = rows.filter((r) => r.run_id === params.run_id)
  }
  if (params.min_score) {
    const min = Number(params.min_score)
    rows = rows.filter((r) => r.score >= min)
  }
  if (params.start_date) {
    rows = rows.filter((r) => new Date(r.run_at) >= new Date(params.start_date))
  }
  if (params.end_date) {
    rows = rows.filter((r) => new Date(r.run_at) <= new Date(params.end_date + 'T23:59:59'))
  }

  return ok(rows)
}
