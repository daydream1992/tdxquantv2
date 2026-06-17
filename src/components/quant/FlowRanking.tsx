'use client'

/**
 * 实时资金流向卡片 (R7-A)
 *
 * - 数据源: QuoteDTO[] (含 main_inflow / big_buy_ratio / turnover_rate 字段, 从 useRealtimeQuotes 复用)
 * - 3 列 Top5 排行:
 *   - 主力净流入 (红色调): 正数 var(--quant-up) 红, 负数 var(--quant-down) 绿
 *   - 大买占比 (琥珀色调): 进度条 0~100%
 *   - 换手率 (青色调): 进度条 0~max%
 * - 排名徽章: 前 3 名金/银/铜, 4-5 灰色
 * - 行 hover: 背景变浅 + 左侧 2px 边框
 * - 响应式: mobile 单列堆叠, sm 2 列, lg 3 列
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Activity,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Flame,
  Gauge,
  Coins,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuoteDTO } from '@/lib/api'

export interface FlowRankingProps {
  quotes: QuoteDTO[]
  lastUpdated: number | null
  loading?: boolean
  onRefresh?: () => void
}

type Metric = 'main_inflow' | 'big_buy_ratio' | 'turnover_rate'

interface MetricMeta {
  key: Metric
  label: string
  hint: string
  icon: React.ElementType
  color: string  // 主色
  glow: string    // 渐变光晕色 (rgba)
}

const METRICS: MetricMeta[] = [
  {
    key: 'main_inflow',
    label: '主力净流入',
    hint: '大资金买入强度 · 万元',
    icon: Coins,
    color: 'var(--quant-up)',
    glow: 'rgba(239, 68, 68, 0.16)',
  },
  {
    key: 'big_buy_ratio',
    label: '大买占比',
    hint: '买盘集中度 · Top5',
    icon: Flame,
    color: 'var(--quant-primary)',
    glow: 'rgba(245, 158, 11, 0.16)',
  },
  {
    key: 'turnover_rate',
    label: '换手率',
    hint: '交投活跃度 · %',
    icon: Gauge,
    color: '#06b6d4',
    glow: 'rgba(6, 182, 212, 0.16)',
  },
]

// 排名徽章: 前 3 名金/银/铜, 4-5 灰
const RANK_BADGES: Array<{ label: string; cls: string }> = [
  { label: '1', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { label: '2', cls: 'bg-slate-400/20 text-slate-200 border-slate-400/40' },
  { label: '3', cls: 'bg-orange-700/20 text-orange-300 border-orange-700/40' },
  { label: '4', cls: 'bg-muted/30 text-muted-foreground border-quant' },
  { label: '5', cls: 'bg-muted/30 text-muted-foreground border-quant' },
]

export function FlowRanking({ quotes, lastUpdated, loading, onRefresh }: FlowRankingProps) {
  // 计算每个 metric 的 Top5
  const rankings = React.useMemo(() => {
    const out: Record<Metric, QuoteDTO[]> = {
      main_inflow: [],
      big_buy_ratio: [],
      turnover_rate: [],
    }
    if (!quotes || quotes.length === 0) return out
    for (const m of METRICS) {
      const sorted = [...quotes]
        .map((q) => ({ q, v: Number(q[m] ?? 0) || 0 }))
        .filter((x) => x.v !== 0 || m === 'main_inflow') // inflow 允许 0 (有正有负)
        .sort((a, b) => b.v - a.v)
        .slice(0, 5)
        .map((x) => x.q)
      out[m.key] = sorted
    }
    return out
  }, [quotes])

  const lastUpdatedStr = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '--:--:--'

  return (
    <Card className="p-4 gap-0 bg-quant-card border-quant overflow-hidden">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center size-7 rounded-md bg-amber-500/15">
            <Activity className="size-4 text-quant-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold">实时资金流向</div>
            <div className="text-[11px] text-muted-foreground">
              主力净流入 · 大买占比 · 换手率 Top5
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:inline">
            {lastUpdatedStr}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 hover:bg-amber-500/10"
            onClick={onRefresh}
            title="刷新"
            disabled={loading}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* 3 列卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {METRICS.map((m) => (
          <MetricColumn key={m.key} meta={m} items={rankings[m.key]} />
        ))}
      </div>
    </Card>
  )
}

// ============================================================================
// 单列: 一个 metric 的 Top5
// ============================================================================

function MetricColumn({ meta, items }: { meta: MetricMeta; items: QuoteDTO[] }) {
  const Icon = meta.icon
  const max = React.useMemo(() => {
    if (items.length === 0) return 1
    const vals = items.map((q) => Number(q[meta.key] ?? 0) || 0)
    return Math.max(1, ...vals.map((v) => Math.abs(v)))
  }, [items, meta.key])

  return (
    <div
      className="rounded-md border p-3 transition-all"
      style={{
        borderColor: `color-mix(in srgb, ${meta.color} 25%, transparent)`,
        backgroundImage: `radial-gradient(circle at top right, ${meta.glow} 0%, transparent 65%)`,
      }}
    >
      {/* 列头 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="size-3.5 shrink-0" style={{ color: meta.color }} />
          <span className="text-xs font-semibold truncate">{meta.label}</span>
        </div>
        <Badge
          variant="outline"
          className="text-[10px] font-mono border-quant"
          style={{ color: meta.color }}
        >
          Top{items.length || 5}
        </Badge>
      </div>
      <div className="text-[10px] text-muted-foreground mb-2 truncate">{meta.hint}</div>

      {/* Top5 行 */}
      {items.length === 0 ? (
        <div className="text-[11px] text-muted-foreground py-4 text-center">
          暂无数据
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((q, idx) => (
            <FlowRow
              key={q.code}
              quote={q}
              rank={idx + 1}
              meta={meta}
              max={max}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 单行
// ============================================================================

function FlowRow({
  quote,
  rank,
  meta,
  max,
}: {
  quote: QuoteDTO
  rank: number
  meta: MetricMeta
  max: number
}) {
  const value = Number(quote[meta.key] ?? 0) || 0
  const pct = quote.pct
  const isUp = pct > 0
  const isDown = pct < 0

  // 排名徽章
  const badge = RANK_BADGES[rank - 1] || RANK_BADGES[4]

  // 数值格式化
  const valueStr = formatValue(meta.key, value)
  // 进度条宽度 (基于 max 归一化)
  const progressPct = Math.max(2, Math.min(100, (Math.abs(value) / max) * 100))
  // 涨跌幅颜色
  const pctColor = isUp
    ? 'var(--quant-up)'
    : isDown
    ? 'var(--quant-down)'
    : 'var(--quant-flat)'

  return (
    <div
      className={cn(
        'group relative rounded px-1.5 py-1 transition-all',
        'hover:bg-quant-bg/40'
      )}
      style={{
        borderLeft: '2px solid transparent',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.borderLeftColor = meta.color
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.borderLeftColor = 'transparent'
      }}
    >
      <div className="flex items-center gap-1.5">
        {/* 排名徽章 */}
        <span
          className={cn(
            'inline-flex items-center justify-center size-4 rounded text-[10px] font-semibold border shrink-0',
            badge.cls
          )}
        >
          {badge.label}
        </span>
        {/* 名称 + 代码 */}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate leading-tight">{quote.name || quote.code}</div>
          <div className="text-[9px] text-muted-foreground font-mono truncate leading-tight">
            {quote.code}
          </div>
        </div>
        {/* 数值 */}
        <div className="text-right shrink-0">
          <div
            className="text-xs font-mono tabular-nums font-semibold leading-tight"
            style={{ color: meta.key === 'main_inflow' ? (value >= 0 ? 'var(--quant-up)' : 'var(--quant-down)') : meta.color }}
          >
            {valueStr}
          </div>
          <div
            className="text-[10px] font-mono tabular-nums leading-tight flex items-center justify-end gap-0.5"
            style={{ color: pctColor }}
          >
            {isUp ? (
              <TrendingUp className="size-2.5" />
            ) : isDown ? (
              <TrendingDown className="size-2.5" />
            ) : null}
            {(pct * 100).toFixed(2)}%
          </div>
        </div>
      </div>
      {/* 进度条 (大买占比/换手率显示) */}
      {meta.key !== 'main_inflow' && (
        <div className="mt-1 h-0.5 rounded-full bg-quant-border overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: `linear-gradient(to right, color-mix(in srgb, ${meta.color} 40%, transparent), ${meta.color})`,
            }}
          />
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 工具
// ============================================================================

function formatValue(metric: Metric, v: number): string {
  if (metric === 'main_inflow') {
    // 万元, 带 +/- 符号, 千位分隔
    const sign = v > 0 ? '+' : v < 0 ? '-' : ''
    const abs = Math.abs(v)
    if (abs >= 10000) {
      return `${sign}${(abs / 10000).toFixed(2)}亿`
    }
    return `${sign}${abs.toFixed(0)}万`
  }
  if (metric === 'big_buy_ratio') {
    return `${(v * 100).toFixed(1)}%`
  }
  if (metric === 'turnover_rate') {
    return `${v.toFixed(2)}%`
  }
  return String(v)
}
