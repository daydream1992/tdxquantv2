/**
 * POST /api/sectors/[code]/refresh — 手动刷新板块成份股
 */

import { tryFastAPI, ok, err } from '@/lib/api-proxy'
import { genSectorStocks } from '@/lib/mock-data'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const r = await tryFastAPI(`/api/sectors/${code}/refresh`, { method: 'POST' })
  if (r) return ok(await r.json())

  if (!code) return err('code required', 400)
  const stocks = genSectorStocks(code, 15)
  return ok({ ok: true, count: stocks.length })
}
