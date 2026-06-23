'use client'

/**
 * StrategyList — 策略列表 + 卡片 + 启用/禁用/执行按钮 + 运行历史 Sheet
 *
 * 纯展示 + 局部 history 状态 (runs / runsLoading), 共享状态由容器 StrategyManager 持有。
 * - 顶部操作栏: 全部启用 / 全部停用 / 批量运行 / 刷新配置
 * - 策略卡片网格: 调用 StrategyCard, 转发 onViewConfig/onCopy/onDelete (id → StrategyDTO)
 * - 运行历史 Sheet: 内部持有 runs / runsLoading, 点击"查看历史"打开并拉取 runs
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Play, Power, PowerOff, RefreshCw, History, Clock, CheckCircle, XCircle } from 'lucide-react'
import { StrategyCard } from '../StrategyCard'
import { LoadingState } from '../LoadingState'
import { toast } from 'sonner'
import { strategyAPI, type StrategyDTO, type StrategyRunRecord } from '@/lib/api'

export interface StrategyListProps {
  strategies: StrategyDTO[]
  loading: boolean
  running: string | null
  onToggle: (id: string, next: boolean) => void
  onRun: (id: string) => void
  onBatch: (action: 'enable_all' | 'disable_all' | 'run_all') => void
  onReloadConfig: () => void
  onViewConfig: (s: StrategyDTO) => void
  onCopy: (s: StrategyDTO) => void
  onDelete: (s: StrategyDTO) => void
}

export function StrategyList({
  strategies, loading, running, onToggle, onRun, onBatch, onReloadConfig,
  onViewConfig, onCopy, onDelete,
}: StrategyListProps) {
  const [historyOpen, setHistoryOpen] = React.useState<StrategyDTO | null>(null)
  const [runs, setRuns] = React.useState<StrategyRunRecord[]>([])
  const [runsLoading, setRunsLoading] = React.useState(false)

  const fetchRuns = React.useCallback(async (id: string) => {
    setRunsLoading(true)
    setRuns([])
    try { setRuns(await strategyAPI.runs(id)) }
    catch (e) { toast.error('加载历史失败', { description: (e as Error).message }) }
    finally { setRunsLoading(false) }
  }, [])

  const openHistory = React.useCallback((s: StrategyDTO) => {
    setHistoryOpen(s)
    fetchRuns(s.strategy_id)
  }, [fetchRuns])

  const lookup = (id: string): StrategyDTO | undefined =>
    strategies.find((x) => x.strategy_id === id)

  const enabledCount = strategies.filter((s) => s.enabled).length

  return (
    <>
      {/* 顶部操作栏 */}
      <Card className="p-3 gap-0 bg-quant-card border-quant">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">策略列表</span>
            <Badge variant="outline" className="border-quant">
              {enabledCount}/{strategies.length} 启用
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="outline" className="h-8 border-quant" onClick={() => onBatch('enable_all')} disabled={loading}>
              <Power className="size-3.5 text-[var(--quant-down)]" />
              全部启用
            </Button>
            <Button size="sm" variant="outline" className="h-8 border-quant" onClick={() => onBatch('disable_all')} disabled={loading}>
              <PowerOff className="size-3.5 text-muted-foreground" />
              全部停用
            </Button>
            <Button size="sm" variant="default" className="h-8" onClick={() => onBatch('run_all')} disabled={loading}>
              <Play className="size-3.5" />
              批量运行
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={onReloadConfig} disabled={loading} title="重新加载 YAML 配置">
              <RefreshCw className="size-3.5" />
              刷新配置
            </Button>
          </div>
        </div>
      </Card>

      {/* 策略卡片网格 */}
      {loading ? (
        <LoadingState variant="cards" rows={5} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {strategies.map((s) => (
            <StrategyCard
              key={s.strategy_id}
              strategy={{
                ...s,
                description: running === s.strategy_id ? '运行中...' : s.description,
              }}
              onToggle={onToggle}
              onRun={onRun}
              onViewConfig={(id) => { const t = lookup(id); if (t) onViewConfig(t) }}
              onViewHistory={(id) => { const t = lookup(id); if (t) openHistory(t) }}
              onCopy={(id) => { const t = lookup(id); if (t) onCopy(t) }}
              onDelete={(id) => { const t = lookup(id); if (t) onDelete(t) }}
            />
          ))}
        </div>
      )}

      {/* 运行历史 Sheet */}
      <Sheet
        open={!!historyOpen}
        onOpenChange={(v) => { if (!v) { setHistoryOpen(null); setRuns([]) } }}
      >
        <SheetContent className="sm:max-w-2xl w-full flex flex-col gap-0 p-0">
          <SheetHeader className="p-4 border-b border-quant">
            <SheetTitle className="flex items-center gap-2">
              <History className="size-5 text-quant-primary" />
              {historyOpen?.strategy_emoji} {historyOpen?.strategy_name}
              <Badge variant="outline" className="ml-2 font-mono text-xs border-quant">
                {historyOpen?.strategy_id}
              </Badge>
            </SheetTitle>
            <SheetDescription>
              最近 50 次选股执行记录（来源 QuestDB strategy_runs 表）
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-auto quant-scroll p-3 space-y-2">
            {runsLoading ? (
              <LoadingState rows={5} />
            ) : runs.length === 0 ? (
              <div className="text-center py-12 text-xs text-muted-foreground">
                <History className="size-8 mx-auto mb-2 opacity-30" />
                暂无执行记录
                <div className="mt-1 text-[10px]">点击"运行"按钮触发选股后会出现在这里</div>
              </div>
            ) : (
              runs.map((r) => {
                const isOk = r.status === 'completed' && !r.error_message
                const dur = r.duration_ms >= 1000
                  ? `${(r.duration_ms / 1000).toFixed(2)}s`
                  : `${r.duration_ms}ms`
                return (
                  <div
                    key={r.run_id}
                    className="rounded-md border border-quant bg-quant-card/50 p-3 hover:bg-quant-card transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {isOk ? (
                            <CheckCircle className="size-3.5 text-[var(--quant-down)]" />
                          ) : (
                            <XCircle className="size-3.5 text-red-400" />
                          )}
                          <span className="font-mono text-xs text-foreground/80 truncate">
                            {r.run_id}
                          </span>
                          <Badge variant="outline" className="text-[10px] border-quant">
                            {r.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground tabular-nums">
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {r.started_at
                              ? new Date(r.started_at).toLocaleString('zh-CN', {
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                })
                              : '-'}
                          </span>
                          <span>耗时 {dur}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          选出 {r.result_count}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          证券池 {r.universe_count}
                        </span>
                      </div>
                    </div>
                    {r.error_message && (
                      <div className="mt-2 text-[10px] text-red-400 bg-red-500/5 border border-red-500/20 rounded p-1.5">
                        {r.error_message}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="p-3 border-t border-quant text-[10px] text-muted-foreground flex items-center justify-between">
            <span>共 {runs.length} 条记录</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => historyOpen && fetchRuns(historyOpen.strategy_id)}
            >
              <RefreshCw className="size-3" />
              刷新
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
