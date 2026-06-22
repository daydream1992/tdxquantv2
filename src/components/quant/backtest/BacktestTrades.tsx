'use client'

/**
 * BacktestTrades — 交易明细表 + 统计指标 + 历史回测
 *
 * 包含 4 块:
 * 1. BacktestTrades (主, 容器调) — 统计指标 Grid + 交易记录表
 * 2. StatGrid — 8 个统计卡片(总收益/年化/最大回撤/夏普/胜率/交易次数/Alpha/Beta)
 * 3. TradesCard — 交易记录 StockTable + 顶部汇总条
 * 4. BacktestHistory — 历史回测 Collapsible + HistoryTable (容器调)
 *
 * 设计原则:
 * - 收益率颜色: 正数 var(--quant-up) 红, 负数 var(--quant-down) 绿 (A 股惯例)
 * - 统计卡片: tone 色 + 渐变背景 + hover 缩放
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Award,
  Scale,
  History,
  ChevronDown,
  Eye,
  PieChart,
  Gauge,
  BarChart3,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type BacktestResultDTO,
  type BacktestHistoryItemDTO,
} from '@/lib/api'
import { StockTable, type Column } from '../StockTable'
import { EmptyState } from '../EmptyState'

// ============================================================================
// 主组件: 统计指标 + 交易记录
// ============================================================================

export interface BacktestTradesProps {
  result: BacktestResultDTO
}

export function BacktestTrades({ result }: BacktestTradesProps) {
  return (
    <>
      <StatGrid result={result} />
      <TradesCard result={result} />
    </>
  )
}

// ============================================================================
// 子组件 1: 统计指标 Grid (8 卡片)
// ============================================================================

interface StatGridProps {
  result: BacktestResultDTO
}

type StatTone = 'primary' | 'up' | 'down' | 'flat'

const TONE_COLOR: Record<StatTone, string> = {
  primary: 'var(--quant-primary)',
  up: 'var(--quant-up)',
  down: 'var(--quant-down)',
  flat: 'var(--quant-flat)',
}

const TONE_GLOW: Record<StatTone, string> = {
  primary: 'rgba(245, 158, 11, 0.18)',
  up: 'rgba(239, 68, 68, 0.18)',
  down: 'rgba(16, 185, 129, 0.18)',
  flat: 'rgba(148, 163, 184, 0.12)',
}

function StatGrid({ result }: StatGridProps) {
  const stats: Array<{
    label: string
    value: string
    icon: React.ElementType
    tone: StatTone
    hint?: string
  }> = [
    { label: '总收益率', value: `${result.total_return >= 0 ? '+' : ''}${result.total_return.toFixed(2)}%`, icon: result.total_return >= 0 ? TrendingUp : TrendingDown, tone: result.total_return >= 0 ? 'up' : 'down', hint: `终值 ¥${result.final_capital.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` },
    { label: '年化收益率', value: `${result.annual_return >= 0 ? '+' : ''}${result.annual_return.toFixed(2)}%`, icon: Gauge, tone: result.annual_return >= 0 ? 'up' : 'down', hint: '复利年化' },
    { label: '最大回撤', value: `${result.max_drawdown.toFixed(2)}%`, icon: TrendingDown, tone: 'down', hint: '历史最大跌幅' },
    { label: '夏普比率', value: result.sharpe_ratio.toFixed(2), icon: Activity, tone: result.sharpe_ratio >= 1 ? 'primary' : 'flat', hint: result.sharpe_ratio >= 1 ? '风险调整后收益优秀' : '收益波动比偏低' },
    { label: '胜率', value: `${result.win_rate.toFixed(1)}%`, icon: Target, tone: result.win_rate >= 50 ? 'up' : 'flat', hint: `${result.profit_trades}盈 / ${result.loss_trades}亏` },
    { label: '交易次数', value: String(result.total_trades), icon: PieChart, tone: 'primary', hint: `平均持仓 ${result.avg_hold_days.toFixed(1)} 天` },
    { label: 'Alpha', value: result.alpha >= 0 ? `+${result.alpha.toFixed(2)}%` : `${result.alpha.toFixed(2)}%`, icon: Award, tone: result.alpha >= 0 ? 'up' : 'down', hint: `基准 ${result.benchmark_return >= 0 ? '+' : ''}${result.benchmark_return.toFixed(2)}%` },
    { label: 'Beta', value: result.beta.toFixed(2), icon: Scale, tone: 'flat', hint: '相对基准波动' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((s, i) => {
        const color = TONE_COLOR[s.tone]
        const glow = TONE_GLOW[s.tone]
        const Icon = s.icon
        return (
          <Card
            key={i}
            className="relative overflow-hidden p-4 gap-0 bg-quant-card border-quant group hover:border-[var(--quant-primary)]/50 hover:shadow-lg hover:shadow-black/30 transition-all duration-300"
            style={{
              backgroundImage: `radial-gradient(circle at top right, ${glow} 0%, transparent 60%)`,
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground truncate">{s.label}</div>
                <div
                  className="text-2xl font-semibold mt-1 tabular-nums transition-transform group-hover:scale-105 origin-left duration-300"
                  style={{ color }}
                >
                  {s.value}
                </div>
                {s.hint && (
                  <div className="text-[11px] text-muted-foreground mt-1 truncate">
                    {s.hint}
                  </div>
                )}
              </div>
              <div
                className="flex items-center justify-center rounded-md size-10 shrink-0 transition-transform group-hover:scale-110 duration-300"
                style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
              >
                <Icon className="size-5" style={{ color }} />
              </div>
            </div>
            <div
              className="absolute bottom-0 left-0 right-0 h-0.5 opacity-80 group-hover:opacity-100 transition-opacity"
              style={{
                background: `linear-gradient(to right, transparent, ${color}, transparent)`,
              }}
            />
          </Card>
        )
      })}
    </div>
  )
}

// ============================================================================
// 子组件 2: 交易记录表格
// ============================================================================

interface TradesCardProps {
  result: BacktestResultDTO
}

function TradesCard({ result }: TradesCardProps) {
  const trades = result.trades

  // 顶部汇总
  const totalPnl = trades.reduce((s, t) => s + t.pnl_amount, 0)
  const avgPnlPct = trades.length > 0
    ? trades.reduce((s, t) => s + t.pnl_pct, 0) / trades.length
    : 0

  const summaryToneColor: Record<string, string> = {
    primary: 'var(--quant-primary)',
    up: 'var(--quant-up)',
    down: 'var(--quant-down)',
  }

  const summary = [
    { label: '总交易次数', value: String(result.total_trades), tone: 'primary' },
    { label: '盈利次数', value: String(result.profit_trades), tone: 'up' },
    { label: '亏损次数', value: String(result.loss_trades), tone: 'down' },
    { label: '胜率', value: `${result.win_rate.toFixed(1)}%`, tone: 'primary' },
    { label: '累计盈亏', value: `${totalPnl >= 0 ? '+' : ''}¥${totalPnl.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`, tone: totalPnl >= 0 ? 'up' : 'down' },
    { label: '平均收益率', value: `${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(2)}%`, tone: avgPnlPct >= 0 ? 'up' : 'down' },
  ]

  const columns: Column<typeof trades[number]>[] = [
    { key: 'stock_code', header: '代码', width: '6rem', render: (t) => <span className="font-mono text-xs">{t.stock_code}</span> },
    { key: 'stock_name', header: '名称', width: '6rem', render: (t) => <span className="text-xs">{t.stock_name}</span> },
    { key: 'entry_date', header: '买入日', width: '6rem', render: (t) => <span className="text-xs text-muted-foreground tabular-nums">{t.entry_date}</span>, sortValue: (t) => t.entry_date },
    { key: 'exit_date', header: '卖出日', width: '6rem', render: (t) => <span className="text-xs text-muted-foreground tabular-nums">{t.exit_date}</span>, sortValue: (t) => t.exit_date },
    { key: 'entry_price', header: '买入价', align: 'right', width: '5rem', render: (t) => <span className="text-xs tabular-nums font-mono">{t.entry_price.toFixed(2)}</span>, sortValue: (t) => t.entry_price },
    { key: 'exit_price', header: '卖出价', align: 'right', width: '5rem', render: (t) => <span className="text-xs tabular-nums font-mono">{t.exit_price.toFixed(2)}</span>, sortValue: (t) => t.exit_price },
    { key: 'hold_days', header: '持仓天数', align: 'center', width: '5rem', render: (t) => <Badge variant="outline" className="text-[10px] border-quant font-mono">{t.hold_days}d</Badge>, sortValue: (t) => t.hold_days },
    {
      key: 'pnl_pct', header: '收益率', align: 'right', width: '6rem',
      render: (t) => (
        <span className="text-xs tabular-nums font-mono font-semibold" style={{ color: t.pnl_pct >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}>
          {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%
        </span>
      ),
      sortValue: (t) => t.pnl_pct,
    },
    {
      key: 'pnl_amount', header: '收益金额', align: 'right', width: '7rem',
      render: (t) => (
        <span className="text-xs tabular-nums font-mono" style={{ color: t.pnl_amount >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}>
          {t.pnl_amount >= 0 ? '+' : ''}¥{t.pnl_amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
        </span>
      ),
      sortValue: (t) => t.pnl_amount,
    },
  ]

  return (
    <Card className="p-0 gap-0 bg-quant-card border-quant overflow-hidden">
      {/* 顶部汇总条 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-quant">
        <BarChart3 className="size-4 text-quant-primary" />
        <span className="font-semibold text-sm">交易记录</span>
        <Badge variant="outline" className="text-[10px] border-quant font-mono">
          {trades.length} 笔
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          {summary.map((s, i) => (
            <div key={i} className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-mono tabular-nums font-semibold" style={{ color: summaryToneColor[s.tone] }}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>
      <StockTable
        columns={columns}
        data={trades}
        rowKey={(t, i) => `${t.stock_code}-${t.entry_date}-${i}`}
        maxHeight="28rem"
        pageSize={20}
        emptyText="暂无交易记录"
      />
    </Card>
  )
}

// ============================================================================
// 子组件 3: 历史回测 (Collapsible + HistoryTable)
// ============================================================================

export interface BacktestHistoryProps {
  history: BacktestHistoryItemDTO[]
  historyOpen: boolean
  historyLoading: boolean
  loadingHistoryId: string | null
  onOpenChange: (v: boolean) => void
  onLoad: (runId: string) => void
}

export function BacktestHistory({
  history,
  historyOpen,
  historyLoading,
  loadingHistoryId,
  onOpenChange,
  onLoad,
}: BacktestHistoryProps) {
  return (
    <Card className="p-0 gap-0 bg-quant-card border-quant overflow-hidden">
      <Collapsible open={historyOpen} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 border-b border-quant hover:bg-quant-bg/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <History className="size-4 text-quant-primary" />
              <span className="font-semibold text-sm">历史回测</span>
              <Badge variant="outline" className="text-[10px] border-quant font-mono">
                {history.length} 条
              </Badge>
            </div>
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                historyOpen && 'rotate-180'
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-2">
            {historyLoading ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin inline mr-2" />
                加载中...
              </div>
            ) : history.length === 0 ? (
              <EmptyState
                text="暂无历史回测"
                description="运行回测后将自动保存到历史"
                className="py-8"
              />
            ) : (
              <HistoryTable
                history={history}
                loadingId={loadingHistoryId}
                onLoad={onLoad}
              />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

// ============================================================================
// 子组件 4: 历史回测表格 (StockTable)
// ============================================================================

interface HistoryTableProps {
  history: BacktestHistoryItemDTO[]
  loadingId: string | null
  onLoad: (runId: string) => void
}

function HistoryTable({ history, loadingId, onLoad }: HistoryTableProps) {
  const columns: Column<BacktestHistoryItemDTO>[] = [
    { key: 'run_id', header: 'Run ID', width: '6rem', render: (h) => <span className="font-mono text-xs text-muted-foreground">{h.run_id.slice(0, 8)}</span> },
    { key: 'strategy', header: '策略', width: '8rem', render: (h) => <Badge variant="outline" className="font-mono text-xs border-quant">{h.strategy_emoji} {h.strategy_name}</Badge> },
    { key: 'range', header: '日期范围', width: '10rem', render: (h) => <span className="text-xs text-muted-foreground tabular-nums">{h.start_date} ~ {h.end_date}</span> },
    {
      key: 'total_return', header: '总收益', align: 'right', width: '6rem',
      render: (h) => (
        <span className="text-xs tabular-nums font-mono font-semibold" style={{ color: h.total_return >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}>
          {h.total_return >= 0 ? '+' : ''}{h.total_return.toFixed(2)}%
        </span>
      ),
      sortValue: (h) => h.total_return,
    },
    {
      key: 'max_drawdown', header: '最大回撤', align: 'right', width: '6rem',
      render: (h) => <span className="text-xs tabular-nums font-mono text-[var(--quant-down)]">{h.max_drawdown.toFixed(2)}%</span>,
      sortValue: (h) => h.max_drawdown,
    },
    {
      key: 'sharpe_ratio', header: '夏普', align: 'right', width: '5rem',
      render: (h) => (
        <span className="text-xs tabular-nums font-mono" style={{ color: h.sharpe_ratio >= 1 ? 'var(--quant-primary)' : 'var(--muted-foreground)' }}>
          {h.sharpe_ratio.toFixed(2)}
        </span>
      ),
      sortValue: (h) => h.sharpe_ratio,
    },
    {
      key: 'created_at', header: '创建时间', align: 'right', width: '9rem',
      render: (h) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {h.created_at ? new Date(h.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
        </span>
      ),
      sortValue: (h) => h.created_at,
    },
    {
      key: 'action', header: '操作', align: 'center', width: '5rem',
      render: (h) => (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 border-quant text-xs gap-1 hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30"
          onClick={(e) => { e.stopPropagation(); onLoad(h.run_id) }}
          disabled={loadingId === h.run_id}
        >
          {loadingId === h.run_id ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />}
          查看
        </Button>
      ),
    },
  ]

  return (
    <StockTable
      columns={columns}
      data={history}
      rowKey={(h) => h.run_id}
      maxHeight="20rem"
      pageSize={20}
      emptyText="暂无历史回测"
    />
  )
}
