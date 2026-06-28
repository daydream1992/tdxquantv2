/**
 * POST /api/channels/signals/[signalId]/repush — 重新推送某条历史信号
 */

import { tryFastAPI, ok, err } from '@/lib/api-proxy'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ signalId: string }> }
) {
  const { signalId } = await params
  const r = await tryFastAPI(
    `/api/channels/signals/${encodeURIComponent(signalId)}/repush`,
    { method: 'POST' }
  )
  if (r) return ok(await r.json())
  return err('FastAPI 不可用', 503)
}
