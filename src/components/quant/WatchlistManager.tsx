'use client'

/**
 * WatchlistManager — 自选股管理容器
 * 持有 items/strategies/loading + 两个 Dialog 的 open 状态,
 * 组合 2 个子组件: WatchlistTable + BatchImportDialog。
 */

import * as React from 'react'
import { toast } from 'sonner'
import {
  watchlistAPI, strategyAPI,
  type WatchlistItemDTO, type StrategyDTO,
} from '@/lib/api'
import { WatchlistTable } from './watchlist/WatchlistTable'
import { BatchImportDialog } from './watchlist/BatchImportDialog'

export function WatchlistManager() {
  const [items, setItems] = React.useState<WatchlistItemDTO[]>([])
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [batchOpen, setBatchOpen] = React.useState(false)
  const [bySectorOpen, setBySectorOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setItems((await watchlistAPI.list()) || [])
    } catch (e) {
      toast.error('加载自选股失败', { description: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
    strategyAPI.list().then(setStrategies).catch(() => {})
  }, [load])

  return (
    <div className="space-y-4">
      <WatchlistTable
        items={items} strategies={strategies} loading={loading}
        onRefresh={load}
        onOpenBatch={() => setBatchOpen(true)}
        onOpenBySector={() => setBySectorOpen(true)}
      />
      <BatchImportDialog
        strategies={strategies} onRefresh={load}
        batchOpen={batchOpen} onBatchOpenChange={setBatchOpen}
        bySectorOpen={bySectorOpen} onBySectorOpenChange={setBySectorOpen}
      />
    </div>
  )
}
