/**
 * GET /api/selections/[runId]/export?format=csv|excel
 * 导出选股结果为 CSV 或 Excel
 */

import { tryFastAPI, err } from '@/lib/api-proxy'
import { genSelections } from '@/lib/mock-data'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const url = new URL(_req.url)
  const format = url.searchParams.get('format') || 'csv'

  const r = await tryFastAPI(`/api/selections/${runId}/export?format=${format}`)
  if (r) {
    const buf = await r.arrayBuffer()
    return new Response(buf, {
      headers: {
        'Content-Type':
          format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="selection_${runId}.${format === 'csv' ? 'csv' : 'xlsx'}"`,
      },
    })
  }

  // 降级 mock：根据 run_id 反查策略
  const match = runId.match(/^R([A-Z]+)/)
  const sid = match ? match[1].toLowerCase() : undefined
  const rows = genSelections(sid, 200).filter((r) => r.run_id === runId)

  if (format === 'csv') {
    const headers = ['run_id', 'strategy_id', 'stock_code', 'stock_name', 'score', 'rank', 'run_at']
    const lines = [headers.join(',')]
    for (const r of rows) {
      lines.push(
        [r.run_id, r.strategy_id, r.stock_code, r.stock_name, r.score, r.rank, r.run_at]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      )
    }
    return new Response('\ufeff' + lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="selection_${runId}.csv"`,
      },
    })
  }

  // Excel 格式降级时返回 CSV（前端通过扩展名识别）
  if (rows.length === 0) return err('no data to export', 404)
  return err('excel export requires FastAPI backend', 501)
}
