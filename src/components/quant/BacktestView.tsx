'use client'

/** 回测视图容器: 组合 BacktestForm + BacktestChart + BacktestTrades, 持有 state + 调 API。 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { BarChart3 } from 'lucide-react'
import { toast } from 'sonner'
import { backtestAPI, strategyAPI, type BacktestResultDTO, type BacktestHistoryItemDTO, type BacktestParamsDTO, type StrategyDTO } from '@/lib/api'
import { EmptyState } from './EmptyState'
import { BacktestForm, defaultStartDate, defaultEndDate } from './backtest/BacktestForm'
import { BacktestChart } from './backtest/BacktestChart'
import { BacktestTrades, BacktestHistory } from './backtest/BacktestTrades'

export function BacktestView() {
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [strategyId, setStrategyId] = React.useState('dbqzt')
  const [startDate, setStartDate] = React.useState(defaultStartDate())
  const [endDate, setEndDate] = React.useState(defaultEndDate())
  const [initialCapital, setInitialCapital] = React.useState('100000')
  const [topN, setTopN] = React.useState('5'); const [holdDays, setHoldDays] = React.useState('5')
  const [result, setResult] = React.useState<BacktestResultDTO | null>(null)
  const [running, setRunning] = React.useState(false); const [historyOpen, setHistoryOpen] = React.useState(false)
  const [history, setHistory] = React.useState<BacktestHistoryItemDTO[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false); const [loadingHistoryId, setLoadingHistoryId] = React.useState<string | null>(null)

  React.useEffect(() => {
    strategyAPI.list().then((list) => {
      setStrategies(list)
      const first = list.find((s) => s.enabled) || list[0]
      if (first) setStrategyId(first.strategy_id)
    }).catch(() => {})
  }, [])

  const loadHistory = React.useCallback(async () => {
    setHistoryLoading(true)
    try { setHistory(await backtestAPI.history()) }
    catch (e) { toast.error('加载历史回测失败', { description: (e as Error).message }) }
    finally { setHistoryLoading(false) }
  }, []); React.useEffect(() => { loadHistory() }, [loadHistory])

  const handleRun = async () => {
    const capital = Number(initialCapital)
    if (!strategyId) { toast.error('请选择策略'); return }
    if (!startDate || !endDate || new Date(endDate) <= new Date(startDate)) { toast.error('结束日期必须晚于开始日期'); return }
    if (!Number.isFinite(capital) || capital < 1000) { toast.error('初始资金不能小于 1000'); return }
    setRunning(true)
    const toastId = toast.loading('正在运行回测...', { description: `${strategyId} · ${startDate} ~ ${endDate}` })
    try {
      const params: BacktestParamsDTO = { strategy_id: strategyId, start_date: startDate, end_date: endDate, initial_capital: capital, top_n: Number(topN), hold_days: Number(holdDays) }
      const r = await backtestAPI.run(params)
      setResult(r)
      toast.success(`回测完成: 总收益 ${r.total_return.toFixed(2)}%`, { id: toastId, description: `夏普 ${r.sharpe_ratio.toFixed(2)} · 胜率 ${r.win_rate.toFixed(1)}% · ${r.total_trades} 笔交易` })
      loadHistory()
    } catch (e) {
      toast.error('回测失败', { id: toastId, description: (e as Error).message })
    } finally {
      setRunning(false)
    }
  }

  const handleLoadHistory = async (runId: string) => {
    setLoadingHistoryId(runId)
    try {
      const r = await backtestAPI.get(runId)
      setResult(r)
      setStrategyId(r.strategy_id); setStartDate(r.start_date); setEndDate(r.end_date)
      setInitialCapital(String(r.initial_capital)); setTopN(String(r.top_n)); setHoldDays(String(r.hold_days))
      toast.success(`已加载回测 ${runId.slice(0, 8)}`)
    } catch (e) {
      toast.error('加载回测详情失败', { description: (e as Error).message })
    } finally { setLoadingHistoryId(null) }
  }

  return (
    <div className="space-y-4">
      <BacktestForm
        strategies={strategies} strategyId={strategyId} startDate={startDate} endDate={endDate}
        initialCapital={initialCapital} topN={topN} holdDays={holdDays} running={running}
        onStrategyIdChange={setStrategyId} onStartDateChange={setStartDate} onEndDateChange={setEndDate}
        onInitialCapitalChange={setInitialCapital} onTopNChange={setTopN} onHoldDaysChange={setHoldDays}
        onRun={handleRun}
      />
      {result ? (
        <BacktestTrades result={result} />
      ) : (
        <Card className="p-6 bg-quant-card border-quant">
          <EmptyState text="暂无回测结果" description="请选择策略与日期范围，点击「运行回测」按钮开始" icon={BarChart3} />
        </Card>
      )}
      {result && result.daily_equity.length > 0 && <BacktestChart result={result} />}
      <BacktestHistory
        history={history} historyOpen={historyOpen} historyLoading={historyLoading}
        loadingHistoryId={loadingHistoryId} onOpenChange={setHistoryOpen} onLoad={handleLoadHistory}
      />
    </div>
  )
}
