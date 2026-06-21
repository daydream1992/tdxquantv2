'use client'

/**
 * 竞价监控面板 (R13-2c, 第 8 个 tab "竞价监控")
 *
 * 数据源: GET /api/monitor/auction → AuctionResponseDTO
 *   - in_auction_hours: 9:15-9:25 竞价时段 (Mock 模式强制 true)
 *   - items[]: 按 auction_score 降序的竞价强弱榜
 *
 * 功能:
 *  1. 顶部状态条: 竞价状态 Badge (绿/灰) + 股票数 + 自动刷新 Switch + 手动刷新 + 自定义代码
 *  2. 竞价强弱排行表: 排名 / 代码 / 竞价涨幅 / 竞价金额 / 涨停买单 / 量比同比 / L2委托数 / 综合评分(进度条)
 *     - 评分进度条: <40 红 / 40-70 黄 / 70-100 绿
 *     - 竞价涨幅 >3% 标红加粗 (抢筹)
 *     - 涨停买单 >0 显示 "涨停买单" Badge
 *  3. 行点击展开 score_detail 四项 + 原始字段 (fetched_at / open_vol_pre)
 *  4. Top5 强弱榜 (右侧横向条形图)
 *  5. 空态 / Loading 兜底
 *
 * 轮询: 竞价时段 3s, 非竞价时段 30s, 关掉 Switch 不轮询
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Gavel,
  RefreshCw,
  Loader2,
  Search,
  ChevronRight,
  TrendingUp,
  Flame,
  Clock,
  Hash,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { monitorAPI, type AuctionItemDTO, type AuctionResponseDTO } from '@/lib/api'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'

// ============================================================================
// 评分等级颜色映射 (0-40 红 / 40-70 黄 / 70-100 绿)
// ============================================================================

function scoreTier(score: number): {
  bar: string
  text: string
  label: string
} {
  if (score >= 70) return { bar: 'bg-emerald-500', text: 'text-emerald-400', label: '强' }
  if (score >= 40) return { bar: 'bg-amber-500', text: 'text-amber-400', label: '中' }
  return { bar: 'bg-red-500', text: 'text-red-400', label: '弱' }
}

// ============================================================================
// 主组件
// ============================================================================

export function AuctionPanel() {
  const [autoRefresh, setAutoRefresh] = React.useState(true)
  const [data, setData] = React.useState<AuctionResponseDTO | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [customCodes, setCustomCodes] = React.useState('')
  // 查询生效的 codes (输入后点查询才更新)
  const [activeCodes, setActiveCodes] = React.useState<string>('')
  const [expandedRow, setExpandedRow] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const fetchData = React.useCallback(async () => {
    setRefreshing(true)
    try {
      const r = await monitorAPI.getAuction(activeCodes || undefined, 50)
      setData(r)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeCodes])

  // 初次拉取 + 轮询
  React.useEffect(() => {
    fetchData()
  }, [fetchData])

  React.useEffect(() => {
    if (!autoRefresh) return
    // 竞价时段 3s 轮询, 非竞价时段 30s 轮询
    const interval = data?.in_auction_hours ? 3000 : 30000
    const t = setInterval(fetchData, interval)
    return () => clearInterval(t)
  }, [autoRefresh, data?.in_auction_hours, fetchData])

  const handleQuery = () => {
    // 简单规范化: 去空格, 去末尾逗号
    const cleaned = customCodes
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(',')
    setActiveCodes(cleaned)
  }

  const handleClear = () => {
    setCustomCodes('')
    setActiveCodes('')
  }

  const handleRefresh = () => fetchData()

  // === 数据派生 ===
  const items = React.useMemo(() => {
    return (data?.items || []).slice().sort((a, b) => b.auction_score - a.auction_score)
  }, [data?.items])

  const top5 = items.slice(0, 5)
  const maxScore = top5.length > 0 ? Math.max(...top5.map((x) => x.auction_score), 1) : 100
  const inAuction = data?.in_auction_hours ?? false
  const count = data?.count ?? 0
  const lastFetched = items[0]?.fetched_at

  // === 渲染 ===
  return (
    <div className="space-y-4">
      {/* 顶部状态条 */}
      <Card className="p-4 gap-0 bg-quant-card border-quant">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 左侧: 标题 + 状态 */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center size-9 rounded-md bg-amber-500/15 shrink-0">
              <Gavel className="size-5 text-quant-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">竞价监控</span>
                <Badge
                  className={cn(
                    'text-[10px] gap-1',
                    inAuction
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15'
                      : 'bg-muted/30 text-muted-foreground border-quant hover:bg-muted/30'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block size-1.5 rounded-full',
                      inAuction ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/60'
                    )}
                  />
                  {inAuction ? '竞价中 (9:15-9:25)' : '非竞价时段'}
                </Badge>
                <Badge variant="outline" className="text-[10px] border-quant font-mono gap-1">
                  <Hash className="size-2.5" />
                  {count} 只
                </Badge>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                <Clock className="size-2.5" />
                {lastFetched
                  ? `最近数据: ${formatTime(lastFetched)}`
                  : '尚未拉取数据'}
                {autoRefresh && (
                  <span className="text-emerald-400/80">
                    · 自动刷新 {inAuction ? '3s' : '30s'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 右侧: 自动刷新开关 + 刷新按钮 + 自定义代码 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-quant bg-quant-bg/50">
              <span className="text-[11px] text-muted-foreground">自动刷新</span>
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="切换自动刷新" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2.5 hover:bg-amber-500/10"
              onClick={handleRefresh}
              disabled={refreshing}
              title="手动刷新"
            >
              {refreshing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
              )}
            </Button>
            <div className="flex items-center gap-1">
              <Input
                value={customCodes}
                onChange={(e) => setCustomCodes(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleQuery()
                }}
                placeholder="自定义代码, 逗号分隔"
                className="h-8 w-44 text-xs font-mono"
                aria-label="自定义股票代码"
              />
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1 px-2.5"
                onClick={handleQuery}
                title="查询"
              >
                <Search className="size-3.5" />
              </Button>
              {activeCodes && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-muted-foreground"
                  onClick={handleClear}
                  title="清除筛选, 显示全部"
                >
                  清除
                </Button>
              )}
            </div>
          </div>
        </div>
        {activeCodes && (
          <div className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span className="text-quant-primary">▸</span>
            正在筛选:
            <code className="px-1.5 py-0.5 rounded bg-quant-bg border border-quant text-quant-primary">
              {activeCodes}
            </code>
          </div>
        )}
      </Card>

      {/* 主体: 排行表 + Top5 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左: 排行表 */}
        <Card className="lg:col-span-2 p-0 gap-0 bg-quant-card border-quant overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-quant">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-quant-primary" />
              <span className="font-semibold text-sm">竞价强弱排行</span>
              <Badge variant="outline" className="text-[10px] border-quant font-mono">
                {items.length} 只
              </Badge>
            </div>
            <div className="text-[10px] text-muted-foreground">
              按 auction_score 降序
            </div>
          </div>

          {loading ? (
            <LoadingState variant="table" rows={6} className="border-0 rounded-none" />
          ) : error ? (
            <EmptyState
              text="加载失败"
              description={error}
              icon={Flame}
              className="py-10"
            />
          ) : items.length === 0 ? (
            <EmptyState
              text="暂无竞价数据"
              description="请在 9:15-9:25 竞价时段查看, 或检查自选股/订阅列表"
              icon={Gavel}
              className="py-10"
            />
          ) : (
            <ScrollArea className="max-h-[600px] w-full quant-scroll">
              <Table className="quant-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead>代码</TableHead>
                    <TableHead className="text-right">竞价涨幅</TableHead>
                    <TableHead className="text-right">竞价金额 (万)</TableHead>
                    <TableHead className="text-right">涨停买单 (万)</TableHead>
                    <TableHead className="text-right">量比同比</TableHead>
                    <TableHead className="text-right">L2委托数</TableHead>
                    <TableHead className="text-right min-w-[140px]">综合评分</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, idx) => (
                    <AuctionRow
                      key={item.stock_code}
                      item={item}
                      rank={idx + 1}
                      expanded={expandedRow === item.stock_code}
                      onToggle={() =>
                        setExpandedRow((prev) =>
                          prev === item.stock_code ? null : item.stock_code
                        )
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </Card>

        {/* 右: Top5 强弱榜 */}
        <Card className="p-0 gap-0 bg-quant-card border-quant overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-quant">
            <div className="flex items-center gap-2">
              <Flame className="size-4 text-quant-primary" />
              <span className="font-semibold text-sm">Top5 强弱榜</span>
            </div>
            <Badge variant="outline" className="text-[10px] border-quant font-mono">
              最强 {top5[0]?.auction_score.toFixed(1) ?? '--'}
            </Badge>
          </div>
          <div className="p-4 space-y-3">
            {top5.length === 0 ? (
              <div className="text-[11px] text-muted-foreground text-center py-6">
                暂无强弱榜数据
              </div>
            ) : (
              top5.map((item, idx) => {
                const tier = scoreTier(item.auction_score)
                const widthPct = Math.max(
                  8,
                  Math.min(100, (item.auction_score / maxScore) * 100)
                )
                return (
                  <div
                    key={item.stock_code}
                    className="group cursor-pointer"
                    onClick={() =>
                      setExpandedRow((prev) =>
                        prev === item.stock_code ? null : item.stock_code
                      )
                    }
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cn(
                            'inline-flex items-center justify-center size-5 rounded text-[10px] font-bold shrink-0',
                            idx === 0
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : idx === 1
                              ? 'bg-slate-400/20 text-slate-200 border border-slate-400/40'
                              : idx === 2
                              ? 'bg-orange-700/20 text-orange-300 border border-orange-700/40'
                              : 'bg-muted/30 text-muted-foreground border border-quant'
                          )}
                        >
                          {idx + 1}
                        </span>
                        <code className="text-xs font-mono truncate group-hover:text-quant-primary transition-colors">
                          {item.stock_code}
                        </code>
                        {item.auction_zt_buy > 0 && (
                          <Badge className="text-[9px] px-1 py-0 h-4 bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/15">
                            涨停
                          </Badge>
                        )}
                      </div>
                      <span className={cn('text-xs font-mono tabular-nums font-semibold', tier.text)}>
                        {item.auction_score.toFixed(1)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-quant-bg overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', tier.bar)}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-0.5 text-[10px] text-muted-foreground">
                      <span className="tabular-nums">
                        涨幅 <span className={item.auction_pct > 3 ? 'text-red-400 font-semibold' : ''}>
                          {item.auction_pct.toFixed(2)}%
                        </span>
                      </span>
                      <span className="tabular-nums">{item.auction_amount.toFixed(0)} 万</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* 评分公式说明 */}
          <div className="border-t border-quant px-4 py-3 bg-quant-bg/30">
            <div className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
              <Activity className="size-2.5" />
              评分公式 (满分 100)
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
              <ScoreLegend label="surge 涨幅" max={40} cls="bg-red-500/80" />
              <ScoreLegend label="zt_flag 涨停" max={20} cls="bg-rose-500/80" />
              <ScoreLegend label="vol_ratio 量比" max={30} cls="bg-amber-500/80" />
              <ScoreLegend label="l2 委托" max={10} cls="bg-emerald-500/80" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ============================================================================
// 单行 (含展开)
// ============================================================================

function AuctionRow({
  item,
  rank,
  expanded,
  onToggle,
}: {
  item: AuctionItemDTO
  rank: number
  expanded: boolean
  onToggle: () => void
}) {
  const tier = scoreTier(item.auction_score)
  const surgeHigh = item.auction_pct > 3
  const hasZt = item.auction_zt_buy > 0
  // 量比同比: auction_amount / open_amount_pre (倍)
  const volRatio =
    item.open_amount_pre > 0 ? item.auction_amount / item.open_amount_pre : 0

  return (
    <>
      <TableRow
        onClick={onToggle}
        className={cn(
          'cursor-pointer transition-colors',
          expanded && 'bg-quant-primary/5'
        )}
      >
        <TableCell className="text-center text-xs text-muted-foreground tabular-nums">
          {rank <= 3 ? (
            <span
              className={cn(
                'inline-flex items-center justify-center size-5 rounded text-[10px] font-bold',
                rank === 1
                  ? 'bg-amber-500/20 text-amber-300'
                  : rank === 2
                  ? 'bg-slate-400/20 text-slate-200'
                  : 'bg-orange-700/20 text-orange-300'
              )}
            >
              {rank}
            </span>
          ) : (
            rank
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <ChevronRight
              className={cn(
                'size-3 text-muted-foreground transition-transform shrink-0',
                expanded && 'rotate-90 text-quant-primary'
              )}
            />
            <code className="text-xs font-mono">{item.stock_code}</code>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <span
            className={cn(
              'text-xs font-mono tabular-nums',
              surgeHigh
                ? 'text-red-400 font-bold'
                : item.auction_pct > 0
                ? 'text-up'
                : 'text-muted-foreground'
            )}
          >
            {item.auction_pct > 0 ? '+' : ''}
            {item.auction_pct.toFixed(2)}%
            {surgeHigh && <TrendingUp className="inline-block size-3 ml-0.5 -mt-0.5" />}
          </span>
        </TableCell>
        <TableCell className="text-right text-xs font-mono tabular-nums text-muted-foreground">
          {item.auction_amount.toFixed(0)}
        </TableCell>
        <TableCell className="text-right">
          {hasZt ? (
            <Badge className="text-[10px] bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/15">
              {item.auction_zt_buy.toFixed(0)}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground/40 font-mono tabular-nums">0</span>
          )}
        </TableCell>
        <TableCell className="text-right text-xs font-mono tabular-nums">
          <span
            className={
              volRatio >= 1
                ? 'text-emerald-400'
                : volRatio >= 0.5
                ? 'text-amber-400'
                : 'text-muted-foreground'
            }
          >
            {volRatio.toFixed(2)}x
          </span>
        </TableCell>
        <TableCell className="text-right text-xs font-mono tabular-nums text-muted-foreground">
          {item.l2_order_num.toLocaleString('zh-CN')}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <div className="flex-1 h-2 max-w-[80px] rounded-full bg-quant-bg overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-500', tier.bar)}
                style={{ width: `${Math.max(2, Math.min(100, item.auction_score))}%` }}
              />
            </div>
            <span className={cn('text-xs font-mono tabular-nums font-semibold w-9 text-right', tier.text)}>
              {item.auction_score.toFixed(1)}
            </span>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-quant-bg/40 hover:bg-quant-bg/40">
          <TableCell colSpan={8} className="p-3">
            <ScoreDetail item={item} volRatio={volRatio} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ============================================================================
// 评分明细展开
// ============================================================================

function ScoreDetail({
  item,
  volRatio,
}: {
  item: AuctionItemDTO
  volRatio: number
}) {
  const d = item.score_detail
  const segments: Array<{ label: string; value: number; max: number; cls: string }> = [
    { label: 'surge 涨幅分', value: d.surge, max: 40, cls: 'bg-red-500' },
    { label: 'zt_flag 涨停分', value: d.zt_flag, max: 20, cls: 'bg-rose-500' },
    { label: 'vol_ratio 量比分', value: d.vol_ratio, max: 30, cls: 'bg-amber-500' },
    { label: 'l2 委托分', value: d.l2, max: 10, cls: 'bg-emerald-500' },
  ]

  return (
    <div className="space-y-3">
      {/* 4 段评分进度条 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {segments.map((s) => (
          <div
            key={s.label}
            className="rounded-md border border-quant bg-quant-card/60 p-2"
          >
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-mono tabular-nums text-foreground">
                {s.value.toFixed(1)} / {s.max}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-quant-bg overflow-hidden">
              <div
                className={cn('h-full rounded-full', s.cls)}
                style={{ width: `${Math.max(2, Math.min(100, (s.value / s.max) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 原始字段 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[10px]">
        <Field label="fetched_at" value={formatTime(item.fetched_at)} mono />
        <Field label="auction_amount (万)" value={item.auction_amount.toFixed(2)} mono />
        <Field label="open_amount_pre (万)" value={item.open_amount_pre.toFixed(2)} mono />
        <Field label="open_vol_pre (手)" value={item.open_vol_pre.toLocaleString('zh-CN')} mono />
        <Field label="l2_order_num" value={item.l2_order_num.toLocaleString('zh-CN')} mono />
        <Field label="l2_tic_num" value={item.l2_tic_num.toLocaleString('zh-CN')} mono />
        <Field label="auction_zt_buy (万)" value={item.auction_zt_buy.toFixed(2)} mono />
        <Field label="auction_pct (%)" value={item.auction_pct.toFixed(3)} mono />
        <Field label="vol_ratio (倍)" value={`${volRatio.toFixed(3)}x`} mono />
      </div>
    </div>
  )
}

// ============================================================================
// 子组件 / 工具
// ============================================================================

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-quant bg-quant-card/60 px-2 py-1.5">
      <div className="text-[9px] text-muted-foreground truncate">{label}</div>
      <div className={cn('text-[11px] text-foreground tabular-nums truncate', mono && 'font-mono')}>
        {value}
      </div>
    </div>
  )
}

function ScoreLegend({ label, max, cls }: { label: string; max: number; cls: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('inline-block size-2 rounded-sm', cls)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground/70 font-mono tabular-nums ml-auto">{max}</span>
    </div>
  )
}

function formatTime(s: string): string {
  if (!s) return '--'
  try {
    const d = new Date(s)
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return s
  }
}
