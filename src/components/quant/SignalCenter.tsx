'use client'

/**
 * 信号中心
 * - 信号流表格：时间/类型/策略/股票/内容/推送通道/状态/操作
 * - 筛选：类型/策略/日期
 * - 统计：今日各类型信号数
 * - 行末"重推"按钮: channelAPI.repush(signalId)
 * - 新信号 (1 分钟内) 左侧琥珀色边框 + glow
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Bell,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Settings,
  Filter,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  RefreshCw,
  X,
  Radio,
} from 'lucide-react'
import { StockTable, type Column } from './StockTable'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'
import {
  signalAPI,
  strategyAPI,
  channelAPI,
  type SignalDTO,
  type StrategyDTO,
} from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const TYPE_META: Record<
  SignalDTO['type'],
  { icon: React.ElementType; color: string; label: string }
> = {
  limit_up: { icon: TrendingUp, color: 'var(--quant-up)', label: '涨停' },
  drop_alert: { icon: TrendingDown, color: 'var(--quant-down)', label: '下跌' },
  breakout: { icon: Sparkles, color: 'var(--quant-primary)', label: '突破' },
  selection: { icon: Bell, color: '#06b6d4', label: '选股' },
  system: { icon: Settings, color: 'var(--quant-flat)', label: '系统' },
}

// 推送状态元信息
const PUSH_STATUS_META: Record<
  SignalDTO['push_status'],
  { icon: React.ElementType; color: string; label: string }
> = {
  success: { icon: CheckCircle2, color: 'var(--quant-down)', label: '成功' },
  partial: { icon: AlertCircle, color: 'var(--quant-primary)', label: '部分' },
  failed: { icon: XCircle, color: 'var(--quant-up)', label: '失败' },
  pending: { icon: Clock, color: 'var(--quant-flat)', label: '待推' },
}

// 通道徽章元信息 (颜色与简称)
const CHANNEL_BADGE_META: Record<string, { color: string; label: string }> = {
  csv_log: { color: 'var(--quant-flat)', label: 'CSV' },
  websocket: { color: '#06b6d4', label: 'WS' },
  tdx_warn: { color: '#a855f7', label: 'TDX' },
  feishu: { color: 'var(--quant-down)', label: '飞书' },
  email: { color: '#f59e0b', label: '邮件' },
}

// 可筛选的通道列表 (固定顺序)
const CHANNEL_FILTER_ORDER: string[] = ['csv_log', 'websocket', 'tdx_warn', 'feishu']

// 新信号判定阈值 (1 分钟)
const NEW_SIGNAL_THRESHOLD_MS = 60 * 1000

export function SignalCenter() {
  const [signals, setSignals] = React.useState<SignalDTO[]>([])
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [typeFilter, setTypeFilter] = React.useState<string>('all')
  const [strategyFilter, setStrategyFilter] = React.useState<string>('all')
  const [startDate, setStartDate] = React.useState<string>('')
  const [endDate, setEndDate] = React.useState<string>('')
  // 推送通道筛选 (多选, "同时包含所有选中通道"语义)
  const [channelFilter, setChannelFilter] = React.useState<Set<string>>(new Set())
  // 正在重推的 signal id 集合
  const [repushing, setRepushing] = React.useState<Set<string>>(new Set())
  // 用于刷新新信号判定
  const [, setTick] = React.useState(0)

  React.useEffect(() => {
    strategyAPI.list().then(setStrategies).catch(() => {})
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await signalAPI.list({
        type: typeFilter === 'all' ? undefined : typeFilter,
        strategy_id: strategyFilter === 'all' ? undefined : strategyFilter,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        limit: 200,
      })
      setSignals(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [typeFilter, strategyFilter, startDate, endDate])

  React.useEffect(() => {
    load()
  }, [load])

  // 每 30 秒刷新一次"新信号"标记 (避免时间过去了还显示)
  React.useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // 按类型统计
  const stats = React.useMemo(() => {
    const m: Record<string, number> = {}
    signals.forEach((s) => {
      m[s.type] = (m[s.type] || 0) + 1
    })
    return m
  }, [signals])

  // 应用 channel 筛选后的信号 (AND 语义: 必须包含所有选中通道)
  const displayedSignals = React.useMemo(() => {
    if (channelFilter.size === 0) return signals
    return signals.filter((s) => {
      for (const ch of channelFilter) {
        if (!s.pushed_channels.includes(ch)) return false
      }
      return true
    })
  }, [signals, channelFilter])

  // 通道切换
  const toggleChannel = (ch: string) => {
    setChannelFilter((prev) => {
      const next = new Set(prev)
      if (next.has(ch)) {
        next.delete(ch)
      } else {
        next.add(ch)
      }
      return next
    })
  }

  // 清空所有筛选 (类型 / 策略 / 日期 / 通道)
  const clearAllFilters = () => {
    setTypeFilter('all')
    setStrategyFilter('all')
    setStartDate('')
    setEndDate('')
    setChannelFilter(new Set())
  }

  const hasAnyFilter =
    typeFilter !== 'all' ||
    strategyFilter !== 'all' ||
    !!startDate ||
    !!endDate ||
    channelFilter.size > 0

  // 重推信号
  const handleRepush = React.useCallback(async (signal: SignalDTO) => {
    setRepushing((prev) => new Set(prev).add(signal.id))
    const toastId = toast.loading(`正在重新推送信号 ${signal.id.slice(0, 8)}...`)
    try {
      const r = await channelAPI.repush(signal.id)
      if (r.ok && r.fired.length > 0) {
        toast.success(`已重推到 ${r.fired.join(', ')}`, {
          id: toastId,
          description: r.results
            .map((x) => `${x.channel}: ${x.ok ? '✓' : '✗'}`)
            .join(' · '),
        })
      } else if (r.ok && r.fired.length === 0) {
        toast.warning('未推送到任何通道', {
          id: toastId,
          description: r.results
            .map((x) => `${x.channel}: ${x.message}`)
            .join(' · ') || '请检查通道是否已启用',
        })
      } else {
        toast.error('重推失败', {
          id: toastId,
          description: r.results
            .map((x) => `${x.channel}: ${x.message}`)
            .join(' · '),
        })
      }
    } catch (e) {
      toast.error('重推失败', {
        id: toastId,
        description: (e as Error).message,
      })
    } finally {
      setRepushing((prev) => {
        const next = new Set(prev)
        next.delete(signal.id)
        return next
      })
    }
  }, [])

  // 判断是否新信号 (1 分钟内)
  const isNewSignal = React.useCallback((s: SignalDTO) => {
    const ts = new Date(s.time).getTime()
    return Date.now() - ts < NEW_SIGNAL_THRESHOLD_MS
  }, [])

  const columns: Column<SignalDTO>[] = [
    {
      key: 'time',
      header: '时间',
      width: '6rem',
      render: (s) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {new Date(s.time).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      ),
      sortValue: (s) => s.time,
    },
    {
      key: 'type',
      header: '类型',
      width: '5rem',
      render: (s) => {
        const meta = TYPE_META[s.type]
        const Icon = meta.icon
        return (
          <span
            className="text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1 border"
            style={{
              color: meta.color,
              backgroundColor: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
              borderColor: `color-mix(in srgb, ${meta.color} 30%, transparent)`,
            }}
          >
            <Icon className="size-3" />
            {meta.label}
          </span>
        )
      },
    },
    {
      key: 'strategy',
      header: '策略',
      width: '8rem',
      render: (s) => {
        // 优先 strategy_name; 若只有 strategy_id 显示 id; 都没有显示 —
        const name = s.strategy_name
        const sid = s.strategy_id
        if (!name && !sid) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        // 反查策略 emoji (若信号本身没带)
        const strategy = strategies.find((x) => x.strategy_id === sid)
        const emoji = strategy?.strategy_emoji || ''
        return (
          <span className="text-xs text-foreground/80 truncate inline-flex items-center gap-1">
            {emoji && <span className="shrink-0">{emoji}</span>}
            <span className="truncate">{name || sid}</span>
          </span>
        )
      },
    },
    {
      key: 'stock',
      header: '股票',
      width: '9rem',
      render: (s) => {
        if (!s.stock_code && !s.stock_name) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <span className="text-xs font-mono text-foreground/80 inline-flex items-center gap-1">
            {s.stock_name && (
              <span className="text-foreground/90">{s.stock_name}</span>
            )}
            {s.stock_code && (
              <span className="text-muted-foreground">({s.stock_code})</span>
            )}
          </span>
        )
      },
    },
    {
      key: 'content',
      header: '内容',
      render: (s) => (
        <span className="text-xs text-foreground/90 line-clamp-2">
          {s.content}
        </span>
      ),
    },
    {
      key: 'channels',
      header: '推送通道',
      align: 'center',
      width: '8rem',
      render: (s) => (
        <div className="flex flex-wrap gap-1 justify-center">
          {s.pushed_channels.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            s.pushed_channels.map((ch) => {
              const meta = CHANNEL_BADGE_META[ch] || {
                color: 'var(--quant-flat)',
                label: ch,
              }
              return (
                <span
                  key={ch}
                  className="text-[10px] px-1.5 py-0.5 rounded border font-medium"
                  style={{
                    color: meta.color,
                    backgroundColor: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
                    borderColor: `color-mix(in srgb, ${meta.color} 30%, transparent)`,
                  }}
                  title={ch}
                >
                  {meta.label}
                </span>
              )
            })
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      align: 'center',
      width: '5rem',
      render: (s) => {
        const meta = PUSH_STATUS_META[s.push_status]
        const Icon = meta.icon
        return (
          <span
            className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded border"
            style={{
              color: meta.color,
              backgroundColor: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
              borderColor: `color-mix(in srgb, ${meta.color} 30%, transparent)`,
            }}
          >
            <Icon className="size-3" />
            {meta.label}
          </span>
        )
      },
    },
    {
      key: 'actions',
      header: '操作',
      align: 'center',
      width: '4rem',
      render: (s) => {
        const isRepushing = repushing.has(s.id)
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs hover:bg-amber-500/10 hover:text-amber-400"
            disabled={isRepushing}
            onClick={(e) => {
              e.stopPropagation()
              handleRepush(s)
            }}
            title="重新推送到所有启用通道"
          >
            <RefreshCw className={cn('size-3', isRepushing && 'animate-spin')} />
            <span className="hidden lg:inline">{isRepushing ? '推送中' : '重推'}</span>
          </Button>
        )
      },
    },
  ]

  // 行样式: 新信号左侧琥珀色边框 + glow
  const rowClassName = React.useCallback(
    (s: SignalDTO) => {
      if (isNewSignal(s)) {
        return 'signal-row-new'
      }
      return ''
    },
    [isNewSignal]
  )

  return (
    <div className="space-y-4">
      {/* 类型统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {(Object.keys(TYPE_META) as SignalDTO['type'][]).map((t) => {
          const meta = TYPE_META[t]
          const Icon = meta.icon
          const count = stats[t] || 0
          const total = signals.length || 1
          const pct = (count / total) * 100
          const isActive = typeFilter === t
          return (
            <Card
              key={t}
              className={`p-3 gap-0 bg-quant-card border-quant cursor-pointer transition-all hover:border-[var(--quant-primary)]/40 hover:shadow-md ${
                isActive ? 'ring-1 ring-amber-500/30 border-amber-500/40' : ''
              }`}
              onClick={() => setTypeFilter(isActive ? 'all' : t)}
              style={{
                backgroundImage: `radial-gradient(circle at top right, color-mix(in srgb, ${meta.color} 15%, transparent) 0%, transparent 60%)`,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="size-8 rounded-md flex items-center justify-center transition-transform hover:scale-110"
                    style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}
                  >
                    <Icon className="size-4" style={{ color: meta.color }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{meta.label}</span>
                </div>
                <span className="text-xl font-semibold tabular-nums" style={{ color: meta.color }}>
                  {count}
                </span>
              </div>
              {/* 占比进度条 */}
              <div className="mt-2 h-1 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    backgroundColor: meta.color,
                  }}
                />
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                {pct.toFixed(1)}% · 点击{isActive ? '取消' : '筛选'}
              </div>
            </Card>
          )
        })}
      </div>

      {/* 筛选栏 */}
      <Card className="p-3 gap-0 bg-quant-card border-quant">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">类型</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-32 border-quant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {(Object.keys(TYPE_META) as SignalDTO['type'][]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_META[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">策略</Label>
            <Select value={strategyFilter} onValueChange={setStrategyFilter}>
              <SelectTrigger className="h-8 w-40 border-quant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部策略</SelectItem>
                {strategies.map((s) => (
                  <SelectItem key={s.strategy_id} value={s.strategy_id}>
                    {s.strategy_emoji} {s.strategy_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">开始日期</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 w-36 border-quant"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">结束日期</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 w-36 border-quant"
            />
          </div>
          {hasAnyFilter && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10"
              onClick={clearAllFilters}
              title="清空所有筛选"
            >
              <X className="size-3" />
              清空筛选
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Filter className="size-3" />
            <span>
              共 <span className="text-quant-primary font-semibold tabular-nums">{displayedSignals.length}</span>
              {channelFilter.size > 0 && signals.length !== displayedSignals.length && (
                <span className="text-muted-foreground/70"> / {signals.length}</span>
              )} 条
            </span>
          </div>
        </div>

        {/* 推送通道筛选行 */}
        <div className="mt-3 pt-3 border-t border-quant/60">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Radio className="size-3" />
              推送通道
            </Label>
            <button
              type="button"
              onClick={() => setChannelFilter(new Set())}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded-md border transition-all',
                channelFilter.size === 0
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/40 font-semibold ring-2 ring-amber-500/30'
                  : 'text-muted-foreground border-quant hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30'
              )}
            >
              全部
            </button>
            {CHANNEL_FILTER_ORDER.map((ch) => {
              const meta = CHANNEL_BADGE_META[ch]
              const active = channelFilter.has(ch)
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  className={cn(
                    'text-[11px] px-2.5 py-1 rounded-md border font-medium transition-all',
                    active && 'ring-2 ring-amber-500/60 ring-offset-1 ring-offset-background'
                  )}
                  style={{
                    color: active ? '#ffffff' : meta.color,
                    backgroundColor: active
                      ? meta.color
                      : `color-mix(in srgb, ${meta.color} 8%, transparent)`,
                    borderColor: active
                      ? meta.color
                      : `color-mix(in srgb, ${meta.color} 30%, transparent)`,
                  }}
                  title={`筛选推送通道: ${meta.label} (${ch})`}
                >
                  {meta.label}
                </button>
              )
            })}
            {channelFilter.size > 0 && (
              <span className="ml-auto text-[11px] text-amber-400 inline-flex items-center gap-1">
                <Filter className="size-3" />
                已筛选: {CHANNEL_FILTER_ORDER.filter((ch) => channelFilter.has(ch))
                  .map((ch) => CHANNEL_BADGE_META[ch].label)
                  .join(' + ')}
                <span className="text-muted-foreground">
                  (共 {displayedSignals.length} 条)
                </span>
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* 图例提示 */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-amber-400 rounded" />
          新信号 (1 分钟内)
        </span>
        <span className="flex items-center gap-1">
          <RefreshCw className="size-3" />
          点击行末"重推"可重新推送到所有启用通道
        </span>
      </div>

      {/* 表格 */}
      {loading ? (
        <LoadingState rows={10} />
      ) : displayedSignals.length === 0 ? (
        <Card className="bg-quant-card border-quant">
          <EmptyState
            text={signals.length === 0 ? '暂无信号' : '当前筛选条件下无信号'}
            description={signals.length === 0 ? '调整筛选条件或稍后再试' : `已过滤 ${signals.length} 条信号, 尝试调整通道筛选`}
          />
        </Card>
      ) : (
        <StockTable
          columns={columns}
          data={displayedSignals}
          rowKey={(s) => s.id}
          maxHeight="32rem"
          pageSize={30}
          rowClassName={rowClassName}
        />
      )}
    </div>
  )
}
