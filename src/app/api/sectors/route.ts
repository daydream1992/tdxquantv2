/**
 * GET /api/sectors — 板块列表
 * POST /api/sectors — 占位（创建/更新板块）
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'
import { genSectors } from '@/lib/mock-data'

export async function GET() {
  const r = await tryFastAPI('/api/sectors')
  if (r) return ok(await r.json())
  return ok(genSectors())
}

export async function POST() {
  const r = await tryFastAPI('/api/sectors', { method: 'POST' })
  if (r) return ok(await r.json())
  return ok({ ok: true })
}
