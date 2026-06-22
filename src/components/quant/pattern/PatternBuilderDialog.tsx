'use client'

/**
 * PatternBuilderDialog — 形态预警构建器主弹窗
 *
 * 三种模式:
 *   1. 创建(空白): 从 DEFAULT_SNAP + 空 condition 起步
 *   2. 克隆: 从预设 PatternMeta 克隆(改 alert_type/label 后另存为自定义)
 *   3. 编辑: 加载已有 CustomPattern 修改后保存
 *
 * 布局: 左侧表单(基础信息 + 条件 + 参数 + 风险 + 快照) + 右侧实时预览 sticky
 *
 * 保存逻辑:
 *   - 校验 alert_type(英文/下划线/数字) / label / condition
 *   - 从 condition 提取 {param} 与 defaultParams 对齐
 *   - deriveKeyVars(condition) 自动生成 keyVars
 *   - 调 onSaved 回调, 由父组件写 localStorage
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
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sparkles,
  Save,
  Loader2,
  Wand2,
  Eye,
  Code2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  PATTERN_EMOJIS,
  DEFAULT_SNAP,
  evalCondition,
  extractParams,
  deriveKeyVars,
  genPatternId,
  type CustomPattern,
} from './builder'
import { PATTERN_LIST, type PatternMeta, type PatternSnap } from './shared'
import { ConditionEditor } from './ConditionEditor'

// ============================================================================
// Props + Draft 类型
// ============================================================================

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 编辑模式: 传入已有自定义形态; 创建/克隆模式传 null */
  initial: CustomPattern | null
  /** 克隆源: 从预设形态克隆(优先级高于 initial) */
  cloneFrom?: PatternMeta | null
  onSaved: (p: CustomPattern) => void
}

interface Draft {
  alert_type: string
  label: string
  emoji: string
  scenario: string
  description: string
  condition: string
  defaultParams: Record<string, number>
  presetSnap: PatternSnap
  risk: 'high' | 'medium'
  advice: string
}

// ============================================================================
// 工具函数
// ============================================================================

const ALERT_TYPE_RE = /^[a-z_][a-z_0-9]*$/i

function emptyDraft(): Draft {
  return {
    alert_type: '',
    label: '',
    emoji: '🎯',
    scenario: '',
    description: '',
    condition: '',
    defaultParams: {},
    presetSnap: { ...DEFAULT_SNAP },
    risk: 'medium',
    advice: '',
  }
}

function presetMetaToDraft(meta: PatternMeta): Draft {
  return {
    alert_type: '',
    label: meta.label + ' (副本)',
    emoji: meta.emoji,
    scenario: meta.scenario,
    description: meta.description,
    condition: meta.condition,
    defaultParams: { ...meta.defaultParams },
    presetSnap: { ...meta.presetSnap },
    risk: meta.risk,
    advice: meta.advice,
  }
}

function customToDraft(c: CustomPattern): Draft {
  return {
    alert_type: c.alert_type,
    label: c.label,
    emoji: c.emoji,
    scenario: c.scenario,
    description: c.description,
    condition: c.condition,
    defaultParams: { ...c.defaultParams },
    presetSnap: { ...c.presetSnap },
    risk: c.risk,
    advice: c.advice,
  }
}

// ============================================================================
// 主组件
// ============================================================================

