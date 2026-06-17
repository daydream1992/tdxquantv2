/**
 * POST /api/backtest/run — 启动一次回测
 *
 * 请求体：BacktestParamsDTO
 * 响应：BacktestResultDTO
 */

import { tryFastAPI, ok, err } from '@/lib/api-proxy'

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return err('invalid body', 400)
  }
  if (!body.strategy_id || !body.start_date || !body.end_date) {
    return err('missing required fields: strategy_id / start_date / end_date', 400)
  }
  const r = await tryFastAPI('/api/backtest/run', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (r) return ok(await r.json())
  return err('FastAPI 不可用', 503)
}
