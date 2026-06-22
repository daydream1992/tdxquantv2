/**
 * GET /api/sectors/[code]/stocks — 板块下的股票
 */

import { tryFastAPI, ok, err, fallback } from '@/lib/api-proxy'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const r = await tryFastAPI(`/api/sectors/${code}/stocks`)
  if (r) return ok(await r.json())

  if (!code) return err('code required', 400)
  return ok(fallback(`/api/sectors/${code}/stocks`))
}
