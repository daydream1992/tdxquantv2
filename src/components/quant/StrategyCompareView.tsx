'use client'

/**
 * 策略横向对比视图
 *
 * 矩阵布局：
 *   - 行 = 股票 (按被多策略选中次数排序前 30)
 *   - 列 = 策略 (启用的)
 *   - 单元格 = 该股票在该策略的得分
 *   - 颜色热力: 得分越高，背景色越深 (琥珀金渐变)
 *   - 空单元格: 灰色"—" (该策略未选这只股票)
 *
 * 顶部统计:
 *   - 策略重叠数 Top5 (被多策略选中的股票)
 *   - 每策略选股数对比 (柱状)
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Columns3, Trophy, TrendingUp } from 'lucide-react'
import type { StrategyDTO } from '@/lib/api'
import type { StockAggRow } from './types'
import { cn } from '@/lib/utils'

interface Props {
  topStocks: StockAggRow[]
  strategyCols: StrategyDTO[]
  matrix: Map<string, Map<string, number>>
}

// 得分→背景色 (热力图)
function scoreBg(score: number): string {
  if (score <= 0) return 'transparent'
  // 0~100 映射到 amber-500 透明度 0.05~0.5
  const ratio = Math.min(1, score / 100)
  const alpha = 0.05 + ratio * 0.45
  return `rgba(245, 158, 11, ${alpha})`
}

function scoreColor(score: number): string {
  if (score >= 70) return 'var(--quant-up)'
  if (score >= 40) return '#f59e0b'
  return 'var(--quant-down)'
}

export function StrategyCompareView({ topStocks, strategyCols, matrix }: Props) {
  if (topStocks.length === 0) {
    return (
      <Card className="bg-quant-card border-quant p-6">
        <div className="text-center text-sm text-muted-foreground">
          暂无比对数据：需要至少 2 个策略同时选中同一只股票
        </div>
      </Card>
    )
  }

  // 每策略选股数
  const strategyCounts = strategyCols.map((s) => {
    let cnt = 0
    for (const [, m] of matrix) {
      if (m.has(s.strategy_id)) cnt++
    }
    return { strategy: s, count: cnt }
  })
  const maxCount = Math.max(...strategyCounts.map((x) => x.count), 1)

  // 重叠 Top5
  const overlapTop5 = topStocks.slice(0, 5)

  return (
    <div className="space-y-3">
      {/* 顶部统计区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 重叠 Top5 */}
        <Card className="p-3 gap-0 bg-quant-card border-quant">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="size-4 text-amber-400" />
            <span className="font-semibold text-sm">多策略重叠 Top 5</span>
            <Badge variant="outline" className="ml-auto text-[10px] border-quant">
              强信号
            </Badge>
          </div>
          <div className="space-y-1.5">
            {overlapTop5.map((s, i) => (
              <div
                key={s.stock_code}
                className="flex items-center gap-2 p-1.5 rounded-md hover:bg-[var(--quant-primary)]/5 transition-colors"
              >
                <div
                  className={cn(
                    'flex items-center justify-center size-6 rounded-full text-[10px] font-bold tabular-nums shrink-0',
                    i === 0
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : i === 1
                      ? 'bg-slate-400/20 text-slate-300 border border-slate-400/30'
                      : i === 2
                      ? 'bg-orange-700/20 text-orange-400 border border-orange-700/30'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {i + 1}
                </div>
                <span className="font-mono text-xs text-foreground/80 w-20 truncate">
                  {s.stock_code}
                </span>
                <span className="text-xs flex-1 truncate">{s.stock_name}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] font-mono',
                    s.strategy_count >= 3
                      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      : 'border-quant'
                  )}
                >
                  {s.strategy_count} 策略
                </Badge>
                <span className="text-xs tabular-nums text-quant-primary font-semibold w-12 text-right">
                  {s.best_score.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* 策略选股数对比 */}
        <Card className="p-3 gap-0 bg-quant-card border-quant">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="size-4 text-quant-primary" />
            <span className="font-semibold text-sm">各策略选股数对比</span>
            <Badge variant="outline" className="ml-auto text-[10px] border-quant">
              重叠股票集合
            </Badge>
          </div>
          <div className="space-y-1.5">
            {strategyCounts.map(({ strategy, count }) => (
              <div key={strategy.strategy_id} className="flex items-center gap-2">
                <span className="text-xs flex items-center gap-1 w-32 shrink-0 truncate">
                  <span>{strategy.strategy_emoji}</span>
                  <span className="truncate">{strategy.strategy_name}</span>
                </span>
                <div className="flex-1 h-4 rounded-sm bg-muted/20 overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500/40 to-amber-400 transition-all duration-500"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                  <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-mono tabular-nums">
                    {count} 只
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 对比矩阵 */}
      <Card className="p-0 gap-0 bg-quant-card border-quant overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-quant">
          <div className="flex items-center gap-2">
            <Columns3 className="size-4 text-quant-primary" />
            <span className="font-semibold text-sm">策略 × 股票 对比矩阵</span>
            <Badge variant="outline" className="text-[10px] border-quant">
              {topStocks.length} 只 × {strategyCols.length} 策略
            </Badge>
          </div>
          <span className="text-[10px] text-muted-foreground">
            颜色越深 = 得分越高
          </span>
        </div>

        <div className="overflow-x-auto quant-scroll max-h-[36rem] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-quant-card z-10">
              <tr className="border-b border-quant">
                <th className="text-left p-2 sticky left-0 bg-quant-card z-20 min-w-[5rem]">
                  代码
                </th>
                <th className="text-left p-2 min-w-[5rem]">名称</th>
                <th className="text-center p-2 min-w-[3rem]">次数</th>
                {strategyCols.map((s) => (
                  <th
                    key={s.strategy_id}
                    className="text-center p-2 min-w-[5rem]"
                    title={s.strategy_name}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-sm">{s.strategy_emoji}</span>
                      <span className="text-[10px] text-muted-foreground truncate max-w-[5rem]">
                        {s.strategy_name}
                      </span>
                    </div>
                  </th>
                ))}
                <th className="text-right p-2 min-w-[4rem] sticky right-0 bg-quant-card z-20">
                  最高分
                </th>
              </tr>
            </thead>
            <tbody>
              {topStocks.map((stock) => {
                const row = matrix.get(stock.stock_code)!
                return (
                  <tr
                    key={stock.stock_code}
                    className="border-b border-quant/50 hover:bg-[var(--quant-primary)]/5 transition-colors"
                  >
                    <td className="p-2 sticky left-0 bg-quant-card z-10 font-mono text-[11px]">
                      {stock.stock_code}
                    </td>
                    <td className="p-2 truncate max-w-[5rem]">{stock.stock_name}</td>
                    <td className="p-2 text-center">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] font-mono',
                          stock.strategy_count >= 3
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                            : stock.strategy_count >= 2
                            ? 'bg-[var(--quant-up)]/10 text-up border-[var(--quant-up)]/30'
                            : 'border-quant'
                        )}
                      >
                        {stock.strategy_count}
                      </Badge>
                    </td>
                    {strategyCols.map((s) => {
                      const score = row.get(s.strategy_id)
                      return (
                        <td key={s.strategy_id} className="p-1.5 text-center">
                          {score !== undefined ? (
                            <div
                              className="rounded-sm py-1 px-1 font-mono tabular-nums text-[11px] font-semibold"
                              style={{
                                backgroundColor: scoreBg(score),
                                color: scoreColor(score),
                              }}
                              title={`${s.strategy_name}: ${score.toFixed(2)}`}
                            >
                              {score.toFixed(1)}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="p-2 text-right sticky right-0 bg-quant-card z-10">
                      <span className="font-mono tabular-nums text-quant-primary font-semibold">
                        {stock.best_score.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 图例 */}
      <Card className="p-3 bg-quant-card border-quant">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>得分图例:</span>
          <div className="flex items-center gap-1">
            <span>低</span>
            <div className="flex">
              {[0, 25, 50, 75, 100].map((s) => (
                <div
                  key={s}
                  className="size-3 border border-quant/30"
                  style={{ backgroundColor: scoreBg(s) }}
                />
              ))}
            </div>
            <span>高</span>
          </div>
          <span className="ml-4">— : 该策略未选这只股票</span>
        </div>
      </Card>
    </div>
  )
}
