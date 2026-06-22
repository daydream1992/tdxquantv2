'use client'

/**
 * 策略管理容器
 * 持有 strategies/loading/running + 顶层 Dialog target 状态,
 * 组合 StrategyList (列表/卡片/历史 Sheet) + StrategyEdit (编辑/复制/删除 Dialog)。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { strategyAPI, configAPI, type StrategyDTO } from '@/lib/api'
import { StrategyList } from './strategy/StrategyList'
import { StrategyEdit } from './strategy/StrategyEdit'

export function StrategyManager() {
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [running, setRunning] = React.useState<string | null>(null)
  const [configTarget, setConfigTarget] = React.useState<StrategyDTO | null>(null)
  const [copySource, setCopySource] = React.useState<StrategyDTO | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<StrategyDTO | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try { setStrategies(await strategyAPI.list()) }
    catch (e) { toast.error('加载策略失败', { description: (e as Error).message }) }
    finally { setLoading(false) }
  }, [])
  React.useEffect(() => { load() }, [load])

  const handleToggle = async (id: string, next: boolean) => {
    setStrategies((prev) => prev.map((s) => s.strategy_id === id ? { ...s, enabled: next } : s))
    try {
      if (next) await strategyAPI.enable(id); else await strategyAPI.disable(id)
      toast.success(`${next ? '已启用' : '已停用'} 策略 ${id}`)
    } catch (e) {
      setStrategies((prev) => prev.map((s) => s.strategy_id === id ? { ...s, enabled: !next } : s))
      toast.error('操作失败', { description: (e as Error).message })
    }
  }

  const handleRun = async (id: string) => {
    setRunning(id)
    try {
      const r = await strategyAPI.run(id)
      toast.success(`策略 ${id} 运行完成`, { description: `run_id: ${r.run_id} · 选出 ${r.count} 只` })
      await load()
    } catch (e) { toast.error('运行失败', { description: (e as Error).message }) }
    finally { setRunning(null) }
  }

  const handleBatch = async (action: 'enable_all' | 'disable_all' | 'run_all') => {
    try {
      if (action === 'enable_all') { await strategyAPI.enableAll(); toast.success('已全部启用') }
      else if (action === 'disable_all') { await strategyAPI.disableAll(); toast.success('已全部停用') }
      else {
        const r = await strategyAPI.runAll()
        toast.success('批量运行完成', { description: r.results.map((x) => `${x.id}: ${x.count}`).join(' · ') })
      }
      await load()
    } catch (e) { toast.error('批量操作失败', { description: (e as Error).message }) }
  }

  const handleReloadConfig = async () => {
    try {
      const r = await configAPI.reload()
      toast.success('配置已热加载', { description: `重载 ${r.reloaded.length} 项: ${r.reloaded.join(', ')}` })
      await load()
    } catch (e) { toast.error('配置加载失败', { description: (e as Error).message }) }
  }

  return (
    <div className="space-y-4">
      <StrategyList
        strategies={strategies} loading={loading} running={running}
        onToggle={handleToggle} onRun={handleRun} onBatch={handleBatch}
        onReloadConfig={handleReloadConfig}
        onViewConfig={setConfigTarget} onCopy={setCopySource} onDelete={setDeleteTarget}
      />
      <StrategyEdit
        strategies={strategies}
        configTarget={configTarget} copySource={copySource} deleteTarget={deleteTarget}
        onCloseConfig={() => setConfigTarget(null)}
        onCloseCopy={() => setCopySource(null)}
        onCloseDelete={() => setDeleteTarget(null)}
        onSaved={load}
        onConfigSaved={setConfigTarget}
      />
    </div>
  )
}
