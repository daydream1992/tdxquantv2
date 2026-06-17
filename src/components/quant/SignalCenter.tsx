'use client'

/**
 * 信号中心
 * - 信号流表格：时间/类型/策略/股票/内容/推送状态
 * - 筛选：类型/策略/日期
 * - 统计：今日各类型信号数
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Bell, TrendingUp, TrendingDown, Sparkles, Settings, Filter } from 'lucide-react'
import { StockTable, type Column } from './StockTable'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'
import {
  signalAPI,
  strategyAPI,
  type SignalDTO,
  type StrategyDTO,
} from '@/lib/api'

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

export function SignalCenter() {
  const [signals, setSignals] = React.useState<SignalDTO[]>([])
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [typeFilter, setTypeFilter] = React.useState<string>('all')
  const [strategyFilter, setStrategyFilter] = React.useState<string>('all')
  const [startDate, setStartDate] = React.useState<string>('')
  const [endDate, setEndDate] = React.useState<string>('')

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

  // 按类型统计
  const stats = React.useMemo(() => {
    const m: Record<string, number> = {}
    signals.forEach((s) => {
      m[s.type] = (m[s.type] || 0) + 1
    })
    return m
  }, [signals])

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
            className="text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            style={{
              color: meta.color,
              backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
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
      width: '7rem',
      render: (s) => (
        <span className="text-xs text-muted-foreground truncate">
          {s.strategy_name || '—'}
        </span>
      ),
    },
    {
      key: 'stock',
      header: '股票',
      width: '8rem',
      render: (s) => (
        <span className="text-xs font-mono text-foreground/80">
          {s.stock_code ? `${s.stock_code} ${s.stock_name || ''}` : '—'}
        </span>
      ),
    },
    {
      key: 'content',
      header: '内容',
      render: (s) => <span className="text-xs text-foreground/90">{s.content}</span>,
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
            s.pushed_channels.map((ch) => (
              <span
                key={ch}
                className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {ch}
              </span>
            ))
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
        const color =
          s.push_status === 'success'
            ? 'var(--quant-down)'
            : s.push_status === 'partial'
            ? 'var(--quant-primary)'
            : s.push_status === 'failed'
            ? 'var(--quant-up)'
            : 'var(--quant-flat)'
        return (
          <span
            className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
            style={{
              color,
              backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
            }}
          >
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            {s.push_status}
          </span>
        )
      },
    },
  ]

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
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Filter className="size-3" />
            <span>共 {signals.length} 条</span>
          </div>
        </div>
      </Card>

      {/* 表格 */}
      {loading ? (
        <LoadingState rows={10} />
      ) : signals.length === 0 ? (
        <Card className="bg-quant-card border-quant">
          <EmptyState text="暂无信号" description="调整筛选条件或稍后再试" />
        </Card>
      ) : (
        <StockTable
          columns={columns}
          data={signals}
          rowKey={(s) => s.id}
          maxHeight="32rem"
          pageSize={30}
        />
      )}
    </div>
  )
}
