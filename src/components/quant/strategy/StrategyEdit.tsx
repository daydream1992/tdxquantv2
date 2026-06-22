'use client'

/**
 * StrategyEdit — 策略编辑/复制/删除 Dialog 组
 *
 * 3 个 Dialog (由容器控制 open target):
 * 1. 配置查看/编辑 Dialog — YAML 在线编辑 + 保存热加载 (PUT /api/config/strategies/[id])
 * 2. 复制策略 Dialog — 输入新 ID/名/emoji + YAML 预览 (POST /api/config/strategies)
 * 3. 删除策略 Dialog — 输入策略 ID 二次确认 (DELETE /api/config/strategies/[id])
 *
 * 内部持有各 Dialog 的局部状态 (editMode/yamlDraft/copyId/deleteConfirmId 等),
 * 共享 strategies 列表用于 ID 唯一性校验, onSaved 回调让容器刷新列表。
 */

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  FileCode, CheckCircle2, Save, Pencil, RotateCcw, AlertCircle,
  Copy, Trash2, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { notifySuccess, notifyError, notifyWarning } from '@/lib/notifications'
import { configAPI, type StrategyDTO } from '@/lib/api'
import { cn } from '@/lib/utils'
import { transformStrategyYaml, ID_REGEX } from './shared'

export interface StrategyEditProps {
  strategies: StrategyDTO[]
  configTarget: StrategyDTO | null
  copySource: StrategyDTO | null
  deleteTarget: StrategyDTO | null
  onCloseConfig: () => void
  onCloseCopy: () => void
  onCloseDelete: () => void
  onSaved: () => Promise<void> | void
  onConfigSaved: (updated: StrategyDTO) => void
}

