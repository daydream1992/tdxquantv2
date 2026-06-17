'use client'

/**
 * 股票价格显示组件
 * - 涨红跌绿（A股惯例）
 * - 支持价格 + 涨跌幅 + 涨跌额
 * - 支持可选的代码/名称后缀
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface StockPriceProps {
  /** 当前价 */
  price: number
  /** 涨跌幅（小数，如 0.0234 表示 +2.34%） */
  pctChange?: number
  /** 涨跌额 */
  change?: number
  /** 显示尺寸 */
  size?: 'sm' | 'md' | 'lg'
  /** 是否等宽数字 */
  tabular?: boolean
  /** 是否显示百分号 */
  showPct?: boolean
  className?: string
}

export function StockPrice({
  price,
  pctChange,
  change,
  size = 'md',
  tabular = true,
  showPct = true,
  className,
}: StockPriceProps) {
  const dir = !pctChange ? 'flat' : pctChange > 0 ? 'up' : 'down'
  const colorClass =
    dir === 'up' ? 'text-up' : dir === 'down' ? 'text-down' : 'text-flat'
  const sizeClass =
    size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-xl font-semibold' : 'text-base font-medium'
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—'

  return (
    <div className={cn('flex items-baseline gap-2', className)}>
      <span className={cn(colorClass, sizeClass, tabular && 'tabular-nums')}>
        {price.toFixed(2)}
      </span>
      {pctChange !== undefined && showPct && (
        <span className={cn(colorClass, 'text-xs tabular-nums')}>
          {arrow} {(pctChange * 100).toFixed(2)}%
        </span>
      )}
      {change !== undefined && (
        <span className={cn(colorClass, 'text-xs tabular-nums')}>
          {change >= 0 ? '+' : ''}
          {change.toFixed(2)}
        </span>
      )}
    </div>
  )
}

/** 仅显示涨跌幅徽章（用于表格紧凑场景） */
export function PctBadge({ pct }: { pct: number }) {
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  const colorClass =
    dir === 'up' ? 'text-up' : dir === 'down' ? 'text-down' : 'text-flat'
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—'
  return (
    <span className={cn(colorClass, 'tabular-nums text-xs font-medium')}>
      {arrow} {(pct * 100).toFixed(2)}%
    </span>
  )
}
