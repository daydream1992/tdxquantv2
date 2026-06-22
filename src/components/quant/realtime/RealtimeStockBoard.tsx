'use client'

/**
 * RealtimeStockBoard — 股票去重看板
 *
 * 维护一只股票一行:
 *   - 当前最新得分 / 与上次得分 delta
 *   - 累计入选轮数 / 入选策略列表
 *   - 状态徽章 NEW / ▲涨分 / ▼跌分 / 持平 / 已出(本轮未入选)
 *
 * 排序:按"当前得分"降序,已出的沉到底
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Search, Star, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScoreBadge } from '../ScoreBadge'
import { StockTable, type Column } from '../StockTable'
import {
  badgeStyle,
  badgeLabel,
  formatClock,
  type StockBoardRow,
} from './shared'

interface Props {
  rows: StockBoardRow[]
  /** 当前轮次号(用于"已出"判定:看板里 lastRoundNo < 当前轮次的算已出) */
  currentRoundNo: number
}

export function RealtimeStockBoard({ rows, currentRoundNo }: Props) {
  const [keyword, setKeyword] = React.useState('')
  const [filter, setFilter] = React.useState<'all' | 'new' | 'up' | 'down' | 'gone'>('all')

  const filtered = React.useMemo(() => {
    let list = rows
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase()
      list = list.filter(
        (r) =>
          r.stock_code.toLowerCase().includes(k) ||
          r.stock_name.toLowerCase().includes(k) ||
          r.strategy_names.some((n) => n.toLowerCase().includes(k))
      )
    }
    if (filter !== 'all') {
      list = list.filter((r) => r.badge === filter)
    }
    // 排序:已出沉底,然后按当前得分降序
    return [...list].sort((a, b) => {
      const aGone = a.lastRoundNo < currentRoundNo ? 1 : 0
      const bGone = b.lastRoundNo < currentRoundNo ? 1 : 0
      if (aGone !== bGone) return aGone - bGone
      return b.currentScore - a.currentScore
    })
  }, [rows, keyword, filter, currentRoundNo])

  const columns: Column<StockBoardRow>[] = [
    {
      key: 'stock_code',
      header: '代码',
      width: '5.5rem',
      render: (r) => <span className="font-mono text-xs">{r.stock_code}</span>,
    },
    {
      key: 'stock_name',
      header: '名称',
      width: '6rem',
      render: (r) => <span className="text-xs">{r.stock_name}</span>,
    },
    {
      key: 'badge',
      header: '状态',
      width: '6rem',
      render: (r) => (
        <Badge variant="outline" className={cn('text-[10px] font-mono', badgeStyle(r.badge))}>
          {badgeLabel(r.badge)}
        </Badge>
      ),
    },
    {
      key: 'currentScore',
      header: '当前分',
      align: 'right',
      width: '6rem',
      render: (r) => <ScoreBadge score={r.currentScore} size="sm" />,
      sortValue: (r) => r.currentScore,
    },
    {
      key: 'delta',
      header: '变化',
      align: 'right',
      width: '5rem',
      render: (r) => {
        if (r.prevScore === null) {
          return <span className="text-[10px] text-muted-foreground">--</span>
        }
        const delta = r.currentScore - r.prevScore
        const tone =
          delta > 0
            ? 'text-up'
            : delta < 0
            ? 'text-down'
            : 'text-muted-foreground'
        const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—'
        return (
          <span className={cn('text-xs font-mono tabular-nums', tone)}>
            {arrow} {Math.abs(delta).toFixed(3)}
          </span>
        )
      },
      sortValue: (r) => (r.prevScore !== null ? r.currentScore - r.prevScore : 0),
    },
    {
      key: 'hitCount',
      header: '入选轮数',
      align: 'center',
      width: '5rem',
      render: (r) => {
        const n = r.hitCount
        const tone =
          n >= 3
            ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            : n >= 2
            ? 'bg-[var(--quant-up)]/15 text-up border-[var(--quant-up)]/30'
            : 'border-quant text-muted-foreground'
        return (
          <Badge variant="outline" className={cn('font-mono text-xs', tone)}>
            {n} 次
          </Badge>
        )
      },
      sortValue: (r) => r.hitCount,
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
      key: 'lastSeenAt',
      header: '最近入选',
      align: 'right',
      width: '6rem',
      render: (r) => (
        <span className="text-[10px] text-muted-foreground tabular-nums font-mono">
          {formatClock(r.lastSeenAt)}
        </span>
      ),
      sortValue: (r) => r.lastSeenAt,
    },
  ]

  const counts = React.useMemo(() => {
    const c = { new: 0, up: 0, down: 0, flat: 0, gone: 0 }
    for (const r of rows) c[r.badge]++
    return c
  }, [rows])

  return (
    <Card className="bg-quant-card border-quant p-3 gap-0">
      {/* 筛选栏 */}
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索代码/名称/策略"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-8 w-48 pl-7 border-quant text-xs"
          />
        </div>
        <div className="flex items-center gap-1 ml-1">
          <Filter className="size-3 text-muted-foreground" />
          {([
            ['all', '全部', rows.length],
            ['new', 'NEW', counts.new],
            ['up', '涨分', counts.up],
            ['down', '跌分', counts.down],
            ['gone', '已出', counts.gone],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'h-7 px-2 text-[11px] rounded-md border transition-colors',
                filter === key
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  : 'border-quant text-muted-foreground hover:bg-amber-500/5 hover:text-foreground'
              )}
            >
              {label} <span className="font-mono tabular-nums">({count})</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Star className="size-3" />
          <span>共 {rows.length} 只股票 · 当前第 {currentRoundNo} 轮</span>
        </div>
      </div>

      {/* 表格 */}
      <StockTable
        columns={columns}
        data={filtered}
        rowKey={(r) => r.stock_code}
        maxHeight="32rem"
        pageSize={30}
        emptyText="尚未有股票入选,启动实时选股开始积累数据"
      />
    </Card>
  )
}
