/**
 * 代理转发到 FastAPI /api/monitor/match-strategies
 * 支持 GET(列表) / POST(新增 或 ?action=reload) / PUT(改参, body 含 match_id)
 *
 * - POST 默认: 新建 match
 * - POST ?action=reload: 热加载 YAML
 *
 * PUT/DELETE/test 由 [id]/route.ts 与 [id]/test/route.ts 处理（路径参数化）
 */

import { tryFastAPI, ok, err, forwardFastAPI, relayJSON } from '@/lib/api-proxy'

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
  // /api/monitor/match-strategies/reload （前端用 ?action=reload 触发）
  if (url.searchParams.get('action') === 'reload') {
    return proxy(req, '/reload')
  }
  // 新建 match_strategies.yaml 项；FastAPI 失败(409 重复等)需要保留状态码
  const body = await req.text().catch(() => undefined)
  const r = await forwardFastAPI('/api/monitor/match-strategies', {
    method: 'POST',
    body,
  })
  if (r) return relayJSON(r)
  return err('FastAPI 不可达', 502)
}
