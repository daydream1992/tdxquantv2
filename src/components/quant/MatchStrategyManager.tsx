'use client'

/**
 * 匹配策略管理 (MatchStrategyManager)
 *
 * 功能：
 *  1. 卡片列表：展示 match_strategies (name / match_id / strategy_id badge / enabled Switch
 *     / alerts 数量 / debounce_override)
 *  2. 卡片操作：编辑(改参) / 测试(test) / 复制(copy, _default 也允许) / 删除(带确认, _default 禁用)
 *  3. 顶部：新建匹配策略 / 重新加载 YAML (reload)
 *  4. 编辑/新建用 Dialog：name / strategy_id / enabled / match_id / debounce_override
 *     / alerts (key-value 表单 + alert_type/channels/priority) / scope (markets 多选 / 排除项)
 *  5. 测试面板：输入 code + pct_change + volume_ratio + main_inflow + auction_pct
 *     → POST /test → 命中 alert 列表 (alert_type + priority + 命中条件)
 *  6. 复制 Dialog：基于现有 match 创建副本, 自动生成 newId (源ID_copy, 已存在则 _2/_3)
 *     + 默认 name="{原名} 副本" + 副本默认 enabled=false + 可选是否复制 alerts
 *  7. 所有操作有 loading 状态 + sonner toast 反馈
 *  8. _default 删除返回 403 → toast 提示 "不允许删除兜底套餐 _default"
 *     _default 复制允许 (它是只读不可删, 但可复制成新策略)
 *
 * 后端 API 走代理：
 *   GET    /api/monitor/match-strategies           列表
 *   POST   /api/monitor/match-strategies           新建 (复制也走这里)
 *   PUT    /api/monitor/match-strategies/[id]      改参
 *   DELETE /api/monitor/match-strategies/[id]      删除
 *   POST   /api/monitor/match-strategies?action=reload      重载
 *   POST   /api/monitor/match-strategies/[id]/test          测试
 */

import * as React from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Crosshair,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  FlaskConical,
  Loader2,
  Shield,
  Clock,
  AlertCircle,
  Copy,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  matchStrategyAPI,
  strategyAPI,
  monitorAPI,
  APIError,
  type MatchStrategyDTO,
  type MatchAlertDTO,
  type MatchScopeDTO,
  type MatchCreateRequest,
  type MatchTestHitDTO,
  type MatchPriority,
  type StrategyDTO,
  type AlertTemplateDTO,
} from '@/lib/api'

// ============================================================================
// 常量
// ============================================================================

const ALL_MARKETS = ['SH', 'SZ', 'BJ'] as const
const ALL_CHANNELS = ['tdx_warn', 'websocket', 'feishu', 'csv_log'] as const
const PRIORITIES: MatchPriority[] = ['high', 'medium', 'low']
const PRIORITY_LABEL: Record<MatchPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const EMPTY_SCOPE: MatchScopeDTO = {
  markets: ['SH', 'SZ', 'BJ'],
  exclude_st: true,
  exclude_suspended: true,
  exclude_codes: [],
  include_only: [],
}

const EMPTY_ALERT: MatchAlertDTO = {
  alert_type: '',
  params: {},
  channels: ['websocket'],
  priority: 'medium',
}

const priorityVariant: Record<
  MatchPriority,
  'destructive' | 'default' | 'secondary'
> = {
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
}

// ============================================================================
// 工具
// ============================================================================

function isDefault(matchId: string): boolean {
  return matchId === '_default'
}

/** match_id 校验：非空 + 只允许字母/数字/下划线 */
const MATCH_ID_PATTERN = /^[A-Za-z0-9_]+$/
function isValidMatchId(id: string): boolean {
  return MATCH_ID_PATTERN.test(id.trim())
}

/**
 * 基于已存在的 ID 集合生成一个唯一的副本 ID。
 * 默认 `${sourceId}_copy`；若已占用则尝试 `_2` / `_3` / ...
 */
function makeUniqueCopyId(sourceId: string, existingIds: Set<string>): string {
  const base = `${sourceId}_copy`
  if (!existingIds.has(base)) return base
  let n = 2
  while (existingIds.has(`${sourceId}_copy_${n}`)) n += 1
  return `${sourceId}_copy_${n}`
}

function scopeSummary(scope: MatchScopeDTO): string {
  if (!scope) return '无限制'
  const parts: string[] = []
  if (scope.markets?.length) parts.push(scope.markets.join('/'))
  if (scope.exclude_st) parts.push('排ST')
  if (scope.exclude_suspended) parts.push('排停牌')
  if (scope.exclude_codes?.length) parts.push(`排除 ${scope.exclude_codes.length} 码`)
  if (scope.include_only?.length) parts.push(`仅 ${scope.include_only.length} 码`)
  return parts.length ? parts.join(' · ') : '无限制'
}

// ============================================================================
// 测试表单值
// ============================================================================

interface TestFormState {
  code: string
  pct_change: string
  volume_ratio: string
  main_inflow: string
  auction_pct: string
}

const EMPTY_TEST_FORM: TestFormState = {
  code: '',
  pct_change: '',
  volume_ratio: '',
  main_inflow: '',
  auction_pct: '',
}

// ============================================================================
// 编辑表单值
// ============================================================================

interface EditFormState {
  match_id: string
  name: string
  enabled: boolean
  strategy_id: string
  debounce_override: string // string for input; ""=null
  scope: MatchScopeDTO
  alerts: MatchAlertDTO[]
}

