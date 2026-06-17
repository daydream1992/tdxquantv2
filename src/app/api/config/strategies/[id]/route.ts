/**
 * PUT    /api/config/strategies/[id] — 在线更新策略 YAML
 *   body: { yaml_content: string, enabled?: boolean }
 *
 * DELETE /api/config/strategies/[id] — 删除策略 YAML 文件
 */

import { ok, err } from '@/lib/api-proxy'

const FASTAPI_PORT = '8000'
const FASTAPI_TIMEOUT_MS = 5_000

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  let body: { yaml_content?: string; enabled?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    return err('invalid json body', 400)
  }
  if (!body.yaml_content || typeof body.yaml_content !== 'string') {
    return err('yaml_content is required', 400)
  }

  // 直接调用 FastAPI（不走 tryFastAPI，以便透传 422 等错误响应）
  const url = `http://127.0.0.1:${FASTAPI_PORT}/api/config/strategies/${id}`
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), FASTAPI_TIMEOUT_MS)
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(t)

    if (r.ok) {
      return ok(await r.json())
    }
    // FastAPI 返回错误（如 YAML 解析失败 / strategy_id 不一致）
    let detail = `FastAPI ${r.status}`
    try {
      const data = await r.json()
      detail = data.detail || detail
    } catch {
      /* noop */
    }
    return err(detail, r.status)
  } catch (e) {
    return err(`FastAPI 不可达: ${(e as Error).message}`, 503)
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const url = `http://127.0.0.1:${FASTAPI_PORT}/api/config/strategies/${id}`
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), FASTAPI_TIMEOUT_MS)
    const r = await fetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(t)

    if (r.ok) {
      return ok(await r.json())
    }
    let detail = `FastAPI ${r.status}`
    try {
      const data = await r.json()
      detail = data.detail || detail
    } catch {
      /* noop */
    }
    return err(detail, r.status)
  } catch (e) {
    return err(`FastAPI 不可达: ${(e as Error).message}`, 503)
  }
}
