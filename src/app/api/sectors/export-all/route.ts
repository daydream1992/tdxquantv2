/**
 * GET /api/sectors/export-all?format=csv|excel
 * 代理 FastAPI 的 "导出全部板块成份股" 端点, 透传二进制流。
 */

import { tryFastAPI, err } from '@/lib/api-proxy'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const format = url.searchParams.get('format') === 'excel' ? 'excel' : 'csv'

  const r = await tryFastAPI(`/api/sectors/export-all?format=${format}`)
  if (!r) {
    return err('FastAPI 不可达或暂无板块数据可导出', 502)
  }

  const buf = await r.arrayBuffer()
  const ext = format === 'csv' ? 'csv' : 'xlsx'
  const contentType =
    format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  return new Response(buf, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="sectors_all.${ext}"`,
      'Cache-Control': 'no-store',
    },
  })
}
