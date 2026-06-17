'use client'

/**
 * 策略管理
 * - 5 策略卡片列表
 * - 启用/禁用开关 + 运行按钮 + 查看配置
 * - 顶部批量操作（全部启用/全部禁用/批量运行）+ 刷新配置
 * - 配置查看：Dialog 展示 YAML
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Play, Power, PowerOff, RefreshCw, FileCode, CheckCircle2 } from 'lucide-react'
import { StrategyCard } from './StrategyCard'
import { LoadingState } from './LoadingState'
import { toast } from 'sonner'
import { strategyAPI, configAPI, type StrategyDTO } from '@/lib/api'

export function StrategyManager() {
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [running, setRunning] = React.useState<string | null>(null)
  const [configOpen, setConfigOpen] = React.useState<StrategyDTO | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await strategyAPI.list()
      setStrategies(data)
    } catch (e) {
      toast.error('加载策略失败', { description: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const handleToggle = async (id: string, next: boolean) => {
    // 乐观更新
    setStrategies((prev) =>
      prev.map((s) => (s.strategy_id === id ? { ...s, enabled: next } : s))
    )
    try {
      if (next) await strategyAPI.enable(id)
      else await strategyAPI.disable(id)
      toast.success(`${next ? '已启用' : '已停用'} 策略 ${id}`)
    } catch (e) {
      // 回滚
      setStrategies((prev) =>
        prev.map((s) => (s.strategy_id === id ? { ...s, enabled: !next } : s))
      )
      toast.error('操作失败', { description: (e as Error).message })
    }
  }

  const handleRun = async (id: string) => {
    setRunning(id)
    try {
      const r = await strategyAPI.run(id)
      toast.success(`策略 ${id} 运行完成`, {
        description: `run_id: ${r.run_id} · 选出 ${r.count} 只`,
      })
      await load()
    } catch (e) {
      toast.error('运行失败', { description: (e as Error).message })
    } finally {
      setRunning(null)
    }
  }

  const handleBatch = async (action: 'enable_all' | 'disable_all' | 'run_all') => {
    try {
      if (action === 'enable_all') {
        await strategyAPI.enableAll()
        toast.success('已全部启用')
      } else if (action === 'disable_all') {
        await strategyAPI.disableAll()
        toast.success('已全部停用')
      } else {
        const r = await strategyAPI.runAll()
        toast.success(`批量运行完成`, {
          description: r.results.map((x) => `${x.id}: ${x.count}`).join(' · '),
        })
      }
      await load()
    } catch (e) {
      toast.error('批量操作失败', { description: (e as Error).message })
    }
  }

  const handleReloadConfig = async () => {
    try {
      const r = await configAPI.reload()
      toast.success('配置已热加载', {
        description: `重载 ${r.reloaded.length} 项: ${r.reloaded.join(', ')}`,
      })
      await load()
    } catch (e) {
      toast.error('配置加载失败', { description: (e as Error).message })
    }
  }

  const enabledCount = strategies.filter((s) => s.enabled).length

  return (
    <div className="space-y-4">
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
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-quant"
              onClick={() => handleBatch('enable_all')}
              disabled={loading}
            >
              <Power className="size-3.5 text-[var(--quant-down)]" />
              全部启用
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-quant"
              onClick={() => handleBatch('disable_all')}
              disabled={loading}
            >
              <PowerOff className="size-3.5 text-muted-foreground" />
              全部停用
            </Button>
            <Button
              size="sm"
              variant="default"
              className="h-8"
              onClick={() => handleBatch('run_all')}
              disabled={loading}
            >
              <Play className="size-3.5" />
              批量运行
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={handleReloadConfig}
              disabled={loading}
              title="重新加载 YAML 配置"
            >
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
              onToggle={handleToggle}
              onRun={handleRun}
              onViewConfig={(id) => {
                const target = strategies.find((x) => x.strategy_id === id)
                if (target) setConfigOpen(target)
              }}
            />
          ))}
        </div>
      )}

      {/* 配置查看 Dialog */}
      <Dialog open={!!configOpen} onOpenChange={(v) => !v && setConfigOpen(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="size-5 text-quant-primary" />
              {configOpen?.strategy_emoji} {configOpen?.strategy_name}
              <Badge variant="outline" className="ml-2 font-mono text-xs border-quant">
                {configOpen?.strategy_id}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              板块 {configOpen?.sector_code} · 版本 v{configOpen?.version}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto quant-scroll rounded-md border border-quant bg-[#0d0d0d]">
            <pre className="text-xs leading-relaxed p-4 text-foreground/90 font-mono whitespace-pre-wrap">
              {configOpen?.yaml_content || '# 配置内容为空'}
            </pre>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-[var(--quant-down)]" />
            配置来源于 strategies/strategy_{configOpen?.strategy_id}.yaml
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
