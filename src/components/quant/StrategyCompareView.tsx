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
 *   - 策略重叠数 Top5 (被多策略选中的股票) + "重叠 Top5 详细" Dialog (因子分解)
 *   - 每策略选股数对比 (柱状)
 *
 * 操作:
 *   - 导出对比 (CSV): 当前矩阵的扁平化 CSV
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Columns3, Trophy, TrendingUp, Download, FileText, Layers, X } from 'lucide-react'
import type { StrategyDTO, SelectionRowDTO } from '@/lib/api'
import type { StockAggRow } from './types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Props {
  topStocks: StockAggRow[]
  strategyCols: StrategyDTO[]
  matrix: Map<string, Map<string, number>>
  /** 原始选股结果行 (用于 Top5 详细 Dialog 显示因子分解) */
  rows?: SelectionRowDTO[]
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

// CSV cell escape
function csvCell(v: string | number | undefined | null): string {
  const s = v === undefined || v === null ? '' : String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function StrategyCompareView({ topStocks, strategyCols, matrix, rows }: Props) {
  const [top5DetailOpen, setTop5DetailOpen] = React.useState(false)
  const [exporting, setExporting] = React.useState<'csv' | null>(null)

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

  // CSV 导出: 当前矩阵的扁平化 (含表头)
  const handleExportCSV = async () => {
    setExporting('csv')
    try {
      // 表头: 股票代码,股票名称,最高分,被选次数,<各策略名>
      const header = [
        '股票代码',
        '股票名称',
        '最高分',
        '被选次数',
        ...strategyCols.map((s) => `${s.strategy_emoji || ''}${s.strategy_name}`),
      ]
      const lines: string[] = [header.map(csvCell).join(',')]
      // 按 best_score 降序
      const sorted = [...topStocks].sort((a, b) => b.best_score - a.best_score)
      for (const stock of sorted) {
        const rowMap = matrix.get(stock.stock_code)
        const cells: (string | number)[] = [
          stock.stock_code,
          stock.stock_name || '',
          stock.best_score.toFixed(2),
          stock.strategy_count,
        ]
        for (const s of strategyCols) {
          const v = rowMap?.get(s.strategy_id)
          cells.push(v !== undefined ? v.toFixed(2) : '')
        }
        lines.push(cells.map(csvCell).join(','))
      }
      const csv = '\ufeff' + lines.join('\n')
      const blob = new Blob([csv], { type: 'text/csv; charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      a.download = `strategy_compare_${dateStr}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${sorted.length} 只 × ${strategyCols.length} 策略 对比矩阵 (CSV)`)
    } catch (e) {
      toast.error('导出失败', { description: (e as Error).message })
    } finally {
      setExporting(null)
    }
  }

  // 构建 Top5 详细 Dialog 数据 (按 stock × strategy 展开因子)
  const top5Detail = overlapTop5.map((stock) => {
    const items = strategyCols
      .map((s) => {
        const r =
          rows?.find(
            (x) => x.stock_code === stock.stock_code && x.strategy_id === s.strategy_id
          ) || null
        return { strategy: s, score: matrix.get(stock.stock_code)?.get(s.strategy_id), row: r }
      })
      .filter((x) => x.row || x.score !== undefined)
    return { stock, items }
  })

  return (
    <div className="space-y-3">
      {/* 顶部统计区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 重叠 Top5 */}
        <Card className="p-3 gap-0 bg-quant-card border-quant">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="size-4 text-amber-400" />
            <span className="font-semibold text-sm">多策略重叠 Top 5</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-6 px-2 text-[10px] hover:bg-amber-500/10 hover:text-amber-400"
              onClick={() => setTop5DetailOpen(true)}
              disabled={top5Detail.every((d) => d.items.length === 0)}
              title="查看 Top5 各策略因子得分分解"
            >
              <Layers className="size-3" />
              重叠 Top5 详细
            </Button>
            <Badge variant="outline" className="text-[10px] border-quant">
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
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-[10px] text-muted-foreground">
              颜色越深 = 得分越高
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs border-quant hover:border-[var(--quant-primary)]/40 hover:bg-amber-500/10 hover:text-amber-400"
                  disabled={!!exporting}
                >
                  <Download className={`size-3 ${exporting ? 'animate-pulse' : ''}`} />
                  {exporting ? '导出中' : '导出对比'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  选择导出格式
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={handleExportCSV}
                >
                  <FileText className="size-4 text-amber-400" />
                  <div className="flex flex-col">
                    <span className="text-sm">CSV</span>
                    <span className="text-[10px] text-muted-foreground">
                      矩阵扁平化 (按最高分降序)
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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

      {/* Top5 详细因子分解 Dialog */}
      <Dialog open={top5DetailOpen} onOpenChange={setTop5DetailOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="size-5 text-amber-400" />
              重叠 Top5 详细因子分解
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7"
                onClick={() => setTop5DetailOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </DialogTitle>
            <DialogDescription>
              每只 Top5 股票在各策略下的因子得分明细 · 数据来自最近一次选股结果
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 quant-scroll pr-1">
            {top5Detail.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                暂无因子分解数据
              </div>
            ) : (
              top5Detail.map(({ stock, items }, idx) => (
                <Card key={stock.stock_code} className="p-3 gap-2 bg-quant-card/60 border-quant">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        'flex items-center justify-center size-6 rounded-full text-[10px] font-bold tabular-nums shrink-0',
                        idx === 0
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : idx === 1
                          ? 'bg-slate-400/20 text-slate-300 border border-slate-400/30'
                          : idx === 2
                          ? 'bg-orange-700/20 text-orange-400 border border-orange-700/30'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {idx + 1}
                    </div>
                    <span className="font-mono text-xs">{stock.stock_code}</span>
                    <span className="text-sm font-medium">{stock.stock_name}</span>
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px] font-mono border-amber-500/30 bg-amber-500/10 text-amber-400"
                    >
                      {stock.strategy_count} 策略 · 最高 {stock.best_score.toFixed(1)}
                    </Badge>
                  </div>

                  {items.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2 text-center">
                      该股票无详细因子数据 (可能来自历史快照)
                    </div>
                  ) : (
                    items.map(({ strategy, score, row }) => (
                      <div
                        key={strategy.strategy_id}
                        className="rounded-md border border-quant/60 bg-background/40 p-2"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm">{strategy.strategy_emoji}</span>
                          <span className="text-xs font-medium">{strategy.strategy_name}</span>
                          {score !== undefined && (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-mono ml-auto"
                              style={{
                                color: scoreColor(score),
                                borderColor: `color-mix(in srgb, ${scoreColor(score)} 30%, transparent)`,
                                backgroundColor: `color-mix(in srgb, ${scoreColor(score)} 10%, transparent)`,
                              }}
                            >
                              得分 {score.toFixed(2)}
                            </Badge>
                          )}
                          {row && (
                            <Badge variant="outline" className="text-[10px] font-mono border-quant">
                              排名 #{row.rank}
                            </Badge>
                          )}
                        </div>
                        {row && row.factors.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                            {row.factors.map((f) => {
                              const v = f.value
                              const tone =
                                v >= 70
                                  ? 'var(--quant-up)'
                                  : v >= 40
                                  ? '#f59e0b'
                                  : 'var(--quant-down)'
                              return (
                                <div
                                  key={f.factor_id}
                                  className="flex items-center gap-1.5 px-1.5 py-1 rounded border border-quant/40 bg-background/60 text-[11px]"
                                >
                                  <span className="font-mono text-muted-foreground truncate flex-1">
                                    {f.factor_id}
                                  </span>
                                  <span className="text-[9px] text-muted-foreground tabular-nums">
                                    w{f.weight.toFixed(2)}
                                  </span>
                                  <span
                                    className="font-mono tabular-nums font-semibold"
                                    style={{ color: tone }}
                                  >
                                    {f.value.toFixed(2)}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground py-1 text-center">
                            无因子得分明细
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
