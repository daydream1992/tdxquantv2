/**
 * 代理转发到 FastAPI /api/monitor/match-strategies
 * 支持 GET(列表) / POST(新增) / PUT(改参) / DELETE(删除)
 * 子路径 /api/monitor/match-strategies/reload 和 /{id}/test 也走这里
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'

async function proxy(req: Request, subPath: string = '') {
  const method = req.method
  const body = ['POST', 'PUT', 'PATCH'].includes(method)
    ? await req.text().catch(() => undefined)
    : undefined

  const r = await tryFastAPI(`/api/monitor/match-strategies${subPath}`, {
    method,
    body,
  })
  if (r) return ok(await r.json())
  return ok({ error: 'FastAPI 不可达' }, 502)
}

export async function GET(req: Request) {
  return proxy(req, '')
}
export async function POST(req: Request) {
  const url = new URL(req.url)
  // /api/monitor/match-strategies/reload
  if (url.searchParams.get('action') === 'reload') {
    return proxy(req, '/reload')
  }
  return proxy(req, '')
}
