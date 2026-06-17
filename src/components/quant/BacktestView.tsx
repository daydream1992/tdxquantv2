'use client'

/**
 * 回测视图 (BacktestView)
 *
 * 5 大区块:
 * 1. 顶部表单 Card - 策略/日期/资金/持仓数/持有天数 + 运行回测按钮
 * 2. 统计指标 Grid - 8 个卡片(总收益/年化/最大回撤/夏普/胜率/交易次数/Alpha/Beta)
 * 3. 收益曲线 SVG - 策略资产曲线 + 基准曲线 + 回撤阴影 + 十字光标 tooltip
 * 4. 交易记录表格 - 复用 StockTable, 收益率正绿负红
 * 5. 历史回测列表 - Collapsible 折叠, 点击查看加载历史详情
 *
 * 设计原则:
 * - 深色金融风: 用 var(--quant-*) CSS 变量, 不用 indigo/blue
 * - 收益率颜色: 正数 var(--quant-up) 红, 负数 var(--quant-down) 绿 (A 股惯例)
 * - 加载态: Skeleton / Loader2
 * - 空状态: EmptyState
 * - 响应式: mobile 单列, desktop 多列
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Play,
  Loader2,
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
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  backtestAPI,
  strategyAPI,
  type BacktestResultDTO,
  type BacktestHistoryItemDTO,
  type BacktestParamsDTO,
  type StrategyDTO,
} from '@/lib/api'
import { StockTable, type Column } from './StockTable'
import { EmptyState } from './EmptyState'

// 默认日期: start = 今天-90天, end = 今天
function defaultStartDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}
function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function BacktestView() {
  // 表单参数
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [strategyId, setStrategyId] = React.useState<string>('dbqzt')
  const [startDate, setStartDate] = React.useState<string>(defaultStartDate())
  const [endDate, setEndDate] = React.useState<string>(defaultEndDate())
  const [initialCapital, setInitialCapital] = React.useState<string>('100000')
  const [topN, setTopN] = React.useState<string>('5')
  const [holdDays, setHoldDays] = React.useState<string>('5')

  // 回测结果
  const [result, setResult] = React.useState<BacktestResultDTO | null>(null)
  const [running, setRunning] = React.useState(false)

  // 历史回测
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [history, setHistory] = React.useState<BacktestHistoryItemDTO[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [loadingHistoryId, setLoadingHistoryId] = React.useState<string | null>(null)

  // 加载策略列表
  React.useEffect(() => {
    strategyAPI
      .list()
      .then((list) => {
        setStrategies(list)
        // 默认选第一个 enabled 策略
        const first = list.find((s) => s.enabled) || list[0]
        if (first) setStrategyId(first.strategy_id)
      })
      .catch(() => {})
  }, [])

  // 加载历史
  const loadHistory = React.useCallback(async () => {
    setHistoryLoading(true)
    try {
      const list = await backtestAPI.history()
      setHistory(list)
    } catch (e) {
      toast.error('加载历史回测失败', { description: (e as Error).message })
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // 运行回测
  const handleRun = async () => {
    if (!strategyId) {
      toast.error('请选择策略')
      return
    }
    if (!startDate || !endDate) {
      toast.error('请填写日期范围')
      return
    }
    if (new Date(endDate) <= new Date(startDate)) {
      toast.error('结束日期必须晚于开始日期')
      return
    }
    const capital = Number(initialCapital)
    if (!Number.isFinite(capital) || capital < 1000) {
      toast.error('初始资金不能小于 1000')
      return
    }

    setRunning(true)
    const toastId = toast.loading('正在运行回测...', {
      description: `${strategyId} · ${startDate} ~ ${endDate}`,
    })
    try {
      const params: BacktestParamsDTO = {
        strategy_id: strategyId,
        start_date: startDate,
        end_date: endDate,
        initial_capital: capital,
        top_n: Number(topN),
        hold_days: Number(holdDays),
      }
      const r = await backtestAPI.run(params)
      setResult(r)
      toast.success(`回测完成: 总收益 ${r.total_return.toFixed(2)}%`, {
        id: toastId,
        description: `夏普 ${r.sharpe_ratio.toFixed(2)} · 胜率 ${r.win_rate.toFixed(1)}% · ${r.total_trades} 笔交易`,
      })
      // 刷新历史
      loadHistory()
    } catch (e) {
      toast.error('回测失败', { id: toastId, description: (e as Error).message })
    } finally {
      setRunning(false)
    }
  }

  // 加载历史详情
  const handleLoadHistory = async (runId: string) => {
    setLoadingHistoryId(runId)
    try {
      const r = await backtestAPI.get(runId)
      setResult(r)
      // 同步表单参数
      setStrategyId(r.strategy_id)
      setStartDate(r.start_date)
      setEndDate(r.end_date)
      setInitialCapital(String(r.initial_capital))
      setTopN(String(r.top_n))
      setHoldDays(String(r.hold_days))
      toast.success(`已加载回测 ${runId.slice(0, 8)}`)
    } catch (e) {
      toast.error('加载回测详情失败', { description: (e as Error).message })
    } finally {
      setLoadingHistoryId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* ===== 1. 顶部表单 ===== */}
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
            <Select value={strategyId} onValueChange={setStrategyId}>
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
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 border-quant"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">结束日期</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
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
              onChange={(e) => setInitialCapital(e.target.value)}
              className="h-9 border-quant tabular-nums"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">持仓数 (Top N)</Label>
            <Select value={topN} onValueChange={setTopN}>
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
            <Select value={holdDays} onValueChange={setHoldDays}>
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
              onClick={handleRun}
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

      {/* ===== 2. 统计指标 ===== */}
      {result ? (
        <StatGrid result={result} />
      ) : (
        <Card className="p-6 bg-quant-card border-quant">
          <EmptyState
            text="暂无回测结果"
            description="请选择策略与日期范围，点击「运行回测」按钮开始"
            icon={BarChart3}
          />
        </Card>
      )}

      {/* ===== 3. 收益曲线 ===== */}
      {result && result.daily_equity.length > 0 && (
        <EquityCurveCard result={result} />
      )}

      {/* ===== 4. 交易记录 ===== */}
      {result && (
        <TradesCard result={result} />
      )}

      {/* ===== 5. 历史回测列表 ===== */}
      <Card className="p-0 gap-0 bg-quant-card border-quant overflow-hidden">
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
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
                  onLoad={handleLoadHistory}
                />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  )
}

