/**
 * 通用 API 转发工具
 * - 转发到 Python FastAPI（端口 8000，通过 XTransformPort）
 * - 失败时降级返回 mock 数据（fallback() 内部维护 path → 数据映射表）
 */

import { NextResponse } from 'next/server'

const FASTAPI_PORT = '8000'
const FASTAPI_TIMEOUT_MS = 3_000

/** 尝试转发到 FastAPI；超时/不可达返回 null（由调用方降级） */
export async function tryFastAPI(
  path: string,
  options: RequestInit = {}
): Promise<Response | null> {
  // 服务端直接用绝对地址访问 FastAPI；浏览器端用相对路径 + XTransformPort
  const isServer = typeof window === 'undefined'
  const url = isServer
    ? `http://127.0.0.1:${FASTAPI_PORT}${path.startsWith('/') ? path : '/' + path}`
    : `/${path.replace(/^\//, '')}?XTransformPort=${FASTAPI_PORT}`
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), FASTAPI_TIMEOUT_MS)
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      cache: 'no-store',
    })
    clearTimeout(t)
    if (!res.ok) return null
    return res
  } catch {
    return null
  }
}

/** JSON 成功响应 */
export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

/** JSON 错误响应 */
export function err(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * 直接转发到 FastAPI：不论 res.ok 与否，都把状态码与 body 原样回给调用方。
 * 用于 DELETE/PUT 等需要把后端的 4xx (如 403 _default 保护) 透传给前端的场景。
 *
 * 失败模式（网络异常 / 超时）返回 null，由调用方自行决定降级。
 */
export async function forwardFastAPI(
  path: string,
  options: RequestInit = {}
): Promise<Response | null> {
  const isServer = typeof window === 'undefined'
  const url = isServer
    ? `http://127.0.0.1:${FASTAPI_PORT}${path.startsWith('/') ? path : '/' + path}`
    : `/${path.replace(/^\//, '')}?XTransformPort=${FASTAPI_PORT}`
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), FASTAPI_TIMEOUT_MS)
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      cache: 'no-store',
    })
    clearTimeout(t)
    return res
  } catch {
    return null
  }
}

/**
 * 把 forwardFastAPI 返回的 Response 透传为 NextResponse（保留原状态码与 JSON body）。
 * FastAPI HTTPException 返回 {"detail": "..."}，这里展开成 {"error": "..."} 以便前端 fetchAPI 解析。
 */
export async function relayJSON(res: Response): Promise<NextResponse> {
  let body: unknown = null
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }
  // FastAPI HTTPException 返回 {"detail": "..."}，前端 fetchAPI 期望 error/message 字段
  if (body && typeof body === 'object' && 'detail' in body && !('error' in body)) {
    body = { ...(body as Record<string, unknown>), error: (body as { detail: unknown }).detail }
  }
  return NextResponse.json(body ?? {}, { status: res.status })
}

// ============================================================================
// Mock 数据（合并到 api-proxy 统一管理）
//
// 用途：
//   1. Next.js API routes 在 Python FastAPI 不可达时降级返回
//   2. 让前端在 P1 阶段可独立开发与展示
//
// 数据基于 V8 选股系统的 CSV 样本，结合 5 策略规范生成。
// 详见 docs/maintenance/ARCHITECTURE.md 第四章「5 策略与板块命名规范」。
// ============================================================================

// ===== 类型定义 =====

export interface StrategyInfo {
  strategy_id: string
  strategy_name: string
  strategy_emoji: string
  version: string
  enabled: boolean
  sector_code: string
  sector_name: string
  last_run_at: string | null
  last_run_stocks: number
  yaml_content: string
  factors: Array<{ factor_id: string; weight: number }>
  description: string
}

export interface SelectionRow {
  run_id: string
  strategy_id: string
  strategy_name: string
  stock_code: string
  stock_name: string
  score: number
  rank: number
  factors: Array<{ factor_id: string; value: number; weight: number; score: number }>
  run_at: string
}

