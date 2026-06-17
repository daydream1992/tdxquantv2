/**
 * GET /api/channels — 通道列表与状态
 * PUT /api/channels — 批量更新通道配置
 */

import { tryFastAPI, ok, err } from '@/lib/api-proxy'

export async function GET() {
  const r = await tryFastAPI('/api/channels')
  if (r) return ok(await r.json())
  return ok({
    channels: [],
    config_path: 'config/channels.yaml',
    fallback: true,
  })
}

export async function PUT(req: Request) {
  let body: { channels?: Record<string, Record<string, unknown>> } = {}
  try {
    body = await req.json()
  } catch {
    return err('invalid body', 400)
  }
  const r = await tryFastAPI('/api/channels', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  if (r) return ok(await r.json())
  return err('FastAPI 不可用', 503)
}
