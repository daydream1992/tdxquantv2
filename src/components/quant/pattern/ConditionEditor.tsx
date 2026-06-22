'use client'

/**
 * ConditionEditor — 形态预警条件编辑器
 *
 * 三段式布局:
 *   1. 变量速查面板(白名单变量, 点击插入到 textarea 光标处)
 *   2. textarea 编辑 condition(支持 {param} 占位符)
 *   3. 实时校验 + 求值预览(用 snap + params 本地求值)
 *
 * 特性:
 *   - 点击变量按钮插入到 textarea 光标位置(非追加)
 *   - 实时显示派生变量值(从 snap 计算)
 *   - 实时显示求值结果(hit / error / resolved expr)
 *   - 参数占位符提示(从 condition 提取 {param})
 */

import * as React from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Variable,
  Calculator,
  Code2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  VARIABLE_WHITELIST,
  evalCondition,
  extractParams,
  type VarSpec,
} from './builder'
import type { PatternSnap } from './shared'

interface Props {
  condition: string
  onChange: (c: string) => void
  snap: PatternSnap
  params: Record<string, number>
}

export function ConditionEditor({ condition, onChange, snap, params }: Props) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // 实时求值
  const evalResult = React.useMemo(
    () => evalCondition(condition, params, snap),
    [condition, params, snap],
  )

  // 提取参数占位符
  const paramNames = React.useMemo(() => extractParams(condition), [condition])

  /** 插入文本到 textarea 光标位置 */
  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current
    if (!ta) {
      onChange(condition + text)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = condition.slice(0, start) + text + condition.slice(end)
    onChange(next)
    // 恢复光标位置(在插入文本之后)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = start + text.length
        textareaRef.current.selectionStart = pos
        textareaRef.current.selectionEnd = pos
        textareaRef.current.focus()
      }
    })
  }

  /** 插入变量名 */
  const insertVar = (v: VarSpec) => insertAtCursor(v.name)

  /** 插入运算符 */
  const insertOp = (op: string) => insertAtCursor(` ${op} `)

  /** 插入参数占位符 */
  const insertParam = () => {
    const name = window.prompt('参数名(英文, 如 pct_threshold):', 'pct_threshold')
    if (name && /^[a-z_][a-z_0-9]*$/i.test(name)) {
      insertAtCursor(`{${name}}`)
    } else if (name) {
      // 非法, 提示
      window.alert('参数名只能包含字母/数字/下划线, 且不能以数字开头')
    }
  }

  return (
    <div className="space-y-2">
      {/* 变量速查面板 */}
      <Card className="bg-quant-card border-quant p-2.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Variable className="size-3 text-amber-400" />
          <span className="text-[10px] font-medium text-amber-400">变量速查(点击插入)</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {VARIABLE_WHITELIST.map((v) => (
            <button
              key={v.name}
              type="button"
              onClick={() => insertVar(v)}
              title={v.desc + (v.formula ? ` (${v.formula})` : '')}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-quant-primary/10 text-quant-primary hover:bg-quant-primary/20 transition-colors border border-quant-primary/20"
            >
              {v.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-quant/40">
          <span className="text-[10px] text-muted-foreground mr-1">运算符:</span>
          {['>', '<', '>=', '<=', '==', '!=', 'and', 'or', 'not'].map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => insertOp(op)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted/40 text-foreground/70 hover:bg-muted/60 transition-colors border border-quant"
            >
              {op}
            </button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={insertParam}
            className="h-5 px-1.5 text-[10px] text-amber-400 hover:bg-amber-500/10"
            title="插入参数占位符, 运行时用 params 替换"
          >
            {'{param}'}
          </Button>
        </div>
      </Card>

      {/* condition textarea */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Code2 className="size-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground font-medium">condition 表达式</span>
        </div>
        <Textarea
          ref={textareaRef}
          value={condition}
          onChange={(e) => onChange(e.target.value)}
          placeholder="例如: pct_change > {pct_threshold} and volume_ratio < {vol_ratio}"
          className="font-mono text-xs min-h-[80px] border-quant bg-background/50 resize-y"
          spellCheck={false}
        />
        <div className="text-[9px] text-muted-foreground/70 leading-relaxed">
          支持: 变量名 / 数字 / {'+ - * / ( ) < > = ! ,'} / and / or / not;{' '}
          {'{param}'} 为参数占位符, 试跑时用 params 值替换
        </div>
      </div>

      {/* 参数占位符提示 */}
      {paramNames.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground">检测到参数:</span>
          {paramNames.map((p) => (
            <Badge
              key={p}
              variant="outline"
              className="text-[9px] font-mono border-amber-500/30 text-amber-400"
            >
              {p} = {params[p] ?? '?'}
            </Badge>
          ))}
        </div>
      )}

      {/* 实时求值预览 */}
      <Card
        className={cn(
          'p-2.5 border',
          evalResult.error
            ? 'bg-red-500/5 border-red-500/20'
            : evalResult.hit
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-background/40 border-quant/40',
        )}
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <Calculator className="size-3 text-amber-400" />
          <span className="text-[10px] font-medium text-amber-400">实时求值(用试跑快照)</span>
        </div>

        {/* resolved 表达式 */}
        <div className="mb-1.5">
          <div className="text-[9px] text-muted-foreground mb-0.5">替换参数后:</div>
          <pre className="text-[10px] font-mono text-foreground/80 bg-background/60 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-16">
            {evalResult.resolvedExpr || '(空)'}
          </pre>
        </div>

        {/* 派生变量值 */}
        <div className="mb-1.5">
          <div className="text-[9px] text-muted-foreground mb-1">派生变量:</div>
          <div className="grid grid-cols-5 gap-1">
            {Object.entries(evalResult.vars).map(([k, v]) => (
              <div key={k} className="text-center">
                <div className="text-[8px] text-muted-foreground font-mono truncate">{k}</div>
                <div
                  className={cn(
                    'text-[10px] font-mono tabular-nums',
                    v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted-foreground',
                  )}
                >
                  {v.toFixed(3)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 求值结果 */}
        <div className="flex items-center gap-1.5 pt-1.5 border-t border-quant/40">
          {evalResult.error ? (
            <>
              <AlertCircle className="size-3.5 text-red-400" />
              <span className="text-[10px] text-red-400 font-mono break-all">{evalResult.error}</span>
            </>
          ) : evalResult.hit ? (
            <>
              <CheckCircle2 className="size-3.5 text-amber-400" />
              <span className="text-[10px] text-amber-400 font-medium">命中 ✓ (当前快照满足条件)</span>
            </>
          ) : (
            <>
              <XCircle className="size-3.5 text-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground">未命中 (当前快照不满足条件)</span>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
