/**
 * PUT /api/monitor/match-strategies/[id]    改参（部分更新，body 含要改的字段）
 * DELETE /api/monitor/match-strategies/[id] 删除（_default 返回 403 透传）
 */

import { forwardFastAPI, relayJSON, err } from '@/lib/api-proxy'

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.text().catch(() => undefined)
  const r = await forwardFastAPI(
    `/api/monitor/match-strategies/${encodeURIComponent(id)}`,
    { method: 'PUT', body }
  )
  if (r) return relayJSON(r)
  return err('FastAPI 不可达', 502)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const r = await forwardFastAPI(
    `/api/monitor/match-strategies/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  )
  if (r) return relayJSON(r)
  return err('FastAPI 不可达', 502)
}
