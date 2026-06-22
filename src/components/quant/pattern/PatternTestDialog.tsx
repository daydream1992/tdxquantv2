'use client'

/**
 * PatternTestDialog — 形态试跑弹窗
 *
 * 用户可调整 PatternSnap 各字段 → 调 matchStrategyAPI.test('pattern_alerts', snap)
 * → 显示 7 个形态的命中结果(命中/未命中/错误)
 *
 * 派生变量实时计算展示: last_vs_high_pct / last_vs_low_pct / last_vs_open_pct / open_pct
 */

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Loader2, Play, CheckCircle2, XCircle, AlertCircle, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { matchStrategyAPI, type MatchTestHitDTO } from '@/lib/api'
import { PATTERN_LIST, type PatternMeta, type PatternSnap } from './shared'
import { evalCondition } from './builder'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 初始 meta(决定初始预设);不传则用第一个 */
  initialMeta?: PatternMeta | null
}

const SNAP_FIELDS: Array<{ key: keyof PatternSnap; label: string; unit?: string; desc: string }> = [
  { key: 'code', label: '股票代码', desc: '测试用代码' },
  { key: 'name', label: '股票名称', desc: '显示用' },
  { key: 'ZAF', label: '当前涨跌幅', unit: '%', desc: '如 3.21 表示 +3.21%' },
  { key: 'OpenZAF', label: '开盘涨跌幅', unit: '%', desc: '如 -2.8 表示 -2.8%' },
  { key: 'Wtb', label: '量比', desc: '1=正常,<1=缩量,>1.5=放量' },
  { key: 'Zjl', label: '主力净流入', unit: '万', desc: '正=流入,负=流出' },
  { key: 'HisHigh', label: '历史最高价', unit: '元', desc: '用于算 last_vs_high_pct' },
  { key: 'HisLow', label: '历史最低价', unit: '元', desc: '用于算 last_vs_low_pct' },
  { key: 'MA5Value', label: '5日均价', unit: '元', desc: 'MA5' },
  { key: 'Now', label: '现价', unit: '元', desc: '当前价' },
  { key: 'Volume', label: '成交量', desc: '股' },
  { key: 'Amount', label: '成交额', desc: '元' },
]