// ============================================================================
// 子组件 1: 统计指标 Grid
// ============================================================================

interface StatGridProps {
  result: BacktestResultDTO
}

function StatGrid({ result }: StatGridProps) {
  const stats: Array<{
    label: string
    value: string
    icon: React.ElementType
    tone: 'primary' | 'up' | 'down' | 'flat'
    hint?: string
  }> = [
    {
      label: '总收益率',
      value: `${result.total_return >= 0 ? '+' : ''}${result.total_return.toFixed(2)}%`,
      icon: result.total_return >= 0 ? TrendingUp : TrendingDown,
      tone: result.total_return >= 0 ? 'up' : 'down',
      hint: `终值 ¥${result.final_capital.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`,
    },
    {
      label: '年化收益率',
      value: `${result.annual_return >= 0 ? '+' : ''}${result.annual_return.toFixed(2)}%`,
      icon: Gauge,
      tone: result.annual_return >= 0 ? 'up' : 'down',
      hint: '复利年化',
    },
    {
      label: '最大回撤',
      value: `${result.max_drawdown.toFixed(2)}%`,
      icon: TrendingDown,
      tone: 'down',
      hint: '历史最大跌幅',
    },
    {
      label: '夏普比率',
      value: result.sharpe_ratio.toFixed(2),
      icon: Activity,
      tone: result.sharpe_ratio >= 1 ? 'primary' : 'flat',
      hint: result.sharpe_ratio >= 1 ? '风险调整后收益优秀' : '收益波动比偏低',
    },
    {
      label: '胜率',
      value: `${result.win_rate.toFixed(1)}%`,
      icon: Target,
      tone: result.win_rate >= 50 ? 'up' : 'flat',
      hint: `${result.profit_trades}盈 / ${result.loss_trades}亏`,
    },
    {
      label: '交易次数',
      value: String(result.total_trades),
      icon: PieChart,
      tone: 'primary',
      hint: `平均持仓 ${result.avg_hold_days.toFixed(1)} 天`,
    },
    {
      label: 'Alpha',
      value: result.alpha >= 0 ? `+${result.alpha.toFixed(2)}%` : `${result.alpha.toFixed(2)}%`,
      icon: Award,
      tone: result.alpha >= 0 ? 'up' : 'down',
      hint: `基准 ${result.benchmark_return >= 0 ? '+' : ''}${result.benchmark_return.toFixed(2)}%`,
    },
    {
      label: 'Beta',
      value: result.beta.toFixed(2),
      icon: Scale,
      tone: 'flat',
      hint: '相对基准波动',
    },
  ]

  const toneColor: Record<string, string> = {
    primary: 'var(--quant-primary)',
    up: 'var(--quant-up)',
    down: 'var(--quant-down)',
    flat: 'var(--quant-flat)',
  }
  const toneGlow: Record<string, string> = {
    primary: 'rgba(245, 158, 11, 0.18)',
    up: 'rgba(239, 68, 68, 0.18)',
    down: 'rgba(16, 185, 129, 0.18)',
    flat: 'rgba(148, 163, 184, 0.12)',
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((s, i) => {
        const color = toneColor[s.tone]
        const glow = toneGlow[s.tone]
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
// 子组件 2: 收益曲线 SVG
// ============================================================================

interface EquityCurveCardProps {
  result: BacktestResultDTO
}

function EquityCurveCard({ result }: EquityCurveCardProps) {
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)

  const W = 920
  const H = 320
  const padding = { top: 16, right: 70, bottom: 32, left: 8 }
  const plotW = W - padding.left - padding.right
  const plotH = H - padding.top - padding.bottom

  const daily = result.daily_equity
  const initialCap = result.initial_capital
  const benchmarkReturn = result.benchmark_return / 100.0

  // 计算基准曲线（线性插值到 final_cap * (1 + benchmark_return)）
  const benchmarkFinal = initialCap * (1 + benchmarkReturn)

  // Y 范围: 取所有 equity 和 benchmarkFinal 的并集，留 8% padding
  const allVals = [...daily.map((d) => d.equity), initialCap, benchmarkFinal]
  const yMax = Math.max(...allVals)
  const yMin = Math.min(...allVals)
  const range = yMax - yMin || 1
  const pad = range * 0.08
  const yTop = yMax + pad
  const yBot = Math.max(0, yMin - pad)
  const yRange = yTop - yBot || 1

  const n = daily.length
  const idxToX = (i: number) => padding.left + (i / Math.max(1, n - 1)) * plotW
  const valToY = (v: number) => padding.top + (1 - (v - yBot) / yRange) * plotH

  // 策略资产路径
  const equityPath = daily
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${idxToX(i).toFixed(1)} ${valToY(d.equity).toFixed(1)}`)
    .join(' ')

  // 策略资产填充区域（到 yBot 基线）
  const equityArea = `${equityPath} L ${idxToX(n - 1).toFixed(1)} ${valToY(yBot).toFixed(1)} L ${idxToX(0).toFixed(1)} ${valToY(yBot).toFixed(1)} Z`

  // 基准路径（线性从 initialCap 到 benchmarkFinal）
  const benchPath = daily
    .map((d, i) => {
      const ratio = n > 1 ? i / (n - 1) : 0
      const v = initialCap + (benchmarkFinal - initialCap) * ratio
      return `${i === 0 ? 'M' : 'L'} ${idxToX(i).toFixed(1)} ${valToY(v).toFixed(1)}`
    })
    .join(' ')

  // 回撤阴影区域: 当 drawdown < 0 时画一个矩形
  const drawdownSegments: Array<{ x1: number; x2: number; yTop: number; yBot: number }> = []
  let segStart: number | null = null
  for (let i = 0; i < n; i++) {
    if (daily[i].drawdown < -0.01) {
      if (segStart === null) segStart = i
    } else {
      if (segStart !== null) {
        drawdownSegments.push({
          x1: idxToX(segStart),
          x2: idxToX(i),
          yTop: padding.top,
          yBot: padding.top + plotH,
        })
        segStart = null
      }
    }
  }
  if (segStart !== null) {
    drawdownSegments.push({
      x1: idxToX(segStart),
      x2: idxToX(n - 1),
      yTop: padding.top,
      yBot: padding.top + plotH,
    })
  }

  // Y 轴刻度 (5 档)
  const yTicks = Array.from({ length: 5 }, (_, i) => yBot + (i / 4) * yRange)

  // X 轴刻度（最多 6 个）
  const xTickEvery = Math.max(1, Math.ceil(n / 6))
  const xTicks: Array<{ x: number; label: string }> = []
  for (let i = 0; i < n; i += xTickEvery) {
    xTicks.push({ x: idxToX(i), label: daily[i].date.slice(5) })
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    // 反推索引
    const idx = Math.round(((x - padding.left) / plotW) * (n - 1))
    if (idx >= 0 && idx < n) {
      setHoverIdx(idx)
    } else {
      setHoverIdx(null)
    }
  }

  const hover = hoverIdx !== null ? daily[hoverIdx] : null
  const benchAtHover = hoverIdx !== null
    ? initialCap + (benchmarkFinal - initialCap) * (n > 1 ? hoverIdx / (n - 1) : 0)
    : 0

  // 图例
  const legend = [
    { color: 'var(--quant-primary)', label: '策略资产', solid: true },
    { color: 'var(--quant-flat)', label: '基准', dashed: true },
    { color: 'var(--quant-down)', label: '回撤区间', fill: true },
  ]

  return (
    <Card className="p-4 gap-0 bg-quant-card border-quant">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-quant-primary" />
          <span className="text-sm font-semibold">收益曲线</span>
          <Badge variant="outline" className="text-[10px] border-quant font-mono">
            {result.daily_equity.length} 个交易日
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {legend.map((l, i) => (
            <span key={i} className="flex items-center gap-1">
              {l.solid && <span className="inline-block w-3 h-0.5" style={{ backgroundColor: l.color }} />}
              {l.dashed && (
                <span
                  className="inline-block w-3 h-0.5"
                  style={{
                    backgroundColor: l.color,
                    backgroundImage: 'linear-gradient(to right, currentColor 50%, transparent 50%)',
                    backgroundSize: '4px 100%',
                  }}
                />
              )}
              {l.fill && <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: l.color, opacity: 0.2 }} />}
              {l.label}
            </span>
          ))}
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ userSelect: 'none' }}
      >
        {/* Y 轴网格 */}
        {yTicks.map((v, i) => {
          const y = valToY(v)
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={W - padding.right}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.06}
                strokeDasharray="2 3"
              />
              <text
                x={W - padding.right + 4}
                y={y + 3}
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.5}
                className="tabular-nums"
              >
                ¥{v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toFixed(0)}
              </text>
            </g>
          )
        })}

        {/* X 轴刻度 */}
        {xTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={t.x}
              y1={padding.top + plotH}
              x2={t.x}
              y2={padding.top + plotH + 4}
              stroke="currentColor"
              strokeOpacity={0.3}
            />
            <text
              x={t.x}
              y={padding.top + plotH + 16}
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.5}
              textAnchor="middle"
              className="tabular-nums"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* 回撤阴影 */}
        {drawdownSegments.map((s, i) => (
          <rect
            key={`dd-${i}`}
            x={s.x1}
            y={s.yTop}
            width={Math.max(0, s.x2 - s.x1)}
            height={s.yBot - s.yTop}
            fill="var(--quant-down)"
            fillOpacity={0.06}
          />
        ))}

        {/* 策略资产填充区 */}
        <path d={equityArea} fill="var(--quant-primary)" fillOpacity={0.08} />

        {/* 基准线 */}
        <path
          d={benchPath}
          fill="none"
          stroke="var(--quant-flat)"
          strokeWidth={1.2}
          strokeOpacity={0.7}
          strokeDasharray="4 3"
        />

        {/* 策略资产曲线 */}
        <path
          d={equityPath}
          fill="none"
          stroke="var(--quant-primary)"
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 十字光标 */}
        {hoverIdx !== null && hover && (
          <g pointerEvents="none">
            <line
              x1={idxToX(hoverIdx)}
              y1={padding.top}
              x2={idxToX(hoverIdx)}
              y2={padding.top + plotH}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeDasharray="2 2"
            />
            <line
              x1={padding.left}
              y1={valToY(hover.equity)}
              x2={W - padding.right}
              y2={valToY(hover.equity)}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeDasharray="2 2"
            />
            {/* 策略点 */}
            <circle
              cx={idxToX(hoverIdx)}
              cy={valToY(hover.equity)}
              r={3.5}
              fill="var(--quant-primary)"
              stroke="var(--quant-bg)"
              strokeWidth={1.5}
            />
            {/* 基准点 */}
            <circle
              cx={idxToX(hoverIdx)}
              cy={valToY(benchAtHover)}
              r={2.5}
              fill="var(--quant-flat)"
              stroke="var(--quant-bg)"
              strokeWidth={1}
            />
          </g>
        )}

        {/* Tooltip 文本 */}
        {hoverIdx !== null && hover && (
          <g pointerEvents="none">
            {/* 背景框 */}
            <rect
              x={Math.min(idxToX(hoverIdx) + 8, W - padding.right - 180)}
              y={padding.top + 4}
              width={172}
              height={64}
              rx={4}
              fill="var(--quant-bg)"
              fillOpacity={0.95}
              stroke="var(--quant-primary)"
              strokeOpacity={0.3}
            />
            <text
              x={Math.min(idxToX(hoverIdx) + 14, W - padding.right - 174)}
              y={padding.top + 18}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.85}
              className="tabular-nums"
            >
              {hover.date}
            </text>
            <text
              x={Math.min(idxToX(hoverIdx) + 14, W - padding.right - 174)}
              y={padding.top + 34}
              fontSize={10}
              fill="var(--quant-primary)"
              className="tabular-nums"
            >
              资产 ¥{hover.equity.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
            </text>
            <text
              x={Math.min(idxToX(hoverIdx) + 14, W - padding.right - 174)}
              y={padding.top + 48}
              fontSize={10}
              fill={hover.return_pct >= 0 ? 'var(--quant-up)' : 'var(--quant-down)'}
              className="tabular-nums"
            >
              收益 {hover.return_pct >= 0 ? '+' : ''}{hover.return_pct.toFixed(2)}%
            </text>
            <text
              x={Math.min(idxToX(hoverIdx) + 14, W - padding.right - 174)}
              y={padding.top + 62}
              fontSize={10}
              fill="var(--quant-down)"
              className="tabular-nums"
            >
              回撤 {hover.drawdown.toFixed(2)}%
            </text>
          </g>
        )}
      </svg>
    </Card>
  )
}

// ============================================================================
// 子组件 3: 交易记录表格
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

  const summary = [
    {
      label: '总交易次数',
      value: String(result.total_trades),
      tone: 'primary',
    },
    {
      label: '盈利次数',
      value: String(result.profit_trades),
      tone: 'up',
    },
    {
      label: '亏损次数',
      value: String(result.loss_trades),
      tone: 'down',
    },
    {
      label: '胜率',
      value: `${result.win_rate.toFixed(1)}%`,
      tone: 'primary',
    },
    {
      label: '累计盈亏',
      value: `${totalPnl >= 0 ? '+' : ''}¥${totalPnl.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`,
      tone: totalPnl >= 0 ? 'up' : 'down',
    },
    {
      label: '平均收益率',
      value: `${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(2)}%`,
      tone: avgPnlPct >= 0 ? 'up' : 'down',
    },
  ]

  const toneColor: Record<string, string> = {
    primary: 'var(--quant-primary)',
    up: 'var(--quant-up)',
    down: 'var(--quant-down)',
  }

  const columns: Column<typeof trades[number]>[] = [
    {
      key: 'stock_code',
      header: '代码',
      width: '6rem',
      render: (t) => <span className="font-mono text-xs">{t.stock_code}</span>,
    },
    {
      key: 'stock_name',
      header: '名称',
      width: '6rem',
      render: (t) => <span className="text-xs">{t.stock_name}</span>,
    },
    {
      key: 'entry_date',
      header: '买入日',
      width: '6rem',
      render: (t) => (
        <span className="text-xs text-muted-foreground tabular-nums">{t.entry_date}</span>
      ),
      sortValue: (t) => t.entry_date,
    },
    {
      key: 'exit_date',
      header: '卖出日',
      width: '6rem',
      render: (t) => (
        <span className="text-xs text-muted-foreground tabular-nums">{t.exit_date}</span>
      ),
      sortValue: (t) => t.exit_date,
    },
    {
      key: 'entry_price',
      header: '买入价',
      align: 'right',
      width: '5rem',
      render: (t) => (
        <span className="text-xs tabular-nums font-mono">{t.entry_price.toFixed(2)}</span>
      ),
      sortValue: (t) => t.entry_price,
    },
    {
      key: 'exit_price',
      header: '卖出价',
      align: 'right',
      width: '5rem',
      render: (t) => (
        <span className="text-xs tabular-nums font-mono">{t.exit_price.toFixed(2)}</span>
      ),
      sortValue: (t) => t.exit_price,
    },
    {
      key: 'hold_days',
      header: '持仓天数',
      align: 'center',
      width: '5rem',
      render: (t) => (
        <Badge variant="outline" className="text-[10px] border-quant font-mono">
          {t.hold_days}d
        </Badge>
      ),
      sortValue: (t) => t.hold_days,
    },
    {
      key: 'pnl_pct',
      header: '收益率',
      align: 'right',
      width: '6rem',
      render: (t) => (
        <span
          className="text-xs tabular-nums font-mono font-semibold"
          style={{ color: t.pnl_pct >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}
        >
          {t.pnl_pct >= 0 ? '+' : ''}
          {t.pnl_pct.toFixed(2)}%
        </span>
      ),
      sortValue: (t) => t.pnl_pct,
    },
    {
      key: 'pnl_amount',
      header: '收益金额',
      align: 'right',
      width: '7rem',
      render: (t) => (
        <span
          className="text-xs tabular-nums font-mono"
          style={{ color: t.pnl_amount >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}
        >
          {t.pnl_amount >= 0 ? '+' : ''}
          ¥{t.pnl_amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
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
              <span className="font-mono tabular-nums font-semibold" style={{ color: toneColor[s.tone] }}>
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
// 子组件 4: 历史回测表格
// ============================================================================

interface HistoryTableProps {
  history: BacktestHistoryItemDTO[]
  loadingId: string | null
  onLoad: (runId: string) => void
}

function HistoryTable({ history, loadingId, onLoad }: HistoryTableProps) {
  const columns: Column<BacktestHistoryItemDTO>[] = [
    {
      key: 'run_id',
      header: 'Run ID',
      width: '6rem',
      render: (h) => (
        <span className="font-mono text-xs text-muted-foreground">{h.run_id.slice(0, 8)}</span>
      ),
    },
    {
      key: 'strategy',
      header: '策略',
      width: '8rem',
      render: (h) => (
        <Badge variant="outline" className="font-mono text-xs border-quant">
          {h.strategy_emoji} {h.strategy_name}
        </Badge>
      ),
    },
    {
      key: 'range',
      header: '日期范围',
      width: '10rem',
      render: (h) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {h.start_date} ~ {h.end_date}
        </span>
      ),
    },
    {
      key: 'total_return',
      header: '总收益',
      align: 'right',
      width: '6rem',
      render: (h) => (
        <span
          className="text-xs tabular-nums font-mono font-semibold"
          style={{ color: h.total_return >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}
        >
          {h.total_return >= 0 ? '+' : ''}
          {h.total_return.toFixed(2)}%
        </span>
      ),
      sortValue: (h) => h.total_return,
    },
    {
      key: 'max_drawdown',
      header: '最大回撤',
      align: 'right',
      width: '6rem',
      render: (h) => (
        <span className="text-xs tabular-nums font-mono text-[var(--quant-down)]">
          {h.max_drawdown.toFixed(2)}%
        </span>
      ),
      sortValue: (h) => h.max_drawdown,
    },
    {
      key: 'sharpe_ratio',
      header: '夏普',
      align: 'right',
      width: '5rem',
      render: (h) => (
        <span
          className="text-xs tabular-nums font-mono"
          style={{ color: h.sharpe_ratio >= 1 ? 'var(--quant-primary)' : 'var(--muted-foreground)' }}
        >
          {h.sharpe_ratio.toFixed(2)}
        </span>
      ),
      sortValue: (h) => h.sharpe_ratio,
    },
    {
      key: 'created_at',
      header: '创建时间',
      align: 'right',
      width: '9rem',
      render: (h) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {h.created_at ? new Date(h.created_at).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }) : '-'}
        </span>
      ),
      sortValue: (h) => h.created_at,
    },
    {
      key: 'action',
      header: '操作',
      align: 'center',
      width: '5rem',
      render: (h) => (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 border-quant text-xs gap-1 hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30"
          onClick={(e) => {
            e.stopPropagation()
            onLoad(h.run_id)
          }}
          disabled={loadingId === h.run_id}
        >
          {loadingId === h.run_id ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Eye className="size-3" />
          )}
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
