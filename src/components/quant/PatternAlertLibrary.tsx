'use client'

/**
 * PatternAlertLibrary — 形态预警库容器
 *
 * 职责:
 *   - 加载 pattern_alerts 套餐(从 matchStrategyAPI.list)
 *   - 合并预设 PATTERN_LIST + localStorage 自定义形态
 *   - 启停预设形态(改套餐 alerts) / 自定义形态(本地 localStorage 标记)
 *   - 试跑: 弹 PatternTestDialog
 *   - 创建/编辑/克隆/删除自定义形态: 弹 PatternBuilderDialog
 *
 * 容器 <120 行, 持有 alerts/customPatterns/builder 状态
 */

import * as React from 'react'
import { Loader2, ShieldCheck, WifiOff } from 'lucide-react'
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
import { matchStrategyAPI, type MatchAlertDTO } from '@/lib/api'
import { toast } from 'sonner'
import { PATTERN_LIST, type PatternMeta } from './pattern/shared'
import { PatternCard, PatternLibraryBanner } from './pattern/PatternCard'
import { PatternTestDialog } from './pattern/PatternTestDialog'
import { PatternBuilderDialog } from './pattern/PatternBuilderDialog'
import {
  loadCustomPatterns,
  saveCustomPatterns,
  type CustomPattern,
} from './pattern/builder'

const PATTERN_MATCH_ID = 'pattern_alerts'
const CUSTOM_ENABLED_KEY = 'tdxquant:custom-patterns-enabled'

/** 用本地 PATTERN_LIST 构造 fallback alerts(7 个形态全启用) */
function buildFallbackAlerts(): MatchAlertDTO[] {
  return PATTERN_LIST.map((p) => ({
    alert_type: p.alert_type,
    params: { ...p.defaultParams },
    channels: p.risk === 'high' ? ['websocket', 'feishu'] : ['websocket'],
    priority: p.risk,
  }))
}

/** 读取自定义形态的启用状态(localStorage) */
function loadCustomEnabled(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CUSTOM_ENABLED_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveCustomEnabled(map: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CUSTOM_ENABLED_KEY, JSON.stringify(map))
  } catch {
    /* noop */
  }
}