export function PatternTestDialog({ open, onOpenChange, initialMeta }: Props) {
  const [snap, setSnap] = React.useState<PatternSnap>(initialMeta?.presetSnap ?? PATTERN_LIST[0].presetSnap)
  const [loading, setLoading] = React.useState(false)
  const [hits, setHits] = React.useState<MatchTestHitDTO[] | null>(null)

  // 切换 meta 时重置 snap
  React.useEffect(() => {
    if (open && initialMeta) {
      setSnap(initialMeta.presetSnap)
      setHits(null)
    }
  }, [open, initialMeta])

  // 派生变量实时计算
  const derived = React.useMemo(() => {
    const last = snap.Now || 0
    const hisHigh = snap.HisHigh || 0
    const hisLow = snap.HisLow || 0
    const zaf = snap.ZAF || 0
    const openZaf = snap.OpenZAF || 0
    return {
      pct_change: zaf / 100,
      open_pct: openZaf / 100,
      volume_ratio: snap.Wtb || 0,
      main_inflow: snap.Zjl || 0,
      last_vs_high_pct: hisHigh > 0 ? (hisHigh - last) / hisHigh : 0,
      last_vs_low_pct: hisLow > 0 ? (last - hisLow) / hisLow : 0,
      last_vs_open_pct: (zaf - openZaf) / 100,
    }
  }, [snap])

  const handleRun = async () => {
    setLoading(true)
    setHits(null)
    try {
      // 自定义形态: 前端本地求值(后端不认识自定义 alert_type)
      if (initialMeta?.custom) {
        const r = evalCondition(initialMeta.condition, initialMeta.defaultParams, snap)
        setHits([
          {
            alert_type: initialMeta.alert_type,
            condition: r.resolvedExpr,
            hit: r.hit,
            error: r.error,
            priority: initialMeta.risk,
          },
        ])
        return
      }
      // 预设形态: 调后端套餐试跑
      const body = { ...snap } as Record<string, unknown>
      const r = await matchStrategyAPI.test('pattern_alerts', body as never)
      setHits(r.hits || [])
    } catch (e) {
      setHits([
        {
          alert_type: '_error',
          condition: '',
          hit: false,
          error: (e as Error).message,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    if (initialMeta) {
      setSnap(initialMeta.presetSnap)
      setHits(null)
    }
  }

  const handleFieldChange = (key: keyof PatternSnap, value: string) => {
    setSnap((prev) => {
      const next = { ...prev }
      if (key === 'code' || key === 'name') {
        ;(next[key] as string) = value
      } else {
        ;(next[key] as number) = value === '' ? 0 : Number(value)
      }
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="size-4 text-amber-400" />
            形态预警试跑 · {initialMeta?.label || ''}
            {initialMeta?.custom && (
              <Badge variant="outline" className="text-[9px] font-mono border-amber-500/40 text-amber-400 bg-amber-500/10">
                自定义 · 本地求值
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {initialMeta?.custom
              ? '自定义形态走前端本地求值(后端不认识自定义 alert_type)。调整快照参数,实时查看命中结果。'
              : '调整快照参数,实时查看派生变量与 7 类形态命中结果。套餐 ID: '}
            {!initialMeta?.custom && (
              <code className="font-mono text-amber-400">pattern_alerts</code>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto quant-scroll space-y-3 pr-1">
          {/* 派生变量实时展示 */}
          <Card className="bg-amber-500/5 border-amber-500/20 p-3">
            <div className="text-[10px] text-amber-400 font-medium mb-1.5">派生变量(实时计算)</div>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {Object.entries(derived).map(([k, v]) => (
                <div key={k} className="text-center">
                  <div className="text-[9px] text-muted-foreground font-mono truncate">{k}</div>
                  <div
                    className={cn(
                      'text-xs font-mono tabular-nums',
                      v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted-foreground'
                    )}
                  >
                    {v.toFixed(4)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* 快照字段表单 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {SNAP_FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  {f.label}
                  {f.unit && <span className="text-[9px] text-muted-foreground/60">({f.unit})</span>}
                </Label>
                <Input
                  type={f.key === 'code' || f.key === 'name' ? 'text' : 'number'}
                  step="any"
                  value={snap[f.key] as string | number}
                  onChange={(e) => handleFieldChange(f.key, e.target.value)}
                  className="h-7 text-xs border-quant"
                />
                <div className="text-[9px] text-muted-foreground/60 truncate">{f.desc}</div>
              </div>
            ))}
          </div>

          {/* 命中结果 */}
          {hits !== null && (
            <Card className="bg-quant-card border-quant p-3">
              <div className="text-[10px] text-muted-foreground font-medium mb-2">
                命中结果({hits.length} 条)
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto quant-scroll">
                {hits.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-3">
                    无命中(套餐未启用或所有形态条件均不满足)
                  </div>
                ) : (
                  hits.map((h, i) => {
                    const meta =
                      PATTERN_LIST.find((p) => p.alert_type === h.alert_type) ||
                      (initialMeta?.alert_type === h.alert_type ? initialMeta : undefined)
                    return (
                      <div
                        key={i}
                        className={cn(
                          'flex items-start gap-2 p-2 rounded-md border',
                          h.hit
                            ? 'bg-amber-500/10 border-amber-500/30'
                            : h.error
                            ? 'bg-red-500/5 border-red-500/20'
                            : 'bg-background/40 border-quant/40'
                        )}
                      >
                        <div className="shrink-0 mt-0.5">
                          {h.hit ? (
                            <CheckCircle2 className="size-4 text-amber-400" />
                          ) : h.error ? (
                            <AlertCircle className="size-4 text-red-400" />
                          ) : (
                            <XCircle className="size-3.5 text-muted-foreground/50" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {meta && <span className="text-sm">{meta.emoji}</span>}
                            <span className="text-xs font-medium">
                              {meta?.label || h.alert_type}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[9px] font-mono',
                                h.hit
                                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                  : 'border-quant text-muted-foreground'
                              )}
                            >
                              {h.hit ? '命中' : '未命中'}
                            </Badge>
                            {h.priority && (
                              <Badge variant="outline" className="text-[9px] font-mono border-quant">
                                {h.priority}
                              </Badge>
                            )}
                          </div>
                          {h.error ? (
                            <div className="text-[10px] text-red-400 mt-0.5 font-mono break-all">
                              {h.error}
                            </div>
                          ) : (
                            <pre className="text-[9px] font-mono text-muted-foreground mt-0.5 whitespace-pre-wrap break-all">
                              {h.condition}
                            </pre>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </Card>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-8 text-muted-foreground"
          >
            <RotateCcw className="size-3.5" />
            重置预设
          </Button>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={loading}
            className="h-8 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {initialMeta?.custom ? '试跑自定义形态' : '试跑 7 类形态'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
