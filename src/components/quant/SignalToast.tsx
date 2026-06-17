'use client'

/**
 * 信号弹窗（Toast 风格）
 * 用于实时推送信号，嵌入页面流式显示
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Bell, TrendingUp, TrendingDown, AlertTriangle, Sparkles, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SignalDTO } from '@/lib/api'

const TYPE_META: Record<
  SignalDTO['type'],
  { icon: React.ElementType; color: string; label: string; bg: string }
> = {
  limit_up: { icon: TrendingUp, color: 'var(--quant-up)', label: '涨停', bg: 'bg-[var(--quant-up)]/10' },
  drop_alert: { icon: TrendingDown, color: 'var(--quant-down)', label: '下跌', bg: 'bg-[var(--quant-down)]/10' },
  breakout: { icon: Sparkles, color: 'var(--quant-primary)', label: '突破', bg: 'bg-[var(--quant-primary)]/10' },
  selection: { icon: Bell, color: '#06b6d4', label: '选股', bg: 'bg-cyan-500/10' },
  system: { icon: Settings, color: 'var(--quant-flat)', label: '系统', bg: 'bg-muted' },
}

const STATUS_COLOR: Record<SignalDTO['push_status'], string> = {
  success: 'var(--quant-down)',
  partial: 'var(--quant-primary)',
  failed: 'var(--quant-up)',
  pending: 'var(--quant-flat)',
}

export interface SignalToastProps {
  signal: SignalDTO
  className?: string
  isNew?: boolean
}

export function SignalToast({ signal, className, isNew }: SignalToastProps) {
  const meta = TYPE_META[signal.type]
  const Icon = meta.icon
  return (
    <Card
      className={cn(
        'p-3 gap-0 bg-quant-card border-quant slide-in hover:border-[var(--quant-primary)]/30 transition-colors relative overflow-hidden',
        isNew && 'ring-1 ring-emerald-500/40 bg-emerald-500/5',
        className
      )}
    >
      {isNew && (
        <span className="absolute top-0 right-0 px-1.5 py-0.5 text-[9px] font-bold bg-emerald-500 text-white rounded-bl-md animate-pulse">
          NEW
        </span>
      )}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex items-center justify-center rounded-md size-8 shrink-0',
            meta.bg
          )}
        >
          <Icon className="size-4" style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-xs font-semibold px-1.5 py-0.5 rounded"
              style={{ color: meta.color, backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}
            >
              {meta.label}
            </span>
            {signal.strategy_name && (
              <span className="text-xs text-muted-foreground">{signal.strategy_name}</span>
            )}
            {signal.stock_code && (
              <span className="text-xs font-mono text-foreground/80">
                {signal.stock_code} {signal.stock_name}
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto tabular-nums">
              {formatTime(signal.time)}
            </span>
          </div>
          <div className="text-sm mt-1 text-foreground/90 line-clamp-2">{signal.content}</div>
          {signal.pushed_channels.length > 0 && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-muted-foreground">推送：</span>
              {signal.pushed_channels.map((ch) => (
                <span
                  key={ch}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  {ch}
                </span>
              ))}
              <span
                className="text-[10px] ml-auto flex items-center gap-1"
                style={{ color: STATUS_COLOR[signal.push_status] }}
              >
                <span
                  className="inline-block size-1.5 rounded-full"
                  style={{ backgroundColor: STATUS_COLOR[signal.push_status] }}
                />
                {signal.push_status}
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

/** 紧凑型信号条目（用于列表行） */
export function SignalRow({ signal }: { signal: SignalDTO }) {
  const meta = TYPE_META[signal.type]
  const Icon = meta.icon
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-quant hover:bg-[var(--quant-primary)]/5 transition-colors">
      <Icon className="size-4 shrink-0" style={{ color: meta.color }} />
      <span className="text-xs tabular-nums text-muted-foreground w-16 shrink-0">
        {formatTime(signal.time)}
      </span>
      <span
        className="text-xs px-1.5 py-0.5 rounded shrink-0 w-12 text-center"
        style={{ color: meta.color, backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}
      >
        {meta.label}
      </span>
      <span className="text-xs text-muted-foreground truncate w-24 shrink-0">
        {signal.strategy_name || '系统'}
      </span>
      <span className="text-xs font-mono text-foreground/80 w-28 shrink-0 truncate">
        {signal.stock_code ? `${signal.stock_code} ${signal.stock_name || ''}` : '-'}
      </span>
      <span className="text-xs flex-1 truncate">{signal.content}</span>
      <span
        className="text-[10px] w-14 text-right shrink-0"
        style={{ color: STATUS_COLOR[signal.push_status] }}
      >
        {signal.push_status}
      </span>
    </div>
  )
}

export { AlertTriangle }
