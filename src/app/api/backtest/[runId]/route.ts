/**
 * GET /api/backtest/[runId] — 单次回测详情
 */

import { tryFastAPI, ok, err } from '@/lib/api-proxy'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const r = await tryFastAPI(`/api/backtest/${encodeURIComponent(runId)}`)
  if (r) return ok(await r.json())
  return err('FastAPI 不可用', 503)
}
