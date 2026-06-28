/**
 * POST /api/sectors/[code]/refresh — 手动刷新板块成份股
 */

import { tryFastAPI, ok, err, fallback } from '@/lib/api-proxy'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const r = await tryFastAPI(`/api/sectors/${code}/refresh`, { method: 'POST' })
  if (r) return ok(await r.json())

  if (!code) return err('code required', 400)
  return ok(fallback(`/api/sectors/${code}/refresh`))
}
