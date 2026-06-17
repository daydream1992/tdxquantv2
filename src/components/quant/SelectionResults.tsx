'use client'

/**
 * 选股结果
 * - 顶部筛选：策略选择/日期范围/最低分
 * - 表格：run_id/策略/股票/名称/得分/因子明细/时间
 * - 点击行展开因子详情
 * - 导出按钮（CSV/Excel）
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Download, Filter, ChevronDown, ChevronUp, List, Layers3, Columns3 } from 'lucide-react'
import { StockTable, type Column } from './StockTable'
import { ScoreBadge } from './ScoreBadge'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'
import { toast } from 'sonner'
import {
  selectionAPI,
  strategyAPI,
  type SelectionRowDTO,
  type StrategyDTO,
} from '@/lib/api'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { StrategyCompareView } from './StrategyCompareView'
import type { StockAggRow } from './types'

// 按股票聚合的视图类型 (从 ./types 导入, 避免循环依赖)
export type { StockAggRow }

export function SelectionResults() {
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [rows, setRows] = React.useState<SelectionRowDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [strategyId, setStrategyId] = React.useState<string>('all')
  const [minScore, setMinScore] = React.useState<string>('0')
  const [startDate, setStartDate] = React.useState<string>('')
  const [endDate, setEndDate] = React.useState<string>('')
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null)
  // 视图切换: 'detail' (明细) | 'agg' (按股票汇总) | 'compare' (策略横向对比)
  const [viewMode, setViewMode] = React.useState<'detail' | 'agg' | 'compare'>('detail')

  // 按股票聚合：同一只股票被多少策略选中
  const aggRows = React.useMemo<StockAggRow[]>(() => {
    const map = new Map<string, StockAggRow>()
    for (const r of rows) {
      const key = r.stock_code
      if (!map.has(key)) {
        map.set(key, {
          stock_code: r.stock_code,
          stock_name: r.stock_name,
          strategy_count: 0,
          strategy_ids: [],
          strategy_names: [],
          best_score: r.score,
          best_rank: r.rank,
          avg_score: 0,
          runs: [],
        })
      }
      const agg = map.get(key)!
      agg.strategy_count += 1
      agg.strategy_ids.push(r.strategy_id)
      agg.strategy_names.push(r.strategy_name || r.strategy_id)
      agg.best_score = Math.max(agg.best_score, r.score)
      agg.best_rank = Math.min(agg.best_rank, r.rank)
      agg.runs.push({
        strategy_id: r.strategy_id,
        strategy_name: r.strategy_name || r.strategy_id,
        score: r.score,
        rank: r.rank,
      })
    }
    const list = Array.from(map.values())
    for (const a of list) {
      a.avg_score = a.runs.reduce((s, x) => s + x.score, 0) / a.runs.length
      // 按得分降序排
      a.runs.sort((x, y) => y.score - x.score)
    }
    // 默认按"被选次数"降序，其次按"最高分"降序
    list.sort((a, b) => b.strategy_count - a.strategy_count || b.best_score - a.best_score)
    return list
  }, [rows])

  // 策略横向对比矩阵
  // 行 = 股票 (按被选次数排序前 30), 列 = 策略, 单元格 = 得分
  const compareMatrix = React.useMemo(() => {
    // 仅取被多策略选中的股票
    const topStocks = aggRows.filter((r) => r.strategy_count >= 2).slice(0, 30)
    const strategyCols = strategies.filter((s) => s.enabled)
    // 矩阵数据: Map<stock_code, Map<strategy_id, score>>
    const matrix = new Map<string, Map<string, number>>()
    for (const r of topStocks) {
      const m = new Map<string, number>()
      // 从 rows 中找这只股票所有策略的得分
      for (const row of rows) {
        if (row.stock_code === r.stock_code) {
          m.set(row.strategy_id, row.score)
        }
      }
      matrix.set(r.stock_code, m)
    }
    return { topStocks, strategyCols, matrix }
  }, [aggRows, strategies, rows])

  // 加载策略列表
  React.useEffect(() => {
    strategyAPI.list().then(setStrategies).catch(() => {})
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await selectionAPI.list({
        strategy_id: strategyId === 'all' ? undefined : strategyId,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        min_score: minScore ? Number(minScore) : undefined,
        limit: 200,
      })
      setRows(data)
    } catch (e) {
      toast.error('加载选股结果失败', { description: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [strategyId, minScore, startDate, endDate])

  React.useEffect(() => {
    load()
  }, [load])

  const handleExport = async (format: 'csv' | 'excel') => {
    try {
      const runId = rows[0]?.run_id || 'all'
      const blob = await selectionAPI.export(runId, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `selection_${runId}.${format === 'csv' ? 'csv' : 'xlsx'}`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${format.toUpperCase()}`)
    } catch (e) {
      toast.error('导出失败', { description: (e as Error).message })
    }
  }

  const columns: Column<SelectionRowDTO>[] = [
    {
      key: 'rank',
      header: '#',
      width: '3rem',
      render: (r) => <span className="text-muted-foreground tabular-nums text-xs">{r.rank}</span>,
      sortValue: (r) => r.rank,
    },
    {
      key: 'strategy',
      header: '策略',
      width: '8rem',
      render: (r) => (
        <Badge variant="outline" className="font-mono text-xs border-quant">
          {r.strategy_name}
        </Badge>
      ),
    },
    {
      key: 'code',
      header: '代码',
      width: '5rem',
      render: (r) => <span className="font-mono text-xs">{r.stock_code}</span>,
    },
    {
      key: 'name',
      header: '名称',
      width: '6rem',
      render: (r) => <span className="text-xs">{r.stock_name}</span>,
    },
    {
      key: 'score',
      header: '得分',
      align: 'right',
      width: '8rem',
      render: (r) => <ScoreBadge score={r.score} size="sm" />,
      sortValue: (r) => r.score,
    },
    {
      key: 'factors',
      header: '因子数',
      align: 'center',
      width: '5rem',
      render: (r) => (
        <span className="text-xs text-muted-foreground tabular-nums">{r.factors.length}</span>
      ),
    },
    {
      key: 'run_at',
      header: '选股时间',
      align: 'right',
      width: '9rem',
      render: (r) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {new Date(r.run_at).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
      sortValue: (r) => r.run_at,
    },
  ]

  // 汇总视图列定义
  const aggColumns: Column<StockAggRow>[] = [
    {
      key: 'stock_code',
      header: '代码',
      width: '6rem',
      render: (r) => <span className="font-mono text-xs">{r.stock_code}</span>,
    },
    {
      key: 'stock_name',
      header: '名称',
      width: '7rem',
      render: (r) => <span className="text-xs">{r.stock_name}</span>,
    },
    {
      key: 'strategy_count',
      header: '被选次数',
      align: 'center',
      width: '6rem',
      render: (r) => {
        const n = r.strategy_count
        // 高亮：被多策略选中 = 强信号
        const tone = n >= 3 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : n >= 2 ? 'bg-[var(--quant-up)]/15 text-up border-[var(--quant-up)]/30' : 'border-quant text-muted-foreground'
        return (
          <Badge variant="outline" className={`font-mono text-xs ${tone}`}>
            {n} 次
          </Badge>
        )
      },
      sortValue: (r) => r.strategy_count,
    },
    {
      key: 'strategies',
      header: '入选策略',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.strategy_names.map((name, i) => (
            <Badge key={i} variant="outline" className="text-[10px] border-quant font-mono">
              {name}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'best_score',
      header: '最高分',
      align: 'right',
      width: '7rem',
      render: (r) => <ScoreBadge score={r.best_score} size="sm" />,
      sortValue: (r) => r.best_score,
    },
    {
      key: 'avg_score',
      header: '平均分',
      align: 'right',
      width: '6rem',
      render: (r) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {r.avg_score.toFixed(2)}
        </span>
      ),
      sortValue: (r) => r.avg_score,
    },
  ]

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
      <Card className="p-3 gap-0 bg-quant-card border-quant">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">策略</Label>
            <Select value={strategyId} onValueChange={setStrategyId}>
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
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">最低得分</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              className="h-8 w-24 border-quant"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* 视图切换 */}
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => v && setViewMode(v as 'detail' | 'agg' | 'compare')}
              className="rounded-md border border-quant bg-transparent h-8"
            >
              <ToggleGroupItem
                value="detail"
                className="h-7 px-2 text-xs data-[state=on]:bg-amber-500/15 data-[state=on]:text-amber-400"
                title="明细视图：每行一条选股记录"
              >
                <List className="size-3.5" />
                明细
              </ToggleGroupItem>
              <ToggleGroupItem
                value="agg"
                className="h-7 px-2 text-xs data-[state=on]:bg-amber-500/15 data-[state=on]:text-amber-400"
                title="汇总视图：同一只股票被多少策略选中"
              >
                <Layers3 className="size-3.5" />
                汇总
              </ToggleGroupItem>
              <ToggleGroupItem
                value="compare"
                className="h-7 px-2 text-xs data-[state=on]:bg-amber-500/15 data-[state=on]:text-amber-400"
                title="对比视图：多策略横向对比，发现重叠机会"
              >
                <Columns3 className="size-3.5" />
                对比
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-quant"
              onClick={() => handleExport('csv')}
              disabled={rows.length === 0}
            >
              <Download className="size-3.5" />
              CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-quant"
              onClick={() => handleExport('excel')}
              disabled={rows.length === 0}
            >
              <Download className="size-3.5" />
              Excel
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          <Filter className="size-3" />
          <span>
            {viewMode === 'detail'
              ? `共 ${rows.length} 条选股记录`
              : `共 ${aggRows.length} 只股票 · ${aggRows.filter((x) => x.strategy_count >= 2).length} 只被多策略选中`}
            {' · '}
            {strategies.find((s) => s.strategy_id === strategyId)?.strategy_name || '全部策略'}
          </span>
        </div>
      </Card>

      {/* 表格 */}
      {loading ? (
        <LoadingState rows={8} />
      ) : rows.length === 0 ? (
        <Card className="bg-quant-card border-quant">
          <EmptyState
            text="暂无选股结果"
            description="尝试调整筛选条件，或在策略管理页运行策略"
          />
        </Card>
      ) : viewMode === 'compare' ? (
        /* 对比视图：策略横向对比矩阵 */
        <StrategyCompareView
          topStocks={compareMatrix.topStocks}
          strategyCols={compareMatrix.strategyCols}
          matrix={compareMatrix.matrix}
        />
      ) : viewMode === 'agg' ? (
        /* 汇总视图：按股票聚合，显示被多少策略选中 */
        <StockTable
          columns={aggColumns}
          data={aggRows}
          rowKey={(r) => r.stock_code}
          maxHeight="32rem"
          pageSize={30}
          expandedRowKey={expandedKey}
          renderExpanded={(r) => (
            <div className="p-2 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <ChevronUp className="size-3" />
                各策略得分明细 ({r.runs.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {r.runs.map((run) => (
                  <div
                    key={run.strategy_id}
                    className="rounded-md border border-quant p-2 bg-background/40 hover:bg-background/60 transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-foreground/80">{run.strategy_name}</span>
                      <Badge variant="outline" className="text-[10px] border-quant">
                        #{run.rank}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-1 tabular-nums">
                      <span className="text-muted-foreground">得分</span>
                      <span className="text-quant-primary font-semibold">{run.score.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          onRowClick={(r) =>
            setExpandedKey((prev) => (prev === r.stock_code ? null : r.stock_code))
          }
          emptyText="暂无汇总数据"
        />
      ) : (
        <StockTable
          columns={columns}
          data={rows}
          rowKey={(r) => `${r.run_id}-${r.stock_code}`}
          maxHeight="32rem"
          pageSize={20}
          expandedRowKey={expandedKey}
          renderExpanded={(r) => {
            const maxScore = Math.max(...r.factors.map((f) => Math.abs(f.score)), 0.01)
            return (
              <div className="space-y-3 p-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                    <ChevronUp className="size-3" />
                    因子明细 ({r.factors.length})
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    run_id: {r.run_id}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {r.factors.map((f) => {
                    const pct = Math.min(100, (Math.abs(f.score) / maxScore) * 100)
                    const isPositive = f.score >= 0
                    return (
                      <div
                        key={f.factor_id}
                        className="rounded-md border border-quant p-2.5 bg-background/40 hover:bg-background/60 transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono text-foreground/80">{f.factor_id}</span>
                          <Badge variant="outline" className="text-[10px] border-quant">
                            w={f.weight.toFixed(2)}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-xs mt-1 tabular-nums">
                          <span className="text-muted-foreground">值 {f.value.toFixed(3)}</span>
                          <span className={isPositive ? 'text-quant-primary' : 'text-[var(--quant-down)]'}>
                            分 {f.score.toFixed(3)}
                          </span>
                        </div>
                        {/* 因子贡献条 */}
                        <div className="mt-1.5 h-1 rounded-full bg-muted/30 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isPositive
                                ? 'bg-gradient-to-r from-amber-500/40 to-amber-400'
                                : 'bg-gradient-to-r from-emerald-500/40 to-emerald-400'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* 汇总栏 */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-quant/50">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">总分</span>
                    <span className="text-base font-bold text-quant-primary tabular-nums">
                      {r.score.toFixed(3)}
                    </span>
                    <Badge variant="outline" className="text-[10px] border-quant">
                      排名 #{r.rank}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>策略: <span className="font-mono text-foreground/70">{r.strategy_id}</span></span>
                    <span>·</span>
                    <span>代码: <span className="font-mono text-foreground/70">{r.stock_code}</span></span>
                  </div>
                </div>
              </div>
            )
          }}
          onRowClick={(r) =>
            setExpandedKey((prev) =>
              prev === `${r.run_id}-${r.stock_code}` ? null : `${r.run_id}-${r.stock_code}`
            )
          }
          emptyText="暂无选股结果"
        />
      )}
    </div>
  )
}
