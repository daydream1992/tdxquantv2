'use client'

/**
 * MatchStrategyForm — 匹配策略编辑/新建 + 复制 弹窗
 *
 * 两个 Dialog:
 *  1. 编辑/新建: name / strategy_id / enabled / match_id / debounce_override
 *     / alerts (key-value + alert_type/channels/priority) / scope (markets 多选 / 排除项)
 *  2. 复制: 基于现有 match 创建副本, 自动生成 newId, 默认 enabled=false, 可选是否复制 alerts
 *
 * 容器注入 open/mode/initial/copySource/existingIds + onClose/onSaved 等回调;
 * alert_templates 由本组件自行加载 (仅 Form 用到)。
 *
 * EditForm / CopyForm 内部字段渲染组件位于 ./MatchStrategyEditFields (拆出以控制文件行数)。
 */

import * as React from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Crosshair, Plus, Loader2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import {
  matchStrategyAPI, APIError,
  type MatchStrategyDTO,
  type MatchCreateRequest,
  type StrategyDTO, type AlertTemplateDTO,
  monitorAPI,
} from '@/lib/api'
import {
  isValidMatchId, makeUniqueCopyId, isDefault,
  strategyToForm, emptyDtoForCreate,
  INITIAL_COPY, type EditFormState, type CopyDialogState,
} from './shared'
import { EditForm, CopyForm } from './MatchStrategyEditFields'

// ============================================================================
// Props
// ============================================================================

export interface MatchStrategyFormProps {
  open: boolean
  mode: 'create' | 'update'
  initial: MatchStrategyDTO | null
  strategies: StrategyDTO[]
  copySource: MatchStrategyDTO | null
  existingIds: string[]
  onClose: () => void
  onSaved: () => void
  onCloseCopy: () => void
  onCopied: () => void
}

// ============================================================================
// 主组件
// ============================================================================