export function PatternBuilderDialog({
  open,
  onOpenChange,
  initial,
  cloneFrom,
  onSaved,
}: Props) {
  const [draft, setDraft] = React.useState<Draft>(emptyDraft())
  const [saving, setSaving] = React.useState(false)

  // open 时初始化 draft
  React.useEffect(() => {
    if (!open) return
    if (cloneFrom) {
      setDraft(presetMetaToDraft(cloneFrom))
    } else if (initial) {
      setDraft(customToDraft(initial))
    } else {
      setDraft(emptyDraft())
    }
  }, [open, initial, cloneFrom])

  // 实时求值(右侧预览用)
  const evalResult = React.useMemo(
    () => evalCondition(draft.condition, draft.defaultParams, draft.presetSnap),
    [draft.condition, draft.defaultParams, draft.presetSnap],
  )

  // 从 condition 提取的参数名(用于参数区显示)
  const paramNames = React.useMemo(
    () => extractParams(draft.condition),
    [draft.condition],
  )

  // 自动补全 defaultParams(条件里新出现的 {param} 补默认 0, 删除的移除)
  React.useEffect(() => {
    setDraft((prev) => {
      const next: Record<string, number> = {}
      for (const p of paramNames) {
        next[p] = prev.defaultParams[p] ?? 0
      }
      // 如果完全一致不更新, 避免死循环
      const same =
        Object.keys(next).length === Object.keys(prev.defaultParams).length &&
        Object.keys(next).every((k) => next[k] === prev.defaultParams[k])
      return same ? prev : { ...prev, defaultParams: next }
    })
  }, [paramNames])

  // ============================================================================
  // 字段更新
  // ============================================================================

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const updateSnap = (key: keyof PatternSnap, value: string) => {
    setDraft((prev) => {
      const next = { ...prev.presetSnap }
      if (key === 'code' || key === 'name') {
        ;(next[key] as string) = value
      } else {
        ;(next[key] as number) = value === '' ? 0 : Number(value)
      }
      return { ...prev, presetSnap: next }
    })
  }

  const updateParam = (name: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      defaultParams: {
        ...prev.defaultParams,
        [name]: value === '' ? 0 : Number(value),
      },
    }))
  }

  // ============================================================================
  // 保存
  // ============================================================================

  const handleSave = () => {
    // 校验
    if (!draft.label.trim()) {
      toast.error('请填写形态名称')
      return
    }
    if (!draft.alert_type.trim()) {
      toast.error('请填写 alert_type 标识符')
      return
    }
    if (!ALERT_TYPE_RE.test(draft.alert_type)) {
      toast.error('alert_type 只能包含字母/数字/下划线, 且不能以数字开头')
      return
    }
    if (!draft.condition.trim()) {
      toast.error('请填写 condition 表达式')
      return
    }
    if (evalResult.error) {
      toast.error('condition 求值错误: ' + evalResult.error)
      return
    }

    setSaving(true)
    try {
      const now = Date.now()
      const custom: CustomPattern =
        initial && !cloneFrom
          ? {
              ...draft,
              custom: true,
              id: initial.id,
              alert_type: draft.alert_type,
              createdAt: initial.createdAt,
              updatedAt: now,
              keyVars: deriveKeyVars(draft.condition),
            }
          : {
              ...draft,
              custom: true,
              id: genPatternId(),
              alert_type: draft.alert_type,
              createdAt: now,
              updatedAt: now,
              keyVars: deriveKeyVars(draft.condition),
            }

      // 检查 alert_type 冲突(预设形态 + 已有自定义)
      const presetConflict = PATTERN_LIST.some((p) => p.alert_type === custom.alert_type)
      if (presetConflict) {
        toast.error(`alert_type "${custom.alert_type}" 与预设形态冲突, 请改名`)
        setSaving(false)
        return
      }

      onSaved(custom)
      onOpenChange(false)
      toast.success(
        initial && !cloneFrom ? '自定义形态已更新' : '自定义形态已创建',
        { description: `${custom.emoji} ${custom.label} (${custom.alert_type})` },
      )
    } catch (e) {
      toast.error('保存失败: ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ============================================================================
  // 快照字段配置
  // ============================================================================

  const SNAP_FIELDS: Array<{ key: keyof PatternSnap; label: string; unit?: string }> = [
    { key: 'code', label: '代码' },
    { key: 'name', label: '名称' },
    { key: 'ZAF', label: '涨跌幅', unit: '%' },
    { key: 'OpenZAF', label: '开盘涨跌', unit: '%' },
    { key: 'Wtb', label: '量比' },
    { key: 'Zjl', label: '主力净流', unit: '万' },
    { key: 'HisHigh', label: '前高', unit: '元' },
    { key: 'HisLow', label: '前低', unit: '元' },
    { key: 'MA5Value', label: 'MA5', unit: '元' },
    { key: 'Now', label: '现价', unit: '元' },
    { key: 'Volume', label: '成交量' },
    { key: 'Amount', label: '成交额' },
  ]

  const modeLabel = cloneFrom
    ? '克隆预设形态'
    : initial
      ? '编辑自定义形态'
      : '创建自定义形态'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-4 text-amber-400" />
            形态预警构建器 · {modeLabel}
          </DialogTitle>
          <DialogDescription>
            可视化拼装 condition 表达式, 实时本地求值试跑, 保存后与预设形态一起展示管理。自定义形态仅本地持久化(localStorage)。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3">
          {/* ===== 左侧: 表单 ===== */}
          <ScrollArea className="pr-3 max-h-[68vh]">
            <div className="space-y-3">
              {/* 基础信息 */}
              <Card className="bg-quant-card border-quant p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="size-3 text-amber-400" />
                  <span className="text-[10px] font-medium text-amber-400">基础信息</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">形态名称 *</Label>
                    <Input
                      value={draft.label}
                      onChange={(e) => update('label', e.target.value)}
                      placeholder="如: 量价齐升"
                      className="h-8 text-xs border-quant"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      alert_type * <span className="text-muted-foreground/60">(英文标识符)</span>
                    </Label>
                    <Input
                      value={draft.alert_type}
                      onChange={(e) => update('alert_type', e.target.value.toLowerCase())}
                      placeholder="如: vol_price_rise"
                      className="h-8 text-xs font-mono border-quant"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">一句话场景</Label>
                  <Input
                    value={draft.scenario}
                    onChange={(e) => update('scenario', e.target.value)}
                    placeholder="如: 放量上涨, 量价配合健康"
                    className="h-8 text-xs border-quant"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">详细说明</Label>
                  <Textarea
                    value={draft.description}
                    onChange={(e) => update('description', e.target.value)}
                    placeholder="详细描述形态逻辑、触发条件、市场含义..."
                    className="text-xs min-h-[48px] border-quant resize-y"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">建议操作</Label>
                  <Input
                    value={draft.advice}
                    onChange={(e) => update('advice', e.target.value)}
                    placeholder="如: 关注, 可轻仓跟进"
                    className="h-8 text-xs border-quant"
                  />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Label className="text-[10px] text-muted-foreground">emoji:</Label>
                  <div className="flex items-center gap-1 flex-wrap max-h-20 overflow-y-auto quant-scroll">
                    {PATTERN_EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => update('emoji', e)}
                        className={cn(
                          'size-7 rounded text-base flex items-center justify-center border transition-colors',
                          draft.emoji === e
                            ? 'border-amber-500 bg-amber-500/15'
                            : 'border-quant hover:bg-muted/40',
                        )}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground">风险等级:</Label>
                  <div className="flex items-center gap-1">
                    {(['high', 'medium'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => update('risk', r)}
                        className={cn(
                          'px-2 py-0.5 rounded text-[10px] border transition-colors',
                          draft.risk === r
                            ? r === 'high'
                              ? 'border-red-500/40 bg-red-500/15 text-red-400'
                              : 'border-amber-500/40 bg-amber-500/15 text-amber-400'
                            : 'border-quant text-muted-foreground hover:bg-muted/40',
                        )}
                      >
                        {r === 'high' ? '高风险' : '中风险'}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>

              {/* 条件编辑器 */}
              <Card className="bg-quant-card border-quant p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Code2 className="size-3 text-amber-400" />
                  <span className="text-[10px] font-medium text-amber-400">条件表达式</span>
                </div>
                <ConditionEditor
                  condition={draft.condition}
                  onChange={(c) => update('condition', c)}
                  snap={draft.presetSnap}
                  params={draft.defaultParams}
                />
              </Card>

              {/* 参数区 */}
              {paramNames.length > 0 && (
                <Card className="bg-quant-card border-quant p-3">
                  <div className="text-[10px] font-medium text-amber-400 mb-2">
                    默认参数 (从 condition 提取)
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {paramNames.map((p) => (
                      <div key={p} className="space-y-0.5">
                        <Label className="text-[10px] font-mono text-muted-foreground">{p}</Label>
                        <Input
                          type="number"
                          step="any"
                          value={draft.defaultParams[p] ?? 0}
                          onChange={(e) => updateParam(p, e.target.value)}
                          className="h-7 text-xs font-mono border-quant"
                        />
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* 试跑快照 */}
              <Card className="bg-quant-card border-quant p-3">
                <div className="text-[10px] font-medium text-amber-400 mb-2">
                  试跑快照 (用于实时预览 + 卡片"模拟试跑")
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {SNAP_FIELDS.map((f) => (
                    <div key={f.key} className="space-y-0.5">
                      <Label className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                        {f.label}
                        {f.unit && <span className="text-[8px] text-muted-foreground/60">({f.unit})</span>}
                      </Label>
                      <Input
                        type={f.key === 'code' || f.key === 'name' ? 'text' : 'number'}
                        step="any"
                        value={draft.presetSnap[f.key] as string | number}
                        onChange={(e) => updateSnap(f.key, e.target.value)}
                        className="h-7 text-xs border-quant"
                      />
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </ScrollArea>

          {/* ===== 右侧: 实时预览 sticky ===== */}
          <div className="hidden lg:block">
            <Card
              className={cn(
                'sticky top-0 p-3 border h-full overflow-y-auto quant-scroll max-h-[68vh]',
                evalResult.error
                  ? 'bg-red-500/5 border-red-500/20'
                  : evalResult.hit
                    ? 'bg-amber-500/10 border-amber-500/30'
                    : 'bg-quant-card border-quant',
              )}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <Eye className="size-3 text-amber-400" />
                <span className="text-[10px] font-medium text-amber-400">实时预览</span>
              </div>

              {/* 卡片预览 */}
              <div className="mb-2 p-2 rounded-md bg-background/60 border border-quant/40">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-base">{draft.emoji || '?'}</span>
                  <span className="text-xs font-semibold truncate">
                    {draft.label || '(未命名)'}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground line-clamp-2">
                  {draft.scenario || '(未填写场景)'}
                </div>
              </div>

              {/* resolved 表达式 */}
              <div className="mb-2">
                <div className="text-[9px] text-muted-foreground mb-0.5">替换参数后:</div>
                <pre className="text-[10px] font-mono text-amber-400/90 bg-amber-500/5 border border-amber-500/20 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-24">
                  {evalResult.resolvedExpr || '(空)'}
                </pre>
              </div>

              {/* 派生变量 */}
              <div className="mb-2">
                <div className="text-[9px] text-muted-foreground mb-1">派生变量:</div>
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(evalResult.vars).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-1 text-[10px]">
                      <code className="font-mono text-muted-foreground truncate">{k}</code>
                      <span
                        className={cn(
                          'font-mono tabular-nums',
                          v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted-foreground',
                        )}
                      >
                        {v.toFixed(3)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 求值结果 */}
              <div className="pt-2 border-t border-quant/40">
                <div className="flex items-center gap-1.5">
                  {evalResult.error ? (
                    <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-400 border-red-500/30">
                      求值错误
                    </Badge>
                  ) : evalResult.hit ? (
                    <Badge variant="outline" className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/30">
                      命中 ✓
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] border-quant text-muted-foreground">
                      未命中
                    </Badge>
                  )}
                </div>
                {evalResult.error && (
                  <div className="text-[9px] text-red-400 mt-1 break-all font-mono">{evalResult.error}</div>
                )}
              </div>

              {/* 参数列表 */}
              {paramNames.length > 0 && (
                <div className="mt-2 pt-2 border-t border-quant/40">
                  <div className="text-[9px] text-muted-foreground mb-1">参数:</div>
                  <div className="flex flex-wrap gap-1">
                    {paramNames.map((p) => (
                      <Badge key={p} variant="outline" className="text-[9px] font-mono border-quant">
                        {p}={draft.defaultParams[p] ?? 0}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8"
          >
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="h-8 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {initial && !cloneFrom ? '保存修改' : '创建形态'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
