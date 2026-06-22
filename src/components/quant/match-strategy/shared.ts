/**
 * match-strategy/shared.ts
 *
 * MatchStrategy 子组件共享的常量 / 工具函数 / 类型 (无 JSX, 不计入 3 个 .tsx 限制)。
 * 由 MatchStrategyList / MatchStrategyForm / MatchStrategyTest 共同 import。
 */

import type {
  MatchStrategyDTO,
  MatchAlertDTO,
  MatchScopeDTO,
  MatchPriority,
} from '@/lib/api'

// ----------------------------------------------------------------------------
// 常量
// ----------------------------------------------------------------------------

export const ALL_MARKETS = ['SH', 'SZ', 'BJ'] as const
export const ALL_CHANNELS = ['tdx_warn', 'websocket', 'feishu', 'csv_log'] as const
export const PRIORITIES: MatchPriority[] = ['high', 'medium', 'low']

export const PRIORITY_LABEL: Record<MatchPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export const EMPTY_SCOPE: MatchScopeDTO = {
  markets: ['SH', 'SZ', 'BJ'],
  exclude_st: true,
  exclude_suspended: true,
  exclude_codes: [],
  include_only: [],
}

export const EMPTY_ALERT: MatchAlertDTO = {
  alert_type: '',
  params: {},
  channels: ['websocket'],
  priority: 'medium',
}

// ----------------------------------------------------------------------------
// 工具函数
// ----------------------------------------------------------------------------

/** 判断是否为兜底套餐 _default (只读不可删, 但可复制) */
export function isDefault(matchId: string): boolean {
  return matchId === '_default'
}

/** match_id 校验：非空 + 只允许字母/数字/下划线 */
const MATCH_ID_PATTERN = /^[A-Za-z0-9_]+$/
export function isValidMatchId(id: string): boolean {
  return MATCH_ID_PATTERN.test(id.trim())
}

/**
 * 基于已存在的 ID 集合生成一个唯一的副本 ID。
 * 默认 `${sourceId}_copy`；若已占用则尝试 `_2` / `_3` / ...
 */
export function makeUniqueCopyId(sourceId: string, existingIds: Set<string>): string {
  const base = `${sourceId}_copy`
  if (!existingIds.has(base)) return base
  let n = 2
  while (existingIds.has(`${sourceId}_copy_${n}`)) n += 1
  return `${sourceId}_copy_${n}`
}

/** scope 摘要: 把 MatchScopeDTO 渲染为单行文本 (SH/SZ/BJ · 排ST · 排停牌 · ...) */
export function scopeSummary(scope: MatchScopeDTO): string {
  if (!scope) return '无限制'
  const parts: string[] = []
  if (scope.markets?.length) parts.push(scope.markets.join('/'))
  if (scope.exclude_st) parts.push('排ST')
  if (scope.exclude_suspended) parts.push('排停牌')
  if (scope.exclude_codes?.length) parts.push(`排除 ${scope.exclude_codes.length} 码`)
  if (scope.include_only?.length) parts.push(`仅 ${scope.include_only.length} 码`)
  return parts.length ? parts.join(' · ') : '无限制'
}

// ----------------------------------------------------------------------------
// EditFormState (Form 内部状态类型, 但因 emptyDtoForCreate / strategyToForm 也用, 放这里)
// ----------------------------------------------------------------------------

export interface EditFormState {
  match_id: string
  name: string
  enabled: boolean
  strategy_id: string
  debounce_override: string // string for input; ""=null
  scope: MatchScopeDTO
  alerts: MatchAlertDTO[]
}

// ----------------------------------------------------------------------------
// CopyDialogState (复制策略 Dialog 的状态, 由 Form 和 CopyForm 共享)
// ----------------------------------------------------------------------------

export interface CopyDialogState {
  source: MatchStrategyDTO | null
  newId: string
  newName: string
  enableCopy: boolean
  copyAlerts: boolean
  loading: boolean
}

export const INITIAL_COPY: CopyDialogState = {
  source: null, newId: '', newName: '', enableCopy: false, copyAlerts: true, loading: false,
}

export function strategyToForm(s: MatchStrategyDTO): EditFormState {
  return {
    match_id: s.match_id,
    name: s.name || '',
    enabled: s.enabled,
    strategy_id: s.strategy_id || '',
    debounce_override:
      s.debounce_override === null || s.debounce_override === undefined
        ? ''
        : String(s.debounce_override),
    scope: s.scope || { ...EMPTY_SCOPE },
    alerts: (s.alerts || []).map((a) => ({
      alert_type: a.alert_type || '',
      params: { ...(a.params || {}) },
      channels: [...(a.channels || [])],
      priority: a.priority || 'medium',
    })),
  }
}

export function emptyDtoForCreate(): MatchStrategyDTO {
  return {
    match_id: '',
    name: '',
    enabled: true,
    strategy_id: '',
    scope: { ...EMPTY_SCOPE },
    alerts: [{ ...EMPTY_ALERT }],
    debounce_override: null,
    trading_hours_override: null,
  }
}