export interface SignalEvent {
  id: string
  time: string
  type: 'limit_up' | 'drop_alert' | 'breakout' | 'selection' | 'system'
  strategy_id: string | null
  strategy_name: string | null
  stock_code: string | null
  stock_name: string | null
  content: string
  pushed_channels: string[]
  push_status: 'success' | 'partial' | 'failed' | 'pending'
}

export interface SectorInfo {
  code: string
  name: string
  strategy_id: string
  strategy_name: string
  stock_count: number
  auto_update: boolean
  update_mode: 'replace' | 'append'
  last_update: string | null
}

export interface SectorStock {
  stock_code: string
  stock_name: string
  added_at: string
  score: number
}

export interface MonitorStatus {
  engine_status: 'running' | 'stopped' | 'error'
  adapter_mode: 'mock' | 'real'
  monitored_count: number
  today_signals: number
  today_limit_up: number
  today_alerts: number
  uptime_seconds: number
  last_hb: string
}

export interface ThemeConfigDTO {
  mode: 'dark' | 'light'
  primary_color: string
  up_color: string
  down_color: string
  flat_color: string
  background: string
  card_background: string
  border_color: string
  font_family: string
}

// ===== 5 策略定义（与 strategies/*.yaml 一一对应） =====

export const STRATEGIES: StrategyInfo[] = [
  {
    strategy_id: 'dbqzt',
    strategy_name: '打板求涨停',
    strategy_emoji: '🔥',
    version: '1.0',
    enabled: true,
    sector_code: 'ZD_DBQZT01',
    sector_name: '打板求涨停选股',
    last_run_at: '2026-06-16T15:05:12',
    last_run_stocks: 18,
    description: '捕捉涨停板封板资金与换手率匹配的标的，次日溢价概率高',
    factors: [
      { factor_id: 'momentum_5d', weight: 0.3 },
      { factor_id: 'fc_amo_ratio', weight: 0.4 },
      { factor_id: 'turnover_rate', weight: 0.3 },
    ],
    yaml_content: `strategy_id: dbqzt
strategy_name: 打板求涨停
strategy_emoji: "🔥"
version: "1.0"
enabled: true

sector:
  code: ZD_DBQZT01
  name: 打板求涨停选股
  auto_update: true
  update_mode: replace

universe:
  exclude_st: true
  exclude_suspended: true
  exclude_new_listing_days: 5
  market_list: [SH, SZ, BJ]

cleaning:
  rules_file: cleaning_rules.yaml
  custom_rules:
    - rule: filter_negative
      field: Wtb
      action: drop
    - rule: filter_negative
      field: FCb
      action: drop

factors:
  - factor_id: momentum_5d
    weight: 0.3
    params:
      window: 5
  - factor_id: fc_amo_ratio
    weight: 0.4
    params:
      threshold: 0.5
  - factor_id: turnover_rate
    weight: 0.3
    params:
      window: 5

scoring:
  formula: "sum(factor_score * weight) * penalty"
  normalization: rank_percentile
  penalties:
    - condition: "fc_amo_ratio < 0.3"
      multiplier: 0.5
      reason: 封板资金不足
    - condition: "turnover_rate > 0.3"
      multiplier: 0.7
      reason: 换手过高

output:
  top_n: 20
  min_score: 0.6
  sort_by: total_score
  sort_order: desc

monitor:
  enabled: true
  subscribe_hq: true
  batch_size: 50
  alert_conditions:
    - condition: "pct_change > 0.095"
      alert_type: limit_up
      channels: [tdx_warn, websocket, feishu]
    - condition: "pct_change < -0.05"
      alert_type: drop_alert
      channels: [websocket, feishu]

export:
  csv: true
  excel: true
  excel_sheet_name: 打板求涨停
`,
  },
  {
    strategy_id: 'qszsl',
    strategy_name: '趋势主升浪',
    strategy_emoji: '📈',
    version: '1.0',
    enabled: true,
    sector_code: 'ZD_QSZSL01',
    sector_name: '趋势主升浪选股',
    last_run_at: '2026-06-16T15:05:42',
    last_run_stocks: 22,
    description: '均线多头排列 + 量能放大，捕捉主升浪启动点',
    factors: [
      { factor_id: 'ma_trend', weight: 0.4 },
      { factor_id: 'volume_surge', weight: 0.35 },
      { factor_id: 'momentum_20d', weight: 0.25 },
    ],
    yaml_content: `strategy_id: qszsl
strategy_name: 趋势主升浪
strategy_emoji: "📈"
version: "1.0"
enabled: true

sector:
  code: ZD_QSZSL01
  name: 趋势主升浪选股
  auto_update: true
  update_mode: replace

universe:
  exclude_st: true
  exclude_suspended: true
  market_list: [SH, SZ, BJ]

factors:
  - factor_id: ma_trend
    weight: 0.4
    params:
      ma_short: 5
      ma_long: 20
  - factor_id: volume_surge
    weight: 0.35
    params:
      window: 5
      threshold: 1.5
  - factor_id: momentum_20d
    weight: 0.25
    params:
      window: 20

scoring:
  formula: "sum(factor_score * weight)"
  normalization: zscore

output:
  top_n: 20
  min_score: 0.55
  sort_by: total_score
  sort_order: desc

monitor:
  enabled: true
  subscribe_hq: true
  batch_size: 50
  alert_conditions:
    - condition: "pct_change > 0.05"
      alert_type: breakout
      channels: [tdx_warn, websocket]
`,
  },
  {
    strategy_id: 'cslx',
    strategy_name: '错杀低吸',
    strategy_emoji: '🩹',
    version: '1.0',
    enabled: false,
    sector_code: 'ZD_CSLX01',
    sector_name: '错杀低吸选股',
    last_run_at: '2026-06-15T15:10:08',
    last_run_stocks: 12,
    description: '基本面良好但短期超跌，捕捉均值回归机会',
    factors: [
      { factor_id: 'rsi_oversold', weight: 0.4 },
      { factor_id: 'pb_percentile', weight: 0.3 },
      { factor_id: 'revenue_growth', weight: 0.3 },
    ],
    yaml_content: `strategy_id: cslx
strategy_name: 错杀低吸
strategy_emoji: "🩹"
version: "1.0"
enabled: false

sector:
  code: ZD_CSLX01
  name: 错杀低吸选股
  auto_update: true
  update_mode: replace

factors:
  - factor_id: rsi_oversold
    weight: 0.4
    params:
      window: 14
      threshold: 30
  - factor_id: pb_percentile
    weight: 0.3
    params:
      window: 250
  - factor_id: revenue_growth
    weight: 0.3
    params:
      quarters: 4

scoring:
  formula: "sum(factor_score * weight)"
  normalization: rank_percentile

output:
  top_n: 15
  min_score: 0.5
  sort_by: total_score
  sort_order: desc
`,
  },
  {
    strategy_id: 'rzq',
    strategy_name: '弱转强',
    strategy_emoji: '⚡',
    version: '1.0',
    enabled: true,
    sector_code: 'ZD_RZQ01',
    sector_name: '弱转强选股',
    last_run_at: '2026-06-16T15:06:01',
    last_run_stocks: 9,
    description: '连续下跌后首次放量突破，捕捉情绪反转',
    factors: [
      { factor_id: 'weak_to_strong', weight: 0.45 },
      { factor_id: 'volume_surge', weight: 0.3 },
      { factor_id: 'momentum_5d', weight: 0.25 },
    ],
    yaml_content: `strategy_id: rzq
strategy_name: 弱转强
strategy_emoji: "⚡"
version: "1.0"
enabled: true

sector:
  code: ZD_RZQ01
  name: 弱转强选股
  auto_update: true
  update_mode: replace

factors:
  - factor_id: weak_to_strong
    weight: 0.45
  - factor_id: volume_surge
    weight: 0.3
  - factor_id: momentum_5d
    weight: 0.25

output:
  top_n: 10
  min_score: 0.6
  sort_by: total_score
  sort_order: desc
`,
  },
  {
    strategy_id: 'qzrfc',
    strategy_name: '强转弱反抽',
    strategy_emoji: '🔄',
    version: '1.0',
    enabled: false,
    sector_code: 'ZD_QZRFC01',
    sector_name: '强转弱反抽选股',
    last_run_at: null,
    last_run_stocks: 0,
    description: '强势股首次回调至支撑位，捕捉反抽交易机会',
    factors: [
      { factor_id: 'pullback_to_ma', weight: 0.4 },
      { factor_id: 'momentum_20d', weight: 0.35 },
      { factor_id: 'turnover_rate', weight: 0.25 },
    ],
    yaml_content: `strategy_id: qzrfc
strategy_name: 强转弱反抽
strategy_emoji: "🔄"
version: "1.0"
enabled: false

sector:
  code: ZD_QZRFC01
  name: 强转弱反抽选股
  auto_update: true
  update_mode: replace

factors:
  - factor_id: pullback_to_ma
    weight: 0.4
    params:
      ma: 20
  - factor_id: momentum_20d
    weight: 0.35
  - factor_id: turnover_rate
    weight: 0.25

output:
  top_n: 10
  min_score: 0.55
`,
  },
]

