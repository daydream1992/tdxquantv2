'use client'

/**
 * RealtimeStream — 流式选股滚动列表
 *
 * 每一轮快照显示为一个 Card,顶部最新,带:
 *   - 轮次编号 + 触发时间 + 耗时
 *   - NEW / 涨分 / 跌分 数量徽章
 *   - 策略成功率
 *   - 折叠的股票列表(默认展开最新一轮)
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDown, Sparkles, TrendingUp, TrendingDown, AlertCircle, Radar } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScoreBadge } from '../ScoreBadge'
import {
  formatClock,
  formatDuration,
  type RoundSnapshot,
} from './shared'

interface Props {
  rounds: RoundSnapshot[]
  /** 当前展开的 round id (默认展开最新一轮) */
  expandedId: string | null
  onExpand: (id: string | null) => void
}

export function RealtimeStream({ rounds, expandedId, onExpand }: Props) {
  if (rounds.length === 0) {
    return (
      <Card className="bg-quant-card border-quant p-8 flex flex-col items-center justify-center gap-2 text-center">
        <div className="flex items-center justify-center size-12 rounded-full bg-amber-500/10">
          <Radar className="size-6 text-amber-400" />
        </div>
        <div className="text-sm font-medium text-foreground">尚未启动实时选股</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          点击上方"启动实时选股"按钮,系统会按所选间隔自动调用全部启用策略,
          并把每一轮的选股结果流式推送到这里。
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-2 max-h-[36rem] overflow-y-auto quant-scroll pr-1">
      {rounds.map((r) => {
        const isOpen = expandedId === r.id || (expandedId === null && r === rounds[0])
        return (
          <Card
            key={r.id}
            className={cn(
              'bg-quant-card border-quant p-0 overflow-hidden transition-shadow',
              isOpen && 'shadow-lg shadow-amber-500/5'
            )}
          >
            {/* 头部:轮次信息 + 统计徽章 + 折叠按钮 */}
            <Collapsible open={isOpen} onOpenChange={(o) => onExpand(o ? r.id : null)}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-amber-500/5 transition-colors text-left">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex items-center justify-center size-7 rounded-md bg-amber-500/10 shrink-0">
                      <span className="text-xs font-bold text-amber-400">#{r.roundNo}</span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="font-mono text-muted-foreground tabular-nums">
                          {formatClock(r.triggeredAt)}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">
                          · {formatDuration(r.durationMs)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>策略 {r.strategyOk}/{r.strategyTotal}</span>
                        <span>·</span>
                        <span>{r.rows.length} 只</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {r.error ? (
                      <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-400 gap-1">
                        <AlertCircle className="size-2.5" />
                        错误
                      </Badge>
                    ) : (
                      <>
                        {r.newCount > 0 && (
                          <Badge className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 gap-0.5">
                            <Sparkles className="size-2.5" />
                            NEW {r.newCount}
                          </Badge>
                        )}
                        {r.upCount > 0 && (
                          <Badge className="text-[10px] bg-[var(--quant-up)]/15 text-up border border-[var(--quant-up)]/30 gap-0.5">
                            <TrendingUp className="size-2.5" />
                            {r.upCount}
                          </Badge>
                        )}
                        {r.downCount > 0 && (
                          <Badge className="text-[10px] bg-[var(--quant-down)]/15 text-down border border-[var(--quant-down)]/30 gap-0.5">
                            <TrendingDown className="size-2.5" />
                            {r.downCount}
                          </Badge>
                        )}
                      </>
                    )}
                    <ChevronDown
                      className={cn(
                        'size-4 text-muted-foreground transition-transform',
                        isOpen && 'rotate-180'
                      )}
                    />
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-quant/50 p-2">
                  {r.error ? (
                    <div className="px-2 py-3 text-xs text-red-400 flex items-start gap-1.5">
                      <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                      <div>
                        <div className="font-medium">本轮执行失败</div>
                        <div className="text-[10px] text-muted-foreground font-mono break-all mt-0.5">
                          {r.error}
                        </div>
                      </div>
                    </div>
                  ) : r.rows.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                      本轮无入选股票
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                      {r.rows.slice(0, 30).map((row) => (
                        <StockChip key={`${row.run_id}-${row.stock_code}`} row={row} />
                      ))}
                      {r.rows.length > 30 && (
                        <div className="col-span-full text-center text-[10px] text-muted-foreground py-1">
                          还有 {r.rows.length - 30} 只,导出 CSV 查看完整列表
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        )
      })}
    </div>
  )
}

import type { SelectionRowDTO } from '@/lib/api'

function StockChip({ row }: { row: SelectionRowDTO }) {
  return (
    <div className="rounded-md border border-quant/60 bg-background/40 px-2 py-1.5 hover:bg-background/70 transition-colors flex items-center justify-between gap-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-foreground/80 truncate">
            {row.stock_code}
          </span>
          <span className="text-[11px] text-muted-foreground truncate">{row.stock_name}</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <Badge variant="outline" className="text-[9px] border-quant px-1 py-0 h-3.5 font-mono">
            {row.strategy_name}
          </Badge>
          <span className="text-[9px] text-muted-foreground tabular-nums">#{row.rank}</span>
        </div>
      </div>
      <ScoreBadge score={row.score} size="sm" />
    </div>
  )
}