export function StrategyEdit({
  strategies, configTarget, copySource, deleteTarget,
  onCloseConfig, onCloseCopy, onCloseDelete, onSaved, onConfigSaved,
}: StrategyEditProps) {
  // ===== 配置查看/编辑 =====
  const [editMode, setEditMode] = React.useState(false)
  const [yamlDraft, setYamlDraft] = React.useState('')
  const [yamlSaving, setYamlSaving] = React.useState(false)
  const [yamlDirty, setYamlDirty] = React.useState(false)

  // target 变化时重置编辑状态
  React.useEffect(() => {
    if (configTarget) {
      setEditMode(false)
      setYamlDirty(false)
      setYamlDraft(configTarget.yaml_content || '')
    }
  }, [configTarget])

  const handleSaveYaml = async () => {
    if (!configTarget) return
    setYamlSaving(true)
    try {
      const updated = await configAPI.updateStrategyConfig(configTarget.strategy_id, yamlDraft)
      toast.success('YAML 已保存', { description: `策略 ${configTarget.strategy_id} 配置已重载` })
      // 更新容器 configTarget, 让 Dialog 头部/查看模式显示新内容 (与原单文件行为一致)
      onConfigSaved({ ...configTarget, yaml_content: updated.yaml_content, strategy_name: updated.strategy_name, enabled: updated.enabled })
      setYamlDirty(false)
      setEditMode(false)
      await onSaved()
    } catch (e) {
      const msg = (e as Error).message
      toast.error('保存失败', {
        description: msg.includes('strategy_id') || msg.includes('YAML') ? msg : '请检查 YAML 语法',
      })
    } finally {
      setYamlSaving(false)
    }
  }

  const handleCloseConfig = () => {
    if (yamlDirty && !confirm('有未保存的修改，确定要关闭吗？')) return
    onCloseConfig()
    setEditMode(false)
    setYamlDirty(false)
  }

  // ===== 复制策略 =====
  const [copyId, setCopyId] = React.useState('')
  const [copyName, setCopyName] = React.useState('')
  const [copyEmoji, setCopyEmoji] = React.useState('📋')
  const [copySaving, setCopySaving] = React.useState(false)

  // source 变化时初始化复制字段
  React.useEffect(() => {
    if (copySource) {
      setCopyId(`${copySource.strategy_id}_copy`)
      setCopyName(`${copySource.strategy_name} 副本`)
      setCopyEmoji('📋')
    }
  }, [copySource])

  const copyYamlPreview = React.useMemo(() => {
    if (!copySource) return ''
    return transformStrategyYaml(copySource.yaml_content || '', {
      newId: copyId.trim(),
      newName: copyName.trim() || `${copySource.strategy_name} 副本`,
      newEmoji: copyEmoji.trim() || '📋',
    })
  }, [copySource, copyId, copyName, copyEmoji])

  const copyIdError = React.useMemo(() => {
    const v = copyId.trim()
    if (!v) return '不能为空'
    if (!ID_REGEX.test(v)) return '只能包含英文字母、数字、下划线，2-30 字符'
    if (strategies.some((s) => s.strategy_id === v)) return 'ID 已存在，请换一个'
    return ''
  }, [copyId, strategies])

  const handleConfirmCopy = async () => {
    if (!copySource) return
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
      notifySuccess('策略已复制', `${copySource.strategy_name} → ${id}（已可编辑/运行）`)
      onCloseCopy()
      await onSaved()
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
  const [deleteConfirmId, setDeleteConfirmId] = React.useState('')
  const [deleteSaving, setDeleteSaving] = React.useState(false)

  React.useEffect(() => {
    if (deleteTarget) setDeleteConfirmId('')
  }, [deleteTarget])

  const deleteIdMatch = deleteTarget !== null && deleteConfirmId.trim() === deleteTarget.strategy_id

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    if (!deleteIdMatch) {
      notifyWarning('未确认', '请输入策略 ID 以确认删除')
      return
    }
    setDeleteSaving(true)
    try {
      const r = await configAPI.deleteStrategy(deleteTarget.strategy_id)
      notifySuccess('策略已删除', r.message || `策略 ${deleteTarget.strategy_id} 已删除`)
      onCloseDelete()
      await onSaved()
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

  return (
    <>
      {/* ===== 配置查看/编辑 Dialog ===== */}
      <Dialog open={!!configTarget} onOpenChange={(v) => { if (!v) handleCloseConfig() }}>
        <DialogContent className="sm:max-w-3xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="size-5 text-quant-primary" />
              {configTarget?.strategy_emoji} {configTarget?.strategy_name}
              <Badge variant="outline" className="ml-2 font-mono text-xs border-quant">
                {configTarget?.strategy_id}
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
              板块 {configTarget?.sector_code} · 版本 v{configTarget?.version} · 路径 strategies/strategy_{configTarget?.strategy_id}.yaml
            </DialogDescription>
          </DialogHeader>

          {/* 编辑器主体 */}
          <div className="flex-1 overflow-auto quant-scroll rounded-md border border-quant bg-[#0d0d0d] relative">
            {editMode ? (
              <textarea
                value={yamlDraft}
                onChange={(e) => {
                  setYamlDraft(e.target.value)
                  setYamlDirty(e.target.value !== (configTarget?.yaml_content || ''))
                }}
                className="w-full h-full min-h-[480px] p-4 text-xs leading-relaxed font-mono bg-transparent text-foreground/90 outline-none resize-none quant-scroll"
                spellCheck={false}
                placeholder="# 编辑策略 YAML..."
              />
            ) : (
              <pre className="text-xs leading-relaxed p-4 text-foreground/90 font-mono whitespace-pre-wrap">
                {configTarget?.yaml_content || '# 配置内容为空'}
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
                    size="sm" variant="ghost" className="h-8"
                    onClick={() => {
                      setYamlDraft(configTarget?.yaml_content || '')
                      setEditMode(false)
                      setYamlDirty(false)
                    }}
                    disabled={yamlSaving}
                  >
                    <RotateCcw className="size-3.5" />
                    取消
                  </Button>
                  <Button
                    size="sm" className="h-8"
                    onClick={handleSaveYaml}
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
                  size="sm" variant="outline" className="h-8 border-quant"
                  onClick={() => {
                    setYamlDraft(configTarget?.yaml_content || '')
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
                  <li>顶层 <code className="text-amber-300">strategy_id</code> 必须与当前策略 <code className="text-amber-300">{configTarget?.strategy_id}</code> 一致</li>
                  <li>修改权重/阈值后，下次"运行"立即生效</li>
                </ol>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== 复制策略 Dialog ===== */}
      <Dialog
        open={!!copySource}
        onOpenChange={(v) => { if (!v) { if (copySaving) return; onCloseCopy() } }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="size-5 text-quant-primary" />
              复制策略
            </DialogTitle>
            <DialogDescription>
              源策略：{copySource?.strategy_emoji} {copySource?.strategy_name}
              <Badge variant="outline" className="ml-2 font-mono text-xs border-quant">
                {copySource?.strategy_id}
              </Badge>
              · 修改 ID/名/emoji 后 YAML 自动更新预览
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_5rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="copy-id" className="text-xs">新策略 ID</Label>
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
              <Label htmlFor="copy-name" className="text-xs">新策略名</Label>
              <Input
                id="copy-name"
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                placeholder="如 打板求涨停 副本"
                className="h-9 text-sm focus-visible:border-[var(--quant-primary)] focus-visible:ring-[var(--quant-primary)]/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="copy-emoji" className="text-xs">Emoji</Label>
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
            <Button variant="ghost" size="sm" className="h-9" onClick={onCloseCopy} disabled={copySaving}>
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
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) {
            if (deleteSaving) return
            onCloseDelete()
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
              即将删除：{deleteTarget?.strategy_emoji} {deleteTarget?.strategy_name}
              <Badge variant="outline" className="ml-2 font-mono text-xs border-quant">
                {deleteTarget?.strategy_id}
              </Badge>
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 text-xs text-red-400/90 bg-red-500/5 border border-red-500/25 rounded-md p-3">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">此操作不可恢复</div>
              <div className="mt-1 text-red-400/70">
                将删除 YAML 文件 <code className="font-mono">strategies/strategy_{deleteTarget?.strategy_id}.yaml</code>。
                启用中的策略无法删除，请先禁用。
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm" className="text-xs">
              请输入策略 ID <code className="font-mono text-red-400">{deleteTarget?.strategy_id}</code> 以确认
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirmId}
              onChange={(e) => setDeleteConfirmId(e.target.value)}
              placeholder={deleteTarget?.strategy_id}
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
              variant="ghost" size="sm" className="h-9"
              onClick={() => { onCloseDelete(); setDeleteConfirmId('') }}
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
    </>
  )
}
