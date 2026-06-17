/**
 * GET /api/theme — 主题配置（与 config/theme.yaml 对应）
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'
import { MOCK_THEME } from '@/lib/mock-data'

export async function GET() {
  const r = await tryFastAPI('/api/theme')
  if (r) return ok(await r.json())
  return ok(MOCK_THEME)
}
