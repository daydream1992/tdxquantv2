'use client'

/**
 * 评分徽章
 * 根据得分阈值显示不同颜色，得分越高颜色越暖（金融风）
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ScoreBadgeProps {
  score: number
  /** 最大值（默认 100，engine total_score 为 0-100 量纲） */
  max?: number
  size?: 'sm' | 'md' | 'lg'
  showValue?: boolean
  className?: string
}

export function ScoreBadge({
  score,
  max = 100,
  size = 'md',
  showValue = true,
  className,
}: ScoreBadgeProps) {
  const ratio = Math.min(1, Math.max(0, score / max))
  // 颜色阶梯：0-0.4 灰，0.4-0.6 黄，0.6-0.8 橙，0.8-1.0 红（金融高分暖色）
  const color =
    ratio >= 0.85
      ? 'var(--quant-up)'
      : ratio >= 0.7
      ? '#f97316'
      : ratio >= 0.55
      ? 'var(--quant-primary)'
      : ratio >= 0.4
      ? '#a16207'
      : 'var(--quant-flat)'

  const sizeClass =
    size === 'sm' ? 'h-1.5 w-12' : size === 'lg' ? 'h-3 w-24' : 'h-2 w-16'
  const textClass =
    size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base font-semibold' : 'text-sm'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showValue && (
        <span className={cn('tabular-nums font-medium', textClass)} style={{ color }}>
          {score.toFixed(1)}
        </span>
      )}
      <div
        className={cn('rounded-full overflow-hidden bg-muted', sizeClass)}
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${ratio * 100}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