function strategyToForm(s: MatchStrategyDTO): EditFormState {
  return {
    match_id: s.match_id,
    name: s.name || '',
    enabled: s.enabled,
    strategy_id: s.strategy_id || '',
    debounce_override:
      s.debounce_override === null || s.debounce_override === undefined
        ? ''
        : String(s.debounce_override),
    scope: s.scope || { ...EMPTY_SCOPE },
    alerts: (s.alerts || []).map((a) => ({
      alert_type: a.alert_type || '',
      params: { ...(a.params || {}) },
      channels: [...(a.channels || [])],
      priority: a.priority || 'medium',
    })),
  }
}

// ============================================================================
// 主组件
// ============================================================================

export function MatchStrategyManager() {
  const [items, setItems] = React.useState<MatchStrategyDTO[]>([])
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [reloading, setReloading] = React.useState(false)
  const [togglingId, setTogglingId] = React.useState<string | null>(null)
  // 编辑/新建 Dialog
  const [editOpen, setEditOpen] = React.useState(false)
  const [editMode, setEditMode] = React.useState<'create' | 'update'>('create')
  const [editForm, setEditForm] = React.useState<EditFormState>(
    strategyToForm(emptyDtoForCreate())
  )
  const [editSaving, setEditSaving] = React.useState(false)
  // 删除确认
  const [deleteTarget, setDeleteTarget] = React.useState<MatchStrategyDTO | null>(null)
  const [deleteSaving, setDeleteSaving] = React.useState(false)
  // 测试 Dialog
  const [testTarget, setTestTarget] = React.useState<MatchStrategyDTO | null>(null)
  const [testForm, setTestForm] = React.useState<TestFormState>({ ...EMPTY_TEST_FORM })
  const [testLoading, setTestLoading] = React.useState(false)
  const [testHits, setTestHits] = React.useState<MatchTestHitDTO[] | null>(null)
  // 复制 Dialog
  const [copyDialog, setCopyDialog] = React.useState<{
    open: boolean
    source: MatchStrategyDTO | null
    newId: string
    newName: string
    enableCopy: boolean
    copyAlerts: boolean
    loading: boolean
  }>({
    open: false,
    source: null,
    newId: '',
    newName: '',
    enableCopy: false,
    copyAlerts: true,
    loading: false,
  })
  // R13-1b: alert_templates 列表 (供 EditForm 的 alert_type 下拉)
  const [alertTemplates, setAlertTemplates] = React.useState<AlertTemplateDTO[]>([])
  const [alertTemplatesLoading, setAlertTemplatesLoading] = React.useState(false)

  // ------------------------------------------------------------------
  // 加载
  // ------------------------------------------------------------------
  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await matchStrategyAPI.list()
      setItems(data.items || [])
    } catch (e) {
      toast.error('加载匹配策略失败', { description: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [])

  const loadStrategies = React.useCallback(async () => {
    try {
      const data = await strategyAPI.list()
      setStrategies(data || [])
    } catch {
      /* 非关键失败，静默 */
    }
  }, [])

  // R13-1b: 拉 alert_templates 列表
  // 失败时不弹 toast (非关键路径, EditForm 会降级为 Input 自由输入)
  const loadAlertTemplates = React.useCallback(async () => {
    setAlertTemplatesLoading(true)
    try {
      const data = await monitorAPI.getRules()
      setAlertTemplates(data.templates || [])
    } catch {
      setAlertTemplates([])
    } finally {
      setAlertTemplatesLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
    loadStrategies()
    loadAlertTemplates()
  }, [load, loadStrategies, loadAlertTemplates])

  // ------------------------------------------------------------------
  // 顶部：reload
  // ------------------------------------------------------------------
  const handleReload = async () => {
    setReloading(true)
    const tid = toast.loading('正在重载 match_strategies YAML...')
    try {
      const r = await matchStrategyAPI.reload()
      toast.success('YAML 已重载', {
        id: tid,
        description: `当前 ${r.count} 项：${r.message}`,
      })
      await load()
    } catch (e) {
      toast.error('重载失败', { id: tid, description: (e as Error).message })
    } finally {
      setReloading(false)
    }
  }

  // ------------------------------------------------------------------
  // 启用/禁用 switch (单卡片立即生效，调 PUT)
  // ------------------------------------------------------------------
  const handleToggleEnabled = async (s: MatchStrategyDTO, next: boolean) => {
    setTogglingId(s.match_id)
    try {
      await matchStrategyAPI.update(s.match_id, { enabled: next })
      setItems((prev) =>
        prev.map((x) =>
          x.match_id === s.match_id ? { ...x, enabled: next } : x
        )
      )
      toast.success(
        `${s.name || s.match_id} 已${next ? '启用' : '禁用'}`,
        { description: `match_id: ${s.match_id}` }
      )
    } catch (e) {
      toast.error('切换状态失败', { description: (e as Error).message })
    } finally {
      setTogglingId(null)
    }
  }

  // ------------------------------------------------------------------
  // 新建 Dialog
  // ------------------------------------------------------------------
  const openCreate = () => {
    setEditMode('create')
    setEditForm(strategyToForm(emptyDtoForCreate()))
    setEditOpen(true)
  }

  // ------------------------------------------------------------------
  // 编辑 Dialog
  // ------------------------------------------------------------------
  const openEdit = (s: MatchStrategyDTO) => {
    setEditMode('update')
    setEditForm(strategyToForm(s))
    setEditOpen(true)
  }

  const handleSave = async () => {
    if (!editForm.match_id.trim()) {
      toast.error('match_id 不能为空')
      return
    }
    if (!editForm.name.trim()) {
      toast.error('名称不能为空')
      return
    }
    if (editMode === 'create' && isDefault(editForm.match_id)) {
      toast.error('match_id 不能为 _default（系统保留）')
      return
    }
    // debounce 数字校验
    let debounceOverride: number | null = null
    if (editForm.debounce_override.trim() !== '') {
      const n = Number(editForm.debounce_override)
      if (!Number.isFinite(n) || n < 0) {
        toast.error('debounce 必须是非负数字（或留空用全局）')
        return
      }
      debounceOverride = Math.floor(n)
    }

    setEditSaving(true)
    const tid = toast.loading(editMode === 'create' ? '正在创建...' : '正在保存...')
    try {
      if (editMode === 'create') {
        await matchStrategyAPI.create({
          match_id: editForm.match_id.trim(),
          name: editForm.name.trim(),
          enabled: editForm.enabled,
          strategy_id: editForm.strategy_id,
          scope: editForm.scope,
          alerts: editForm.alerts,
          debounce_override: debounceOverride,
          trading_hours_override: null,
        })
        toast.success('已创建匹配策略', {
          id: tid,
          description: `${editForm.match_id} · ${editForm.alerts.length} 个 alert`,
        })
      } else {
        await matchStrategyAPI.update(editForm.match_id, {
          name: editForm.name.trim(),
          enabled: editForm.enabled,
          strategy_id: editForm.strategy_id,
          scope: editForm.scope,
          alerts: editForm.alerts,
          debounce_override: debounceOverride,
        })
        toast.success('已保存修改', {
          id: tid,
          description: `match_id: ${editForm.match_id}`,
        })
      }
      setEditOpen(false)
      await load()
    } catch (e) {
      toast.error('保存失败', { id: tid, description: (e as Error).message })
    } finally {
      setEditSaving(false)
    }
  }

  // ------------------------------------------------------------------
  // 删除确认
  // ------------------------------------------------------------------
  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleteSaving(true)
    const tid = toast.loading(`正在删除 ${deleteTarget.match_id}...`)
    try {
      await matchStrategyAPI.remove(deleteTarget.match_id)
      toast.success('已删除', {
        id: tid,
        description: deleteTarget.match_id,
      })
      setDeleteTarget(null)
      await load()
    } catch (e) {
      const msg = (e as Error).message || ''
      // 后端 403 (兜底) → 友好提示
      if (msg.includes('_default') || msg.includes('兜底')) {
        toast.error('不允许删除兜底套餐 _default', {
          id: tid,
          description: '兜底套餐系统保留，不可删除',
        })
      } else {
        toast.error('删除失败', { id: tid, description: msg })
      }
    } finally {
      setDeleteSaving(false)
    }
  }

  // ------------------------------------------------------------------
  // 测试
  // ------------------------------------------------------------------
  const openTest = (s: MatchStrategyDTO) => {
    setTestTarget(s)
    setTestForm({ ...EMPTY_TEST_FORM, code: '600519.SH' })
    setTestHits(null)
  }

  const handleTest = async () => {
    if (!testTarget) return
    if (!testForm.code.trim()) {
      toast.error('请输入股票代码')
      return
    }
    const params: Record<string, unknown> = { code: testForm.code.trim() }
    if (testForm.pct_change.trim()) params.pct_change = Number(testForm.pct_change)
    if (testForm.volume_ratio.trim()) params.volume_ratio = Number(testForm.volume_ratio)
    if (testForm.main_inflow.trim()) params.main_inflow = Number(testForm.main_inflow)
    if (testForm.auction_pct.trim()) params.auction_pct = Number(testForm.auction_pct)

    setTestLoading(true)
    setTestHits(null)
    try {
      const r = await matchStrategyAPI.test(
        testTarget.match_id,
        params as Parameters<typeof matchStrategyAPI.test>[1]
      )
      setTestHits(r.hits || [])
      const hits = (r.hits || []).filter((h) => h.hit).length
      toast.success('测试完成', {
        description: `${testTarget.match_id} · 命中 ${hits}/${r.hits?.length ?? 0} 条 alert`,
      })
    } catch (e) {
      toast.error('测试失败', { description: (e as Error).message })
    } finally {
      setTestLoading(false)
    }
  }

  // ------------------------------------------------------------------
  // 复制 Dialog
  // ------------------------------------------------------------------
  const openCopy = (s: MatchStrategyDTO) => {
    const existingIds = new Set(items.map((x) => x.match_id))
    const newId = makeUniqueCopyId(s.match_id, existingIds)
    const newName = `${s.name || s.match_id} 副本`
    setCopyDialog({
      open: true,
      source: s,
      newId,
      newName,
      enableCopy: false,
      copyAlerts: true,
      loading: false,
    })
  }

  const closeCopy = () => {
    setCopyDialog((p) => ({ ...p, open: false }))
  }

  const handleCopyCreate = async () => {
    const { source, newId, newName, copyAlerts, enableCopy } = copyDialog
    if (!source) return
    const trimmedId = newId.trim()
    const trimmedName = newName.trim()
    if (!trimmedId) {
      toast.error('match_id 不能为空')
      return
    }
    if (!isValidMatchId(trimmedId)) {
      toast.error('match_id 只能含字母、数字、下划线')
      return
    }
    if (isDefault(trimmedId)) {
      toast.error('match_id 不能为 _default（系统保留）')
      return
    }
    if (!trimmedName) {
      toast.error('显示名不能为空')
      return
    }

    // 客户端预检：本地已存在则直接提示，避免无效请求
    if (items.some((x) => x.match_id === trimmedId)) {
      toast.error('ID 已存在，请换一个', { description: `match_id: ${trimmedId}` })
      return
    }

    // 副本默认不启用 (避免重复预警)；enableCopy 勾选则启用；其余字段从源策略原样复制
    const payload: MatchCreateRequest = {
      match_id: trimmedId,
      name: trimmedName,
      strategy_id: source.strategy_id,
      enabled: enableCopy,
      scope: source.scope,
      alerts: copyAlerts
        ? (source.alerts || []).map((a) => ({
            alert_type: a.alert_type,
            params: { ...(a.params || {}) },
            channels: [...(a.channels || [])],
            priority: a.priority,
          }))
        : [],
      debounce_override: source.debounce_override,
      trading_hours_override: source.trading_hours_override,
    }

    setCopyDialog((p) => ({ ...p, loading: true }))
    const tid = toast.loading('正在创建副本...')
    try {
      await matchStrategyAPI.create(payload)
      toast.success('副本已创建', {
        id: tid,
        description: `${trimmedId} · 基于 ${source.match_id}`,
      })
      closeCopy()
      await load()
    } catch (e) {
      const err = e as APIError
      const msg = err.message || ''
      // 后端 409 重复 / 400 校验失败 → 友好提示
      if (
        err.status === 409 ||
        msg.includes('已存在') ||
        msg.includes('already exists') ||
        msg.includes('duplicate')
      ) {
        toast.error('ID 已存在，请换一个', { id: tid, description: msg })
      } else if (err.status === 403 || msg.includes('_default')) {
        toast.error('不允许的操作', { id: tid, description: msg })
      } else {
        toast.error('创建副本失败', { id: tid, description: msg })
      }
    } finally {
      setCopyDialog((p) => ({ ...p, loading: false }))
    }
  }

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* 顶部工具栏 */}
      <Card className="p-3 gap-0 bg-quant-card border-quant">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Crosshair className="size-4 text-quant-primary" />
            <span className="font-semibold">匹配策略管理</span>
            <Badge variant="outline" className="border-quant font-mono">
              {items.length} 项
            </Badge>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              match_strategies.yaml · 三层模型 L2 装配单
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-quant"
              onClick={handleReload}
              disabled={reloading}
            >
              <RefreshCw className={cn('size-3.5', reloading && 'animate-spin')} />
              <span className="hidden sm:inline">重载 YAML</span>
            </Button>
            <Button
              size="sm"
              className="h-8 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
              onClick={openCreate}
            >
              <Plus className="size-3.5" />
              <span className="hidden sm:inline">新建匹配策略</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* 卡片列表 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-4 bg-quant-card border-quant">
              <div className="h-4 w-1/2 bg-muted/30 rounded mb-2" />
              <div className="h-3 w-2/3 bg-muted/20 rounded mb-3" />
              <div className="h-16 w-full bg-muted/10 rounded" />
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="bg-quant-card border-quant">
          <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
            <Crosshair className="size-6 mb-2 opacity-40" />
            暂无匹配策略，点击右上角"新建"创建
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((s) => (
            <MatchCard
              key={s.match_id}
              data={s}
              strategies={strategies}
              toggling={togglingId === s.match_id}
              onToggle={(next) => handleToggleEnabled(s, next)}
              onEdit={() => openEdit(s)}
              onTest={() => openTest(s)}
              onCopy={() => openCopy(s)}
              onDelete={() => setDeleteTarget(s)}
            />
          ))}
        </div>
      )}

      {/* 编辑/新建 Dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => !v && setEditOpen(false)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crosshair className="size-5 text-quant-primary" />
              {editMode === 'create' ? '新建匹配策略' : `编辑 ${editForm.match_id}`}
            </DialogTitle>
            <DialogDescription>
              match_id 全局唯一；strategy_id 决定走哪个选股策略；alerts 引用
              monitor_rules.yaml 的 alert_templates。
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 max-h-[60vh] pr-3">
            <EditForm
              value={editForm}
              onChange={setEditForm}
              strategies={strategies}
              mode={editMode}
              alertTemplates={alertTemplates}
              alertTemplatesLoading={alertTemplatesLoading}
            />
          </ScrollArea>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={editSaving}
            >
              取消
            </Button>
            <Button
              className="bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
              onClick={handleSave}
              disabled={editSaving}
            >
              {editSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {editMode === 'create' ? '创建' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && !deleteSaving && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-5 text-red-500" />
              确认删除匹配策略
            </AlertDialogTitle>
            <AlertDialogDescription>
              即将删除 <span className="font-mono font-semibold">{deleteTarget?.match_id}</span>
              （{deleteTarget?.name}）。
              {deleteTarget && isDefault(deleteTarget.match_id) && (
                <span className="block mt-2 text-red-500 font-medium">
                  ⚠ _default 为兜底套餐，后端会返回 403 拒绝删除。
                </span>
              )}
              <span className="block mt-1">该操作不可恢复，删除后相关股票将不再产生预警。</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSaving}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25"
              onClick={handleDelete}
              disabled={deleteSaving}
            >
              {deleteSaving ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : (
                <Trash2 className="size-4 mr-1" />
              )}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 测试 Dialog */}
      <Dialog
        open={!!testTarget}
        onOpenChange={(v) => !v && !testLoading && setTestTarget(null)}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="size-5 text-amber-400" />
              调参预览 · {testTarget?.match_id}
            </DialogTitle>
            <DialogDescription>
              输入单股快照试跑 match，返回命中的 alert 列表（不实际推送）。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">股票代码 *</Label>
                <Input
                  className="h-8 font-mono text-xs"
                  placeholder="600519.SH"
                  value={testForm.code}
                  onChange={(e) =>
                    setTestForm((p) => ({ ...p, code: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">涨跌幅 (0.04=4%)</Label>
                <Input
                  className="h-8 font-mono text-xs"
                  type="number"
                  step="0.001"
                  placeholder="0.04"
                  value={testForm.pct_change}
                  onChange={(e) =>
                    setTestForm((p) => ({ ...p, pct_change: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">量比 (vol_ratio)</Label>
                <Input
                  className="h-8 font-mono text-xs"
                  type="number"
                  step="0.1"
                  placeholder="1.5"
                  value={testForm.volume_ratio}
                  onChange={(e) =>
                    setTestForm((p) => ({ ...p, volume_ratio: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">主力净流入 (万)</Label>
                <Input
                  className="h-8 font-mono text-xs"
                  type="number"
                  step="100"
                  placeholder="5000"
                  value={testForm.main_inflow}
                  onChange={(e) =>
                    setTestForm((p) => ({ ...p, main_inflow: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">集合竞价涨幅</Label>
                <Input
                  className="h-8 font-mono text-xs"
                  type="number"
                  step="0.001"
                  placeholder="0.02"
                  value={testForm.auction_pct}
                  onChange={(e) =>
                    setTestForm((p) => ({ ...p, auction_pct: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-end">
                <Button
                  className="h-8 w-full bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
                  onClick={handleTest}
                  disabled={testLoading}
                >
                  {testLoading ? (
                    <Loader2 className="size-3.5 animate-spin mr-1" />
                  ) : (
                    <FlaskConical className="size-3.5 mr-1" />
                  )}
                  测试
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          {/* 测试结果 */}
          <div className="flex-1 overflow-hidden">
            {testHits === null ? (
              <div className="text-xs text-muted-foreground text-center py-8">
                点击"测试"查看命中结果
              </div>
            ) : testHits.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-8">
                该 match 无 alert 配置
              </div>
            ) : (
              <ScrollArea className="max-h-72">
                <div className="space-y-1.5 pr-2">
                  {testHits.map((h, i) => (
                    <div
                      key={`${h.alert_type}-${i}`}
                      className={cn(
                        'rounded-md border p-2 text-xs flex items-start gap-2',
                        h.hit
                          ? 'border-[var(--quant-up)]/30 bg-[var(--quant-up)]/5'
                          : 'border-quant bg-quant-card/30'
                      )}
                    >
                      <div className="flex flex-col gap-1 items-start shrink-0">
                        <Badge
                          variant={
                            h.hit ? priorityVariant[h.priority || 'medium'] : 'outline'
                          }
                          className="text-[10px]"
                        >
                          {h.hit ? '命中' : '未中'}
                        </Badge>
                        {h.priority && (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-quant"
                          >
                            {PRIORITY_LABEL[h.priority]}
                          </Badge>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-medium text-foreground">
                            {h.alert_type}
                          </span>
                          {h.channels && h.channels.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              → {h.channels.join(', ')}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground break-all">
                          {h.error ? (
                            <span className="text-red-500">err: {h.error}</span>
                          ) : (
                            h.condition
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 复制 Dialog */}
      <Dialog
        open={copyDialog.open}
        onOpenChange={(v) => {
          if (!v && !copyDialog.loading) closeCopy()
        }}
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
            existingIds={items.map((x) => x.match_id)}
          />

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={closeCopy}
              disabled={copyDialog.loading}
            >
              取消
            </Button>
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
              {copyDialog.loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Copy className="size-4" />
              )}
              创建副本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================================
// 单张卡片
// ============================================================================

interface MatchCardProps {
  data: MatchStrategyDTO
  strategies: StrategyDTO[]
  toggling: boolean
  onToggle: (next: boolean) => void
  onEdit: () => void
  onTest: () => void
  onCopy: () => void
  onDelete: () => void
}

function MatchCard({
  data,
  strategies,
  toggling,
  onToggle,
  onEdit,
  onTest,
  onCopy,
  onDelete,
}: MatchCardProps) {
  const def = isDefault(data.match_id)
  const linkedStrategy = strategies.find((s) => s.strategy_id === data.strategy_id)
  const hitCount = (data.alerts || []).filter(Boolean).length
  const highCount = (data.alerts || []).filter((a) => a.priority === 'high').length

  return (
    <Card className="p-4 gap-2 bg-quant-card border-quant hover:border-[var(--quant-primary)]/40 transition-colors flex flex-col">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm truncate">{data.name || data.match_id}</span>
            {def && (
              <Badge
                variant="outline"
                className="text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-400 gap-0.5"
              >
                <Shield className="size-2.5" />
                兜底
              </Badge>
            )}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground truncate">
            {data.match_id}
          </div>
        </div>
        <Switch
          checked={data.enabled}
          onCheckedChange={onToggle}
          disabled={toggling}
          aria-label="启用/禁用"
        />
      </div>

      {/* 关联策略 + alerts */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <Badge
          variant="outline"
          className={
            data.strategy_id
              ? 'border-quant text-quant-primary font-mono'
              : 'border-quant text-muted-foreground'
          }
        >
          {data.strategy_id ? `策略: ${data.strategy_id}` : '全局兜底'}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          {hitCount} alerts
        </Badge>
        {highCount > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {highCount} high
          </Badge>
        )}
      </div>

      {/* scope 摘要 */}
      <div className="text-[11px] text-muted-foreground leading-relaxed bg-muted/20 rounded p-1.5">
        {scopeSummary(data.scope)}
      </div>

      {/* debounce */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          debounce:
          <span className="font-mono text-foreground/80">
            {data.debounce_override === null || data.debounce_override === undefined
              ? '全局默认'
              : `${data.debounce_override}s`}
          </span>
        </span>
        {linkedStrategy && (
          <span className="truncate max-w-[10rem]">
            → {linkedStrategy.strategy_name}
          </span>
        )}
      </div>

      {/* alerts 列表预览（最多 3 条）*/}
      {data.alerts && data.alerts.length > 0 && (
        <div className="space-y-0.5">
          {data.alerts.slice(0, 3).map((a, i) => (
            <div
              key={`${a.alert_type}-${i}`}
              className="flex items-center gap-1.5 text-[10px] font-mono"
            >
              <span
                className={cn(
                  'inline-block size-1.5 rounded-full',
                  a.priority === 'high'
                    ? 'bg-red-500'
                    : a.priority === 'medium'
                    ? 'bg-amber-400'
                    : 'bg-muted-foreground'
                )}
              />
              <span className="text-foreground/80">{a.alert_type}</span>
              {a.channels.length > 0 && (
                <span className="text-muted-foreground truncate">
                  → {a.channels.join(',')}
                </span>
              )}
            </div>
          ))}
          {data.alerts.length > 3 && (
            <div className="text-[10px] text-muted-foreground">
              ...还有 {data.alerts.length - 3} 条
            </div>
          )}
        </div>
      )}

      <Separator className="my-1" />

      {/* 操作 */}
      <div className="flex items-center gap-1 mt-auto">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 flex-1 text-xs"
          onClick={onEdit}
        >
          <Pencil className="size-3" />
          编辑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 flex-1 text-xs hover:bg-amber-500/10 hover:text-amber-400"
          onClick={onTest}
        >
          <FlaskConical className="size-3" />
          测试
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs hover:bg-amber-500/10 hover:text-amber-400"
          onClick={onCopy}
          title={`基于「${data.name || data.match_id}」创建副本`}
          aria-label="复制策略"
        >
          <Copy className="size-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-7 px-2 text-xs',
            def
              ? 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground'
              : 'hover:bg-red-500/10 hover:text-red-500'
          )}
          onClick={onDelete}
          disabled={def}
          title={def ? '兜底套餐不允许删除' : '删除'}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </Card>
  )
}

// ============================================================================
// 复制表单
// ============================================================================

interface CopyFormProps {
  value: {
    source: MatchStrategyDTO | null
    newId: string
    newName: string
    enableCopy: boolean
    copyAlerts: boolean
    loading: boolean
  }
  onChange: (patch: Partial<CopyFormProps['value']>) => void
  existingIds: string[]
}

function CopyForm({ value, onChange, existingIds }: CopyFormProps) {
  const trimmedId = value.newId.trim()
  const idTaken =
    trimmedId.length > 0 &&
    existingIds.includes(trimmedId) &&
    trimmedId !== value.source?.match_id
  const idInvalid = trimmedId.length > 0 && !isValidMatchId(trimmedId)
  const idIsDefault = trimmedId === '_default'

  return (
    <div className="space-y-3">
      {/* 源策略信息 */}
      {value.source && (
        <div className="text-xs rounded-md border border-quant bg-quant-card/30 p-2 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">源策略:</span>
            <span className="font-mono text-foreground/80">
              {value.source.match_id}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-foreground/80">{value.source.name}</span>
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>strategy_id: <span className="font-mono">{value.source.strategy_id || '(全局兜底)'}</span></span>
            <span>·</span>
            <span>alerts: {value.source.alerts?.length ?? 0}</span>
            <span>·</span>
            <span>scope: {scopeSummary(value.source.scope)}</span>
          </div>
        </div>
      )}

      {/* 新 match_id */}
      <div className="space-y-1">
        <Label className="text-xs">新 match_id *</Label>
        <Input
          className="h-8 font-mono text-xs"
          value={value.newId}
          onChange={(e) => onChange({ newId: e.target.value })}
          placeholder="如 my_match_v2"
          autoFocus
        />
        <p className="text-[10px] text-muted-foreground">
          全局唯一；只能含字母、数字、下划线
        </p>
        {idInvalid && (
          <p className="text-[10px] text-red-500 flex items-center gap-1">
            <AlertCircle className="size-3" />
            match_id 只能含字母、数字、下划线
          </p>
        )}
        {idIsDefault && (
          <p className="text-[10px] text-red-500 flex items-center gap-1">
            <AlertCircle className="size-3" />
            _default 是系统保留 ID，不可使用
          </p>
        )}
        {idTaken && !idIsDefault && (
          <p className="text-[10px] text-red-500 flex items-center gap-1">
            <AlertCircle className="size-3" />
            该 ID 已存在，请换一个
          </p>
        )}
      </div>

      {/* 新名称 */}
      <div className="space-y-1">
        <Label className="text-xs">显示名 *</Label>
        <Input
          className="h-8 text-xs"
          value={value.newName}
          onChange={(e) => onChange({ newName: e.target.value })}
          placeholder="如 弱转强默认监控 副本"
        />
      </div>

      <Separator />

      {/* 选项 */}
      <div className="space-y-2">
        <label
          className="flex items-start gap-2 cursor-pointer select-none"
          htmlFor="copy-enable"
        >
          <Checkbox
            id="copy-enable"
            checked={value.enableCopy}
            onCheckedChange={(v) => onChange({ enableCopy: v === true })}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <div className="text-xs font-medium">启用副本（默认关闭）</div>
            <div className="text-[10px] text-muted-foreground">
              副本默认不启用，避免与源策略产生重复预警。可创建后手动开启。
            </div>
          </div>
        </label>

        <label
          className="flex items-start gap-2 cursor-pointer select-none"
          htmlFor="copy-alerts"
        >
          <Checkbox
            id="copy-alerts"
            checked={value.copyAlerts}
            onCheckedChange={(v) => onChange({ copyAlerts: v === true })}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <div className="text-xs font-medium">
              复制 alerts 配置（默认勾选）
            </div>
            <div className="text-[10px] text-muted-foreground">
              取消勾选则创建一个无 alert 的空壳策略，之后可在编辑页单独配置。
            </div>
          </div>
        </label>
      </div>
    </div>
  )
}

// ============================================================================
// 编辑表单
// ============================================================================

interface EditFormProps {
  value: EditFormState
  onChange: (next: EditFormState) => void
  strategies: StrategyDTO[]
  mode: 'create' | 'update'
  /** R13-1b: alert_type 下拉用的模板列表 (空数组时回退为 Input 自由输入) */
  alertTemplates?: AlertTemplateDTO[]
  /** R13-1b: 模板列表加载中 (展示 loading 占位) */
  alertTemplatesLoading?: boolean
}

function EditForm({
  value,
  onChange,
  strategies,
  mode,
  alertTemplates,
  alertTemplatesLoading,
}: EditFormProps) {
  const set = <K extends keyof EditFormState>(k: K, v: EditFormState[K]) =>
    onChange({ ...value, [k]: v })

  const setScope = (patch: Partial<MatchScopeDTO>) =>
    set('scope', { ...value.scope, ...patch })

  const setAlert = (idx: number, patch: Partial<MatchAlertDTO>) =>
    set(
      'alerts',
      value.alerts.map((a, i) => (i === idx ? { ...a, ...patch } : a))
    )

  const addAlert = () =>
    set('alerts', [...value.alerts, { ...EMPTY_ALERT }])

  const removeAlert = (idx: number) =>
    set('alerts', value.alerts.filter((_, i) => i !== idx))

  const toggleMarket = (m: string, on: boolean) => {
    const cur = new Set(value.scope.markets || [])
    if (on) cur.add(m)
    else cur.delete(m)
    setScope({ markets: Array.from(cur) })
  }

  const toggleChannel = (alertIdx: number, ch: string, on: boolean) => {
    const alert = value.alerts[alertIdx]
    const cur = new Set(alert.channels || [])
    if (on) cur.add(ch)
    else cur.delete(ch)
    setAlert(alertIdx, { channels: Array.from(cur) })
  }

  const setParam = (alertIdx: number, key: string, val: string) => {
    const alert = value.alerts[alertIdx]
    const params = { ...alert.params }
    if (val === '') {
      delete params[key]
    } else {
      const n = Number(val)
      params[key] = Number.isFinite(n) ? n : val
    }
    setAlert(alertIdx, { params })
  }

  const addParamKey = (alertIdx: number) => {
    const key = window.prompt('新参数名 (如 pct_threshold / vol_ratio_threshold)')
    if (!key) return
    const alert = value.alerts[alertIdx]
    if (key in alert.params) {
      toast.warning('参数已存在')
      return
    }
    setAlert(alertIdx, { params: { ...alert.params, [key]: 0 } })
  }

  const removeParam = (alertIdx: number, key: string) => {
    const alert = value.alerts[alertIdx]
    const params = { ...alert.params }
    delete params[key]
    setAlert(alertIdx, { params })
  }

  return (
    <div className="space-y-4 pr-1">
      {/* 基础字段 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">match_id *</Label>
          <Input
            className="h-8 font-mono text-xs"
            value={value.match_id}
            onChange={(e) => set('match_id', e.target.value)}
            disabled={mode === 'update'}
            placeholder="如 rzq_default / my_custom"
          />
          <p className="text-[10px] text-muted-foreground">
            全局唯一；update 模式不可改
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">显示名 *</Label>
          <Input
            className="h-8 text-xs"
            value={value.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="如 弱转强默认监控"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">关联策略 strategy_id</Label>
          <Select
            value={value.strategy_id || '__fallback__'}
            onValueChange={(v) =>
              set('strategy_id', v === '__fallback__' ? '' : v)
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="选择策略" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__fallback__" className="text-xs">
                全局兜底 (strategy_id="")
              </SelectItem>
              {strategies.map((s) => (
                <SelectItem
                  key={s.strategy_id}
                  value={s.strategy_id}
                  className="text-xs"
                >
                  {s.strategy_id} · {s.strategy_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">debounce_override (秒)</Label>
          <Input
            className="h-8 font-mono text-xs"
            type="number"
            min={0}
            placeholder="留空=用全局"
            value={value.debounce_override}
            onChange={(e) => set('debounce_override', e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={value.enabled}
          onCheckedChange={(v) => set('enabled', v)}
          id="match-enabled"
        />
        <Label htmlFor="match-enabled" className="text-xs cursor-pointer">
          启用此匹配策略
        </Label>
      </div>

      <Separator />

      {/* Scope */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Scope 范围筛选</Label>
          <span className="text-[10px] text-muted-foreground">
            限制 match 仅在哪些股票上求值
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">市场</Label>
            <div className="flex gap-1.5 flex-wrap">
              {ALL_MARKETS.map((m) => {
                const on = value.scope.markets?.includes(m) ?? false
                return (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    className={cn(
                      'h-7 px-2 text-[10px] font-mono',
                      on
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        : 'border-quant'
                    )}
                    onClick={() => toggleMarket(m, !on)}
                  >
                    {m}
                  </Button>
                )
              })}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">排除 ST</Label>
            <Switch
              checked={value.scope.exclude_st}
              onCheckedChange={(v) => setScope({ exclude_st: v })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">排除停牌</Label>
            <Switch
              checked={value.scope.exclude_suspended}
              onCheckedChange={(v) => setScope({ exclude_suspended: v })}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            排除代码 (逗号分隔)
          </Label>
          <Input
            className="h-8 font-mono text-xs"
            placeholder="如 688001.SH,300001.SZ"
            value={(value.scope.exclude_codes || []).join(',')}
            onChange={(e) =>
              setScope({
                exclude_codes: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            仅包含代码 (逗号分隔, 留空=不限)
          </Label>
          <Input
            className="h-8 font-mono text-xs"
            placeholder="如 600519.SH,000001.SZ"
            value={(value.scope.include_only || []).join(',')}
            onChange={(e) =>
              setScope({
                include_only: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
      </div>

      <Separator />

      {/* Alerts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">
            Alerts 引用 ({value.alerts.length})
          </Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs border-quant"
            onClick={addAlert}
          >
            <Plus className="size-3" />
            添加 alert
          </Button>
        </div>

        {value.alerts.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-3 border border-dashed border-quant rounded">
            暂无 alert 引用，点击"添加 alert"创建
          </div>
        )}

        <div className="space-y-2">
          {value.alerts.map((a, i) => (
            <div
              key={i}
              className="rounded-md border border-quant bg-quant-card/30 p-2 space-y-2"
            >
              <div className="flex items-center gap-2">
                {alertTemplates && alertTemplates.length > 0 ? (
                  // R13-1b: alert_type 下拉选择 (从后端拉模板列表)
                  <Select
                    value={a.alert_type}
                    onValueChange={(v) => {
                      const tpl = alertTemplates.find((t) => t.alert_type === v)
                      const patch: Partial<MatchAlertDTO> = { alert_type: v }
                      // 选中模板后, 若 params 为空, 自动填入 default_params
                      if (
                        tpl &&
                        tpl.default_params &&
                        Object.keys(tpl.default_params).length > 0 &&
                        (!a.params || Object.keys(a.params).length === 0)
                      ) {
                        patch.params = { ...tpl.default_params }
                      }
                      setAlert(i, patch)
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs font-mono flex-1">
                      <SelectValue placeholder="选择 alert_type (模板下拉)" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {alertTemplates.map((t) => (
                        <SelectItem
                          key={t.alert_type}
                          value={t.alert_type}
                          className="text-xs font-mono"
                        >
                          <span className="mr-1">{t.emoji}</span>
                          {t.alert_type} — {t.label}
                        </SelectItem>
                      ))}
                      {/* 已选但不在模板列表中的值 (历史/自定义/拼写差异), 仍展示, 避免选中状态丢失 */}
                      {a.alert_type &&
                        !alertTemplates.some(
                          (t) => t.alert_type === a.alert_type
                        ) && (
                          <SelectItem
                            value={a.alert_type}
                            className="text-xs font-mono"
                          >
                            ⚠ {a.alert_type} (未在模板列表)
                          </SelectItem>
                        )}
                    </SelectContent>
                  </Select>
                ) : alertTemplatesLoading ? (
                  // 加载中: 显示 loading 占位
                  <div className="h-7 flex-1 flex items-center gap-1.5 px-2 rounded-md border border-quant text-[10px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    正在加载 alert 模板...
                  </div>
                ) : (
                  // 降级: 模板列表为空 (FastAPI 不可达 or 配置缺失) → 自由 Input
                  <Input
                    className="h-7 text-xs font-mono flex-1"
                    placeholder="alert_type (如 rzq_ignite)"
                    value={a.alert_type}
                    onChange={(e) =>
                      setAlert(i, { alert_type: e.target.value })
                    }
                  />
                )}
                <Select
                  value={a.priority}
                  onValueChange={(v) =>
                    setAlert(i, { priority: v as MatchPriority })
                  }
                >
                  <SelectTrigger className="h-7 text-xs w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">
                        {PRIORITY_LABEL[p]} ({p})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs hover:bg-red-500/10 hover:text-red-500"
                  onClick={() => removeAlert(i)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>

              {/* R13-1b: 选中模板后展示 description + condition (帮助用户理解模板含义) */}
              {a.alert_type &&
                alertTemplates &&
                alertTemplates.some((t) => t.alert_type === a.alert_type) && (
                  <div className="text-[10px] text-muted-foreground leading-relaxed pl-1">
                    {(() => {
                      const t = alertTemplates.find(
                        (x) => x.alert_type === a.alert_type
                      )
                      if (!t) return null
                      return (
                        <>
                          <span className="text-foreground/70">
                            {t.description}
                          </span>
                          {t.condition && (
                            <span className="ml-2 font-mono text-foreground/50">
                              条件: {t.condition}
                            </span>
                          )}
                          {t.default_params &&
                            Object.keys(t.default_params).length > 0 && (
                              <span className="ml-2 font-mono text-foreground/50">
                                默认参数:{' '}
                                {Object.entries(t.default_params)
                                  .map(([k, v]) => `${k}=${v}`)
                                  .join(', ')}
                              </span>
                            )}
                        </>
                      )
                    })()}
                  </div>
                )}

              {/* channels */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground mr-1">通道:</span>
                {ALL_CHANNELS.map((ch) => {
                  const on = a.channels?.includes(ch) ?? false
                  return (
                    <Button
                      key={ch}
                      type="button"
                      size="sm"
                      variant={on ? 'default' : 'outline'}
                      className={cn(
                        'h-6 px-2 text-[10px] font-mono',
                        on
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : 'border-quant'
                      )}
                      onClick={() => toggleChannel(i, ch, !on)}
                    >
                      {ch}
                    </Button>
                  )
                })}
              </div>

              {/* params */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    参数覆盖 (params):
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[10px]"
                    onClick={() => addParamKey(i)}
                  >
                    <Plus className="size-2.5" />
                    加参数
                  </Button>
                </div>
                {Object.keys(a.params || {}).length === 0 ? (
                  <div className="text-[10px] text-muted-foreground italic">
                    无参数（用模板默认值）
                  </div>
                ) : (
                  <div className="space-y-1">
                    {Object.entries(a.params).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-1">
                        <span className="text-[10px] font-mono text-foreground/80 w-32 truncate">
                          {k}
                        </span>
                        <Input
                          className="h-6 text-xs font-mono flex-1"
                          type="number"
                          step="any"
                          value={String(v)}
                          onChange={(e) => setParam(i, k, e.target.value)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 hover:bg-red-500/10 hover:text-red-500"
                          onClick={() => removeParam(i, k)}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 内部：创建空 DTO
// ============================================================================

function emptyDtoForCreate(): MatchStrategyDTO {
  return {
    match_id: '',
    name: '',
    enabled: true,
    strategy_id: '',
    scope: { ...EMPTY_SCOPE },
    alerts: [{ ...EMPTY_ALERT }],
    debounce_override: null,
    trading_hours_override: null,
  }
}
