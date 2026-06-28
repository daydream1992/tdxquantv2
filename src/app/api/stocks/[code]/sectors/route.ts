/**
 * GET /api/stocks/[code]/sectors
 *
 * 透传到 FastAPI GET /api/stocks/{code}/sectors
 *
 * 返回个股所属板块 (概念/行业/地区分组 + 其它), 含 from_cache 标记。
 *
 * Next.js 16 动态路由 params 为 Promise, 需 await。
 */

import { forwardFastAPI, relayJSON, err } from '@/lib/api-proxy'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const target = `/api/stocks/${encodeURIComponent(code)}/sectors`
  const r = await forwardFastAPI(target, { method: 'GET' })
  if (r) return relayJSON(r)
  return err('FastAPI 不可达', 502)
}