// ===== 股票池（模拟数据） =====

const STOCK_POOL: Array<{ code: string; name: string }> = [
  { code: '600519', name: '贵州茅台' },
  { code: '000858', name: '五粮液' },
  { code: '601318', name: '中国平安' },
  { code: '000333', name: '美的集团' },
  { code: '600036', name: '招商银行' },
  { code: '000651', name: '格力电器' },
  { code: '600276', name: '恒瑞医药' },
  { code: '002415', name: '海康威视' },
  { code: '000725', name: '京东方A' },
  { code: '601012', name: '隆基绿能' },
  { code: '300750', name: '宁德时代' },
  { code: '002594', name: '比亚迪' },
  { code: '600900', name: '长江电力' },
  { code: '601888', name: '中国中免' },
  { code: '000001', name: '平安银行' },
  { code: '600031', name: '三一重工' },
  { code: '002241', name: '歌尔股份' },
  { code: '600585', name: '海螺水泥' },
  { code: '601633', name: '长城汽车' },
  { code: '300059', name: '东方财富' },
  { code: '600438', name: '通威股份' },
  { code: '002129', name: 'TCL中环' },
  { code: '603259', name: '药明康德' },
  { code: '300760', name: '迈瑞医疗' },
  { code: '688981', name: '中芯国际' },
  { code: '601919', name: '中远海控' },
  { code: '000063', name: '中兴通讯' },
  { code: '002230', name: '科大讯飞' },
  { code: '600660', name: '福耀玻璃' },
  { code: '603288', name: '海天味业' },
]

