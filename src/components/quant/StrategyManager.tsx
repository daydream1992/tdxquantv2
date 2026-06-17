'use client'

/**
 * 策略管理
 * - 5 策略卡片列表
 * - 启用/禁用开关 + 运行按钮 + 查看/编辑配置
 * - 顶部批量操作（全部启用/全部禁用/批量运行）+ 刷新配置
 * - 配置编辑：Dialog 展示 YAML + 在线编辑保存（PUT /api/config/strategies/[id]）
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Play, Power, PowerOff, RefreshCw, FileCode, CheckCircle2, Save, Pencil, RotateCcw, AlertCircle, History, Clock, CheckCircle, XCircle } from 'lucide-react'
import { StrategyCard } from './StrategyCard'
import { LoadingState } from './LoadingState'
import { toast } from 'sonner'
import { strategyAPI, configAPI, type StrategyDTO, type StrategyRunRecord } from '@/lib/api'

export function StrategyManager() {
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [running, setRunning] = React.useState<string | null>(null)
  const [configOpen, setConfigOpen] = React.useState<StrategyDTO | null>(null)
  // YAML 编辑模式
  const [editMode, setEditMode] = React.useState(false)
  const [yamlDraft, setYamlDraft] = React.useState('')
  const [yamlSaving, setYamlSaving] = React.useState(false)
  const [yamlDirty, setYamlDirty] = React.useState(false)
  // 运行历史
  const [historyOpen, setHistoryOpen] = React.useState<StrategyDTO | null>(null)
  const [runs, setRuns] = React.useState<StrategyRunRecord[]>([])
  const [runsLoading, setRunsLoading] = React.useState(false)

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
                if (target) {
                  setConfigOpen(target)
                  setEditMode(false)
                  setYamlDirty(false)
                }
              }}
              onViewHistory={async (id) => {
                const target = strategies.find((x) => x.strategy_id === id)
                if (!target) return
                setHistoryOpen(target)
                setRunsLoading(true)
                setRuns([])
                try {
                  const data = await strategyAPI.runs(id)
                  setRuns(data)
                } catch (e) {
                  toast.error('加载历史失败', { description: (e as Error).message })
                } finally {
                  setRunsLoading(false)
                }
              }}
            />
          ))}
        </div>
      )}

      {/* 配置查看/编辑 Dialog */}
      <Dialog
        open={!!configOpen}
        onOpenChange={(v) => {
          if (!v) {
            // 关闭时重置编辑模式
            if (yamlDirty && !confirm('有未保存的修改，确定要关闭吗？')) {
              return
            }
            setConfigOpen(null)
            setEditMode(false)
            setYamlDirty(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="size-5 text-quant-primary" />
              {configOpen?.strategy_emoji} {configOpen?.strategy_name}
              <Badge variant="outline" className="ml-2 font-mono text-xs border-quant">
                {configOpen?.strategy_id}
              </Badge>
              {editMode && (
                <Badge variant="secondary" className="ml-1 text-xs gap-1 bg-amber-500/10 text-amber-400 border-amber-500/30">
                  <Pencil className="size-3" />
                  编辑中
                </Badge>
              )}
              {yamlDirty && (
                <span className="text-xs text-amber-400 ml-1">● 未保存</span>
              )}
            </DialogTitle>
            <DialogDescription>
              板块 {configOpen?.sector_code} · 版本 v{configOpen?.version} · 路径 strategies/strategy_{configOpen?.strategy_id}.yaml
            </DialogDescription>
          </DialogHeader>

          {/* 编辑器主体 */}
          <div className="flex-1 overflow-auto quant-scroll rounded-md border border-quant bg-[#0d0d0d] relative">
            {editMode ? (
              <textarea
                value={yamlDraft}
                onChange={(e) => {
                  setYamlDraft(e.target.value)
                  setYamlDirty(e.target.value !== (configOpen?.yaml_content || ''))
                }}
                className="w-full h-full min-h-[480px] p-4 text-xs leading-relaxed font-mono bg-transparent text-foreground/90 outline-none resize-none quant-scroll"
                spellCheck={false}
                placeholder="# 编辑策略 YAML..."
              />
            ) : (
              <pre className="text-xs leading-relaxed p-4 text-foreground/90 font-mono whitespace-pre-wrap">
                {configOpen?.yaml_content || '# 配置内容为空'}
              </pre>
            )}
          </div>

          {/* 底部状态 + 操作 */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-[var(--quant-down)]" />
              <span>修改后自动 reload 配置，立即生效</span>
            </div>
            <div className="flex items-center gap-2">
              {editMode ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => {
                      setYamlDraft(configOpen?.yaml_content || '')
                      setEditMode(false)
                      setYamlDirty(false)
                    }}
                    disabled={yamlSaving}
                  >
                    <RotateCcw className="size-3.5" />
                    取消
                  </Button>
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={async () => {
                      if (!configOpen) return
                      setYamlSaving(true)
                      try {
                        const updated = await configAPI.updateStrategyConfig(
                          configOpen.strategy_id,
                          yamlDraft,
                        )
                        toast.success('YAML 已保存', {
                          description: `策略 ${configOpen.strategy_id} 配置已重载`,
                        })
                        // 更新本地状态
                        setConfigOpen({
                          ...configOpen,
                          yaml_content: updated.yaml_content,
                          strategy_name: updated.strategy_name,
                          enabled: updated.enabled,
                        })
                        setYamlDirty(false)
                        setEditMode(false)
                        await load()
                      } catch (e) {
                        const msg = (e as Error).message
                        toast.error('保存失败', {
                          description: msg.includes('strategy_id') || msg.includes('YAML')
                            ? msg
                            : '请检查 YAML 语法',
                        })
                      } finally {
                        setYamlSaving(false)
                      }
                    }}
                    disabled={yamlSaving || !yamlDirty}
                  >
                    {yamlSaving ? (
                      <RefreshCw className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    {yamlSaving ? '保存中...' : '保存并热加载'}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-quant"
                  onClick={() => {
                    setYamlDraft(configOpen?.yaml_content || '')
                    setEditMode(true)
                    setYamlDirty(false)
                  }}
                >
                  <Pencil className="size-3.5 text-quant-primary" />
                  编辑配置
                </Button>
              )}
            </div>
          </div>

          {/* YAML 校验提示 */}
          {editMode && yamlDirty && (
            <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded p-2">
              <AlertCircle className="size-3.5 mt-0.5 flex-shrink-0" />
              <div>
                保存前请确认：
                <ol className="list-decimal ml-4 mt-1 space-y-0.5 text-amber-400/60">
                  <li>YAML 语法正确（缩进一致、引号闭合）</li>
                  <li>顶层 <code className="text-amber-300">strategy_id</code> 必须与当前策略 <code className="text-amber-300">{configOpen?.strategy_id}</code> 一致</li>
                  <li>修改权重/阈值后，下次"运行"立即生效</li>
                </ol>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 运行历史 Sheet */}
      <Sheet
        open={!!historyOpen}
        onOpenChange={(v) => {
          if (!v) {
            setHistoryOpen(null)
            setRuns([])
          }
        }}
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
              最近 50 次选股执行记录（来源 DuckDB strategy_runs 表）
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
              onClick={async () => {
                if (!historyOpen) return
                setRunsLoading(true)
                try {
                  const data = await strategyAPI.runs(historyOpen.strategy_id)
                  setRuns(data)
                } catch (e) {
                  toast.error('加载历史失败', { description: (e as Error).message })
                } finally {
                  setRunsLoading(false)
                }
              }}
            >
              <RefreshCw className="size-3" />
              刷新
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
