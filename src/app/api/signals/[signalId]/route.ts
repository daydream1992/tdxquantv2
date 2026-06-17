/**
 * GET /api/signals/[signalId] — 信号详情 (含 snapshot JSON, R7-A)
 *
 * 透传到 FastAPI: /api/signals/{signalId}
 * 失败: 返回 404 / 503 错误
 */

import { tryFastAPI, ok, err } from '@/lib/api-proxy'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ signalId: string }> }
) {
  const { signalId } = await params
  if (!signalId) return err('缺少 signalId', 400)

  const r = await tryFastAPI(`/api/signals/${encodeURIComponent(signalId)}`)
  if (r) return ok(await r.json())

  // 降级: FastAPI 不可用 / 信号不存在
  return err('信号详情加载失败 (FastAPI 不可用)', 503)
}
