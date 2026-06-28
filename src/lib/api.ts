/**
 * TdxQuant 前端 API 客户端
 *
 * 设计要点：
 *   - 所有调用走 Next.js API routes（同源 / 相对路径），由 route 转发到 Python FastAPI
 *   - 路由内部已处理降级（FastAPI 不通时返回 mock），前端只需感知数据结构
 *   - 统一错误处理，所有方法返回 Promise<T>
 */

// ===== 类型定义 =====
export interface StrategyDTO {
  strategy_id: string
  strategy_name: string
  strategy_emoji: string
  version: string
  enabled: boolean
  sector_code: string
  sector_name: string
  last_run_at: string | null
  last_run_stocks: number
  description: string
  factors: Array<{ factor_id: string; weight: number }>
  yaml_content?: string
}

export interface SelectionRowDTO {
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

export interface SignalDTO {
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
  /** R7-A: 触发时行情快照 JSON */
  snapshot?: Record<string, unknown> | null
  /** R7-A: 信号严重度 (info / warn / error) */
  severity?: string
}

export interface SectorDTO {
  code: string
  name: string
  strategy_id: string
  strategy_name: string
  stock_count: number
  auto_update: boolean
  update_mode: 'replace' | 'append'
  last_update: string | null
}

export interface SectorStockDTO {
  stock_code: string
  stock_name: string
  added_at: string
  score: number
}

/** R14-1: 个股所属板块 DTO */
export interface StockSectorItemDTO {
  code: string
  name: string
  type: 'concept' | 'industry' | 'region' | 'index' | 'style' | 'system' | 'custom' | string
  type_raw: string
  gp_num: string
}

export interface StockSectorsDTO {
  stock_code: string
  concept: StockSectorItemDTO[]
  industry: StockSectorItemDTO[]
  region: StockSectorItemDTO[]
  other: StockSectorItemDTO[]
  total: number
  from_cache: boolean
  fetched_at: string
}

/** R14-3: 监控池概念热度 DTO */
export interface HeatmapItemDTO {
  /** 板块代码 */
  code: string
  /** 板块名 */
  name: string
  /** 板块类型: concept / industry */
  type: 'concept' | 'industry' | string
  /** 监控池中属于该板块的股票数 */
  count: number
  /** 股票代码列表（最多 5 个示例） */
  stocks: string[]
}

export interface SectorHeatmapDTO {
  enabled: boolean
  items: HeatmapItemDTO[]
  /** 监控池总数 */
  total_stocks: number
  /** 实际扫描数（失败的跳过） */
  scanned_stocks: number
  from_cache: boolean
  fetched_at: string
  duration_ms: number
}

/** R14-3: 信号同板块联动 DTO */
export interface RelatedStockDTO {
  code: string
  name: string
  /** 当前涨跌幅（EngineState 未缓存行情时为 0） */
  pct: number
}

export interface RelatedSectorDTO {
  sector_code: string
  sector_name: string
  sector_type: string
  stocks: RelatedStockDTO[]
}

export interface SectorLinkageDTO {
  enabled: boolean
  signal_id: string
  stock_code: string
  stock_name: string
  items: RelatedSectorDTO[]
  from_cache: boolean
  fetched_at: string
}

export interface MonitorStatusDTO {
  engine_status: 'running' | 'stopped' | 'error'
  adapter_mode: 'mock' | 'real'
  monitored_count: number
  today_signals: number
  today_limit_up: number
  today_alerts: number
  uptime_seconds: number
  last_hb: string
}

export interface ThemeDTO {
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

export interface QuoteDTO {
  code: string
  name: string
  last: number
  pct: number
  change: number
  volume: number
  amount: number
  ts: number
  /** R7-A: 主力净流入 (万元) */
  main_inflow?: number
  /** R7-A: 大买占比 0~1 */
  big_buy_ratio?: number
  /** R7-A: 换手率% */
  turnover_rate?: number
}

/** R7-A: 资金流向排行单条 */
export interface FlowRankingItemDTO {
  code: string
  name: string
  last: number
  pct: number
  main_inflow: number
  big_buy_ratio: number
  turnover_rate: number
  amount: number
}

/** R13-2c: 竞价强弱项 (后端 /api/monitor/auction 单条) */
export interface AuctionItemDTO {
  stock_code: string
  /** 百分比形式 (5.23 = 5.23%) */
  auction_pct: number
  /** 万元 */
  auction_amount: number
  /** 万元 */
  auction_zt_buy: number
  /** 万元 */
  open_amount_pre: number
  /** 手 */
  open_vol_pre: number
  l2_order_num: number
  l2_tic_num: number
  /** 0-100 综合评分 */
  auction_score: number
  score_detail: {
    surge: number
    zt_flag: number
    vol_ratio: number
    l2: number
  }
  fetched_at: string
}

/** R13-2c: 竞价强弱响应 */
export interface AuctionResponseDTO {
  items: AuctionItemDTO[]
  count: number
  in_auction_hours: boolean
}

// ===== 通用请求 =====

export class APIError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.status = status
  }
}

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    // 默认不缓存，确保数据新鲜
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = `请求失败 ${res.status}`
    try {
      const data = await res.json()
      msg = data.error || data.message || msg
    } catch {
      /* noop */
    }
    throw new APIError(msg, res.status)
  }
  // 部分导出接口直接返回 Blob
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    return (await res.json()) as T
  }
  return (await res.text()) as unknown as T
}

