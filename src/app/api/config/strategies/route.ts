/**
 * GET  /api/config/strategies — 列出策略配置文件（含 yaml_content 原文）
 * POST /api/config/strategies — 创建/复制策略 YAML 文件
 */

import { tryFastAPI, ok, err } from '@/lib/api-proxy'

const FASTAPI_PORT = '8000'
const FASTAPI_TIMEOUT_MS = 5_000

export async function GET() {
  const r = await tryFastAPI('/api/config/strategies')
  if (r) return ok(await r.json())

  // 降级 mock：返回空数组（前端会从 strategyAPI.list() 取 yaml_content）
  return ok([])
}

export async function POST(req: Request) {
  let body: {
    strategy_id?: string
    yaml_content?: string
    overwrite?: boolean
  } = {}
  try {
    body = await req.json()
  } catch {
    return err('invalid json body', 400)
  }
  if (!body.strategy_id || typeof body.strategy_id !== 'string') {
    return err('strategy_id is required', 400)
  }
  if (!body.yaml_content || typeof body.yaml_content !== 'string') {
    return err('yaml_content is required', 400)
  }

  // 直接调用 FastAPI（透传 4xx 错误：409 文件已存在 / 400 YAML 解析失败）
  const url = `http://127.0.0.1:${FASTAPI_PORT}/api/config/strategies`
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), FASTAPI_TIMEOUT_MS)
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
