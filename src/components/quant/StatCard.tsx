'use client'

/**
 * 统计卡片
 * 顶部 4 统计：监控股票数 / 今日信号数 / 涨停股票数 / 异常告警数
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type StatTone = 'primary' | 'up' | 'down' | 'flat'

const TONE_COLOR: Record<StatTone, string> = {
  primary: 'var(--quant-primary)',
  up: 'var(--quant-up)',
  down: 'var(--quant-down)',
  flat: 'var(--quant-flat)',
}

export interface StatCardProps {
  label: string
  value: number | string
  icon?: React.ElementType
  tone?: StatTone
  hint?: string
  trend?: { value: number; label?: string }
  loading?: boolean
  className?: string
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
  hint,
  trend,
  loading,
  className,
}: StatCardProps) {
  const color = TONE_COLOR[tone]
  return (
    <Card
      className={cn(
        'relative overflow-hidden p-4 gap-0 bg-quant-card border-quant',
        'hover:border-[var(--quant-primary)]/40 transition-colors',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">{label}</div>
          {loading ? (
            <div className="h-8 w-20 bg-muted rounded mt-1.5 animate-pulse" />
          ) : (
            <div
              className="text-2xl font-semibold mt-1 tabular-nums"
              style={{ color }}
            >
              {typeof value === 'number' ? value.toLocaleString('zh-CN') : value}
            </div>
          )}
          {hint && <div className="text-[11px] text-muted-foreground mt-1 truncate">{hint}</div>}
          {trend && (
            <div
              className="text-[11px] mt-1 tabular-nums flex items-center gap-1"
              style={{ color: trend.value >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}
            >
              <span>
                {trend.value >= 0 ? '▲' : '▼'} {Math.abs(trend.value).toFixed(2)}%
              </span>
              {trend.label && <span className="text-muted-foreground">{trend.label}</span>}
            </div>
          )}
        </div>
        {Icon && (
          <div
            className="flex items-center justify-center rounded-md size-10 shrink-0"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
            }}
          >
            <Icon className="size-5" style={{ color }} />
          </div>
        )}
      </div>
      {/* 底部装饰条 */}
      <div
        className="absolute bottom-0 left-0 right-0 h-0.5 opacity-60"
        style={{ backgroundColor: color }}
      />
    </Card>
  )
}
