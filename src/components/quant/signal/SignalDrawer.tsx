'use client'

/**
 * SignalDrawer — 信号详情抽屉 (R7-A)
 *
 * Sheet 抽屉显示信号完整详情: 类型/时间/策略/股票/推送状态/严重度/通道/内容/
 * snapshot JSON 树形展示。底部含"重新推送"和"复制 JSON"按钮。
 *
 * 内部含两个 helper 组件: InfoCell (信息单元) + JsonNode (JSON 树形节点)。
 */

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  RefreshCw, Copy, Loader2, Braces, Hash, Radio,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { type SignalDTO, type StrategyDTO } from '@/lib/api'
import { TYPE_META, PUSH_STATUS_META } from './shared'

export interface SignalDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  signal: SignalDTO | null
  loading: boolean
  error: string | null
  strategies: StrategyDTO[]
  repushing: boolean
  onRepush: (signal: SignalDTO) => void
}

export function SignalDrawer({
  open, onOpenChange, signal, loading, error, strategies, repushing, onRepush,
}: SignalDrawerProps) {
  // R7-A: 复制 snapshot JSON 到剪贴板
  const handleCopyJson = React.useCallback(async () => {
    if (!signal?.snapshot) {
      toast.warning('当前信号无 snapshot JSON')
      return
    }
    try {
      const text = JSON.stringify(signal.snapshot, null, 2)
      await navigator.clipboard.writeText(text)
      toast.success('已复制 snapshot JSON', { description: `${text.length} 字符` })
    } catch (e) {
      toast.error('复制失败', { description: (e as Error).message })
    }
  }, [signal])

  if (!signal) return null

  const typeMeta = TYPE_META[signal.type] || TYPE_META.system
  const TypeIcon = typeMeta.icon
  const statusMeta = PUSH_STATUS_META[signal.push_status] || PUSH_STATUS_META.pending
  const StatusIcon = statusMeta.icon
  const strategy = strategies.find((x) => x.strategy_id === signal.strategy_id)
  const strategyEmoji = signal.strategy_name ? strategy?.strategy_emoji || '📊' : ''
  const severityLabel: Record<string, string> = { info: '信息', warn: '警告', error: '错误' }
  const severityColor: Record<string, string> = {
    info: 'var(--quant-flat)', warn: 'var(--quant-primary)', error: 'var(--quant-up)',
  }
  const severity = signal.severity || 'info'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg bg-quant-card border-quant p-0 gap-0 overflow-y-auto quant-scroll"
      >
        {/* 顶部: 类型 + 时间 + 策略 */}
        <SheetHeader className="p-4 border-b border-quant gap-2">
          <div className="flex items-center gap-2">
            <span
              className="text-xs px-2 py-0.5 rounded inline-flex items-center gap-1 border"
              style={{
                color: typeMeta.color,
                backgroundColor: `color-mix(in srgb, ${typeMeta.color} 10%, transparent)`,
                borderColor: `color-mix(in srgb, ${typeMeta.color} 30%, transparent)`,
              }}
            >
              <TypeIcon className="size-3" />
              {typeMeta.label}
            </span>
            <SheetTitle className="text-sm font-mono text-muted-foreground">
              {new Date(signal.time).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </SheetTitle>
          </div>
          <SheetDescription className="flex items-center gap-2 text-sm text-foreground/90">
            {strategyEmoji && <span className="text-lg" aria-hidden>{strategyEmoji}</span>}
            <span className="font-medium">
              {signal.strategy_name || signal.strategy_id || '系统信号'}
            </span>
          </SheetDescription>
        </SheetHeader>

        {/* 加载中 */}
        {loading && (
          <div className="p-4 flex items-center justify-center text-muted-foreground text-sm border-b border-quant">
            <Loader2 className="size-4 mr-2 animate-spin text-quant-primary" />
            正在加载完整详情...
          </div>
        )}

        {/* 错误提示 */}
        {error && !loading && (
          <div className="p-4 border-b border-quant bg-rose-500/5 text-rose-400 text-xs">
            加载详情失败: {error} (显示行内已有信息)
          </div>
        )}

        {/* 基本信息 */}
        <section className="p-4 border-b border-quant space-y-2">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Hash className="size-3" />
            基本信息
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <InfoCell label="信号 ID" value={signal.id} mono />
            <InfoCell label="股票代码" value={signal.stock_code || '—'} mono />
            <InfoCell label="股票名称" value={signal.stock_name || '—'} />
            <InfoCell label="策略 ID" value={signal.strategy_id || '—'} mono />
            <InfoCell
              label="推送状态"
              value={
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border"
                  style={{
                    color: statusMeta.color,
                    backgroundColor: `color-mix(in srgb, ${statusMeta.color} 10%, transparent)`,
                    borderColor: `color-mix(in srgb, ${statusMeta.color} 30%, transparent)`,
                  }}
                >
                  <StatusIcon className="size-3" />
                  {statusMeta.label}
                </span>
              }
            />
            <InfoCell
              label="严重度"
              value={
                <span
                  className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border"
                  style={{
                    color: severityColor[severity] || 'var(--quant-flat)',
                    backgroundColor: `color-mix(in srgb, ${severityColor[severity] || 'var(--quant-flat)'} 10%, transparent)`,
                    borderColor: `color-mix(in srgb, ${severityColor[severity] || 'var(--quant-flat)'} 30%, transparent)`,
                  }}
                >
                  {severityLabel[severity] || severity}
                </span>
              }
            />
          </div>
        </section>

        {/* 推送通道 */}
        <section className="p-4 border-b border-quant space-y-2">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Radio className="size-3" />
            推送通道 ({signal.pushed_channels.length})
          </div>
          {signal.pushed_channels.length === 0 ? (
            <div className="text-xs text-muted-foreground">—</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {signal.pushed_channels.map((ch) => {
                const meta = CHANNEL_BADGE_META_DRAWER[ch] || { color: 'var(--quant-flat)', label: ch }
                return (
                  <span
                    key={ch}
                    className="text-[11px] px-2 py-0.5 rounded border font-medium"
                    style={{
                      color: meta.color,
                      backgroundColor: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
                      borderColor: `color-mix(in srgb, ${meta.color} 30%, transparent)`,
                    }}
                    title={ch}
                  >
                    {meta.label}
                  </span>
                )
              })}
            </div>
          )}
        </section>

        {/* 信号内容 */}
        <section className="p-4 border-b border-quant space-y-2">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <TypeIcon className="size-3" />
            信号内容
          </div>
          <div className="rounded-md bg-quant-bg/50 border border-quant/60 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
            {signal.content || '(空)'}
          </div>
        </section>

        {/* Snapshot JSON 树形展示 */}
        <section className="p-4 border-b border-quant space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Braces className="size-3" />
              Snapshot JSON
            </div>
            <Button
              variant="ghost" size="sm"
              className="h-7 px-2 text-xs hover:bg-amber-500/10 hover:text-amber-400"
              onClick={handleCopyJson}
              disabled={!signal.snapshot}
              title="复制 JSON 到剪贴板"
            >
              <Copy className="size-3" />
              复制 JSON
            </Button>
          </div>
          {!signal.snapshot ? (
            <div className="rounded-md bg-quant-bg/50 border border-quant/60 p-3 text-xs text-muted-foreground">
              {loading ? '加载中...' : '该信号无 snapshot 数据'}
            </div>
          ) : (
            <div className="rounded-md bg-quant-bg/80 border border-quant p-3 max-h-80 overflow-y-auto quant-scroll">
              <pre className="text-[11px] font-mono leading-relaxed">
                <JsonNode value={signal.snapshot} depth={0} isLast />
              </pre>
            </div>
          )}
        </section>

        {/* 底部操作 */}
        <div className="p-4 border-t border-quant flex flex-wrap items-center gap-2 sticky bottom-0 bg-quant-card">
          <Button
            variant="default" size="sm"
            className="h-8 gap-1.5 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300"
            onClick={() => onRepush(signal)}
            disabled={repushing}
            title="重新推送到所有启用通道"
          >
            <RefreshCw className={cn('size-3.5', repushing && 'animate-spin')} />
            {repushing ? '推送中...' : '重新推送'}
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-8 gap-1.5 border-quant"
            onClick={handleCopyJson}
            disabled={!signal.snapshot}
            title="复制 JSON 到剪贴板"
          >
            <Copy className="size-3.5" />
            <span className="hidden sm:inline">复制 JSON</span>
          </Button>
          <Button
            variant="ghost" size="sm"
            className="h-8 ml-auto text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            关闭
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ============================================================================
// 工具: 信息单元 / JSON 树
// ============================================================================

const CHANNEL_BADGE_META_DRAWER: Record<string, { color: string; label: string }> = {
  csv_log: { color: 'var(--quant-flat)', label: 'CSV' },
  websocket: { color: '#06b6d4', label: 'WS' },
  tdx_warn: { color: '#a855f7', label: 'TDX' },
  feishu: { color: 'var(--quant-down)', label: '飞书' },
  email: { color: '#f59e0b', label: '邮件' },
}

function InfoCell({
  label, value, mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="rounded-md bg-quant-bg/40 border border-quant/50 px-2 py-1.5">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div
        className={cn('text-xs truncate', mono && 'font-mono tabular-nums')}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * JSON 树形节点 (递归渲染)
 * - key: 琥珀色 var(--quant-primary)
 * - string: 绿色 var(--quant-down)
 * - number: 蓝色 #38bdf8
 * - boolean: 紫色 #c084fc
 * - null: 灰色 var(--quant-flat)
 * - object/array: 递归, 缩进 2 空格
 */
function JsonNode({
  value, depth, isLast, keyName,
}: {
  value: unknown
  depth: number
  isLast: boolean
  keyName?: string
}) {
  const indent = '  '.repeat(depth)
  const comma = isLast ? '' : ','

  if (value === null) {
    return (
      <div>
        {keyName && <span style={{ color: 'var(--quant-primary)' }}>&quot;{keyName}&quot;: </span>}
        <span style={{ color: 'var(--quant-flat)' }}>null</span>
        <span>{comma}</span>
      </div>
    )
  }

  if (typeof value === 'boolean') {
    return (
      <div>
        {keyName && <span style={{ color: 'var(--quant-primary)' }}>&quot;{keyName}&quot;: </span>}
        <span style={{ color: '#c084fc' }}>{String(value)}</span>
        <span>{comma}</span>
      </div>
    )
  }

  if (typeof value === 'number') {
    return (
      <div>
        {keyName && <span style={{ color: 'var(--quant-primary)' }}>&quot;{keyName}&quot;: </span>}
        <span style={{ color: '#38bdf8' }}>{String(value)}</span>
        <span>{comma}</span>
      </div>
    )
  }

  if (typeof value === 'string') {
    const display = value.length > 200 ? value.slice(0, 200) + '…' : value
    return (
      <div>
        {keyName && <span style={{ color: 'var(--quant-primary)' }}>&quot;{keyName}&quot;: </span>}
        <span style={{ color: 'var(--quant-down)' }}>&quot;{display}&quot;</span>
        <span>{comma}</span>
      </div>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div>
          {keyName && <span style={{ color: 'var(--quant-primary)' }}>&quot;{keyName}&quot;: </span>}
          <span>[]</span>
          <span>{comma}</span>
        </div>
      )
    }
    return (
      <div>
        {keyName && <span style={{ color: 'var(--quant-primary)' }}>&quot;{keyName}&quot;: </span>}
        <span>[</span>
        {value.map((v, i) => (
          <div key={i} style={{ paddingLeft: '1rem' }}>
            <JsonNode value={v} depth={depth + 1} isLast={i === value.length - 1} />
          </div>
        ))}
        <span>{indent}]</span>
        <span>{comma}</span>
      </div>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      return (
        <div>
          {keyName && <span style={{ color: 'var(--quant-primary)' }}>&quot;{keyName}&quot;: </span>}
          <span>{'{}'}</span>
          <span>{comma}</span>
        </div>
      )
    }
    return (
      <div>
        {keyName && <span style={{ color: 'var(--quant-primary)' }}>&quot;{keyName}&quot;: </span>}
        <span>{'{'}</span>
        {entries.map(([k, v], i) => (
          <div key={k} style={{ paddingLeft: '1rem' }}>
            <JsonNode value={v} depth={depth + 1} isLast={i === entries.length - 1} keyName={k} />
          </div>
        ))}
        <span>{indent}{'}'}</span>
        <span>{comma}</span>
      </div>
    )
  }

  // fallback (function / undefined / symbol)
  return (
    <div>
      {keyName && <span style={{ color: 'var(--quant-primary)' }}>&quot;{keyName}&quot;: </span>}
      <span style={{ color: 'var(--quant-flat)' }}>{String(value)}</span>
      <span>{comma}</span>
    </div>
  )
}
