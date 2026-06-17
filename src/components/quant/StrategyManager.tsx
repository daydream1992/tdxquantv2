'use client'

/**
 * 策略管理
 * - 5 策略卡片列表
 * - 启用/禁用开关 + 运行按钮 + 查看/编辑配置 + 复制 + 删除
 * - 顶部批量操作（全部启用/全部禁用/批量运行）+ 刷新配置
 * - 配置编辑：Dialog 展示 YAML + 在线编辑保存（PUT /api/config/strategies/[id]）
 * - 复制策略：Dialog 输入新 ID/名/emoji + YAML 预览（POST /api/config/strategies）
 * - 删除策略：确认 Dialog 输入策略 ID 二次确认（DELETE /api/config/strategies/[id]）
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Play, Power, PowerOff, RefreshCw, FileCode, CheckCircle2, Save, Pencil, RotateCcw, AlertCircle, History, Clock, CheckCircle, XCircle, Copy, Trash2, AlertTriangle } from 'lucide-react'
import { StrategyCard } from './StrategyCard'
import { LoadingState } from './LoadingState'
import { toast } from 'sonner'
import { notifySuccess, notifyError, notifyWarning } from '@/lib/notifications'
import { strategyAPI, configAPI, type StrategyDTO, type StrategyRunRecord } from '@/lib/api'
import { cn } from '@/lib/utils'

// ----------------------------------------------------------------------------
// YAML 复制辅助：行级替换 strategy_id / strategy_name / strategy_emoji / sector.code / sector.name
// ----------------------------------------------------------------------------

interface YamlTransformOpts {
  newId: string
  newName: string
  newEmoji: string
}

function transformStrategyYaml(yaml: string, opts: YamlTransformOpts): string {
  const lines = yaml.split('\n')
  let inSector = false
  let sectorIndent = 0
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.replace(/^\s+/, '')
    // 进入 sector: 块
    if (!inSector && /^sector:\s*$/.test(line)) {
      inSector = true
      sectorIndent = 0
      out.push(line)
      continue
    }
    if (inSector) {
      // 空行/注释行直接保留
      if (line.trim() === '' || line.trim().startsWith('#')) {
        out.push(line)
        continue
      }
      const indent = line.length - trimmed.length
      // 缩进回到 <= sectorIndent 表示出了 sector 块
      if (indent <= sectorIndent) {
        inSector = false
      } else {
        // 在 sector 块内
        if (/^code:\s/.test(trimmed)) {
          out.push(`${' '.repeat(indent)}code: ZD_${opts.newId.toUpperCase()}01`)
          continue
        }
        if (/^name:\s/.test(trimmed)) {
          out.push(`${' '.repeat(indent)}name: ${opts.newName}选股`)
          continue
        }
        out.push(line)
        continue
      }
    }
    // 顶层 key（column 0）
    if (/^strategy_id:\s/.test(line)) {
      out.push(`strategy_id: ${opts.newId}`)
      continue
    }
    if (/^strategy_name:\s/.test(line)) {
      out.push(`strategy_name: ${opts.newName}`)
      continue
    }
    if (/^strategy_emoji:\s/.test(line)) {
      out.push(`strategy_emoji: ${opts.newEmoji}`)
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

const ID_REGEX = /^[a-zA-Z0-9_]{2,30}$/

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
  // 复制策略 Dialog
  const [copyOpen, setCopyOpen] = React.useState<StrategyDTO | null>(null)
  const [copyId, setCopyId] = React.useState('')
  const [copyName, setCopyName] = React.useState('')
  const [copyEmoji, setCopyEmoji] = React.useState('📋')
  const [copySaving, setCopySaving] = React.useState(false)
  // 删除策略 Dialog
  const [deleteOpen, setDeleteOpen] = React.useState<StrategyDTO | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = React.useState('')
  const [deleteSaving, setDeleteSaving] = React.useState(false)

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

  // ===== 复制策略 =====
  const handleOpenCopy = (id: string) => {
    const target = strategies.find((x) => x.strategy_id === id)
    if (!target) return
    setCopyOpen(target)
    setCopyId(`${id}_copy`)
    setCopyName(`${target.strategy_name} 副本`)
    setCopyEmoji('📋')
  }

  const copyYamlPreview = React.useMemo(() => {
    if (!copyOpen) return ''
    return transformStrategyYaml(copyOpen.yaml_content || '', {
      newId: copyId.trim(),
      newName: copyName.trim() || `${copyOpen.strategy_name} 副本`,
      newEmoji: copyEmoji.trim() || '📋',
    })
  }, [copyOpen, copyId, copyName, copyEmoji])

  const copyIdError = React.useMemo(() => {
    const v = copyId.trim()
    if (!v) return '不能为空'
    if (!ID_REGEX.test(v)) return '只能包含英文字母、数字、下划线，2-30 字符'
    if (strategies.some((s) => s.strategy_id === v)) return 'ID 已存在，请换一个'
    return ''
  }, [copyId, strategies])

  const handleConfirmCopy = async () => {
    if (!copyOpen) return
    const id = copyId.trim()
    if (!ID_REGEX.test(id)) {
      notifyError('策略 ID 不合法', '只能包含英文字母、数字、下划线，2-30 字符')
      return
    }
    if (strategies.some((s) => s.strategy_id === id)) {
      notifyError('ID 已存在', `策略 ${id} 已存在，请更换 ID`)
      return
    }
    setCopySaving(true)
    try {
      await configAPI.createStrategy(id, copyYamlPreview, false)
      notifySuccess('策略已复制', `${copyOpen.strategy_name} → ${id}（已可编辑/运行）`)
      setCopyOpen(null)
      await load()
    } catch (e) {
      const msg = (e as Error).message || ''
      if (msg.includes('409') || msg.includes('已存在')) {
        notifyError('ID 冲突', `策略 ${id} 已存在，请换一个 ID`)
      } else if (msg.includes('YAML') || msg.includes('解析')) {
        notifyError('YAML 解析失败', msg)
      } else {
        notifyError('复制失败', msg)
      }
    } finally {
      setCopySaving(false)
    }
  }

  // ===== 删除策略 =====
  const handleOpenDelete = (id: string) => {
    const target = strategies.find((x) => x.strategy_id === id)
    if (!target) return
    setDeleteOpen(target)
    setDeleteConfirmId('')
  }

  const deleteIdMatch = deleteOpen !== null && deleteConfirmId.trim() === deleteOpen.strategy_id

  const handleConfirmDelete = async () => {
    if (!deleteOpen) return
    if (!deleteIdMatch) {
      notifyWarning('未确认', '请输入策略 ID 以确认删除')
      return
    }
    setDeleteSaving(true)
    try {
      const r = await configAPI.deleteStrategy(deleteOpen.strategy_id)
      notifySuccess('策略已删除', r.message || `策略 ${deleteOpen.strategy_id} 已删除`)
      setDeleteOpen(null)
      await load()
    } catch (e) {
      const msg = (e as Error).message || ''
      if (msg.includes('409') || msg.includes('启用')) {
        notifyError('无法删除', '策略正在启用中，请先禁用再删除')
      } else if (msg.includes('404') || msg.includes('不存在')) {
        notifyError('策略不存在', msg)
      } else {
        notifyError('删除失败', msg)
      }
    } finally {
      setDeleteSaving(false)
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
              onCopy={handleOpenCopy}
              onDelete={handleOpenDelete}
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

      {/* ===== 复制策略 Dialog ===== */}
      <Dialog
        open={!!copyOpen}
        onOpenChange={(v) => {
          if (!v) {
            if (copySaving) return
            setCopyOpen(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="size-5 text-quant-primary" />
              复制策略
            </DialogTitle>
            <DialogDescription>
              源策略：{copyOpen?.strategy_emoji} {copyOpen?.strategy_name}
              <Badge variant="outline" className="ml-2 font-mono text-xs border-quant">
                {copyOpen?.strategy_id}
              </Badge>
              · 修改 ID/名/emoji 后 YAML 自动更新预览
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_5rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="copy-id" className="text-xs">
                新策略 ID
              </Label>
              <Input
                id="copy-id"
                value={copyId}
                onChange={(e) => setCopyId(e.target.value)}
                placeholder="如 dbqzt_v2"
                className={cn(
                  'h-9 font-mono text-sm focus-visible:border-[var(--quant-primary)] focus-visible:ring-[var(--quant-primary)]/30',
                  copyIdError && 'border-red-500/60 focus-visible:ring-red-500/20'
                )}
                spellCheck={false}
                autoComplete="off"
              />
              <div className={cn('text-[11px]', copyIdError ? 'text-red-400' : 'text-muted-foreground')}>
                {copyIdError || '英文字母/数字/下划线，2-30 字符'}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="copy-name" className="text-xs">
                新策略名
              </Label>
              <Input
                id="copy-name"
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                placeholder="如 打板求涨停 副本"
                className="h-9 text-sm focus-visible:border-[var(--quant-primary)] focus-visible:ring-[var(--quant-primary)]/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="copy-emoji" className="text-xs">
                Emoji
              </Label>
              <Input
                id="copy-emoji"
                value={copyEmoji}
                onChange={(e) => setCopyEmoji(e.target.value)}
                placeholder="📋"
                className="h-9 text-center text-base focus-visible:border-[var(--quant-primary)] focus-visible:ring-[var(--quant-primary)]/30"
                maxLength={4}
              />
            </div>
          </div>

          {/* YAML 预览 */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <FileCode className="size-3.5 text-quant-primary" />
                YAML 预览（已替换 strategy_id / name / emoji / sector.code / sector.name）
              </Label>
              <Badge variant="outline" className="text-[10px] font-mono border-quant">
                {copyYamlPreview.split('\n').length} 行
              </Badge>
            </div>
            <div className="flex-1 overflow-auto quant-scroll rounded-md border border-quant bg-[#0d0d0d] min-h-[260px] max-h-[40vh]">
              <pre className="text-xs leading-relaxed p-3 text-foreground/90 font-mono whitespace-pre-wrap">
                {copyYamlPreview || '# YAML 预览'}
              </pre>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => setCopyOpen(null)}
              disabled={copySaving}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="h-9 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300"
              onClick={handleConfirmCopy}
              disabled={copySaving || !!copyIdError || !copyId.trim()}
            >
              {copySaving ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copySaving ? '复制中...' : '确认复制'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 删除策略 Dialog ===== */}
      <Dialog
        open={!!deleteOpen}
        onOpenChange={(v) => {
          if (!v) {
            if (deleteSaving) return
            setDeleteOpen(null)
            setDeleteConfirmId('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="size-5" />
              确认删除策略
            </DialogTitle>
            <DialogDescription>
              即将删除：{deleteOpen?.strategy_emoji} {deleteOpen?.strategy_name}
              <Badge variant="outline" className="ml-2 font-mono text-xs border-quant">
                {deleteOpen?.strategy_id}
              </Badge>
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 text-xs text-red-400/90 bg-red-500/5 border border-red-500/25 rounded-md p-3">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">此操作不可恢复</div>
              <div className="mt-1 text-red-400/70">
                将删除 YAML 文件 <code className="font-mono">strategies/strategy_{deleteOpen?.strategy_id}.yaml</code>。
                启用中的策略无法删除，请先禁用。
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm" className="text-xs">
              请输入策略 ID <code className="font-mono text-red-400">{deleteOpen?.strategy_id}</code> 以确认
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirmId}
              onChange={(e) => setDeleteConfirmId(e.target.value)}
              placeholder={deleteOpen?.strategy_id}
              className={cn(
                'h-9 font-mono text-sm',
                deleteConfirmId.trim() && !deleteIdMatch && 'border-red-500/60',
                deleteIdMatch && 'border-[var(--quant-up)]/60 focus-visible:ring-[var(--quant-up)]/20'
              )}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => {
                setDeleteOpen(null)
                setDeleteConfirmId('')
              }}
              disabled={deleteSaving}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="h-9 bg-red-500/15 text-red-400 border border-red-500/40 hover:bg-red-500/25 hover:text-red-300"
              onClick={handleConfirmDelete}
              disabled={deleteSaving || !deleteIdMatch}
            >
              {deleteSaving ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {deleteSaving ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
