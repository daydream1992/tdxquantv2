/**
 * GET /api/backtest/history — 历史回测列表
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'

export async function GET() {
  const r = await tryFastAPI('/api/backtest/history')
  if (r) return ok(await r.json())
  // 降级：返回空数组
  return ok([])
}
