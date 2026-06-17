/**
 * GET /api/monitor/flow-ranking — 资金流向排行 (R7-A)
 *   query: count (1~200, default 50), metric (main_inflow|big_buy_ratio|turnover_rate)
 *
 * 透传到 FastAPI: /api/monitor/flow-ranking?count=...&metric=...
 * 降级: 返回空数组 (前端显示空态)
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'
import type { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const count = sp.get('count') || '50'
  const metric = sp.get('metric') || 'main_inflow'
  // 透传 query 到 FastAPI
  const r = await tryFastAPI(
    `/api/monitor/flow-ranking?count=${encodeURIComponent(count)}&metric=${encodeURIComponent(metric)}`
  )
  if (r) return ok(await r.json())
  // 降级: 空数组 (前端会显示 "暂无数据")
  return ok([])
}