// ===== API 模块 =====

export const strategyAPI = {
  list: () => fetchAPI<StrategyDTO[]>('/api/strategies'),
  get: (id: string) => fetchAPI<StrategyDTO>(`/api/strategies/${id}`),
  enable: (id: string) =>
    fetchAPI<{ ok: boolean }>(`/api/strategies/${id}`, {
      method: 'POST',
      body: JSON.stringify({ enabled: true }),
    }),
  disable: (id: string) =>
    fetchAPI<{ ok: boolean }>(`/api/strategies/${id}`, {
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
    }),
  run: (id: string) =>
    fetchAPI<{ ok: boolean; run_id: string; count: number }>(`/api/strategies/${id}/run`, {
      method: 'POST',
    }),
  enableAll: () =>
    fetchAPI<{ ok: boolean }>('/api/strategies', {
      method: 'POST',
      body: JSON.stringify({ action: 'enable_all' }),
    }),
  disableAll: () =>
    fetchAPI<{ ok: boolean }>('/api/strategies', {
      method: 'POST',
      body: JSON.stringify({ action: 'disable_all' }),
    }),
  runAll: () =>
    fetchAPI<{ ok: boolean; results: Array<{ id: string; count: number; ok: boolean; error?: string }> }>('/api/strategies', {
      method: 'POST',
      body: JSON.stringify({ action: 'run_all' }),
    }),
  runs: (id: string) =>
    fetchAPI<Array<StrategyRunRecord>>(`/api/strategies/${id}/runs`),
}

export interface StrategyRunRecord {
  run_id: string
  strategy_id: string
  run_date: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  duration_ms: number
  universe_count: number
  result_count: number
  error_message: string
}

export interface SelectionQuery {
  strategy_id?: string
  start_date?: string
  end_date?: string
  min_score?: number
  limit?: number
}

export const selectionAPI = {
  list: (params: SelectionQuery = {}) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
    })
    return fetchAPI<SelectionRowDTO[]>(`/api/selections?${sp.toString()}`)
  },
  get: (runId: string) => fetchAPI<SelectionRowDTO[]>(`/api/selections?run_id=${runId}`),
  export: (runId: string, format: 'csv' | 'excel') =>
    fetchAPI<Blob>(`/api/selections/${runId}/export?format=${format}`).then(async (r) => {
      // fetchAPI 返回 string，需要包装为 Blob
      if (r instanceof Blob) return r
      return new Blob([r as unknown as string])
    }),
}

export interface SignalQuery {
  type?: string
  strategy_id?: string
  start_date?: string
  end_date?: string
  limit?: number
}

export const signalAPI = {
  list: (params: SignalQuery = {}) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
    })
    return fetchAPI<SignalDTO[]>(`/api/signals?${sp.toString()}`)
  },
  /** R7-A: 信号详情 (含 snapshot JSON) */
  getDetail: (id: string) =>
    fetchAPI<SignalDTO>(`/api/signals/${encodeURIComponent(id)}`),
  /** R14-3: 信号同板块联动股（方案 C，受 monitor.sector_linkage.enabled 开关控制） */
  getRelated: (id: string) =>
    fetchAPI<SectorLinkageDTO>(`/api/signals/${encodeURIComponent(id)}/related`),
}

