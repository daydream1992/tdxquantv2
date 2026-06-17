'use client'

/**
 * 策略胜率排行卡片
 *
 * - 数据源: GET /api/backtest/leaderboard (按 strategy_id 聚合, 取最新一次回测)
 * - 排序: 按 sharpe_ratio 降序
 * - 每行: 排名徽章 (🥇🥈🥉/4/5) + 策略 emoji + 名称 + 胜率进度条 + 4 mini stat
 *   (总收益率 / 夏普 / 最大回撤 / 交易次数)
 * - 第 1 名行: 金色边框 + 微弱 glow
 * - 空: EmptyState "暂无回测数据, 请先运行回测"
 * - 右上角 "查看全部回测" 链接 -> 跳到选股结果 Tab 的回测视图
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Trophy, ChevronRight, History, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { backtestAPI, type BacktestLeaderboardItemDTO } from '@/lib/api'
import { EmptyState } from './EmptyState'

export interface StrategyLeaderboardProps {
  onViewAll?: () => void
  className?: string
}

// 前 3 名的排名徽章样式
const RANK_BADGES: Array<{ label: string; className: string }> = [
  {
    label: '🥇',
    className: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  {
    label: '🥈',
    className: 'bg-slate-400/20 text-slate-200 border-slate-400/40',
  },
  {
    label: '🥉',
    className: 'bg-orange-700/20 text-orange-300 border-orange-700/40',
  },
]

export function StrategyLeaderboard({ onViewAll, className }: StrategyLeaderboardProps) {
  const [items, setItems] = React.useState<BacktestLeaderboardItemDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await backtestAPI.leaderboard()
      setItems(r.items || [])
    } catch (e) {
      setError((e as Error).message || '加载排行失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  // 取前 5 名
  const top5 = items.slice(0, 5)

  return (
    <Card
      className={cn(
        'p-4 gap-0 bg-quant-card border-quant overflow-hidden relative',
        className
      )}
    >
      {/* 标题 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center size-7 rounded-md bg-amber-500/15">
            <Trophy className="size-4 text-amber-400" />
          </div>
          <div>
            <div className="text-sm font-semibold">策略胜率排行</div>
            <div className="text-[11px] text-muted-foreground">基于历史回测数据 · 按夏普降序</div>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-quant-primary hover:bg-amber-500/10"
          onClick={onViewAll}
          title="跳转到回测视图"
        >
          <History className="size-3.5" />
          <span className="hidden sm:inline">查看全部回测</span>
          <ChevronRight className="size-3" />
        </Button>
      </div>

      {/* 内容 */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
          <Loader2 className="size-4 mr-2 animate-spin text-quant-primary" />
          加载中...
        </div>
      ) : error ? (
        <EmptyState
          icon={History}
          text="加载排行失败"
          description={error}
          className="py-8"
        />
      ) : top5.length === 0 ? (
        <EmptyState
          icon={History}
          text="暂无回测数据"
          description="请先在选股结果 Tab 中运行回测, 这里会自动汇总各策略胜率排行"
          className="py-8"
          action={
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-quant text-xs"
              onClick={onViewAll}
            >
              <History className="size-3.5" />
              去运行回测
            </Button>
          }
        />
      ) : (
        <div className="space-y-1.5">
          {top5.map((item, idx) => (
            <LeaderboardRow key={item.strategy_id} item={item} rank={idx + 1} />
          ))}
        </div>
      )}
    </Card>
  )
}

// ============================================================================
// 行
// ============================================================================

function LeaderboardRow({ item, rank }: { item: BacktestLeaderboardItemDTO; rank: number }) {
  const isFirst = rank === 1
  const rankBadge = RANK_BADGES[rank - 1]

  // 胜率进度条: 0~100% -> 宽度
  const winPct = Math.max(0, Math.min(100, item.win_rate))
  // 总收益率颜色: 正绿(实际A股红), 负绿
  const totalReturnColor =
    item.total_return > 0
      ? 'var(--quant-up)'
      : item.total_return < 0
      ? 'var(--quant-down)'
      : 'var(--quant-flat)'
  // 最大回撤: 必为负数, 显示为红色
  const ddColor = item.max_drawdown < 0 ? 'var(--quant-down)' : 'var(--quant-flat)'

  return (
    <div
      className={cn(
        'relative rounded-md p-2.5 transition-all duration-200',
        'flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3',
        isFirst
          ? 'bg-amber-500/5 border border-amber-500/40 shadow-[0_0_12px_-2px_rgba(245,158,11,0.35)]'
          : 'border border-transparent hover:bg-amber-500/5 hover:border-quant/50'
      )}
    >
      {/* 左侧: 排名 + emoji + 名称 */}
      <div className="flex items-center gap-2 min-w-0 lg:w-[14rem] lg:shrink-0">
        <span
          className={cn(
            'inline-flex items-center justify-center size-6 rounded-full text-xs font-semibold border shrink-0',
            rankBadge
              ? rankBadge.className
              : 'bg-muted/30 text-muted-foreground border-quant'
          )}
        >
          {rankBadge ? rankBadge.label : rank}
        </span>
        <span className="text-xl leading-none shrink-0" aria-hidden>
          {item.strategy_emoji || '📊'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{item.strategy_name}</div>
          <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
            <span>回测 {item.run_count} 次</span>
            {item.start_date && item.end_date && (
              <>
                <span>·</span>
                <span className="font-mono">
                  {item.start_date} ~ {item.end_date}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 中间: 胜率进度条 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span className="text-muted-foreground">胜率</span>
          <span className="font-mono text-amber-400 tabular-nums">{winPct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-quant-border overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-500"
            style={{ width: `${winPct}%` }}
          />
        </div>
      </div>

      {/* 右侧: 4 mini stat */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 lg:gap-2 lg:w-[20rem] lg:shrink-0">
        <MiniStat
          label="总收益"
          value={`${item.total_return > 0 ? '+' : ''}${item.total_return.toFixed(2)}%`}
          color={totalReturnColor}
        />
        <MiniStat
          label="夏普"
          value={item.sharpe_ratio.toFixed(2)}
          color="var(--quant-primary)"
        />
        <MiniStat
          label="最大回撤"
          value={`${item.max_drawdown.toFixed(2)}%`}
          color={ddColor}
        />
        <MiniStat
          label="交易数"
          value={String(item.total_trades)}
          color="var(--quant-flat)"
        />
      </div>
    </div>
  )
}

// ============================================================================
// mini stat
// ============================================================================

function MiniStat({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div className="rounded-md bg-quant-bg/40 border border-quant/50 px-2 py-1">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div
        className="text-xs font-mono tabular-nums font-semibold truncate"
        style={{ color }}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}