/** 生成选股结果（每次调用结果稳定） */
export function genSelections(strategyId?: string, limit = 20): SelectionRow[] {
  const targetStrategies = strategyId
    ? STRATEGIES.filter((s) => s.strategy_id === strategyId)
    : STRATEGIES.filter((s) => s.enabled)
  const rows: SelectionRow[] = []
  let rank = 1
  for (const s of targetStrategies) {
    const count = Math.min(s.last_run_stocks || 8, 10)
    for (let i = 0; i < count; i++) {
      const stock = STOCK_POOL[(s.strategy_id.charCodeAt(0) + i) % STOCK_POOL.length]
      const score = +(0.95 - i * 0.025 - Math.random() * 0.02).toFixed(3)
      rows.push({
        run_id: `R${s.strategy_id.toUpperCase()}20260616`,
        strategy_id: s.strategy_id,
        strategy_name: s.strategy_name,
        stock_code: stock.code,
        stock_name: stock.name,
        score,
        rank: rank++,
        factors: s.factors.map((f) => ({
          factor_id: f.factor_id,
          value: +(Math.random() * 1.5 + 0.1).toFixed(3),
          weight: f.weight,
          score: +(score * f.weight * (0.8 + Math.random() * 0.4)).toFixed(3),
        })),
        run_at: s.last_run_at || '2026-06-15T15:05:00',
      })
    }
  }
  return rows.slice(0, limit)
}

