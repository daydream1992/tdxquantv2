/**
 * GET /api/monitor/auction — 竞价强弱排行 (R13-2c)
 *   query: count (1~200, default 50, 仅 codes 未传时生效)
 *          codes (可选, 逗号分隔股票代码, 如 "600519.SH,000858.SZ")
 *
 * 透传到 FastAPI: /api/monitor/auction?count=...&codes=...
 * 降级: 返回 {items: [], count: 0, in_auction_hours: false}
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'
import type { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const count = sp.get('count') || '50'
  const codes = sp.get('codes') || ''
  // 透传 query 到 FastAPI
  const qs = `count=${encodeURIComponent(count)}${codes ? `&codes=${encodeURIComponent(codes)}` : ''}`
  const r = await tryFastAPI(`/api/monitor/auction?${qs}`)
  if (r) return ok(await r.json())
  // 降级: 空响应 (前端会显示 "暂无竞价数据" 空态)
  return ok({ items: [], count: 0, in_auction_hours: false })
}
