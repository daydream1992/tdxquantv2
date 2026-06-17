/**
 * POST /api/strategies/[id]/run — 触发策略运行
 */

import { tryFastAPI, ok, err } from '@/lib/api-proxy'
import { STRATEGIES, genSelections } from '@/lib/mock-data'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const r = await tryFastAPI(`/api/strategies/${id}/run`, { method: 'POST' })
  if (r) return ok(await r.json())

  // 降级 mock
  const s = STRATEGIES.find((x) => x.strategy_id === id)
  if (!s) return err('strategy not found', 404)
  if (!s.enabled) return err('strategy disabled', 400)

  const sel = genSelections(id, 20)
  const count = sel.length
  s.last_run_at = new Date().toISOString()
  s.last_run_stocks = count
  const runId = `R${id.toUpperCase()}${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
  return ok({ ok: true, run_id: runId, count })
}