export function MatchStrategyForm({
  open, mode, initial, strategies, copySource, existingIds,
  onClose, onSaved, onCloseCopy, onCopied,
}: MatchStrategyFormProps) {
  // alert_templates (R13-1b: alert_type 下拉用模板列表)
  const [alertTemplates, setAlertTemplates] = React.useState<AlertTemplateDTO[]>([])
  const [alertTemplatesLoading, setAlertTemplatesLoading] = React.useState(false)
  const loadAlertTemplates = React.useCallback(async () => {
    setAlertTemplatesLoading(true)
    try {
      setAlertTemplates((await monitorAPI.getRules()).templates || [])
    } catch {
      setAlertTemplates([])
    } finally {
      setAlertTemplatesLoading(false)
    }
  }, [])
  React.useEffect(() => { loadAlertTemplates() }, [loadAlertTemplates])

  // 编辑/新建表单
  const [editForm, setEditForm] = React.useState<EditFormState>(strategyToForm(emptyDtoForCreate()))
  const [editSaving, setEditSaving] = React.useState(false)
  React.useEffect(() => {
    if (open && initial) setEditForm(strategyToForm(initial))
  }, [open, initial])

  const handleSave = async () => {
    if (!editForm.match_id.trim()) { toast.error('match_id 不能为空'); return }
    if (!editForm.name.trim()) { toast.error('名称不能为空'); return }
    if (mode === 'create' && isDefault(editForm.match_id)) {
      toast.error('match_id 不能为 _default（系统保留）'); return
    }
    let debounceOverride: number | null = null
    if (editForm.debounce_override.trim() !== '') {
      const n = Number(editForm.debounce_override)
      if (!Number.isFinite(n) || n < 0) {
        toast.error('debounce 必须是非负数字（或留空用全局）'); return
      }
      debounceOverride = Math.floor(n)
    }
    setEditSaving(true)
    const tid = toast.loading(mode === 'create' ? '正在创建...' : '正在保存...')
    try {
      if (mode === 'create') {
        await matchStrategyAPI.create({
          match_id: editForm.match_id.trim(), name: editForm.name.trim(),
          enabled: editForm.enabled, strategy_id: editForm.strategy_id,
          scope: editForm.scope, alerts: editForm.alerts,
          debounce_override: debounceOverride, trading_hours_override: null,
        })
        toast.success('已创建匹配策略', {
          id: tid, description: `${editForm.match_id} · ${editForm.alerts.length} 个 alert`,
        })
      } else {
        await matchStrategyAPI.update(editForm.match_id, {
          name: editForm.name.trim(), enabled: editForm.enabled,
          strategy_id: editForm.strategy_id, scope: editForm.scope,
          alerts: editForm.alerts, debounce_override: debounceOverride,
        })
        toast.success('已保存修改', { id: tid, description: `match_id: ${editForm.match_id}` })
      }
      onClose()
      onSaved()
    } catch (e) {
      toast.error('保存失败', { id: tid, description: (e as Error).message })
    } finally {
      setEditSaving(false)
    }
  }

  // 复制 Dialog
  const [copyDialog, setCopyDialog] = React.useState<CopyDialogState>(INITIAL_COPY)
  React.useEffect(() => {
    if (copySource) {
      const existingIdsSet = new Set(existingIds)
      setCopyDialog({
        source: copySource,
        newId: makeUniqueCopyId(copySource.match_id, existingIdsSet),
        newName: `${copySource.name || copySource.match_id} 副本`,
        enableCopy: false, copyAlerts: true, loading: false,
      })
    }
  }, [copySource, existingIds])

  const closeCopy = () => {
    setCopyDialog((p) => ({ ...p, loading: false }))
    onCloseCopy()
  }

  const handleCopyCreate = async () => {
    const { source, newId, newName, copyAlerts, enableCopy } = copyDialog
    if (!source) return
    const trimmedId = newId.trim()
    const trimmedName = newName.trim()
    if (!trimmedId) { toast.error('match_id 不能为空'); return }
    if (!isValidMatchId(trimmedId)) { toast.error('match_id 只能含字母、数字、下划线'); return }
    if (isDefault(trimmedId)) { toast.error('match_id 不能为 _default（系统保留）'); return }
    if (!trimmedName) { toast.error('显示名不能为空'); return }
    if (existingIds.some((x) => x === trimmedId)) {
      toast.error('ID 已存在，请换一个', { description: `match_id: ${trimmedId}` }); return
    }
    const payload: MatchCreateRequest = {
      match_id: trimmedId, name: trimmedName,
      strategy_id: source.strategy_id, enabled: enableCopy,
      scope: source.scope,
      alerts: copyAlerts
        ? (source.alerts || []).map((a) => ({
            alert_type: a.alert_type, params: { ...(a.params || {}) },
            channels: [...(a.channels || [])], priority: a.priority,
          }))
        : [],
      debounce_override: source.debounce_override,
      trading_hours_override: source.trading_hours_override,
    }
    setCopyDialog((p) => ({ ...p, loading: true }))
    const tid = toast.loading('正在创建副本...')
    try {
      await matchStrategyAPI.create(payload)
      toast.success('副本已创建', { id: tid, description: `${trimmedId} · 基于 ${source.match_id}` })
      closeCopy()
      onCopied()
    } catch (e) {
      const err = e as APIError
      const msg = err.message || ''
      if (err.status === 409 || msg.includes('已存在') || msg.includes('already exists') || msg.includes('duplicate')) {
        toast.error('ID 已存在，请换一个', { id: tid, description: msg })
      } else if (err.status === 403 || msg.includes('_default')) {
        toast.error('不允许的操作', { id: tid, description: msg })
      } else {
        toast.error('创建副本失败', { id: tid, description: msg })
      }
      setCopyDialog((p) => ({ ...p, loading: false }))
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && !editSaving && onClose()}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crosshair className="size-5 text-quant-primary" />
              {mode === 'create' ? '新建匹配策略' : `编辑 ${editForm.match_id}`}
            </DialogTitle>
            <DialogDescription>
              match_id 全局唯一；strategy_id 决定走哪个选股策略；alerts 引用 monitor_rules.yaml 的 alert_templates。
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh] pr-3">
            <EditForm
              value={editForm} onChange={setEditForm}
              strategies={strategies} mode={mode}
              alertTemplates={alertTemplates} alertTemplatesLoading={alertTemplatesLoading}
            />
          </ScrollArea>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose} disabled={editSaving}>取消</Button>
            <Button
              className="bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
              onClick={handleSave} disabled={editSaving}
            >
              {editSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {mode === 'create' ? '创建' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!copySource}
        onOpenChange={(v) => { if (!v && !copyDialog.loading) closeCopy() }}
      >
        <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="size-5 text-amber-400" />
              复制匹配策略
            </DialogTitle>
            <DialogDescription>
              {copyDialog.source
                ? `基于「${copyDialog.source.name || copyDialog.source.match_id}」创建副本，可修改 ID 和名称。`
                : '基于现有策略创建副本。'}
            </DialogDescription>
          </DialogHeader>
          <CopyForm
            value={copyDialog}
            onChange={(patch) => setCopyDialog((p) => ({ ...p, ...patch }))}
            existingIds={existingIds}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeCopy} disabled={copyDialog.loading}>取消</Button>
            <Button
              className="bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
              onClick={handleCopyCreate}
              disabled={
                copyDialog.loading ||
                !copyDialog.newId.trim() ||
                !isValidMatchId(copyDialog.newId) ||
                !copyDialog.newName.trim() ||
                isDefault(copyDialog.newId.trim())
              }
            >
              {copyDialog.loading ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
              创建副本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
