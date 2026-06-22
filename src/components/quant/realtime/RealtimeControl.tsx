'use client'

/**
 * RealtimeControl — 实时选股控制栏 + 状态条
 *
 * 职责:
 *   - 启停按钮(主操作)
 *   - 间隔选择(15s/30s/60s/2min)
 *   - 涨分阈值选择(0.02/0.05/0.10)
 *   - 一键清空流
 *   - 状态指标:累计轮数/累计选股/NEW/上次执行/倒计时进度条
 */

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Play, Pause, Trash2, Loader2, Radar, Timer, Activity, Sparkles, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  INTERVAL_OPTIONS,
  THRESHOLD_OPTIONS,
  formatClock,
  formatDuration,
  type RealtimeState,
} from './shared'

interface Props {
  state: RealtimeState
  lastRoundDurationMs: number | null
  onToggleRun: () => void
  onIntervalChange: (sec: number) => void
  onThresholdChange: (v: number) => void
  onClear: () => void
}

export function RealtimeControl({
  state,
  lastRoundDurationMs,
  onToggleRun,
  onIntervalChange,
  onThresholdChange,
  onClear,
}: Props) {
  const pct = state.running
    ? Math.max(0, Math.min(100, ((state.intervalSec - state.nextRunIn) / state.intervalSec) * 100))
    : 0

  return (
    <div className="space-y-3">
      {/* 第一行:操作 + 配置 */}
      <div className="flex flex-wrap items-end gap-3">
        {/* 启停按钮 */}
        <Button
          size="sm"
          variant={state.running ? 'default' : 'outline'}
          className={cn(
            'h-9 gap-1.5',
            state.running
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300'
              : 'border-quant'
          )}
          onClick={onToggleRun}
        >
          {state.ticking ? (
            <Loader2 className="size-4 animate-spin" />
          ) : state.running ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
          <span>{state.ticking ? '执行中...' : state.running ? '暂停' : '启动实时选股'}</span>
        </Button>

        {/* 间隔 */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <Timer className="size-3" /> 间隔
          </Label>
          <ToggleGroup
            type="single"
            value={String(state.intervalSec)}
            onValueChange={(v) => v && onIntervalChange(Number(v))}
            className="rounded-md border border-quant bg-transparent h-9"
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                value={String(opt.value)}
                className="h-8 px-3 text-xs data-[state=on]:bg-amber-500/15 data-[state=on]:text-amber-400"
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* 阈值 */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingUp className="size-3" /> 涨分阈值
          </Label>
          <Select
            value={String(state.threshold)}
            onValueChange={(v) => onThresholdChange(Number(v))}
          >
            <SelectTrigger className="h-9 w-28 border-quant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THRESHOLD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  ≥ {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 清空 */}
        <Button
          size="sm"
          variant="ghost"
          className="h-9 ml-auto text-muted-foreground hover:text-foreground"
          onClick={onClear}
          title="清空累计数据"
        >
          <Trash2 className="size-3.5" />
          清空
        </Button>
      </div>

      {/* 第二行:状态指标 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        <StatTile
          icon={<Radar className="size-3.5" />}
          label="累计轮数"
          value={String(state.totalRounds)}
          tone="primary"
        />
        <StatTile
          icon={<Activity className="size-3.5" />}
          label="累计选股"
          value={String(state.totalRows)}
        />
        <StatTile
          icon={<Sparkles className="size-3.5" />}
          label="NEW"
          value={String(state.totalNew)}
          tone="amber"
        />
        <StatTile
          icon={<Timer className="size-3.5" />}
          label="上次耗时"
          value={lastRoundDurationMs ? formatDuration(lastRoundDurationMs) : '--'}
        />
        <StatTile
          icon={<Activity className="size-3.5" />}
          label="上次执行"
          value={state.lastRunAt ? formatClock(state.lastRunAt) : '--'}
          mono
        />
        <StatTile
          icon={<Timer className="size-3.5" />}
          label="下次执行"
          value={state.running ? `${state.nextRunIn}s 后` : '已停止'}
          tone={state.running ? 'up' : 'muted'}
          mono
        />
      </div>

      {/* 倒计时进度条 */}
      <div className="relative h-1.5 rounded-full bg-muted/30 overflow-hidden">
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
            state.running
              ? 'bg-gradient-to-r from-amber-500/60 to-amber-400'
              : 'bg-muted/40'
          )}
          style={{ width: `${state.running ? pct : 0}%` }}
        />
        {state.running && state.ticking && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-mono text-amber-400/80">执行中…</span>
          </div>
        )}
      </div>
    </div>
  )
}

interface StatTileProps {
  icon: React.ReactNode
  label: string
  value: string
  tone?: 'default' | 'primary' | 'amber' | 'up' | 'muted'
  mono?: boolean
}

function StatTile({ icon, label, value, tone = 'default', mono }: StatTileProps) {
  const valueColor =
    tone === 'primary'
      ? 'text-quant-primary'
      : tone === 'amber'
      ? 'text-amber-400'
      : tone === 'up'
      ? 'text-up'
      : tone === 'muted'
      ? 'text-muted-foreground'
      : 'text-foreground'
  return (
    <div className="rounded-md border border-quant bg-quant-card/60 px-3 py-2 flex flex-col gap-0.5">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn('text-sm font-semibold tabular-nums', valueColor, mono && 'font-mono')}>
        {value}
      </div>
    </div>
  )
}

/** 用于在控制栏右上角额外显示的 Badge(可选) */
export function RunningBadge({ running }: { running: boolean }) {
  if (running) {
    return (
      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 gap-1">
        <span className="inline-block size-1.5 rounded-full bg-amber-400 status-pulse" />
        实时选股中
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-quant text-muted-foreground gap-1">
      <span className="inline-block size-1.5 rounded-full bg-muted-foreground/60" />
      已停止
    </Badge>
  )
}
