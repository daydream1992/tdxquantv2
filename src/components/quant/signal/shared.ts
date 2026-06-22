/**
 * signal/shared.ts
 *
 * SignalCenter 子组件共享的常量 / 工具函数 / 类型 (无 JSX)。
 * 由 SignalList / SignalDrawer / SignalFilter 共同 import。
 */

import type * as React from 'react'
import type { SignalDTO } from '@/lib/api'
import { TrendingUp, TrendingDown, Sparkles, Bell, Settings, CheckCircle2, AlertCircle, XCircle, Clock } from 'lucide-react'

// ----------------------------------------------------------------------------
// 元信息常量
// ----------------------------------------------------------------------------

export const TYPE_META: Record<
  SignalDTO['type'],
  { icon: React.ElementType; color: string; label: string }
> = {
  limit_up: { icon: TrendingUp, color: 'var(--quant-up)', label: '涨停' },
  drop_alert: { icon: TrendingDown, color: 'var(--quant-down)', label: '下跌' },
  breakout: { icon: Sparkles, color: 'var(--quant-primary)', label: '突破' },
  selection: { icon: Bell, color: '#06b6d4', label: '选股' },
  system: { icon: Settings, color: 'var(--quant-flat)', label: '系统' },
}

export const PUSH_STATUS_META: Record<
  SignalDTO['push_status'],
  { icon: React.ElementType; color: string; label: string }
> = {
  success: { icon: CheckCircle2, color: 'var(--quant-down)', label: '成功' },
  partial: { icon: AlertCircle, color: 'var(--quant-primary)', label: '部分' },
  failed: { icon: XCircle, color: 'var(--quant-up)', label: '失败' },
  pending: { icon: Clock, color: 'var(--quant-flat)', label: '待推' },
}

export const CHANNEL_BADGE_META: Record<string, { color: string; label: string }> = {
  csv_log: { color: 'var(--quant-flat)', label: 'CSV' },
  websocket: { color: '#06b6d4', label: 'WS' },
  tdx_warn: { color: '#a855f7', label: 'TDX' },
  feishu: { color: 'var(--quant-down)', label: '飞书' },
  email: { color: '#f59e0b', label: '邮件' },
}

/** 可筛选的通道列表 (固定顺序) */
export const CHANNEL_FILTER_ORDER: string[] = ['csv_log', 'websocket', 'tdx_warn', 'feishu']

/** 新信号判定阈值 (1 分钟) */
export const NEW_SIGNAL_THRESHOLD_MS = 60 * 1000

/** R13-3c: 导出 CSV 时单条记录超过此条数弹确认对话框 */
export const EXPORT_CONFIRM_THRESHOLD = 500

// ----------------------------------------------------------------------------
// 工具函数
// ----------------------------------------------------------------------------

/** R13-3c: CSV 单元格转义 (含逗号/双引号/换行 → 双引号包裹, 内部双引号双写转义) */
export function csvEscape(val: string): string {
  if (/[",\n\r]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

/** 判断是否新信号 (1 分钟内) */
export function isNewSignal(s: SignalDTO): boolean {
  return Date.now() - new Date(s.time).getTime() < NEW_SIGNAL_THRESHOLD_MS
}

// ----------------------------------------------------------------------------
// 类型
// ----------------------------------------------------------------------------

export type FilterActive = 'all' | 'active' | 'inactive'
