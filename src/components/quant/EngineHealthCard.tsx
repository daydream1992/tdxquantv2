'use client'

/**
 * 引擎健康度卡片 (R11-1)
 * - 调 monitorAPI.getHealth() 每 5s 自动刷新, 支持手动刷新按钮
 * - 状态徽章 (healthy / degraded / unhealthy / unknown) + 6 关键指标 + 行情延迟趋势图
 * - 趋势图: SVG 折线, 维护 ref 数组保留最近 30 次采样, 颜色随 status 变化
 * - last_error 非空时底部红色小字展示 (截断 80 字符 + title 全文)
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Activity,
  RefreshCw,
  HeartPulse,
  AlertTriangle,
  AlertOctagon,
  HelpCircle,
} from 'lucide-react'
import { monitorAPI, type EngineHealthDTO } from '@/lib/api'
import { cn } from '@/lib/utils'

type HealthStatus = EngineHealthDTO['status']

/** status → 视觉映射 (badge 文案 / 颜色 / 图标) */
const STATUS_META: Record<
  HealthStatus,
  {
    label: string
    badgeCls: string
    icon: React.ElementType
    lineColor: string
  }
> = {
  healthy: {
    label: '运行正常',
    badgeCls:
      'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15',
    icon: HeartPulse,
    lineColor: 'var(--quant-up, #22c55e)',
  },
  degraded: {
    label: '性能下降',
    badgeCls:
      'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15',
    icon: AlertTriangle,
    lineColor: '#f59e0b',
  },
  unhealthy: {
    label: '异常',
    badgeCls:
      'bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/15',
    icon: AlertOctagon,
    lineColor: '#ef4444',
  },
  unknown: {
    label: '未知',
    badgeCls:
      'bg-zinc-500/15 text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/15',
    icon: HelpCircle,
    lineColor: '#71717a',
  },
}

const MAX_SAMPLES = 30
const REFRESH_INTERVAL_MS = 5_000

/** 把秒数格式化为 "Xh Ym" 或 "Xm Ys" */
function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--'
  const s = Math.floor(sec)
  if (s >= 3600) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${h}h ${m}m`
  }
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${m}m ${ss}s`
}

/** 把数字按千分位格式化 (整数) */
function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '--'
  return Math.floor(n).toLocaleString('zh-CN')
}

/** 截断字符串到 maxLen, 超过加省略号 */
function truncate(s: string, maxLen: number): string {
  if (!s) return ''
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
}

/** 单个指标格子 */
function MetricCell({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-quant/60 bg-quant-bg/40 px-2.5 py-2">
      <div className="text-[10px] text-muted-foreground truncate">{label}</div>
      <div className="text-sm font-semibold tabular-nums mt-0.5 text-card-foreground">
        {children}
      </div>
    </div>
  )
}

