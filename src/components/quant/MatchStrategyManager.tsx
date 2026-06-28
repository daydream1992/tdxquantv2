'use client'

/**
 * MatchStrategyManager — 匹配策略管理容器
 * 持有 items/strategies/loading 等共享状态 + 顶层 Dialog 协调状态，
 * 组合 3 个子组件: List / Form / Test。各子组件内部局部状态由其自治。
 */

import * as React from 'react'
import { toast } from 'sonner'
import {
  matchStrategyAPI,
  strategyAPI,
  type MatchStrategyDTO,
  type StrategyDTO,
} from '@/lib/api'
import { MatchStrategyList } from './match-strategy/MatchStrategyList'
import { MatchStrategyForm } from './match-strategy/MatchStrategyForm'
import { MatchStrategyTest } from './match-strategy/MatchStrategyTest'
import { emptyDtoForCreate } from './match-strategy/shared'

export function MatchStrategyManager() {
  const [items, setItems] = React.useState<MatchStrategyDTO[]>([])
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [reloading, setReloading] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editMode, setEditMode] = React.useState<'create' | 'update'>('create')
  const [editInitial, setEditInitial] = React.useState<MatchStrategyDTO | null>(null)
  const [testTarget, setTestTarget] = React.useState<MatchStrategyDTO | null>(null)
  const [copySource, setCopySource] = React.useState<MatchStrategyDTO | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setItems((await matchStrategyAPI.list()).items || [])
    } catch (e) {
      toast.error('加载匹配策略失败', { description: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
    strategyAPI.list().then(setStrategies).catch(() => {})
  }, [load])

  const handleReload = async () => {
    setReloading(true)
    const tid = toast.loading('正在重载 match_strategies YAML...')
    try {
      const r = await matchStrategyAPI.reload()
      toast.success('YAML 已重载', { id: tid, description: `当前 ${r.count} 项：${r.message}` })
      await load()
    } catch (e) {
      toast.error('重载失败', { id: tid, description: (e as Error).message })
    } finally {
      setReloading(false)
    }
  }

  const openCreate = () => {
    setEditMode('create')
    setEditInitial(emptyDtoForCreate())
    setEditOpen(true)
  }

  const openEdit = (s: MatchStrategyDTO) => {
    setEditMode('update')
    setEditInitial(s)
    setEditOpen(true)
  }

  return (
    <>
      <MatchStrategyList
        items={items} setItems={setItems} strategies={strategies}
        loading={loading} reloading={reloading}
        onReload={handleReload} onRefresh={load}
        onCreate={openCreate} onEdit={openEdit}
        onTest={setTestTarget} onCopy={setCopySource}
      />
      <MatchStrategyForm
        open={editOpen} mode={editMode} initial={editInitial} strategies={strategies}
        copySource={copySource} existingIds={items.map((x) => x.match_id)}
        onClose={() => setEditOpen(false)} onSaved={load}
        onCloseCopy={() => setCopySource(null)} onCopied={load}
      />
      <MatchStrategyTest target={testTarget} onClose={() => setTestTarget(null)} />
    </>
  )
}
