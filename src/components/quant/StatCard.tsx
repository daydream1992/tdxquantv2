'use client'

/**
 * 统计卡片
 * 顶部 4 统计：监控股票数 / 今日信号数 / 涨停股票数 / 异常告警数
 * 增强：渐变背景光晕 + sparkline 装饰 + hover 微动效
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

const TONE_GLOW: Record<StatTone, string> = {
  primary: 'rgba(245, 158, 11, 0.18)',
  up: 'rgba(239, 68, 68, 0.18)',
  down: 'rgba(16, 185, 129, 0.18)',
  flat: 'rgba(148, 163, 184, 0.12)',
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
  /** 卡片右上角 sparkline 数据点（0-1 归一化值），最多 12 个 */
  spark?: number[]
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
  spark,
}: StatCardProps) {
  const color = TONE_COLOR[tone]
  const glow = TONE_GLOW[tone]

  // sparkline 路径计算
  const sparkPath = React.useMemo(() => {
    if (!spark || spark.length < 2) return null
    const W = 80
    const H = 24
    const max = Math.max(...spark)
    const min = Math.min(...spark)
    const range = max - min || 1
    const step = W / (spark.length - 1)
    const pts = spark.map((v, i) => {
      const x = i * step
      const y = H - ((v - min) / range) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    return pts.join(' ')
  }, [spark])

  return (
    <Card
      className={cn(
        'relative overflow-hidden p-4 gap-0 bg-quant-card border-quant group',
        'hover:border-[var(--quant-primary)]/50 hover:shadow-lg hover:shadow-black/30',
        'transition-all duration-300',
        className
      )}
      style={{
        backgroundImage: `radial-gradient(circle at top right, ${glow} 0%, transparent 60%)`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground truncate">{label}</div>
          {loading ? (
            <div className="h-8 w-20 bg-muted rounded mt-1.5 animate-pulse" />
          ) : (
            <div
              className="text-2xl font-semibold mt-1 tabular-nums transition-transform group-hover:scale-105 origin-left duration-300"
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
        <div className="flex flex-col items-end gap-1 shrink-0">
          {Icon && (
            <div
              className="flex items-center justify-center rounded-md size-10 shrink-0 transition-transform group-hover:scale-110 duration-300"
              style={{
                backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
              }}
            >
              <Icon className="size-5" style={{ color }} />
            </div>
          )}
          {sparkPath && (
            <svg
              width="80"
              height="24"
              viewBox="0 0 80 24"
              className="opacity-70"
              aria-hidden
            >
              <polyline
                points={sparkPath}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      </div>
      {/* 底部装饰条 - 带渐变 */}
      <div
        className="absolute bottom-0 left-0 right-0 h-0.5 opacity-80 group-hover:opacity-100 transition-opacity"
        style={{
          background: `linear-gradient(to right, transparent, ${color}, transparent)`,
        }}
      />
    </Card>
  )
}
