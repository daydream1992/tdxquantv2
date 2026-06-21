/**
 * GET  /api/config         — 当前配置摘要（脱敏）
 * POST /api/config/reload  — 热加载 YAML 配置
 */

import { tryFastAPI, ok } from '@/lib/api-proxy'

export async function GET() {
  const r = await tryFastAPI('/api/config')
  if (r) return ok(await r.json())
  return ok({
    app: { adapter_mode: 'mock' },
    strategies_count: 0,
    channels: [],
    fallback: true,
  })
}

export async function POST() {
  const r = await tryFastAPI('/api/config/reload', { method: 'POST' })
  if (r) return ok(await r.json())

  // 降级 mock
  return ok({
    ok: true,
    reloaded: [
      'strategies/*.yaml',
      'config/app.yaml',
      'config/sector_mapping.yaml',
      'config/channels.yaml',
      'config/theme.yaml',
      'config/monitor_rules.yaml',
    ],
  })
}