export const sectorAPI = {
  list: () => fetchAPI<SectorDTO[]>('/api/sectors'),
  getStocks: (code: string) => fetchAPI<SectorStockDTO[]>(`/api/sectors/${code}/stocks`),
  refresh: (code: string) =>
    fetchAPI<{ ok: boolean; count: number }>(`/api/sectors/${code}/refresh`, { method: 'POST' }),
  /** 导出全部板块成份股, 返回 Blob (供浏览器下载) */
  exportAll: async (format: 'csv' | 'excel'): Promise<Blob> => {
    const res = await fetch(`/api/sectors/export-all?format=${format}`, { cache: 'no-store' })
    if (!res.ok) {
      let msg = `导出失败 ${res.status}`
      try {
        const data = await res.json()
        msg = data.error || data.message || msg
      } catch {
        /* noop */
      }
      throw new APIError(msg, res.status)
    }
    return await res.blob()
  },
}

export const stockAPI = {
  /** R14-1: 个股所属板块（概念/行业/地区分组） */
  getSectors: (code: string) =>
    fetchAPI<StockSectorsDTO>(`/api/stocks/${encodeURIComponent(code)}/sectors`),
}

/** P1: 引擎健康度 DTO */
export interface EngineHealthDTO {
  subscribe_alive: boolean
  last_quote_ts: number
  quote_lag_seconds: number
  eval_count: number
  error_count: number
  last_error: string
  debounce_size: number
  queue_size: number
  uptime_seconds: number
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  /** R11-1: 后端透出的当前生效阈值 (P2-2 后端可热加载, 缺省时前端用 60/120/10 兜底) */
  thresholds?: {
    lag_healthy_seconds: number
    lag_degraded_seconds: number
    error_healthy_threshold: number
  }
  /** R14-2: API 限流监控计数（全部 optional, 向后兼容旧后端） */
  api_call_total?: number
  api_rejected_total?: number
  api_avg_latency_ms?: number
  tqcenter_call_total?: number
  tqcenter_rejected_total?: number
  /** R14-2: 限流配置状态（令牌桶 + 中间件） */
  rate_limit?: {
    tqcenter_limiter?: {
      enabled: boolean
      qps?: number
      burst?: number
      current_tokens?: number
      total_calls?: number
      rejected_calls?: number
      total_wait_ms?: number
    }
    api_middleware?: {
      enabled: boolean
      rules_count: number
    }
  }
}

export const monitorAPI = {
  getStatus: () => fetchAPI<MonitorStatusDTO>('/api/monitor?action=status'),
  getQuotes: (count = 100) =>
    fetchAPI<QuoteDTO[]>(`/api/monitor?action=quotes&count=${count}`),
  /** R7-A: 资金流向排行 (按 main_inflow / big_buy_ratio / turnover_rate 排序, Top 5) */
  getFlowRanking: (count = 50, metric: 'main_inflow' | 'big_buy_ratio' | 'turnover_rate' = 'main_inflow') =>
    fetchAPI<FlowRankingItemDTO[]>(
      `/api/monitor/flow-ranking?count=${count}&metric=${metric}`
    ),
  /** P1: 引擎健康度 */
  getHealth: () => fetchAPI<EngineHealthDTO>('/api/monitor?action=health'),
  /** R13-1b: 列出 alert_templates (供 MatchStrategyManager 编辑 alert_type 下拉) */
  getRules: () =>
    fetchAPI<{ templates: AlertTemplateDTO[]; count: number }>(
      '/api/monitor/rules'
    ),
  /** R13-2c: 竞价强弱排行 (codes 可选, 逗号分隔; count 仅在 codes 未传时生效) */
  getAuction: (codes?: string, count = 50) =>
    fetchAPI<AuctionResponseDTO>(
      `/api/monitor/auction?count=${count}${codes ? `&codes=${encodeURIComponent(codes)}` : ''}`
    ),
  /** R14-3: 监控池概念热度 Top N (方案 B, 受 monitor.sector_heatmap.enabled 开关控制) */
  getSectorHeatmap: () =>
    fetchAPI<SectorHeatmapDTO>('/api/monitor/sector-heatmap'),
}

