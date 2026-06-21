/**
 * GET /api/monitor/rules — 列出所有 alert_templates（R13-1b）
 *
 * 透传到 FastAPI: /api/monitor/rules
 * 用途: MatchStrategyManager 编辑 alerts 时，alert_type 改为下拉选择
 *       选中模板后自动填入 default_params
 * 降级: FastAPI 不可达时返回空列表（前端会回退为 Input 自由输入）
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'

export async function GET() {
  const r = await tryFastAPI('/api/monitor/rules')
  if (r) return ok(await r.json())
  // 降级: 空列表（前端 EditForm 会自动回退为 Input 自由输入）
  return ok({ templates: [], count: 0 })
}
