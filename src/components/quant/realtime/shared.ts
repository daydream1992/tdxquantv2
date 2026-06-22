/**
 * RealtimeSelection 共享类型 + 工具
 *
 * 数据流:
 *   定时器触发 → strategyAPI.runAll() 跑全部启用策略
 *                → 延迟 1.2s 等 DuckDB 写入
 *                → selectionAPI.list({ limit: 200 }) 拉最新一轮选股
 *                → 与 prevScoreMap 对比,标记 NEW / 涨分 / 跌分
 *                → 推入 stream(顶部) + 更新 stockBoard(去重)
 */

import type { SelectionRowDTO } from '@/lib/api'

/** 一轮快照(对应一次 runAll + list) */
export interface RoundSnapshot {
  /** 唯一 ID = `round-${roundNo}` */
  id: string
  /** 第几轮,从 1 开始 */
  roundNo: number
  /** 触发时间戳(ms) */
  triggeredAt: number
  /** 完成时间戳(ms),用于显示耗时 */
  finishedAt: number
  /** 本轮耗时(ms) */
  durationMs: number
  /** 本轮选出的所有行 */
  rows: SelectionRowDTO[]
  /** 本轮新增股票数(对比上一轮的 prevScoreMap) */
  newCount: number
  /** 本轮涨分股票数(≥ threshold) */
  upCount: number
  /** 本轮跌分股票数(≥ threshold) */
  downCount: number
  /** 本轮 runAll 返回的成功策略数 */
  strategyOk: number
  /** 本轮 runAll 返回的策略总数 */
  strategyTotal: number
  /** 本轮错误(若有) */
  error?: string
}

/** 股票看板单行(去重聚合) */
export interface StockBoardRow {
  stock_code: string
  stock_name: string
  /** 当前最新得分 */
  currentScore: number
  /** 上一轮得分(用于显示 delta) */
  prevScore: number | null
  /** 入选次数(累计轮数) */
  hitCount: number
  /** 第一次入选时间 */
  firstSeenAt: number
  /** 最近一次入选时间 */
  lastSeenAt: number
  /** 入选策略列表(去重) */
  strategy_ids: string[]
  strategy_names: string[]
  /** 状态标记 */
  badge: 'new' | 'up' | 'down' | 'flat' | 'gone'
  /** 最大 rank(越小越靠前) */
  bestRank: number
  /** 上次更新轮次号 */
  lastRoundNo: number
}

/** 控制栏状态 */
export interface RealtimeState {
  running: boolean
  intervalSec: number
  threshold: number
  /** 累计轮数 */
  totalRounds: number
  /** 累计选股行数(含重复) */
  totalRows: number
  /** 累计 NEW 数 */
  totalNew: number
  /** 上次触发时间 */
  lastRunAt: number | null
  /** 下次执行倒计时(秒) */
  nextRunIn: number
  /** 是否正在执行本轮 */
  ticking: boolean
}

export const INTERVAL_OPTIONS = [
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
  { label: '2min', value: 120 },
] as const

export const THRESHOLD_OPTIONS = [
  { label: '0.02', value: 0.02 },
  { label: '0.05', value: 0.05 },
  { label: '0.10', value: 0.1 },
] as const

export const MAX_STREAM_ROUNDS = 50
export const MAX_BOARD_ROWS = 200
export const RUNALL_DELAY_MS = 1200

/** 格式化相对时间:刚刚 / N秒前 / N分前 */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts)
  if (diff < 5_000) return '刚刚'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}秒前`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`
  return `${Math.floor(diff / 3_600_000)}小时前`
}

/** 格式化耗时 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** 格式化时钟 HH:mm:ss */
export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

/** 状态徽章样式 */
export function badgeStyle(badge: StockBoardRow['badge']): string {
  switch (badge) {
    case 'new':
      return 'bg-amber-500/20 text-amber-400 border-amber-500/40'
    case 'up':
      return 'bg-[var(--quant-up)]/15 text-up border-[var(--quant-up)]/40'
    case 'down':
      return 'bg-[var(--quant-down)]/15 text-down border-[var(--quant-down)]/40'
    case 'flat':
      return 'border-quant text-muted-foreground'
    case 'gone':
      return 'bg-muted/20 text-muted-foreground/60 border-muted/40 line-through'
  }
}

export function badgeLabel(badge: StockBoardRow['badge']): string {
  switch (badge) {
    case 'new':
      return 'NEW'
    case 'up':
      return '▲ 涨分'
    case 'down':
      return '▼ 跌分'
    case 'flat':
      return '持平'
    case 'gone':
      return '已出'
  }
}
