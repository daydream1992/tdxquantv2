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
import { Download, Filter, ChevronDown, ChevronUp } from 'lucide-react'
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

export function SelectionResults() {
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [rows, setRows] = React.useState<SelectionRowDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [strategyId, setStrategyId] = React.useState<string>('all')
  const [minScore, setMinScore] = React.useState<string>('0')
  const [startDate, setStartDate] = React.useState<string>('')
  const [endDate, setEndDate] = React.useState<string>('')
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null)

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
          <div className="ml-auto flex items-center gap-1">
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
            共 {rows.length} 条结果 · {strategies.find((s) => s.strategy_id === strategyId)?.strategy_name || '全部策略'}
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
      ) : (
        <StockTable
          columns={columns}
          data={rows}
          rowKey={(r) => `${r.run_id}-${r.stock_code}`}
          maxHeight="32rem"
          pageSize={20}
          expandedRowKey={expandedKey}
          renderExpanded={(r) => (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">因子明细</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {r.factors.map((f) => (
                  <div
                    key={f.factor_id}
                    className="rounded-md border border-quant p-2 bg-background/40"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-foreground/80">{f.factor_id}</span>
                      <Badge variant="outline" className="text-[10px] border-quant">
                        w={f.weight.toFixed(2)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-1 tabular-nums">
                      <span className="text-muted-foreground">值 {f.value.toFixed(3)}</span>
                      <span className="text-quant-primary">分 {f.score.toFixed(3)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground pt-1 flex items-center gap-1">
                {expandedKey === `${r.run_id}-${r.stock_code}` ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
                run_id: <span className="font-mono">{r.run_id}</span>
              </div>
            </div>
          )}
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
