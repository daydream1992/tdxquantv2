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
    fetchAPI<{ ok: boolean; results: Array<{ id: string; count: number }> }>('/api/strategies', {
      method: 'POST',
      body: JSON.stringify({ action: 'run_all' }),
    }),
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
}

export const sectorAPI = {
  list: () => fetchAPI<SectorDTO[]>('/api/sectors'),
  getStocks: (code: string) => fetchAPI<SectorStockDTO[]>(`/api/sectors/${code}/stocks`),
  refresh: (code: string) =>
    fetchAPI<{ ok: boolean; count: number }>(`/api/sectors/${code}/refresh`, { method: 'POST' }),
}

export const monitorAPI = {
  getStatus: () => fetchAPI<MonitorStatusDTO>('/api/monitor?action=status'),
  getQuotes: () => fetchAPI<QuoteDTO[]>('/api/monitor?action=quotes'),
}

export const themeAPI = {
  get: () => fetchAPI<ThemeDTO>('/api/theme'),
}

export const configAPI = {
  reload: () => fetchAPI<{ ok: boolean; reloaded: string[] }>('/api/config', { method: 'POST' }),
}