export function EngineHealthCard() {
  const [health, setHealth] = React.useState<EngineHealthDTO | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // 趋势历史用 ref 存 (避免 setState 在 push/shift 时频繁触发, 仅在 setState 触发时一起 re-render)
  const lagHistoryRef = React.useRef<number[]>([])
  // renderTick 仅用于触发 useMemo 重算 (lagHistoryRef.current 是同一引用, 单独 useMemo 不会重算)
  const [renderTick, setRenderTick] = React.useState(0)

  const fetchHealth = React.useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const data = await monitorAPI.getHealth()
      setHealth(data)
      setError(null)
      // 维护最近 MAX_SAMPLES 个 lag 采样
      const hist = lagHistoryRef.current
      hist.push(Number(data.quote_lag_seconds) || 0)
      if (hist.length > MAX_SAMPLES) hist.splice(0, hist.length - MAX_SAMPLES)
      setRenderTick((t) => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : '拉取失败')
    } finally {
      setLoading(false)
      if (manual) setRefreshing(false)
    }
  }, [])

  // 首次 + 定时轮询
  React.useEffect(() => {
    fetchHealth()
    const id = setInterval(() => fetchHealth(false), REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchHealth])

  const status: HealthStatus = health?.status ?? 'unknown'
  const meta = STATUS_META[status]
  const StatusIcon = meta.icon

  // 趋势 SVG 折线点 (viewBox 100x40, preserveAspectRatio=none 拉伸)
  // 注意: 依赖 renderTick 触发重算 (lagHistoryRef.current 是同一引用, 不会触发 useMemo)
  const lagPoints = lagHistoryRef.current
  const sparkPath = React.useMemo(() => {
    if (lagPoints.length < 2) return null
    const W = 100
    const H = 40
    const max = Math.max(...lagPoints, 1)
    const min = Math.min(...lagPoints, 0)
    const range = max - min || 1
    const step = W / (lagPoints.length - 1)
    return lagPoints
      .map((v, i) => {
        const x = i * step
        const y = H - 3 - ((v - min) / range) * (H - 6)
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')
  }, [renderTick])

  // 卡片首屏骨架
  if (loading && !health) {
    return (
      <Card className="bg-quant-card border-quant p-4 gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-quant-primary" />
            <span className="font-semibold text-sm">引擎健康度</span>
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </div>
      </Card>
    )
  }

  const lag = health?.quote_lag_seconds ?? 0
  // R11-1: 红色阈值优先用后端透出的 thresholds.lag_healthy_seconds, 缺省回退 60s
  const lagHealthyThreshold = health?.thresholds?.lag_healthy_seconds ?? 60
  const lagDegradedThreshold = health?.thresholds?.lag_degraded_seconds ?? 120
  const errHealthyThreshold = health?.thresholds?.error_healthy_threshold ?? 10
  const lagHigh = lag > lagHealthyThreshold
  const errCount = health?.error_count ?? 0
  const lastError = health?.last_error ?? ''

  return (
    <Card className="bg-quant-card border-quant p-4 gap-3 relative overflow-hidden">
      {/* 顶部: 标题 + 状态徽章 + 刷新按钮 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="size-4 text-quant-primary shrink-0" />
          <span className="font-semibold text-sm">引擎健康度</span>
          <Badge
            variant="outline"
            className={cn('gap-1 text-[11px]', meta.badgeCls)}
          >
            <StatusIcon className="size-3" />
            {meta.label}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={() => fetchHealth(true)}
          disabled={refreshing}
          aria-label="手动刷新引擎健康度"
          title="立即刷新"
        >
          <RefreshCw
            className={cn('size-3.5', refreshing && 'animate-spin')}
          />
        </Button>
      </div>

      {/* 趋势图 (lag 折线, 高 40, 宽撑满) */}
      <div className="relative w-full h-10 rounded-md bg-quant-bg/40 border border-quant/40 overflow-hidden">
        {sparkPath ? (
          <svg
            width="100%"
            height="40"
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            className="block"
            aria-label="行情延迟最近 30 次采样"
          >
            <polyline
              points={sparkPath}
              fill="none"
              stroke={meta.lineColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
            采样中…
          </div>
        )}
        <div className="absolute top-0.5 left-1.5 text-[9px] text-muted-foreground/80 tabular-nums pointer-events-none">
          lag {lag.toFixed(1)}s · 采样 {lagPoints.length}/{MAX_SAMPLES}
        </div>
      </div>

      {/* 6 关键指标: 移动 2 列 / 桌面 3 列 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <MetricCell label="订阅状态">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                'inline-block size-2 rounded-full',
                health?.subscribe_alive
                  ? 'bg-emerald-500 status-pulse'
                  : 'bg-zinc-500'
              )}
            />
            {health?.subscribe_alive ? '是' : '否'}
          </span>
        </MetricCell>
        <MetricCell label="行情延迟 (秒)">
          <span className={cn(lagHigh && 'text-down font-bold')}>
            {lag.toFixed(1)}
          </span>
        </MetricCell>
        <MetricCell label="求值次数">{fmtInt(health?.eval_count ?? 0)}</MetricCell>
        <MetricCell label="错误次数">
          <span className={cn(errCount > 0 && 'text-down font-bold')}>
            {fmtInt(errCount)}
          </span>
        </MetricCell>
        <MetricCell label="去重队列">
          {fmtInt(health?.debounce_size ?? 0)}
        </MetricCell>
        <MetricCell label="运行时长">
          {formatUptime(health?.uptime_seconds ?? 0)}
        </MetricCell>
      </div>

      {/* 底部: 最近错误 / 拉取异常提示 */}
      {lastError && (
        <div
          className="text-[11px] text-rose-400 truncate font-mono"
          title={lastError}
        >
          ⚠ {truncate(lastError, 80)}
        </div>
      )}
      {error && !lastError && (
        <div className="text-[11px] text-amber-400 truncate" title={error}>
          ⚠ 拉取失败: {error}
        </div>
      )}
      {/* R11-1: 阈值脚注 (后端透出时展示当前生效阈值, 便于调参验证) */}
      {health?.thresholds && (
        <div className="text-[10px] text-muted-foreground/70 tabular-nums truncate">
          阈值 · lag&lt;{lagHealthyThreshold}s 正常 / &lt;{lagDegradedThreshold}s 降级 ·
          err&gt;{errHealthyThreshold} 异常
        </div>
      )}
    </Card>
  )
}
