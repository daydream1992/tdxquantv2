/**
 * GET /api/signals/[signalId]/related — 信号同板块联动股 (R14-3 方案 C)
 *
 * 透传到 FastAPI: /api/signals/{signalId}/related
 *
 * Next.js 16 动态路由 params 为 Promise, 需 await。
 * 注意：本路由与 /api/signals/[signalId]/route.ts 在同一段共享动态参数名 [signalId]，
 * 必须使用相同的参数名（Next.js 不允许同一层段使用不同 slug 名）。
 */

import { forwardFastAPI, relayJSON, err } from '@/lib/api-proxy'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ signalId: string }> }
) {
  const { signalId } = await params
  if (!signalId) return err('缺少 signalId', 400)
  const target = `/api/signals/${encodeURIComponent(signalId)}/related`
  const r = await forwardFastAPI(target, { method: 'GET' })
  if (r) return relayJSON(r)
  // 降级: FastAPI 不可达 → 返回关闭态 + 空数据（前端隐藏按钮/Popover）
  return err('FastAPI 不可达', 502)
}
