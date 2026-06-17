/**
 * GET /api/strategies/[id]/runs — 策略历史执行记录
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const r = await tryFastAPI(`/api/strategies/${id}/runs`)
  if (r) return ok(await r.json())

  // 降级 mock：返回空数组
  return ok([])
}
