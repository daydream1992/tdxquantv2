'use client'

/**
 * MatchStrategyEditFields — MatchStrategyForm 内部使用的字段渲染组件
 *
 * 包含两个内部组件:
 *  - EditForm: 编辑/新建表单的基础字段 + Scope + Alerts
 *  - CopyForm: 复制策略时显示的源策略信息 + 新 ID/名称输入
 *
 * 从 MatchStrategyForm.tsx 抽出, 使 Form 主文件保持在 500 行以内。
 */

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Plus, AlertCircle, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  type MatchAlertDTO, type MatchScopeDTO, type MatchPriority,
  type StrategyDTO, type AlertTemplateDTO,
} from '@/lib/api'
import {
  ALL_MARKETS, ALL_CHANNELS, PRIORITIES, PRIORITY_LABEL,
  EMPTY_ALERT,
  isValidMatchId,
  scopeSummary,
  type EditFormState, type CopyDialogState,
} from './shared'

// ============================================================================
// 编辑表单 (基础字段 + Scope + Alerts)
// ============================================================================

export interface EditFormProps {
  value: EditFormState
  onChange: (next: EditFormState) => void
  strategies: StrategyDTO[]
  mode: 'create' | 'update'
  alertTemplates?: AlertTemplateDTO[]
  alertTemplatesLoading?: boolean
}

