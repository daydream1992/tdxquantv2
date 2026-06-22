'use client'

/**
 * PatternAlertLibrary — 形态预警库容器
 *
 * 职责:
 *   - 加载 pattern_alerts 套餐(从 matchStrategyAPI.list)
 *   - 把套餐里的 7 个 alert_ref 与 PATTERN_LIST 元信息合并展示
 *   - 启停:改 alert_ref 是否在套餐里(实际通过 update match alerts 实现)
 *   - 试跑:弹 PatternTestDialog
 *
 * 容器 <100 行,只持有 matchData/testMeta 状态
 */

import * as React from 'react'
import { Loader2, ShieldCheck, WifiOff } from 'lucide-react'
import { matchStrategyAPI, type MatchAlertDTO } from '@/lib/api'
import { toast } from 'sonner'
import { PATTERN_LIST, type PatternMeta } from './pattern/shared'
import { PatternCard, PatternLibraryBanner } from './pattern/PatternCard'
import { PatternTestDialog } from './pattern/PatternTestDialog'

const PATTERN_MATCH_ID = 'pattern_alerts'

/** 用本地 PATTERN_LIST 构造 fallback alerts(7 个形态全启用) */
function buildFallbackAlerts(): MatchAlertDTO[] {
  return PATTERN_LIST.map((p) => ({
    alert_type: p.alert_type,
    params: { ...p.defaultParams },
    channels: p.risk === 'high' ? ['websocket', 'feishu'] : ['websocket'],
    priority: p.risk,
  }))
}

export function PatternAlertLibrary() {
  const [alerts, setAlerts] = React.useState<MatchAlertDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [offline, setOffline] = React.useState(false)
  const [testMeta, setTestMeta] = React.useState<PatternMeta | null>(null)
  const [testOpen, setTestOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const r = await matchStrategyAPI.list()
      const match = (r.items || []).find((m) => m.match_id === PATTERN_MATCH_ID)
      const alerts = match?.alerts || []
      if (alerts.length === 0) {
        // 套餐存在但 alerts 为空,或套餐不存在 → 用本地 PATTERN_LIST 作 fallback
        setAlerts(buildFallbackAlerts())
        setOffline(true)
      } else {
        setAlerts(alerts)
        setOffline(false)
      }
    } catch (e) {
      // FastAPI 不可达 → 离线模式,用本地 PATTERN_LIST
      setAlerts(buildFallbackAlerts())
      setOffline(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  /** 判断某个形态是否启用(在 alerts 里) */
  const isEnabled = (alertType: string) =>
    alerts.some((a) => a.alert_type === alertType)

  /** 启停某个形态:重建 alerts 数组(增/删该 alert_type) */
  const handleToggle = async (alertType: string, enabled: boolean) => {
    if (offline) {
      // 离线模式:只改本地状态,不调后端
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
        // 从 PATTERN_LIST 找到 meta,用 defaultParams 构造 alert_ref
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
      setAlerts(next) // 乐观更新
      await matchStrategyAPI.update(PATTERN_MATCH_ID, { alerts: next })
      toast.success(enabled ? `已启用 ${alertType}` : `已停用 ${alertType}`)
    } catch (e) {
      setAlerts(prev) // 回滚
      toast.error('更新失败', { description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = (meta: PatternMeta) => {
    setTestMeta(meta)
    setTestOpen(true)
  }

  const enabledCount = PATTERN_LIST.filter((p) => isEnabled(p.alert_type)).length

  return (
    <div className="space-y-3">
      <PatternLibraryBanner enabledCount={enabledCount} totalCount={PATTERN_LIST.length} />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin mr-2" />
          加载形态预警套餐...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PATTERN_LIST.map((meta) => (
            <PatternCard
              key={meta.alert_type}
              meta={meta}
              enabled={isEnabled(meta.alert_type)}
              onToggle={handleToggle}
              onTest={handleTest}
            />
          ))}
        </div>
      )}

      {/* 底部状态条 */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground px-1">
        <div className="flex items-center gap-1.5">
          {offline ? (
            <>
              <WifiOff className="size-3.5 text-amber-400" />
              <span>离线模式 · FastAPI 不可达,改动仅本地</span>
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
        <span>所有股票生效(兜底套餐) · 防抖 120s · 修改后实时热加载</span>
      </div>

      <PatternTestDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        initialMeta={testMeta}
      />
    </div>
  )
}
