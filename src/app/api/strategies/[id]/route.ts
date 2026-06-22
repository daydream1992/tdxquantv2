/**
 * GET /api/strategies/[id] — 单个策略详情（含 yaml_content）
 * POST /api/strategies/[id] — 启用/禁用（body: { enabled: boolean }）
 */

import { tryFastAPI, ok, err, fallback, STRATEGIES } from '@/lib/api-proxy'
import type { StrategyInfo } from '@/lib/api-proxy'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const r = await tryFastAPI(`/api/strategies/${id}`)
  if (r) return ok(await r.json())

  const s = fallback(`/api/strategies/${id}`) as StrategyInfo | null
  if (!s) return err('strategy not found', 404)
  return ok(s)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  let body: { enabled?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    /* noop */
  }

  const r = await tryFastAPI(`/api/strategies/${id}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (r) return ok(await r.json())

  // 降级 mock：直接 mutate 内存中的 STRATEGIES
  const s = STRATEGIES.find((x) => x.strategy_id === id)
  if (!s) return err('strategy not found', 404)
  if (typeof body.enabled === 'boolean') s.enabled = body.enabled
  return ok({ ok: true, strategy: s })
}
