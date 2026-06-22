'use client'

/**
 * MatchStrategyTest — 匹配策略测试弹窗
 *
 * 输入单股快照试跑 match，返回命中的 alert 列表（不实际推送）。
 */

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FlaskConical, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  matchStrategyAPI,
  type MatchStrategyDTO,
  type MatchTestHitDTO,
  type MatchPriority,
} from '@/lib/api'
import { PRIORITY_LABEL } from './shared'

export interface TestFormState {
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

const priorityVariant: Record<
  MatchPriority,
  'destructive' | 'default' | 'secondary'
> = {
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
}

export interface MatchStrategyTestProps {
  target: MatchStrategyDTO | null
  onClose: () => void
}

export function MatchStrategyTest({ target, onClose }: MatchStrategyTestProps) {
  const [form, setForm] = React.useState<TestFormState>({
    ...EMPTY_TEST_FORM,
    code: '600519.SH',
  })
  const [loading, setLoading] = React.useState(false)
  const [hits, setHits] = React.useState<MatchTestHitDTO[] | null>(null)

  React.useEffect(() => {
    if (target) {
      setForm({ ...EMPTY_TEST_FORM, code: '600519.SH' })
      setHits(null)
    }
  }, [target])

  const handleTest = async () => {
    if (!target) return
    if (!form.code.trim()) {
      toast.error('请输入股票代码')
      return
    }
    const params: Record<string, unknown> = { code: form.code.trim() }
    if (form.pct_change.trim()) params.pct_change = Number(form.pct_change)
    if (form.volume_ratio.trim()) params.volume_ratio = Number(form.volume_ratio)
    if (form.main_inflow.trim()) params.main_inflow = Number(form.main_inflow)
    if (form.auction_pct.trim()) params.auction_pct = Number(form.auction_pct)

    setLoading(true)
    setHits(null)
    try {
      const r = await matchStrategyAPI.test(
        target.match_id,
        params as Parameters<typeof matchStrategyAPI.test>[1],
      )
      setHits(r.hits || [])
      const hitCount = (r.hits || []).filter((h) => h.hit).length
      toast.success('测试完成', {
        description: `${target.match_id} · 命中 ${hitCount}/${r.hits?.length ?? 0} 条 alert`,
      })
    } catch (e) {
      toast.error('测试失败', { description: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && !loading && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="size-5 text-amber-400" />
            调参预览 · {target?.match_id}
          </DialogTitle>
          <DialogDescription>
            输入单股快照试跑 match，返回命中的 alert 列表（不实际推送）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Field
              label="股票代码 *"
              placeholder="600519.SH"
              value={form.code}
              onChange={(v) => setForm((p) => ({ ...p, code: v }))}
            />
            <Field
              label="涨跌幅 (0.04=4%)"
              type="number"
              step="0.001"
              placeholder="0.04"
              value={form.pct_change}
              onChange={(v) => setForm((p) => ({ ...p, pct_change: v }))}
            />
            <Field
              label="量比 (vol_ratio)"
              type="number"
              step="0.1"
              placeholder="1.5"
              value={form.volume_ratio}
              onChange={(v) => setForm((p) => ({ ...p, volume_ratio: v }))}
            />
            <Field
              label="主力净流入 (万)"
              type="number"
              step="100"
              placeholder="5000"
              value={form.main_inflow}
              onChange={(v) => setForm((p) => ({ ...p, main_inflow: v }))}
            />
            <Field
              label="集合竞价涨幅"
              type="number"
              step="0.001"
              placeholder="0.02"
              value={form.auction_pct}
              onChange={(v) => setForm((p) => ({ ...p, auction_pct: v }))}
            />
            <div className="flex items-end">
              <Button
                className="h-8 w-full bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
                onClick={handleTest}
                disabled={loading}
              >
                {loading ? (
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

        <div className="flex-1 overflow-hidden">
          {hits === null ? (
            <div className="text-xs text-muted-foreground text-center py-8">
              点击&quot;测试&quot;查看命中结果
            </div>
          ) : hits.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">
              该 match 无 alert 配置
            </div>
          ) : (
            <ScrollArea className="max-h-72">
              <div className="space-y-1.5 pr-2">
                {hits.map((h, i) => (
                  <div
                    key={`${h.alert_type}-${i}`}
                    className={cn(
                      'rounded-md border p-2 text-xs flex items-start gap-2',
                      h.hit
                        ? 'border-[var(--quant-up)]/30 bg-[var(--quant-up)]/5'
                        : 'border-quant bg-quant-card/30',
                    )}
                  >
                    <div className="flex flex-col gap-1 items-start shrink-0">
                      <Badge
                        variant={h.hit ? priorityVariant[h.priority || 'medium'] : 'outline'}
                        className="text-[10px]"
                      >
                        {h.hit ? '命中' : '未中'}
                      </Badge>
                      {h.priority && (
                        <Badge variant="outline" className="text-[10px] border-quant">
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
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  step?: string
}

function Field({ label, value, onChange, placeholder, type, step }: FieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        className="h-8 font-mono text-xs"
        type={type}
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
