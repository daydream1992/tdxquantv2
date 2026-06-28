'use client'

/**
 * 监控池概念热度卡片 (R14-3 方案 B)
 *
 * - 数据源: monitorAPI.getSectorHeatmap() (后端 /api/monitor/sector-heatmap)
 * - 30s 轮询（与其它 Dashboard 卡片一致），可手动刷新
 * - enabled=false 时整个组件返回 null（不占位，前端隐藏）
 * - items.length=0 时 EmptyState "暂无概念热度数据"
 * - 概念板块 amber 色调，行业板块 emerald 色调
 * - 移动端单列堆叠，桌面端 2 列（概念/行业分组）
 * - 加载中 Skeleton，错误 EmptyState + 重试
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Flame,
  RefreshCw,
  Factory,
  AlertCircle,
  Database,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { monitorAPI, type SectorHeatmapDTO, type HeatmapItemDTO } from '@/lib/api'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'

const POLL_INTERVAL_MS = 30_000

const TYPE_META: Record<
  string,
  { color: string; glow: string; label: string; icon: React.ElementType }
> = {
  concept: {
    color: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.16)',
    label: '概念板块',
    icon: Flame,
  },
  industry: {
    color: '#10b981',
    glow: 'rgba(16, 185, 129, 0.16)',
    label: '行业板块',
    icon: Factory,
  },
}

export function SectorHeatmap() {
  const [data, setData] = React.useState<SectorHeatmapDTO | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

  const load = React.useCallback(async (silent = false) => {
    if (!silent) {
      setRefreshing(true)
    }
    try {
      const r = await monitorAPI.getSectorHeatmap()
      setData(r)
      setError(null)
    } catch (e) {
      setError((e as Error).message || '加载概念热度失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    load()
    const t = setInterval(() => load(true), POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [load])

  // 开关关闭 → 整个组件不渲染
  if (data && !data.enabled) {
    return null
  }

  // 加载中（首次）
  if (loading && !data) {
    return (
      <Card className="p-4 gap-0 bg-quant-card border-quant overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-7 rounded-md bg-amber-500/15">
              <Flame className="size-4 text-quant-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold">概念热度 Top10</div>
              <div className="text-[11px] text-muted-foreground">
                监控池板块聚合 · 加载中...
              </div>
            </div>
          </div>
        </div>
        <LoadingState variant="list" rows={5} />
      </Card>
    )
  }

  // 错误
  if (error && !data) {
    return (
      <Card className="p-4 gap-0 bg-quant-card border-quant overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-7 rounded-md bg-amber-500/15">
              <Flame className="size-4 text-quant-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold">概念热度 Top10</div>
              <div className="text-[11px] text-muted-foreground">监控池板块聚合</div>
            </div>
          </div>
        </div>
        <EmptyState
          icon={AlertCircle}
          text="加载概念热度失败"
          description={error}
          action={
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 border-quant"
              onClick={() => load()}
            >
              <RefreshCw className="size-3" />
              重试
            </Button>
          }
        />
      </Card>
    )
  }

  if (!data) return null

  // 分组（概念/行业）
  const conceptItems = data.items.filter((i) => i.type === 'concept')
  const industryItems = data.items.filter((i) => i.type === 'industry')
  const maxCount = Math.max(1, ...data.items.map((i) => i.count))

  const fetchedAtStr = data.fetched_at
    ? new Date(data.fetched_at).toLocaleTimeString('zh-CN', {
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
            <Flame className="size-4 text-quant-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold">概念热度 Top{data.items.length || 10}</div>
            <div className="text-[11px] text-muted-foreground">
              监控池板块聚合 · 扫描 {data.scanned_stocks}/{data.total_stocks} 只
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.from_cache && (
            <Badge
              variant="outline"
              className="text-[10px] border-quant text-emerald-400 hidden sm:inline-flex"
            >
              缓存命中
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:inline">
            {fetchedAtStr}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 hover:bg-amber-500/10"
            onClick={() => load()}
            title="刷新"
            disabled={refreshing}
          >
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* 空数据 */}
      {data.items.length === 0 ? (
        <EmptyState
          icon={Database}
          text="暂无概念热度数据"
          description={
            data.total_stocks === 0
              ? '监控池为空，请先添加监控股票'
              : '监控池股票均无概念/行业板块归属'
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <HeatmapColumn
            typeKey="concept"
            items={conceptItems}
            maxCount={maxCount}
          />
          <HeatmapColumn
            typeKey="industry"
            items={industryItems}
            maxCount={maxCount}
          />
        </div>
      )}

      {/* 错误（有数据但刷新失败） */}
      {error && data.items.length > 0 && (
        <div className="mt-3 pt-3 border-t border-quant/60 text-[10px] text-amber-400/80 flex items-center gap-1.5">
          <AlertCircle className="size-3" />
          最近一次刷新失败: {error}（显示旧数据）
        </div>
      )}
    </Card>
  )
}

// ============================================================================
// 单列：一个 type 的 Top N
// ============================================================================

interface HeatmapColumnProps {
  typeKey: 'concept' | 'industry'
  items: HeatmapItemDTO[]
  maxCount: number
}

function HeatmapColumn({ typeKey, items, maxCount }: HeatmapColumnProps) {
  const meta = TYPE_META[typeKey]
  const Icon = meta.icon

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
          {items.length}
        </Badge>
      </div>

      {/* 列表 */}
      {items.length === 0 ? (
        <div className="text-[11px] text-muted-foreground py-3 text-center">
          暂无{meta.label}
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item, idx) => (
            <HeatmapRow
              key={`${item.code}-${idx}`}
              item={item}
              rank={idx + 1}
              maxCount={maxCount}
              color={meta.color}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 单行：一个板块的进度条
// ============================================================================

function HeatmapRow({
  item,
  rank,
  maxCount,
  color,
}: {
  item: HeatmapItemDTO
  rank: number
  maxCount: number
  color: string
}) {
  const progressPct = Math.max(2, Math.min(100, (item.count / maxCount) * 100))
  const sampleStocks = item.stocks.slice(0, 3).join(' · ')

  return (
    <div
      className="group relative rounded px-1.5 py-1 transition-all hover:bg-quant-bg/40"
      style={{ borderLeft: '2px solid transparent' }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.borderLeftColor = color
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.borderLeftColor = 'transparent'
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-flex items-center justify-center size-4 rounded text-[10px] font-semibold border shrink-0"
          style={{
            color: color,
            backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
            borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
          }}
        >
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate leading-tight">{item.name}</div>
          <div className="text-[9px] text-muted-foreground font-mono truncate leading-tight">
            {sampleStocks}
            {item.stocks.length > 3 && ' ...'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span
            className="text-xs font-mono tabular-nums font-semibold"
            style={{ color }}
          >
            {item.count}
          </span>
          <span className="text-[10px] text-muted-foreground ml-0.5">只</span>
        </div>
      </div>
      {/* 进度条 */}
      <div className="mt-1 h-0.5 rounded-full bg-quant-border overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progressPct}%`,
            background: `linear-gradient(to right, color-mix(in srgb, ${color} 40%, transparent), ${color})`,
          }}
        />
      </div>
    </div>
  )
}
