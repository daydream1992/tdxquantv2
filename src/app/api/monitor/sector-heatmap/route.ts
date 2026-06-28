/**
 * GET /api/monitor/sector-heatmap — 监控池概念热度 Top N (R14-3 方案 B)
 *
 * 透传到 FastAPI: /api/monitor/sector-heatmap
 * 降级: 返回 {enabled: false, items: [], total_stocks: 0, ...} (前端隐藏整个卡片)
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'

export async function GET() {
  const r = await tryFastAPI('/api/monitor/sector-heatmap')
  if (r) return ok(await r.json())
  // 降级: 关闭态 + 空数据（前端 SectorHeatmap 组件 enabled=false 时返回 null）
  return ok({
    enabled: false,
    items: [],
    total_stocks: 0,
    scanned_stocks: 0,
    from_cache: false,
    fetched_at: '',
    duration_ms: 0,
  })
}