/** R13-1b: alert_template 单条 DTO (对齐后端 GET /api/monitor/rules) */
export interface AlertTemplateDTO {
  alert_type: string
  label: string
  emoji: string
  description: string
  condition: string
  default_params: Record<string, number>
  priority: 'high' | 'medium' | 'low'
  channels: string[]
}

export const themeAPI = {
  get: () => fetchAPI<ThemeDTO>('/api/theme'),
}

/** R13-3a: GET /api/config 摘要响应 (对齐后端 ConfigSummaryResponse) */
export interface ConfigSummaryDTO {
  app: {
    name: string
    version: string
    adapter_mode: string
    log_level: string
  }
  server: {
    host: string
    port: number
  }
  paths: Record<string, string>
  strategies_count: number
  strategies_enabled_count: number
  alert_templates_count: number
  match_strategies_count: number
  channels: Array<{ name: string; enabled: boolean }>
  config_files?: string[]
  last_reload_at?: string
  /** 后端降级标记 (前端代理无法连接 FastAPI 时为 true) */
  fallback?: boolean
}

export const configAPI = {
  /** R13-3a: 获取配置摘要 (GET /api/config) */
  getSummary: () => fetchAPI<ConfigSummaryDTO>('/api/config'),
  reload: () => fetchAPI<{ ok: boolean; reloaded: string[] }>('/api/config', { method: 'POST' }),
  listStrategyConfigs: () =>
    fetchAPI<Array<{
      strategy_id: string
      strategy_name: string
      enabled: boolean
      yaml_path: string
      yaml_content: string
    }>>('/api/config/strategies'),
  updateStrategyConfig: (id: string, yaml_content: string, enabled?: boolean) =>
    fetchAPI<{
      strategy_id: string
      strategy_name: string
      enabled: boolean
      yaml_path: string
      yaml_content: string
    }>(`/api/config/strategies/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ yaml_content, enabled }),
    }),
  /** 创建/复制策略 YAML 文件 */
  createStrategy: (strategy_id: string, yaml_content: string, overwrite = false) =>
    fetchAPI<{
      strategy_id: string
      strategy_name: string
      enabled: boolean
      yaml_path: string
      yaml_content: string
    }>('/api/config/strategies', {
      method: 'POST',
      body: JSON.stringify({ strategy_id, yaml_content, overwrite }),
    }),
  /** 删除策略 YAML 文件（启用中的策略会返回 409） */
  deleteStrategy: (id: string) =>
    fetchAPI<{ ok: boolean; strategy_id: string; deleted: string; message: string }>(
      `/api/config/strategies/${id}`,
      { method: 'DELETE' }
    ),
}

/** 创建策略请求体（前端 DTO，对齐后端 StrategyCreateRequest） */
export interface StrategyCreateRequestDTO {
  strategy_id: string
  yaml_content: string
  overwrite?: boolean
}

// ===== 推送通道 =====

export interface ChannelConfigDTO {
  name: string
  enabled: boolean
  config: Record<string, unknown>
  errors: string[]
}

export interface ChannelListDTO {
  channels: ChannelConfigDTO[]
  config_path: string
}

export interface ChannelTestResultDTO {
  ok: boolean
  message: string
  channel: string
}

export interface SignalRepushResultDTO {
  ok: boolean
  signal_id: string
  fired: string[]
  results: Array<{ channel: string; ok: boolean; message: string }>
}

export const channelAPI = {
  list: () => fetchAPI<ChannelListDTO>('/api/channels'),
  update: (channels: Record<string, Record<string, unknown>>) =>
    fetchAPI<{ ok: boolean; errors: string[]; channels: ChannelConfigDTO[] }>(
      '/api/channels',
      { method: 'PUT', body: JSON.stringify({ channels }) }
    ),
  test: (name: string) =>
    fetchAPI<ChannelTestResultDTO>(`/api/channels/${encodeURIComponent(name)}/test`, {
      method: 'POST',
    }),
  repush: (signalId: string) =>
    fetchAPI<SignalRepushResultDTO>(
      `/api/channels/signals/${encodeURIComponent(signalId)}/repush`,
      { method: 'POST' }
    ),
}

// ===== 回测 =====

export interface BacktestParamsDTO {
  strategy_id: string
  start_date: string
  end_date: string
  initial_capital?: number
  top_n?: number
  hold_days?: number
}

export interface BacktestDailyEquityDTO {
  date: string
  equity: number
  return_pct: number
  drawdown: number
}

export interface BacktestTradeDTO {
  stock_code: string
  stock_name: string
  entry_date: string
  exit_date: string
  entry_price: number
  exit_price: number
  pnl_pct: number
  pnl_amount: number
  hold_days: number
}

export interface BacktestResultDTO {
  run_id: string
  strategy_id: string
  strategy_name: string
  strategy_emoji: string
  start_date: string
  end_date: string
  initial_capital: number
  final_capital: number
  total_return: number
  annual_return: number
  max_drawdown: number
  sharpe_ratio: number
  win_rate: number
  total_trades: number
  profit_trades: number
  loss_trades: number
  avg_hold_days: number
  daily_equity: BacktestDailyEquityDTO[]
  trades: BacktestTradeDTO[]
  benchmark_return: number
  alpha: number
  beta: number
  top_n: number
  hold_days: number
  created_at: string
}

export interface BacktestHistoryItemDTO {
  run_id: string
  strategy_id: string
  strategy_name: string
  strategy_emoji: string
  start_date: string
  end_date: string
  total_return: number
  max_drawdown: number
  sharpe_ratio: number
  created_at: string
}

export interface BacktestLeaderboardItemDTO {
  strategy_id: string
  strategy_name: string
  strategy_emoji: string
  latest_run_id: string
  latest_run_at: string
  start_date: string
  end_date: string
  total_return: number
  annual_return: number
  max_drawdown: number
  sharpe_ratio: number
  win_rate: number
  total_trades: number
  run_count: number
}

export interface BacktestLeaderboardDTO {
  items: BacktestLeaderboardItemDTO[]
  total: number
}

export const backtestAPI = {
  run: (params: BacktestParamsDTO) =>
    fetchAPI<BacktestResultDTO>('/api/backtest/run', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  history: () => fetchAPI<BacktestHistoryItemDTO[]>('/api/backtest/history'),
  get: (runId: string) =>
    fetchAPI<BacktestResultDTO>(`/api/backtest/${encodeURIComponent(runId)}`),
  leaderboard: () => fetchAPI<BacktestLeaderboardDTO>('/api/backtest/leaderboard'),
}

// ===== 全局搜索 =====

export interface SearchStrategyItemDTO {
  strategy_id: string
  strategy_name: string
  strategy_emoji: string
  description: string
  sector_code: string
  enabled: boolean
}

export interface SearchStockItemDTO {
  stock_code: string
  stock_name: string
  strategy_id: string
  strategy_name: string
  score: number
  run_date: string
}

export interface SearchSignalItemDTO {
  id: string
  time: string
  type: 'limit_up' | 'drop_alert' | 'breakout' | 'selection' | 'system'
  strategy_id: string | null
  strategy_name: string | null
  stock_code: string | null
  stock_name: string | null
  content: string
}

export interface SearchResponseDTO {
  q: string
  strategies: SearchStrategyItemDTO[]
  stocks: SearchStockItemDTO[]
  signals: SearchSignalItemDTO[]
  total: number
}

export const searchAPI = {
  search: (q: string, limit = 20) => {
    const sp = new URLSearchParams()
    sp.set('q', q)
    sp.set('limit', String(limit))
    return fetchAPI<SearchResponseDTO>(`/api/search?${sp.toString()}`)
  },
}

// ===== 匹配策略 (match-strategies) =====

export interface MatchScopeDTO {
  markets: string[]
  exclude_st: boolean
  exclude_suspended: boolean
  exclude_codes: string[]
  include_only: string[]
}

export type MatchPriority = 'high' | 'medium' | 'low'

export interface MatchAlertDTO {
  alert_type: string
  params: Record<string, number>
  channels: string[]
  priority: MatchPriority
}

export interface MatchStrategyDTO {
  match_id: string
  name: string
  enabled: boolean
  strategy_id: string
  scope: MatchScopeDTO
  alerts: MatchAlertDTO[]
  debounce_override: number | null
  trading_hours_override: Record<string, unknown> | null
}

export interface MatchListResponse {
  items: MatchStrategyDTO[]
  count?: number
}

/** PUT 部分更新（与后端 MatchUpdateModel 对齐，所有字段可选） */
export interface MatchUpdateRequest {
  name?: string
  enabled?: boolean
  strategy_id?: string
  scope?: MatchScopeDTO
  alerts?: MatchAlertDTO[]
  debounce_override?: number | null
  trading_hours_override?: Record<string, unknown> | null
}

/** POST 新建（与后端 MatchStrategyModel 对齐） */
export interface MatchCreateRequest {
  match_id: string
  name: string
  enabled: boolean
  strategy_id: string
  scope: MatchScopeDTO
  alerts: MatchAlertDTO[]
  debounce_override: number | null
  trading_hours_override: Record<string, unknown> | null
}

export interface MatchTestHitDTO {
  alert_type: string
  condition: string
  hit: boolean
  priority?: MatchPriority
  channels?: string[]
  error?: string
}

export interface MatchTestResponse {
  match_id: string
  hits: MatchTestHitDTO[]
}

export interface MatchTestParams {
  code: string
  pct_change?: number
  volume_ratio?: number
  main_inflow?: number
  auction_pct?: number
  [k: string]: unknown
}

export const matchStrategyAPI = {
  list: () => fetchAPI<MatchListResponse>('/api/monitor/match-strategies'),
  create: (body: MatchCreateRequest) =>
    fetchAPI<{ ok: boolean; match_id: string; message: string }>(
      '/api/monitor/match-strategies',
      { method: 'POST', body: JSON.stringify(body) }
    ),
  update: (id: string, body: MatchUpdateRequest) =>
    fetchAPI<{ ok: boolean; match_id: string; message: string }>(
      `/api/monitor/match-strategies/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(body) }
    ),
  remove: (id: string) =>
    fetchAPI<{ ok: boolean; match_id: string; message: string }>(
      `/api/monitor/match-strategies/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  reload: () =>
    fetchAPI<{ ok: boolean; count: number; message: string }>(
      '/api/monitor/match-strategies?action=reload',
      { method: 'POST' }
    ),
  test: (id: string, params: MatchTestParams) =>
    fetchAPI<MatchTestResponse>(
      `/api/monitor/match-strategies/${encodeURIComponent(id)}/test`,
      { method: 'POST', body: JSON.stringify(params) }
    ),
}

// ===== 自选股 (watchlist) =====

export interface WatchlistItemDTO {
  stock_code: string
  strategy_id: string
  subscriber: string
  subscribed_at: string
  active: boolean
  batch_no: number
}

export interface WatchlistAddRequest {
  codes: string[]
  strategy_id?: string
  subscriber?: string
}

export interface WatchlistAddResponse {
  ok: boolean
  added: number
  skipped: number
  message: string
}

/**
 * R13-3b: 按板块批量加入响应。
 *
 * 后端实际返回 WatchlistAddResponse (ok/added/skipped/message)，
 * sector_code / sector_name 字段为前端展示用, 由 UI 端拼接, 后端不一定返回。
 */
export interface WatchlistBySectorResponse {
  ok: boolean
  added: number
  skipped: number
  message: string
  sector_code?: string
  sector_name?: string
}

export const watchlistAPI = {
  list: () => fetchAPI<WatchlistItemDTO[]>('/api/monitor/watchlist'),
  add: (body: WatchlistAddRequest) =>
    fetchAPI<WatchlistAddResponse>('/api/monitor/watchlist', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  remove: (code: string) =>
    fetchAPI<{ ok: boolean; code: string; message: string }>(
      `/api/monitor/watchlist/${encodeURIComponent(code)}`,
      { method: 'DELETE' }
    ),
  /**
   * R13-3b: 按板块批量加入监控池。
   *
   * 后端把 strategy_id / subscriber 作为 **query 参数**接收
   * (FastAPI 默认对未注解的 str 参数走 query)，因此这里走 URL query 而非 body。
   */
  addBySector: (sector_code: string, strategy_id = '_manual') => {
    const sp = new URLSearchParams()
    if (strategy_id) sp.set('strategy_id', strategy_id)
    const q = sp.toString()
    return fetchAPI<WatchlistBySectorResponse>(
      `/api/monitor/watchlist/by-sector/${encodeURIComponent(sector_code)}${q ? `?${q}` : ''}`,
      { method: 'POST' }
    )
  },
}