export function PatternAlertLibrary() {
  const [alerts, setAlerts] = React.useState<MatchAlertDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [offline, setOffline] = React.useState(false)
  const [testMeta, setTestMeta] = React.useState<PatternMeta | null>(null)
  const [testOpen, setTestOpen] = React.useState(false)

  // 自定义形态
  const [customPatterns, setCustomPatterns] = React.useState<CustomPattern[]>([])
  const [customEnabled, setCustomEnabled] = React.useState<Record<string, boolean>>({})

  // 构建器状态
  const [builderOpen, setBuilderOpen] = React.useState(false)
  const [builderInitial, setBuilderInitial] = React.useState<CustomPattern | null>(null)
  const [builderCloneFrom, setBuilderCloneFrom] = React.useState<PatternMeta | null>(null)

  // 删除确认
  const [deleteTarget, setDeleteTarget] = React.useState<CustomPattern | null>(null)

  // 合并预设 + 自定义
  const allPatterns = React.useMemo<PatternMeta[]>(
    () => [...PATTERN_LIST, ...customPatterns],
    [customPatterns],
  )

  // ============================================================================
  // 加载
  // ============================================================================

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const r = await matchStrategyAPI.list()
      const match = (r.items || []).find((m) => m.match_id === PATTERN_MATCH_ID)
      const alerts = match?.alerts || []
      if (alerts.length === 0) {
        setAlerts(buildFallbackAlerts())
        setOffline(true)
      } else {
        setAlerts(alerts)
        setOffline(false)
      }
    } catch {
      setAlerts(buildFallbackAlerts())
      setOffline(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次挂载: 加载套餐 + 自定义形态
  React.useEffect(() => {
    load()
    setCustomPatterns(loadCustomPatterns())
    setCustomEnabled(loadCustomEnabled())
  }, [load])

  // ============================================================================
  // 启停逻辑
  // ============================================================================

  /** 判断某个形态是否启用 */
  const isEnabled = (meta: PatternMeta) => {
    if (meta.custom && meta.id) {
      return customEnabled[meta.id] ?? false
    }
    return alerts.some((a) => a.alert_type === meta.alert_type)
  }

  /** 启停预设形态: 重建 alerts 数组(增/删该 alert_type) */
  const handleTogglePreset = async (alertType: string, enabled: boolean) => {
    if (offline) {
      if (enabled) {
        const meta = PATTERN_LIST.find((p) => p.alert_type === alertType)
        if (!meta) return
        setAlerts((prev) => [
          ...prev.filter((a) => a.alert_type !== alertType),
          {
            alert_type: alertType,
            params: { ...meta.defaultParams },
            channels: meta.risk === 'high' ? ['websocket', 'feishu'] : ['websocket'],
            priority: meta.risk,
          },
        ])
      } else {
        setAlerts((prev) => prev.filter((a) => a.alert_type !== alertType))
      }
      toast.info(enabled ? `已启用 ${alertType}(离线)` : `已停用 ${alertType}(离线)`)
      return
    }
    setSaving(true)
    const prev = alerts
    try {
      let next: MatchAlertDTO[]
      if (enabled) {
        const meta = PATTERN_LIST.find((p) => p.alert_type === alertType)
        if (!meta) throw new Error('未知形态: ' + alertType)
        next = [
          ...alerts.filter((a) => a.alert_type !== alertType),
          {
            alert_type: alertType,
            params: { ...meta.defaultParams },
            channels: meta.risk === 'high' ? ['websocket', 'feishu'] : ['websocket'],
            priority: meta.risk,
          },
        ]
      } else {
        next = alerts.filter((a) => a.alert_type !== alertType)
      }
      setAlerts(next)
      await matchStrategyAPI.update(PATTERN_MATCH_ID, { alerts: next })
      toast.success(enabled ? `已启用 ${alertType}` : `已停用 ${alertType}`)
    } catch (e) {
      setAlerts(prev)
      toast.error('更新失败', { description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  /** 启停自定义形态: 仅本地 localStorage */
  const handleToggleCustom = (id: string, enabled: boolean) => {
    setCustomEnabled((prev) => {
      const next = { ...prev, [id]: enabled }
      saveCustomEnabled(next)
      return next
    })
    toast.success(
      enabled ? '已启用自定义形态(本地)' : '已停用自定义形态(本地)',
      { description: '自定义形态仅本地生效, 预设形态走后端套餐' },
    )
  }

  const handleToggle = (alertType: string, enabled: boolean) => {
    // 先在自定义里找, 找不到再走预设
    const custom = customPatterns.find((p) => p.alert_type === alertType)
    if (custom && custom.id) {
      handleToggleCustom(custom.id, enabled)
    } else {
      handleTogglePreset(alertType, enabled)
    }
  }

  // ============================================================================
  // 构建器: 创建/编辑/克隆
  // ============================================================================

  const handleCreate = () => {
    setBuilderInitial(null)
    setBuilderCloneFrom(null)
    setBuilderOpen(true)
  }

  const handleEdit = (meta: PatternMeta) => {
    const custom = customPatterns.find((p) => p.id === meta.id)
    if (!custom) return
    setBuilderInitial(custom)
    setBuilderCloneFrom(null)
    setBuilderOpen(true)
  }

  const handleClone = (meta: PatternMeta) => {
    setBuilderInitial(null)
    setBuilderCloneFrom(meta)
    setBuilderOpen(true)
  }

  const handleSaved = (p: CustomPattern) => {
    setCustomPatterns((prev) => {
      // 编辑模式: 替换; 创建模式: 追加
      const idx = prev.findIndex((x) => x.id === p.id)
      let next: CustomPattern[]
      if (idx >= 0) {
        next = [...prev.slice(0, idx), p, ...prev.slice(idx + 1)]
      } else {
        next = [...prev, p]
      }
      saveCustomPatterns(next)
      return next
    })
  }

  // ============================================================================
  // 删除
  // ============================================================================

  const handleDelete = (meta: PatternMeta) => {
    const custom = customPatterns.find((p) => p.id === meta.id)
    if (!custom) return
    setDeleteTarget(custom)
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    setCustomPatterns((prev) => {
      const next = prev.filter((p) => p.id !== deleteTarget.id)
      saveCustomPatterns(next)
      return next
    })
    setCustomEnabled((prev) => {
      const next = { ...prev }
      delete next[deleteTarget.id]
      saveCustomEnabled(next)
      return next
    })
    toast.success('自定义形态已删除', { description: `${deleteTarget.emoji} ${deleteTarget.label}` })
    setDeleteTarget(null)
  }

  // ============================================================================
  // 试跑
  // ============================================================================

  const handleTest = (meta: PatternMeta) => {
    setTestMeta(meta)
    setTestOpen(true)
  }

  const enabledCount = allPatterns.filter((p) => isEnabled(p)).length
  const customCount = customPatterns.length

  return (
    <div className="space-y-3">
      <PatternLibraryBanner
        enabledCount={enabledCount}
        totalCount={allPatterns.length}
        customCount={customCount}
        onCreate={handleCreate}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin mr-2" />
          加载形态预警套餐...
        </div>
      ) : (
        <>
          {/* 预设形态区 */}
          {PATTERN_LIST.length > 0 && (
            <div>
              <div className="text-[10px] text-muted-foreground mb-2 px-1">预设形态({PATTERN_LIST.length})</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {PATTERN_LIST.map((meta) => (
                  <PatternCard
                    key={meta.alert_type}
                    meta={meta}
                    enabled={isEnabled(meta)}
                    onToggle={handleToggle}
                    onTest={handleTest}
                    onClone={handleClone}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 自定义形态区 */}
          {customPatterns.length > 0 && (
            <div>
              <div className="text-[10px] text-amber-400 mb-2 px-1 flex items-center gap-1.5">
                自定义形态({customPatterns.length})
                <span className="text-muted-foreground/60">· 本地持久化</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {customPatterns.map((meta) => (
                  <PatternCard
                    key={meta.id}
                    meta={meta}
                    enabled={isEnabled(meta)}
                    onToggle={handleToggle}
                    onTest={handleTest}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onClone={handleClone}
                  />
                ))}
              </div>
            </div>
          )}

          {customPatterns.length === 0 && (
            <div className="text-center py-6 text-[11px] text-muted-foreground border border-dashed border-quant/60 rounded-lg">
              还没有自定义形态, 点击上方"新建自定义形态"或克隆任意预设形态开始
            </div>
          )}
        </>
      )}

      {/* 底部状态条 */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground px-1">
        <div className="flex items-center gap-1.5">
          {offline ? (
            <>
              <WifiOff className="size-3.5 text-amber-400" />
              <span>离线模式 · FastAPI 不可达, 预设形态改动仅本地</span>
            </>
          ) : (
            <>
              <ShieldCheck className="size-3.5 text-amber-400" />
              <span>
                套餐 <code className="font-mono text-amber-400">{PATTERN_MATCH_ID}</code> ·{' '}
                {saving ? '保存中...' : '已同步'}
              </span>
            </>
          )}
        </div>
        <span>预设套餐对所有股票生效 · 防抖 120s · 自定义形态本地持久化</span>
      </div>

      {/* 试跑弹窗 */}
      <PatternTestDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        initialMeta={testMeta}
      />

      {/* 构建器弹窗 */}
      <PatternBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        initial={builderInitial}
        cloneFrom={builderCloneFrom}
        onSaved={handleSaved}
      />

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除自定义形态</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 <span className="font-medium text-foreground">{deleteTarget?.emoji} {deleteTarget?.label}</span> 吗?
              <br />
              <code className="font-mono text-xs">{deleteTarget?.alert_type}</code>
              <br />
              <span className="text-[11px]">此操作不可撤销, 删除后无法恢复。</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 hover:text-red-300"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
