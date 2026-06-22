'use client'

/**
 * BacktestForm — 回测参数表单
 *
 * 包含: 策略选择 / 开始日期 / 结束日期 / 初始资金 / 持仓数(TopN) / 持有天数 + 运行回测按钮
 * 纯展示组件, 所有状态由容器 BacktestView 持有, 通过 props 传入。
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Play, Loader2 } from 'lucide-react'
import type { StrategyDTO } from '@/lib/api'

// 默认日期: start = 今天-90天, end = 今天
export function defaultStartDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

export function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface BacktestFormProps {
  strategies: StrategyDTO[]
  strategyId: string
  startDate: string
  endDate: string
  initialCapital: string
  topN: string
  holdDays: string
  running: boolean
  onStrategyIdChange: (v: string) => void
  onStartDateChange: (v: string) => void
  onEndDateChange: (v: string) => void
  onInitialCapitalChange: (v: string) => void
  onTopNChange: (v: string) => void
  onHoldDaysChange: (v: string) => void
  onRun: () => void
}

export function BacktestForm({
  strategies,
  strategyId,
  startDate,
  endDate,
  initialCapital,
  topN,
  holdDays,
  running,
  onStrategyIdChange,
  onStartDateChange,
  onEndDateChange,
  onInitialCapitalChange,
  onTopNChange,
  onHoldDaysChange,
  onRun,
}: BacktestFormProps) {
  return (
    <Card className="p-4 gap-0 bg-quant-card border-quant">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center justify-center size-7 rounded-md bg-amber-500/15">
          <Play className="size-4 text-quant-primary" />
        </div>
        <div>
          <div className="text-sm font-semibold">回测参数</div>
          <div className="text-[11px] text-muted-foreground">
            选择策略与时间范围，模拟历史交易并计算绩效指标
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">策略</Label>
          <Select value={strategyId} onValueChange={onStrategyIdChange}>
            <SelectTrigger className="h-9 border-quant">
              <SelectValue placeholder="选择策略" />
            </SelectTrigger>
            <SelectContent>
              {strategies.map((s) => (
                <SelectItem key={s.strategy_id} value={s.strategy_id}>
                  {s.strategy_emoji} {s.strategy_name}
                  <span className="ml-1 text-[10px] text-muted-foreground font-mono">
                    ({s.strategy_id})
                  </span>
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
            onChange={(e) => onStartDateChange(e.target.value)}
            className="h-9 border-quant"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">结束日期</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="h-9 border-quant"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">初始资金 (元)</Label>
          <Input
            type="number"
            min="1000"
            step="1000"
            value={initialCapital}
            onChange={(e) => onInitialCapitalChange(e.target.value)}
            className="h-9 border-quant tabular-nums"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">持仓数 (Top N)</Label>
          <Select value={topN} onValueChange={onTopNChange}>
            <SelectTrigger className="h-9 border-quant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 只</SelectItem>
              <SelectItem value="5">5 只</SelectItem>
              <SelectItem value="10">10 只</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">持有天数</Label>
          <Select value={holdDays} onValueChange={onHoldDaysChange}>
            <SelectTrigger className="h-9 border-quant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 天</SelectItem>
              <SelectItem value="3">3 天</SelectItem>
              <SelectItem value="5">5 天</SelectItem>
              <SelectItem value="10">10 天</SelectItem>
              <SelectItem value="20">20 天</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end sm:col-span-2 lg:col-span-2">
          <Button
            className="h-9 w-full gap-2 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300"
            onClick={onRun}
            disabled={running}
          >
            {running ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                回测运行中...
              </>
            ) : (
              <>
                <Play className="size-4" />
                运行回测
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  )
}
