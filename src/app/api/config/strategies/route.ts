/**
 * GET /api/config/strategies — 列出策略配置文件（含 yaml_content 原文）
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'

export async function GET() {
  const r = await tryFastAPI('/api/config/strategies')
  if (r) return ok(await r.json())

  // 降级 mock：返回空数组（前端会从 strategyAPI.list() 取 yaml_content）
  return ok([])
}
