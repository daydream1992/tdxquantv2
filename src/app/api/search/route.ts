/**
 * GET /api/search?q=<kw> — 全局搜索 (策略 / 股票 / 信号)
 */

import { tryFastAPI, ok, err } from '@/lib/api-proxy'
import type { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || ''
  const limit = req.nextUrl.searchParams.get('limit') || '20'
  if (!q.trim()) {
    return err('缺少参数 q', 400)
  }
  const r = await tryFastAPI(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`)
  if (r) return ok(await r.json())
  // 降级: 返回空结果
  return ok({ q, strategies: [], stocks: [], signals: [], total: 0 })
}
