/**
 * GET /api/strategies — 策略列表
 * POST /api/strategies — 批量操作 { action: 'enable_all' | 'disable_all' | 'run_all' }
 */

import { tryFastAPI, ok, err, fallback, STRATEGIES, genSelections } from '@/lib/api-proxy'

export async function GET() {
  const r = await tryFastAPI('/api/strategies')
  if (r) return ok(await r.json())
  // 降级 mock
  return ok(fallback('/api/strategies'))
}

export async function POST(req: Request) {
  let body: { action?: string } = {}
  try {
    body = await req.json()
  } catch {
    return err('invalid body', 400)
  }

  // 尝试转发到 FastAPI
  const r = await tryFastAPI('/api/strategies', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (r) return ok(await r.json())

  // 降级 mock：mutate 内存中的 STRATEGIES
  if (body.action === 'enable_all') {
    STRATEGIES.forEach((s) => (s.enabled = true))
    return ok({ ok: true })
  }
  if (body.action === 'disable_all') {
    STRATEGIES.forEach((s) => (s.enabled = false))
    return ok({ ok: true })
  }
  if (body.action === 'run_all') {
    const results = STRATEGIES.filter((s) => s.enabled).map((s) => {
      const sel = genSelections(s.strategy_id, 20)
      const count = sel.length
      s.last_run_at = new Date().toISOString()
      s.last_run_stocks = count
      return { id: s.strategy_id, count }
    })
    return ok({ ok: true, results })
  }
  return err('unknown action', 400)
}
