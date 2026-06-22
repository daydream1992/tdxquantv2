'use client'

/**
 * SignalFilter — 信号中心筛选栏
 *
 * 包含:
 *  - 类型 / 策略 / 起止日期 4 个下拉/输入
 *  - 推送通道多选 (AND 语义: 必须同时包含所有选中通道)
 *  - 清空筛选按钮
 *  - 右上角计数显示 (displayed/total)
 *
 * 全部状态由容器注入, 本组件无内部状态。
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Filter, X, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SignalDTO, StrategyDTO } from '@/lib/api'
import { TYPE_META, CHANNEL_BADGE_META, CHANNEL_FILTER_ORDER } from './shared'

export interface SignalFilterProps {
  typeFilter: string
  strategyFilter: string
  startDate: string
  endDate: string
  channelFilter: Set<string>
  strategies: StrategyDTO[]
  signalsCount: number
  displayedCount: number
  setTypeFilter: (v: string) => void
  setStrategyFilter: (v: string) => void
  setStartDate: (v: string) => void
  setEndDate: (v: string) => void
  setChannelFilter: (v: Set<string>) => void
}

export function SignalFilter({
  typeFilter, strategyFilter, startDate, endDate, channelFilter,
  strategies, signalsCount, displayedCount,
  setTypeFilter, setStrategyFilter, setStartDate, setEndDate, setChannelFilter,
}: SignalFilterProps) {
  const hasAnyFilter =
    typeFilter !== 'all' ||
    strategyFilter !== 'all' ||
    !!startDate ||
    !!endDate ||
    channelFilter.size > 0

  const clearAllFilters = () => {
    setTypeFilter('all')
    setStrategyFilter('all')
    setStartDate('')
    setEndDate('')
    setChannelFilter(new Set())
  }

  const toggleChannel = (ch: string) => {
    setChannelFilter((() => {
      const next = new Set(channelFilter)
      if (next.has(ch)) next.delete(ch)
      else next.add(ch)
      return next
    })())
  }

  return (
    <Card className="p-3 gap-0 bg-quant-card border-quant">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">类型</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-32 border-quant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {(Object.keys(TYPE_META) as SignalDTO['type'][]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_META[t].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">策略</Label>
          <Select value={strategyFilter} onValueChange={setStrategyFilter}>
            <SelectTrigger className="h-8 w-40 border-quant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部策略</SelectItem>
              {strategies.map((s) => (
                <SelectItem key={s.strategy_id} value={s.strategy_id}>
                  {s.strategy_emoji} {s.strategy_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">开始日期</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-8 w-36 border-quant"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">结束日期</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-8 w-36 border-quant"
          />
        </div>
        {hasAnyFilter && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10"
            onClick={clearAllFilters}
            title="清空所有筛选"
          >
            <X className="size-3" />
            清空筛选
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Filter className="size-3" />
          <span>
            共 <span className="text-quant-primary font-semibold tabular-nums">{displayedCount}</span>
            {channelFilter.size > 0 && signalsCount !== displayedCount && (
              <span className="text-muted-foreground/70"> / {signalsCount}</span>
            )} 条
          </span>
        </div>
      </div>

      {/* 推送通道筛选行 */}
      <div className="mt-3 pt-3 border-t border-quant/60">
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Radio className="size-3" />
            推送通道
          </Label>
          <button
            type="button"
            onClick={() => setChannelFilter(new Set())}
            className={cn(
              'text-[11px] px-2.5 py-1 rounded-md border transition-all',
              channelFilter.size === 0
                ? 'bg-amber-500/15 text-amber-400 border-amber-500/40 font-semibold ring-2 ring-amber-500/30'
                : 'text-muted-foreground border-quant hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30'
            )}
          >
            全部
          </button>
          {CHANNEL_FILTER_ORDER.map((ch) => {
            const meta = CHANNEL_BADGE_META[ch]
            const active = channelFilter.has(ch)
            return (
              <button
                key={ch}
                type="button"
                onClick={() => toggleChannel(ch)}
                className={cn(
                  'text-[11px] px-2.5 py-1 rounded-md border font-medium transition-all',
                  active && 'ring-2 ring-amber-500/60 ring-offset-1 ring-offset-background'
                )}
                style={{
                  color: active ? '#ffffff' : meta.color,
                  backgroundColor: active
                    ? meta.color
                    : `color-mix(in srgb, ${meta.color} 8%, transparent)`,
                  borderColor: active
                    ? meta.color
                    : `color-mix(in srgb, ${meta.color} 30%, transparent)`,
                }}
                title={`筛选推送通道: ${meta.label} (${ch})`}
              >
                {meta.label}
              </button>
            )
          })}
          {channelFilter.size > 0 && (
            <span className="ml-auto text-[11px] text-amber-400 inline-flex items-center gap-1">
              <Filter className="size-3" />
              已筛选: {CHANNEL_FILTER_ORDER.filter((ch) => channelFilter.has(ch))
                .map((ch) => CHANNEL_BADGE_META[ch].label)
                .join(' + ')}
              <span className="text-muted-foreground">
                (共 {displayedCount} 条)
              </span>
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}
