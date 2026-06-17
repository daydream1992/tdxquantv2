/**
 * GET /api/backtest/leaderboard — 策略胜率排行 (按 sharpe 降序)
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'
import type { NextRequest } from 'next/server'

export async function GET(_req: NextRequest) {
  const r = await tryFastAPI('/api/backtest/leaderboard')
  if (r) return ok(await r.json())
  // 降级: 返回空排行
  return ok({ items: [], total: 0 })
}
