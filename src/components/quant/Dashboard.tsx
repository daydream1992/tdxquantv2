'use client'

/**
 * 实时大屏 (P2 SSE 实时推送)
 * - 顶部 4 统计：监控股票数 / 今日信号数 / 涨停股票数 / 异常告警数
 * - 中部左侧：实时行情滚动 (SSE 推送，5s 全量)
 * - 中部右侧：信号实时流 (新信号到达时高亮闪烁)
 * - 底部：5 策略板块概览
 * - 连接状态指示器 (SSE 在线 / 轮询降级 / 离线)
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Activity,
  Bell,
  Flame,
  AlertTriangle,
  Radio,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { StatCard } from './StatCard'
import { EngineHealthCard } from './EngineHealthCard'
import { StockPrice, PctBadge } from './StockPrice'
import { SignalToast } from './SignalToast'
import { StrategyCard } from './StrategyCard'
import { StrategyLeaderboard } from './StrategyLeaderboard'
import { FlowRanking } from './FlowRanking'
import { SectorHeatmap } from './SectorHeatmap'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'
import { Button } from '@/components/ui/button'
import { strategyAPI, type StrategyDTO } from '@/lib/api'
import { useRealtimeQuotes } from '@/lib/useRealtime'

export interface DashboardProps {
  /** 跳转到选股结果 Tab 的回测视图 */
  onNavigateToBacktest?: () => void
}

