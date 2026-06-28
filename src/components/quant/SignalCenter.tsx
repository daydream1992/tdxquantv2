'use client'

/**
 * SignalCenter — 信号中心容器
 * 持有 signals/strategies/filters/detail 等共享状态, 组合 3 个子组件:
 * SignalFilter + SignalList + SignalDrawer。30s 轮询在 SignalList 内部。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { signalAPI, strategyAPI, channelAPI, type SignalDTO, type StrategyDTO } from '@/lib/api'
import { SignalFilter } from './signal/SignalFilter'
import { SignalList } from './signal/SignalList'
import { SignalDrawer } from './signal/SignalDrawer'

export function SignalCenter() {
  const [signals, setSignals] = React.useState<SignalDTO[]>([])
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [typeFilter, setTypeFilter] = React.useState('all')
  const [strategyFilter, setStrategyFilter] = React.useState('all')
  const [startDate, setStartDate] = React.useState('')
  const [endDate, setEndDate] = React.useState('')
  const [channelFilter, setChannelFilter] = React.useState<Set<string>>(new Set())
  const [repushing, setRepushing] = React.useState<Set<string>>(new Set())
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailSignal, setDetailSignal] = React.useState<SignalDTO | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setSignals(await signalAPI.list({
        type: typeFilter === 'all' ? undefined : typeFilter,
        strategy_id: strategyFilter === 'all' ? undefined : strategyFilter,
        start_date: startDate || undefined, end_date: endDate || undefined, limit: 200,
      }))
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [typeFilter, strategyFilter, startDate, endDate])

  React.useEffect(() => {
    load()
    strategyAPI.list().then(setStrategies).catch(() => {})
  }, [load])

  const displayedSignals = React.useMemo(() => {
    if (channelFilter.size === 0) return signals
    return signals.filter((s) => {
      for (const ch of channelFilter) if (!s.pushed_channels.includes(ch)) return false
      return true
    })
  }, [signals, channelFilter])

  const handleRepush = React.useCallback(async (signal: SignalDTO) => {
    setRepushing((prev) => new Set(prev).add(signal.id))
    const tid = toast.loading(`正在重新推送信号 ${signal.id.slice(0, 8)}...`)
    try {
      const r = await channelAPI.repush(signal.id)
      const desc = r.results.map((x) => `${x.channel}: ${x.ok ? '✓' : x.message}`).join(' · ')
      if (r.ok && r.fired.length > 0) toast.success(`已重推到 ${r.fired.join(', ')}`, { id: tid, description: desc })
      else if (r.ok && r.fired.length === 0) toast.warning('未推送到任何通道', { id: tid, description: desc || '请检查通道是否已启用' })
      else toast.error('重推失败', { id: tid, description: desc })
    } catch (e) {
      toast.error('重推失败', { id: tid, description: (e as Error).message })
    } finally {
      setRepushing((prev) => { const n = new Set(prev); n.delete(signal.id); return n })
    }
  }, [])

  const handleOpenDetail = React.useCallback(async (signal: SignalDTO) => {
    setDetailSignal(signal); setDetailOpen(true); setDetailError(null); setDetailLoading(true)
    try { setDetailSignal(await signalAPI.getDetail(signal.id)) }
    catch (e) { setDetailError((e as Error).message || '加载详情失败') }
    finally { setDetailLoading(false) }
  }, [])
  return (
    <div className="space-y-4">
      <SignalFilter
        typeFilter={typeFilter} strategyFilter={strategyFilter}
        startDate={startDate} endDate={endDate}
        channelFilter={channelFilter} setChannelFilter={setChannelFilter}
        strategies={strategies} setTypeFilter={setTypeFilter} setStrategyFilter={setStrategyFilter}
        setStartDate={setStartDate} setEndDate={setEndDate}
        signalsCount={signals.length} displayedCount={displayedSignals.length}
      />
      <SignalList
        signals={displayedSignals} totalCount={signals.length}
        loading={loading} strategies={strategies} repushing={repushing}
        onRepush={handleRepush} onOpenDetail={handleOpenDetail}
        typeFilter={typeFilter} setTypeFilter={setTypeFilter}
      />
      <SignalDrawer
        open={detailOpen} onOpenChange={setDetailOpen} signal={detailSignal}
        loading={detailLoading} error={detailError} strategies={strategies}
        repushing={repushing.has(detailSignal?.id || '')} onRepush={handleRepush}
      />
    </div>
  )
}
