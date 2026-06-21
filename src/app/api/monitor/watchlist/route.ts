/**
 * 代理转发到 FastAPI /api/monitor/watchlist
 * 支持 GET(列表) / POST(批量加入) / DELETE(?code=xxx)
 *
 * 后端实际路径: DELETE /api/monitor/watchlist/{code}
 * 前端约定:    DELETE /api/monitor/watchlist?code=xxx
 * 这里把 query 转成 path param 再透传给 FastAPI
 */

import { tryFastAPI, ok, err, forwardFastAPI, relayJSON } from '@/lib/api-proxy'

export async function GET(_req: Request) {
  const r = await tryFastAPI('/api/monitor/watchlist')
  if (r) return ok(await r.json())
  return ok([])
}

export async function POST(req: Request) {
  const body = await req.text().catch(() => undefined)
  const r = await tryFastAPI('/api/monitor/watchlist', {
    method: 'POST',
    body,
  })
  if (r) return ok(await r.json())
  return ok({ error: 'FastAPI 不可达' }, 502)
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  if (!code) return err('缺少 code 参数', 400)
  const r = await forwardFastAPI(
    `/api/monitor/watchlist/${encodeURIComponent(code)}`,
    { method: 'DELETE' }
  )
  if (r) return relayJSON(r)
  return err('FastAPI 不可达', 502)
}