export function Dashboard({ onNavigateToBacktest }: DashboardProps) {
  // 实时 WS 数据
  const rt = useRealtimeQuotes({ autoRefresh: true })

  // 策略列表 (相对静态，单独拉)
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [strategiesLoading, setStrategiesLoading] = React.useState(true)

  React.useEffect(() => {
    strategyAPI
      .list()
      .then(setStrategies)
      .catch(() => {})
      .finally(() => setStrategiesLoading(false))
  }, [])

  // 拉取初值: 等 WS 数据到达前先显示 loading
  const initialLoading = rt.quotes.length === 0 && rt.signals.length === 0 && !rt.connected

  // 涨幅榜/跌幅榜 (排序后取前 N)
  const sortedQuotes = React.useMemo(() => {
    return [...rt.quotes].sort((a, b) => b.pct - a.pct)
  }, [rt.quotes])

  // 上 Top3 / 下 Top3 提示
  const topGainers = sortedQuotes.slice(0, 3)
  const topLosers = sortedQuotes.slice(-3).reverse()

  // 连接状态 Badge
  const connBadge = rt.connected ? (
    rt.mode === 'sse' ? (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15 gap-1">
        <Wifi className="size-3" />
        SSE 实时
      </Badge>
    ) : (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15 gap-1">
        <RefreshCw className="size-3" />
        轮询在线
      </Badge>
    )
  ) : (
    <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/15 gap-1">
      <WifiOff className="size-3" />
      离线
    </Badge>
  )

  return (
    <div className="space-y-4">
      {/* 顶部统计 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="监控股票数"
          value={rt.status?.monitored_count ?? 0}
          icon={Activity}
          tone="primary"
          hint={`引擎 ${rt.status?.engine_status ?? '...'} · ${rt.status?.adapter_mode ?? ''} 模式`}
          loading={initialLoading}
          spark={[0.2, 0.3, 0.5, 0.4, 0.6, 0.5, 0.7, 0.6, 0.8, 0.7, 0.9, 1.0]}
        />
        <StatCard
          label="今日信号数"
          value={rt.status?.today_signals ?? 0}
          icon={Bell}
          tone="primary"
          hint="全部信号通道"
          loading={initialLoading}
          spark={[0.1, 0.3, 0.2, 0.5, 0.4, 0.7, 0.6, 0.8, 0.5, 0.9, 0.7, 1.0]}
        />
        <StatCard
          label="涨停股票数"
          value={rt.status?.today_limit_up ?? 0}
          icon={Flame}
          tone="up"
          hint="盘中触及涨停"
          loading={initialLoading}
          spark={[0.0, 0.1, 0.05, 0.2, 0.15, 0.3, 0.25, 0.4, 0.35, 0.5, 0.45, 0.6]}
        />
        <StatCard
          label="异常告警数"
          value={rt.status?.today_alerts ?? 0}
          icon={AlertTriangle}
          tone="down"
          hint="跌幅/异常推送"
          loading={initialLoading}
          spark={[0.0, 0.05, 0.0, 0.1, 0.05, 0.0, 0.15, 0.1, 0.05, 0.2, 0.1, 0.15]}
        />
      </div>

      {/* 引擎健康度卡片 (R11-1) */}
      <EngineHealthCard />

      {/* 中部：行情 + 信号流 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左：实时行情滚动 */}
        <Card className="lg:col-span-2 p-0 gap-0 bg-quant-card border-quant overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-quant">
            <div className="flex items-center gap-2">
              <Radio className="size-4 text-quant-primary" />
              <span className="font-semibold text-sm">实时行情</span>
              <Badge variant="outline" className="text-[10px] border-quant font-mono">
                {rt.quotes.length} 只
              </Badge>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span
                  className={`inline-block size-1.5 rounded-full status-pulse ${
                    rt.connected ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                />
                {rt.mode === 'sse' ? 'SSE 5s' : '轮询 10s'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {connBadge}
            </div>
          </div>

          {/* 涨幅 Top3 / 跌幅 Top3 速览条 */}
          {sortedQuotes.length > 0 && (
            <div className="grid grid-cols-2 gap-2 p-2 border-b border-quant/50 bg-quant-bg/50">
              <div className="rounded-md p-2 bg-[var(--quant-up)]/5 border border-[var(--quant-up)]/15">
                <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Flame className="size-3 text-[var(--quant-up)]" />
                  涨幅榜 Top3
                </div>
                <div className="space-y-0.5">
                  {topGainers.map((q, i) => (
                    <div key={q.code} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] text-muted-foreground/60 w-3">{i + 1}</span>
                        <span className="truncate">{q.name}</span>
                      </span>
                      <span className="text-up tabular-nums font-mono">
                        +{(q.pct * 100).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md p-2 bg-[var(--quant-down)]/5 border border-[var(--quant-down)]/15">
                <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <AlertTriangle className="size-3 text-[var(--quant-down)]" />
                  跌幅榜 Top3
                </div>
                <div className="space-y-0.5">
                  {topLosers.map((q, i) => (
                    <div key={q.code} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] text-muted-foreground/60 w-3">{i + 1}</span>
                        <span className="truncate">{q.name}</span>
                      </span>
                      <span className="text-down tabular-nums font-mono">
                        {(q.pct * 100).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="max-h-96 overflow-y-auto quant-scroll">
            {initialLoading ? (
              <LoadingState variant="list" className="p-3" rows={6} />
            ) : rt.quotes.length === 0 ? (
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
                  {rt.quotes.map((q) => {
                    const dir = q.pct > 0 ? 'up' : q.pct < 0 ? 'down' : 'flat'
                    return (
                      <tr key={q.code} className={dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : ''}>
                        <td className="font-mono text-xs">{q.code}</td>
                        <td className="text-xs">{q.name || q.code}</td>
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
                          {q.amount > 0 ? `${(q.amount / 100000000).toFixed(2)}亿` : '--'}
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
              {rt.lastSignalAt && (
                <span className="text-[10px] text-emerald-400 animate-pulse">● new</span>
              )}
            </div>
            <Badge variant="outline" className="text-[10px] border-quant">
              最近 {rt.signals.length} 条
            </Badge>
          </div>
          <div className="max-h-96 overflow-y-auto quant-scroll p-2 space-y-2">
            {initialLoading ? (
              <LoadingState variant="list" rows={5} />
            ) : rt.signals.length === 0 ? (
              <EmptyState text="暂无信号" className="py-10" />
            ) : (
              rt.signals.map((s) => (
                <SignalToast key={s.id} signal={s} isNew={rt.lastSignalAt !== null && Date.now() - rt.lastSignalAt < 5000 && s.id === rt.signals[0]?.id} />
              ))
            )}
          </div>
        </Card>
      </div>

      {/* 实时资金流向 (R7-A) */}
      <FlowRanking
        quotes={rt.quotes}
        lastUpdated={rt.lastUpdated}
        loading={rt.refreshing}
        onRefresh={rt.refresh}
      />

      {/* R14-3: 监控池概念热度（方案 B，开关关闭时组件返回 null） */}
      <SectorHeatmap />

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
          {strategiesLoading ? (
            <LoadingState variant="cards" rows={5} className="col-span-full" />
          ) : (
            strategies.map((s) => <StrategyCard key={s.strategy_id} strategy={s} />)
          )}
        </div>
      </div>

      {/* 策略胜率排行 */}
      <StrategyLeaderboard onViewAll={onNavigateToBacktest} />
    </div>
  )
}