export function EditForm({ value, onChange, strategies, mode, alertTemplates, alertTemplatesLoading }: EditFormProps) {
  const set = <K extends keyof EditFormState>(k: K, v: EditFormState[K]) => onChange({ ...value, [k]: v })
  const setScope = (patch: Partial<MatchScopeDTO>) => set('scope', { ...value.scope, ...patch })
  const setAlert = (idx: number, patch: Partial<MatchAlertDTO>) =>
    set('alerts', value.alerts.map((a, i) => (i === idx ? { ...a, ...patch } : a)))
  const addAlert = () => set('alerts', [...value.alerts, { ...EMPTY_ALERT }])
  const removeAlert = (idx: number) => set('alerts', value.alerts.filter((_, i) => i !== idx))
  const toggleMarket = (m: string, on: boolean) => {
    const cur = new Set(value.scope.markets || [])
    if (on) cur.add(m); else cur.delete(m)
    setScope({ markets: Array.from(cur) })
  }
  const toggleChannel = (alertIdx: number, ch: string, on: boolean) => {
    const cur = new Set(value.alerts[alertIdx].channels || [])
    if (on) cur.add(ch); else cur.delete(ch)
    setAlert(alertIdx, { channels: Array.from(cur) })
  }
  const setParam = (alertIdx: number, key: string, val: string) => {
    const params = { ...value.alerts[alertIdx].params }
    if (val === '') { delete params[key] } else {
      const n = Number(val)
      params[key] = Number.isFinite(n) ? n : val
    }
    setAlert(alertIdx, { params })
  }
  const addParamKey = (alertIdx: number) => {
    const key = window.prompt('新参数名 (如 pct_threshold / vol_ratio_threshold)')
    if (!key) return
    if (key in value.alerts[alertIdx].params) { toast.warning('参数已存在'); return }
    setAlert(alertIdx, { params: { ...value.alerts[alertIdx].params, [key]: 0 } })
  }
  const removeParam = (alertIdx: number, key: string) => {
    const params = { ...value.alerts[alertIdx].params }
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
            className="h-8 font-mono text-xs" value={value.match_id}
            onChange={(e) => set('match_id', e.target.value)}
            disabled={mode === 'update'} placeholder="如 rzq_default / my_custom"
          />
          <p className="text-[10px] text-muted-foreground">全局唯一；update 模式不可改</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">显示名 *</Label>
          <Input
            className="h-8 text-xs" value={value.name}
            onChange={(e) => set('name', e.target.value)} placeholder="如 弱转强默认监控"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">关联策略 strategy_id</Label>
          <Select
            value={value.strategy_id || '__fallback__'}
            onValueChange={(v) => set('strategy_id', v === '__fallback__' ? '' : v)}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择策略" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__fallback__" className="text-xs">全局兜底 (strategy_id=&quot;&quot;)</SelectItem>
              {strategies.map((s) => (
                <SelectItem key={s.strategy_id} value={s.strategy_id} className="text-xs">
                  {s.strategy_id} · {s.strategy_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">debounce_override (秒)</Label>
          <Input
            className="h-8 font-mono text-xs" type="number" min={0}
            placeholder="留空=用全局" value={value.debounce_override}
            onChange={(e) => set('debounce_override', e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={value.enabled} onCheckedChange={(v) => set('enabled', v)} id="match-enabled" />
        <Label htmlFor="match-enabled" className="text-xs cursor-pointer">启用此匹配策略</Label>
      </div>

      <Separator />

      {/* Scope */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Scope 范围筛选</Label>
          <span className="text-[10px] text-muted-foreground">限制 match 仅在哪些股票上求值</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">市场</Label>
            <div className="flex gap-1.5 flex-wrap">
              {ALL_MARKETS.map((m) => {
                const on = value.scope.markets?.includes(m) ?? false
                return (
                  <Button
                    key={m} type="button" size="sm"
                    variant={on ? 'default' : 'outline'}
                    className={cn(
                      'h-7 px-2 text-[10px] font-mono',
                      on ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'border-quant',
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
            <Switch checked={value.scope.exclude_st} onCheckedChange={(v) => setScope({ exclude_st: v })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">排除停牌</Label>
            <Switch checked={value.scope.exclude_suspended} onCheckedChange={(v) => setScope({ exclude_suspended: v })} />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">排除代码 (逗号分隔)</Label>
          <Input
            className="h-8 font-mono text-xs" placeholder="如 688001.SH,300001.SZ"
            value={(value.scope.exclude_codes || []).join(',')}
            onChange={(e) => setScope({
              exclude_codes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
            })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">仅包含代码 (逗号分隔, 留空=不限)</Label>
          <Input
            className="h-8 font-mono text-xs" placeholder="如 600519.SH,000001.SZ"
            value={(value.scope.include_only || []).join(',')}
            onChange={(e) => setScope({
              include_only: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
            })}
          />
        </div>
      </div>

      <Separator />

      {/* Alerts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Alerts 引用 ({value.alerts.length})</Label>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs border-quant" onClick={addAlert}>
            <Plus className="size-3" />添加 alert
          </Button>
        </div>
        {value.alerts.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-3 border border-dashed border-quant rounded">
            暂无 alert 引用，点击&quot;添加 alert&quot;创建
          </div>
        )}
        <div className="space-y-2">
          {value.alerts.map((a, i) => (
            <div key={i} className="rounded-md border border-quant bg-quant-card/30 p-2 space-y-2">
              <div className="flex items-center gap-2">
                {alertTemplates && alertTemplates.length > 0 ? (
                  <Select
                    value={a.alert_type}
                    onValueChange={(v) => {
                      const tpl = alertTemplates.find((t) => t.alert_type === v)
                      const patch: Partial<MatchAlertDTO> = { alert_type: v }
                      if (tpl && tpl.default_params && Object.keys(tpl.default_params).length > 0 && (!a.params || Object.keys(a.params).length === 0)) {
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
                        <SelectItem key={t.alert_type} value={t.alert_type} className="text-xs font-mono">
                          <span className="mr-1">{t.emoji}</span>
                          {t.alert_type} — {t.label}
                        </SelectItem>
                      ))}
                      {a.alert_type && !alertTemplates.some((t) => t.alert_type === a.alert_type) && (
                        <SelectItem value={a.alert_type} className="text-xs font-mono">
                          ⚠ {a.alert_type} (未在模板列表)
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                ) : alertTemplatesLoading ? (
                  <div className="h-7 flex-1 flex items-center gap-1.5 px-2 rounded-md border border-quant text-[10px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />正在加载 alert 模板...
                  </div>
                ) : (
                  <Input
                    className="h-7 text-xs font-mono flex-1"
                    placeholder="alert_type (如 rzq_ignite)"
                    value={a.alert_type}
                    onChange={(e) => setAlert(i, { alert_type: e.target.value })}
                  />
                )}
                <Select
                  value={a.priority}
                  onValueChange={(v) => setAlert(i, { priority: v as MatchPriority })}
                >
                  <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">{PRIORITY_LABEL[p]} ({p})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button" size="sm" variant="ghost"
                  className="h-7 px-2 text-xs hover:bg-red-500/10 hover:text-red-500"
                  onClick={() => removeAlert(i)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>

              {a.alert_type && alertTemplates && alertTemplates.some((t) => t.alert_type === a.alert_type) && (
                <div className="text-[10px] text-muted-foreground leading-relaxed pl-1">
                  {(() => {
                    const t = alertTemplates.find((x) => x.alert_type === a.alert_type)
                    if (!t) return null
                    return (
                      <>
                        <span className="text-foreground/70">{t.description}</span>
                        {t.condition && (
                          <span className="ml-2 font-mono text-foreground/50">条件: {t.condition}</span>
                        )}
                        {t.default_params && Object.keys(t.default_params).length > 0 && (
                          <span className="ml-2 font-mono text-foreground/50">
                            默认参数: {Object.entries(t.default_params).map(([k, v]) => `${k}=${v}`).join(', ')}
                          </span>
                        )}
                      </>
                    )
                  })()}
                </div>
              )}

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground mr-1">通道:</span>
                {ALL_CHANNELS.map((ch) => {
                  const on = a.channels?.includes(ch) ?? false
                  return (
                    <Button
                      key={ch} type="button" size="sm"
                      variant={on ? 'default' : 'outline'}
                      className={cn(
                        'h-6 px-2 text-[10px] font-mono',
                        on ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'border-quant',
                      )}
                      onClick={() => toggleChannel(i, ch, !on)}
                    >
                      {ch}
                    </Button>
                  )
                })}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">参数覆盖 (params):</span>
                  <Button
                    type="button" size="sm" variant="ghost"
                    className="h-5 px-1.5 text-[10px]"
                    onClick={() => addParamKey(i)}
                  >
                    <Plus className="size-2.5" />加参数
                  </Button>
                </div>
                {Object.keys(a.params || {}).length === 0 ? (
                  <div className="text-[10px] text-muted-foreground italic">无参数（用模板默认值）</div>
                ) : (
                  <div className="space-y-1">
                    {Object.entries(a.params).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-1">
                        <span className="text-[10px] font-mono text-foreground/80 w-32 truncate">{k}</span>
                        <Input
                          className="h-6 text-xs font-mono flex-1" type="number" step="any"
                          value={String(v)}
                          onChange={(e) => setParam(i, k, e.target.value)}
                        />
                        <Button
                          type="button" size="sm" variant="ghost"
                          className="h-6 px-1.5 hover:bg-red-500/10 hover:text-red-500"
                          onClick={() => removeParam(i, k)}
                        >×</Button>
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
// 复制表单
// ============================================================================

export interface CopyFormProps {
  value: CopyDialogState
  onChange: (patch: Partial<CopyDialogState>) => void
  existingIds: string[]
}

export function CopyForm({ value, onChange, existingIds }: CopyFormProps) {
  const trimmedId = value.newId.trim()
  const idTaken = trimmedId.length > 0 && existingIds.includes(trimmedId) && trimmedId !== value.source?.match_id
  const idInvalid = trimmedId.length > 0 && !isValidMatchId(trimmedId)
  const idIsDefault = trimmedId === '_default'
  return (
    <div className="space-y-3">
      {value.source && (
        <div className="text-xs rounded-md border border-quant bg-quant-card/30 p-2 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">源策略:</span>
            <span className="font-mono text-foreground/80">{value.source.match_id}</span>
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
      <div className="space-y-1">
        <Label className="text-xs">新 match_id *</Label>
        <Input
          className="h-8 font-mono text-xs" value={value.newId}
          onChange={(e) => onChange({ newId: e.target.value })}
          placeholder="如 my_match_v2" autoFocus
        />
        <p className="text-[10px] text-muted-foreground">全局唯一；只能含字母、数字、下划线</p>
        {idInvalid && (
          <p className="text-[10px] text-red-500 flex items-center gap-1">
            <AlertCircle className="size-3" />match_id 只能含字母、数字、下划线
          </p>
        )}
        {idIsDefault && (
          <p className="text-[10px] text-red-500 flex items-center gap-1">
            <AlertCircle className="size-3" />_default 是系统保留 ID，不可使用
          </p>
        )}
        {idTaken && !idIsDefault && (
          <p className="text-[10px] text-red-500 flex items-center gap-1">
            <AlertCircle className="size-3" />该 ID 已存在，请换一个
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-xs">显示名 *</Label>
        <Input
          className="h-8 text-xs" value={value.newName}
          onChange={(e) => onChange({ newName: e.target.value })}
          placeholder="如 弱转强默认监控 副本"
        />
      </div>
      <Separator />
      <div className="space-y-2">
        <label className="flex items-start gap-2 cursor-pointer select-none" htmlFor="copy-enable">
          <Checkbox
            id="copy-enable" checked={value.enableCopy}
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
        <label className="flex items-start gap-2 cursor-pointer select-none" htmlFor="copy-alerts">
          <Checkbox
            id="copy-alerts" checked={value.copyAlerts}
            onCheckedChange={(v) => onChange({ copyAlerts: v === true })}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <div className="text-xs font-medium">复制 alerts 配置（默认勾选）</div>
            <div className="text-[10px] text-muted-foreground">
              取消勾选则创建一个无 alert 的空壳策略，之后可在编辑页单独配置。
            </div>
          </div>
        </label>
      </div>
    </div>
  )
}