const SIGNAL_TYPES: SignalEvent['type'][] = ['limit_up', 'drop_alert', 'breakout', 'selection', 'system']
const SIGNAL_CONTENT_TEMPLATES: Record<SignalEvent['type'], string[]> = {
  limit_up: ['{name}({code}) 触及涨停板，封单 {vol} 万手', '{name} 涨停打开，注意风险'],
  drop_alert: ['{name}({code}) 跌幅超 5%，关注止损', '{name} 短期超跌，可能错杀'],
  breakout: ['{name}({code}) 突破 20 日均线，量比 {vol}', '{name} 放量上涨，主升浪启动迹象'],
  selection: ['策略 {strategy} 选出 {count} 只标的', '策略 {strategy} 选股完成，已回写板块 {sector}'],
  system: ['配置热加载完成', 'FastAPI 引擎已连接', '监控订阅批次完成'],
}

/** 生成最近信号流 */
export function genSignals(limit = 30): SignalEvent[] {
  const out: SignalEvent[] = []
  const now = Date.now()
  for (let i = 0; i < limit; i++) {
    const type = SIGNAL_TYPES[i % SIGNAL_TYPES.length]
    const stock = STOCK_POOL[i % STOCK_POOL.length]
    const strategy = STRATEGIES[i % STRATEGIES.length]
    const templates = SIGNAL_CONTENT_TEMPLATES[type]
    const content = templates[i % templates.length]
      .replace('{name}', stock.name)
      .replace('{code}', stock.code)
      .replace('{vol}', String(Math.floor(Math.random() * 50 + 5)))
      .replace('{strategy}', strategy.strategy_name)
      .replace('{count}', String(Math.floor(Math.random() * 20 + 3)))
      .replace('{sector}', strategy.sector_code)
    const isStockSignal = type !== 'selection' && type !== 'system'
    out.push({
      id: `S${String(now + i).slice(-8)}${i}`,
      time: new Date(now - i * 60_000 * Math.floor(Math.random() * 15 + 1)).toISOString(),
      type,
      strategy_id: type === 'system' ? null : strategy.strategy_id,
      strategy_name: type === 'system' ? null : strategy.strategy_name,
      stock_code: isStockSignal ? stock.code : null,
      stock_name: isStockSignal ? stock.name : null,
      content,
      pushed_channels: type === 'system' ? [] : ['tdx_warn', 'websocket', 'feishu'].slice(0, (i % 3) + 1),
      push_status: (['success', 'success', 'success', 'partial', 'failed', 'pending'] as const)[i % 6],
    })
  }
  return out
}

/** 板块列表 */
export function genSectors(): SectorInfo[] {
  return STRATEGIES.map((s) => ({
    code: s.sector_code,
    name: s.sector_name,
    strategy_id: s.strategy_id,
    strategy_name: s.strategy_name,
    stock_count: s.last_run_stocks,
    auto_update: true,
    update_mode: 'replace' as const,
    last_update: s.last_run_at,
  }))
}

/** 板块下的股票 */
export function genSectorStocks(code: string, count = 15): SectorStock[] {
  const out: SectorStock[] = []
  for (let i = 0; i < count; i++) {
    const stock = STOCK_POOL[(code.charCodeAt(0) + i * 3) % STOCK_POOL.length]
    out.push({
      stock_code: stock.code,
      stock_name: stock.name,
      added_at: '2026-06-16T15:05:30',
      score: +(0.95 - i * 0.025).toFixed(3),
    })
  }
  return out
}

/** 监控状态 */
export function genMonitorStatus(): MonitorStatus {
  return {
    engine_status: 'running',
    adapter_mode: 'mock',
    monitored_count: 187,
    today_signals: 42,
    today_limit_up: 8,
    today_alerts: 3,
    uptime_seconds: 3621,
    last_hb: new Date().toISOString(),
  }
}

/** 主题配置（与 config/theme.yaml 一致） */
export const MOCK_THEME: ThemeConfigDTO = {
  mode: 'dark',
  primary_color: '#f59e0b',
  up_color: '#ef4444',
  down_color: '#22c55e',
  flat_color: '#6b7280',
  background: '#0a0a0a',
  card_background: '#171717',
  border_color: '#262626',
  font_family: 'ui-sans-serif, system-ui, sans-serif',
}

