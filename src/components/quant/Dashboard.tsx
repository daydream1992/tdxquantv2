'use client'

/**
 * 实时大屏
 * - 顶部 4 统计：监控股票数 / 今日信号数 / 涨停股票数 / 异常告警数
 * - 中部左侧：实时行情滚动（轮询 mock）
 * - 中部右侧：信号实时流（最近 10 条）
 * - 底部：5 策略板块概览
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Activity, Bell, Flame, AlertTriangle, Radio, RefreshCw } from 'lucide-react'
import { StatCard } from './StatCard'
import { StockPrice, PctBadge } from './StockPrice'
import { SignalToast } from './SignalToast'
import { StrategyCard } from './StrategyCard'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'
import { Button } from '@/components/ui/button'
import {
  monitorAPI,
  signalAPI,
  strategyAPI,
  type MonitorStatusDTO,
  type SignalDTO,
  type StrategyDTO,
  type QuoteDTO,
} from '@/lib/api'

export function Dashboard() {
  const [status, setStatus] = React.useState<MonitorStatusDTO | null>(null)
  const [signals, setSignals] = React.useState<SignalDTO[]>([])
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [quotes, setQuotes] = React.useState<QuoteDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [autoRefresh, setAutoRefresh] = React.useState(true)

  const loadAll = React.useCallback(async () => {
    try {
      const [s, sig, str] = await Promise.all([
        monitorAPI.getStatus(),
        signalAPI.list({ limit: 10 }),
        strategyAPI.list(),
      ])
      setStatus(s)
      setSignals(sig)
      setStrategies(str)
      // 行情数据来自 monitorAPI.getQuotes（route 内含 mock）
      try {
        const q = await monitorAPI.getQuotes()
        setQuotes(q)
      } catch {
        /* noop */
      }
    } catch (e) {
      console.error('[Dashboard] load error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadAll()
  }, [loadAll])

  // 自动轮询（10s）
  React.useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(loadAll, 10_000)
    return () => clearInterval(t)
  }, [autoRefresh, loadAll])

  return (
    <div className="space-y-4">
      {/* 顶部统计 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="监控股票数"
          value={status?.monitored_count ?? 0}
          icon={Activity}
          tone="primary"
          hint={`引擎 ${status?.engine_status ?? '...'} · ${status?.adapter_mode ?? ''} 模式`}
          loading={loading}
        />
        <StatCard
          label="今日信号数"
          value={status?.today_signals ?? 0}
          icon={Bell}
          tone="primary"
          hint="全部信号通道"
          loading={loading}
        />
        <StatCard
          label="涨停股票数"
          value={status?.today_limit_up ?? 0}
          icon={Flame}
          tone="up"
          hint="盘中触及涨停"
          loading={loading}
        />
        <StatCard
          label="异常告警数"
          value={status?.today_alerts ?? 0}
          icon={AlertTriangle}
          tone="down"
          hint="跌幅/异常推送"
          loading={loading}
        />
      </div>

      {/* 中部：行情 + 信号流 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左：实时行情滚动 */}
        <Card className="lg:col-span-2 p-0 gap-0 bg-quant-card border-quant overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-quant">
            <div className="flex items-center gap-2">
              <Radio className="size-4 text-quant-primary" />
              <span className="font-semibold text-sm">实时行情</span>
              <Badge variant="outline" className="text-[10px] border-quant font-mono">
                {quotes.length} 只
              </Badge>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="inline-block size-1.5 rounded-full bg-[var(--quant-down)] status-pulse" />
                轮询 10s
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setAutoRefresh((v) => !v)}
            >
              <RefreshCw className={`size-3 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? '自动刷新中' : '已暂停'}
            </Button>
          </div>
          <div className="max-h-96 overflow-y-auto quant-scroll">
            {loading ? (
              <LoadingState variant="list" className="p-3" rows={6} />
            ) : quotes.length === 0 ? (
              <EmptyState text="暂无行情数据" className="py-10" />
            ) : (
              <table className="quant-table w-full">
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>名称</th>
                    <th className="text-right">现价</th>
                    <th className="text-right">涨跌幅</th>
                    <th className="text-right">成交量</th>
                    <th className="text-right">成交额</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => {
                    const dir = q.pct > 0 ? 'up' : q.pct < 0 ? 'down' : 'flat'
                    return (
                      <tr key={q.code} className={dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : ''}>
                        <td className="font-mono text-xs">{q.code}</td>
                        <td className="text-xs">{q.name}</td>
                        <td className="text-right tabular-nums">
                          <span className={dir === 'up' ? 'text-up' : dir === 'down' ? 'text-down' : 'text-flat'}>
                            {q.last.toFixed(2)}
                          </span>
                        </td>
                        <td className="text-right">
                          <PctBadge pct={q.pct} />
                        </td>
                        <td className="text-right tabular-nums text-xs text-muted-foreground">
                          {(q.volume / 10000).toFixed(0)}万
                        </td>
                        <td className="text-right tabular-nums text-xs text-muted-foreground">
                          {(q.amount / 100000000).toFixed(2)}亿
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* 右：信号实时流 */}
        <Card className="p-0 gap-0 bg-quant-card border-quant overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-quant">
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-quant-primary" />
              <span className="font-semibold text-sm">信号实时流</span>
            </div>
            <Badge variant="outline" className="text-[10px] border-quant">
              最近 {signals.length} 条
            </Badge>
          </div>
          <div className="max-h-96 overflow-y-auto quant-scroll p-2 space-y-2">
            {loading ? (
              <LoadingState variant="list" rows={5} />
            ) : signals.length === 0 ? (
              <EmptyState text="暂无信号" className="py-10" />
            ) : (
              signals.map((s) => <SignalToast key={s.id} signal={s} />)
            )}
          </div>
        </Card>
      </div>

      {/* 底部：5 策略概览 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="size-4 text-quant-primary" />
            策略板块概览
          </h3>
          <Badge variant="outline" className="text-[10px] border-quant">
            {strategies.filter((s) => s.enabled).length}/{strategies.length} 启用
          </Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {loading ? (
            <LoadingState variant="cards" rows={5} className="col-span-full" />
          ) : (
            strategies.map((s) => <StrategyCard key={s.strategy_id} strategy={s} />)
          )}
        </div>
      </div>
    </div>
  )
}