/** 实时行情快照（用于大屏滚动） */
export function genQuotes(count = 12) {
  return STOCK_POOL.slice(0, count).map((s, i) => {
    const last = +(10 + Math.random() * 200).toFixed(2)
    const pct = +((Math.random() - 0.45) * 0.1).toFixed(4)
    return {
      code: s.code,
      name: s.name,
      last,
      pct,
      change: +(last * pct / (1 + pct)).toFixed(2),
      volume: Math.floor(Math.random() * 1000000 + 50000),
      amount: Math.floor(Math.random() * 500000000 + 10000000),
      ts: Date.now() - i * 1000,
    }
  })
}

// ============================================================================
// 降级数据 fallback(path, query?) —— path → mock 数据映射表
//
// 调用约定：route 在 tryFastAPI 失败后调用 fallback(path, query) 拿到降级数据。
// 对于需要参数化生成（如 /api/selections?strategy_id=xxx&limit=200）的路径，
// 通过 query 把查询参数传进来；fallback 内部解析后调用对应的 gen* 函数。
//
// 对于需要业务错误处理（404/400）或 POST 副作用的路径，route 仍应直接调用
// STRATEGIES / genSelections / genSignals 等 export（与 fallback 内部使用的是同一份）。
// ============================================================================

/**
 * 根据路径返回降级 mock 数据。
 *
 * @param path  FastAPI 路径（含动态段实际值，如 /api/sectors/ZD_DBQZT01/stocks）
 * @param query 可选的查询参数映射（用于参数化生成）
 * @returns     对应路径的 mock 数据；未匹配返回 null
 */
export function fallback(
  path: string,
  query: Record<string, string | undefined> = {}
): unknown {
  // /api/sectors/:code/stocks
  let m = path.match(/^\/api\/sectors\/([^/?]+)\/stocks/)
  if (m) return genSectorStocks(decodeURIComponent(m[1]), 15)

  // /api/sectors/:code/refresh —— POST 刷新，返回 { ok, count }（与原 route 行为一致）
  m = path.match(/^\/api\/sectors\/([^/?]+)\/refresh/)
  if (m) {
    const stocks = genSectorStocks(decodeURIComponent(m[1]), 15)
    return { ok: true, count: stocks.length }
  }

  // /api/sectors —— 板块列表
  if (path === '/api/sectors' || path === '/api/sectors/') {
    return genSectors()
  }

  // /api/theme —— 主题配置
  if (path === '/api/theme' || path === '/api/theme/') {
    return MOCK_THEME
  }

  // /api/monitor/status —— 监控状态
  if (path === '/api/monitor/status' || path.startsWith('/api/monitor/status?')) {
    return genMonitorStatus()
  }

  // /api/monitor/quotes?count=N —— 实时行情快照
  if (path.startsWith('/api/monitor/quotes')) {
    // 与原 route 行为一致：Number(count) || 12（NaN/0 → 12）
    const count = query.count !== undefined ? Number(query.count) : 12
    return genQuotes(count || 12)
  }

  // /api/selections —— 选股结果列表（参数化生成；route 可继续做后过滤）
  if (path === '/api/selections' || path.startsWith('/api/selections?')) {
    const sid = query.strategy_id
    const limit = query.limit ? Number(query.limit) : 200
    return genSelections(sid, limit)
  }

  // /api/strategies/:id —— 单个策略
  m = path.match(/^\/api\/strategies\/([^/?]+)$/)
  if (m) {
    return STRATEGIES.find((s) => s.strategy_id === decodeURIComponent(m[1])) ?? null
  }

  // /api/strategies —— 策略列表
  if (path === '/api/strategies' || path === '/api/strategies/') {
    return STRATEGIES
  }

  // /api/signals —— 信号列表（参数化生成；route 可继续做后过滤）
  if (path === '/api/signals' || path.startsWith('/api/signals?')) {
    // 与原 route 行为一致：limit = params.limit ? Number(params.limit) : 50, 调 genSignals(limit * 2)
    const limit = query.limit ? Number(query.limit) : 50
    return genSignals(limit * 2)
  }

  return null
}
