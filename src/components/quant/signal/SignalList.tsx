'use client'

/**
 * SignalList — 信号列表 + 30s 轮询 + 类型统计 + CSV 导出。
 * 内含 SectorLinkageButton (同板块联动 Popover)。
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  RefreshCw, Download, AlertCircle, Database, Link2, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { StockTable, type Column } from '../StockTable'
import { LoadingState } from '../LoadingState'
import { EmptyState } from '../EmptyState'
import {
  signalAPI,
  type SignalDTO, type StrategyDTO, type SectorLinkageDTO,
} from '@/lib/api'
import {
  TYPE_META, PUSH_STATUS_META, CHANNEL_BADGE_META,
  EXPORT_CONFIRM_THRESHOLD, csvEscape, isNewSignal,
} from './shared'

export interface SignalListProps {
  signals: SignalDTO[]
  totalCount: number
  loading: boolean
  strategies: StrategyDTO[]
  repushing: Set<string>
  onRepush: (signal: SignalDTO) => void
  onOpenDetail: (signal: SignalDTO) => void
  typeFilter: string
  setTypeFilter: (v: string) => void
}

export function SignalList({
  signals, totalCount, loading, strategies, repushing,
  onRepush, onOpenDetail, typeFilter, setTypeFilter,
}: SignalListProps) {
  // 30s 刷新"新信号"标记
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // R14-3: 同板块联动开关状态探测
  const [linkageEnabled, setLinkageEnabled] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    if (!signals.length) return
    const probe = signals.find((s) => s.stock_code)
    if (!probe) { setLinkageEnabled(false); return }
    signalAPI
      .getRelated(probe.id)
      .then((r) => setLinkageEnabled(!!r.enabled))
      .catch((e: unknown) => setLinkageEnabled((e as { status?: number })?.status === 404))
  }, [signals])

  const stats = React.useMemo(() => {
    const m: Record<string, number> = {}
    signals.forEach((s) => { m[s.type] = (m[s.type] || 0) + 1 })
    return m
  }, [signals])

  const [exportDialogOpen, setExportDialogOpen] = React.useState(false)

  const handleExportCSV = React.useCallback(() => {
    if (signals.length === 0) { toast.warning('当前无信号可导出'); return }
    try {
      const headers = ['时间', '类型', '策略', '股票代码', '股票名称', '内容', '推送通道', '推送状态']
      const csvRows = signals.map((s) =>
        [
          s.time, TYPE_META[s.type]?.label || s.type,
          s.strategy_name || s.strategy_id || '',
          s.stock_code || '', s.stock_name || '', s.content || '',
          (s.pushed_channels || []).join('|'),
          PUSH_STATUS_META[s.push_status]?.label || s.push_status,
        ].map((cell) => csvEscape(String(cell))).join(',')
      )
      const csv = '\uFEFF' + [headers.join(','), ...csvRows].join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `signals_${new Date().toISOString().slice(0, 10)}_${signals.length}条.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${signals.length} 条信号`, {
        description: `signals_${new Date().toISOString().slice(0, 10)}_${signals.length}条.csv`,
      })
    } catch (e) {
      toast.error('导出失败', { description: (e as Error).message })
    }
  }, [signals])

  const handleExportClick = React.useCallback(() => {
    if (signals.length === 0) { toast.warning('当前无信号可导出'); return }
    if (signals.length > EXPORT_CONFIRM_THRESHOLD) { setExportDialogOpen(true); return }
    handleExportCSV()
  }, [signals.length, handleExportCSV])

  const rowClassName = React.useCallback(
    (s: SignalDTO) => (isNewSignal(s) ? 'signal-row-new' : ''),
    [],
  )

  const columns: Column<SignalDTO>[] = [
    {
      key: 'time', header: '时间', width: '6rem',
      render: (s) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {new Date(s.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      ),
      sortValue: (s) => s.time,
    },
    {
      key: 'type', header: '类型', width: '5rem',
      render: (s) => {
        const meta = TYPE_META[s.type]
        const Icon = meta.icon
        return (
          <span
            className="text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1 border"
            style={{
              color: meta.color,
              backgroundColor: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
              borderColor: `color-mix(in srgb, ${meta.color} 30%, transparent)`,
            }}
          >
            <Icon className="size-3" />
            {meta.label}
          </span>
        )
      },
    },
    {
      key: 'strategy', header: '策略', width: '8rem',
      render: (s) => {
        const name = s.strategy_name
        const sid = s.strategy_id
        if (!name && !sid) return <span className="text-xs text-muted-foreground">—</span>
        const strategy = strategies.find((x) => x.strategy_id === sid)
        const emoji = strategy?.strategy_emoji || ''
        return (
          <span className="text-xs text-foreground/80 truncate inline-flex items-center gap-1">
            {emoji && <span className="shrink-0">{emoji}</span>}
            <span className="truncate">{name || sid}</span>
          </span>
        )
      },
    },
    {
      key: 'stock', header: '股票', width: '9rem',
      render: (s) => {
        if (!s.stock_code && !s.stock_name) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <span className="text-xs font-mono text-foreground/80 inline-flex items-center gap-1">
            {s.stock_name && <span className="text-foreground/90">{s.stock_name}</span>}
            {s.stock_code && <span className="text-muted-foreground">({s.stock_code})</span>}
          </span>
        )
      },
    },
    {
      key: 'content', header: '内容',
      render: (s) => <span className="text-xs text-foreground/90 line-clamp-2">{s.content}</span>,
    },
    {
      key: 'channels', header: '推送通道', align: 'center', width: '8rem',
      render: (s) => (
        <div className="flex flex-wrap gap-1 justify-center">
          {s.pushed_channels.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : s.pushed_channels.map((ch) => {
            const meta = CHANNEL_BADGE_META[ch] || { color: 'var(--quant-flat)', label: ch }
            return (
              <span key={ch} className="text-[10px] px-1.5 py-0.5 rounded border font-medium"
                style={{
                  color: meta.color,
                  backgroundColor: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
                  borderColor: `color-mix(in srgb, ${meta.color} 30%, transparent)`,
                }}
                title={ch}
              >{meta.label}</span>
            )
          })}
        </div>
      ),
    },
    {
      key: 'status', header: '状态', align: 'center', width: '5rem',
      render: (s) => {
        const meta = PUSH_STATUS_META[s.push_status]
        const Icon = meta.icon
        return (
          <span
            className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded border"
            style={{
              color: meta.color,
              backgroundColor: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
              borderColor: `color-mix(in srgb, ${meta.color} 30%, transparent)`,
            }}
          >
            <Icon className="size-3" />
            {meta.label}
          </span>
        )
      },
    },
    {
      key: 'actions', header: '操作', align: 'center', width: '7rem',
      render: (s) => {
        const isRepushing = repushing.has(s.id)
        const showLinkage = linkageEnabled === true && !!s.stock_code
        return (
          <div className="flex items-center justify-center gap-0.5">
            {showLinkage && <SectorLinkageButton signalId={s.id} stockCode={s.stock_code!} />}
            <Button
              variant="ghost" size="sm"
              className="h-7 px-2 text-xs hover:bg-amber-500/10 hover:text-amber-400"
              disabled={isRepushing}
              onClick={(e) => { e.stopPropagation(); onRepush(s) }}
              title="重新推送到所有启用通道"
            >
              <RefreshCw className={cn('size-3', isRepushing && 'animate-spin')} />
              <span className="hidden lg:inline">{isRepushing ? '推送中' : '重推'}</span>
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <>
      {/* 类型统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {(Object.keys(TYPE_META) as SignalDTO['type'][]).map((t) => {
          const meta = TYPE_META[t]
          const Icon = meta.icon
          const count = stats[t] || 0
          const total = signals.length || 1
          const pct = (count / total) * 100
          const isActive = typeFilter === t
          return (
            <Card
              key={t}
              className={`p-3 gap-0 bg-quant-card border-quant cursor-pointer transition-all hover:border-[var(--quant-primary)]/40 hover:shadow-md ${
                isActive ? 'ring-1 ring-amber-500/30 border-amber-500/40' : ''
              }`}
              onClick={() => setTypeFilter(isActive ? 'all' : t)}
              style={{
                backgroundImage: `radial-gradient(circle at top right, color-mix(in srgb, ${meta.color} 15%, transparent) 0%, transparent 60%)`,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="size-8 rounded-md flex items-center justify-center transition-transform hover:scale-110"
                    style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}
                  >
                    <Icon className="size-4" style={{ color: meta.color }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{meta.label}</span>
                </div>
                <span className="text-xl font-semibold tabular-nums" style={{ color: meta.color }}>
                  {count}
                </span>
              </div>
              <div className="mt-2 h-1 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(2, pct)}%`, backgroundColor: meta.color }}
                />
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                {pct.toFixed(1)}% · 点击{isActive ? '取消' : '筛选'}
              </div>
            </Card>
          )
        })}
      </div>

      {/* 图例提示 + 导出工具栏 */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-amber-400 rounded" />
          新信号 (1 分钟内)
        </span>
        <span className="flex items-center gap-1">
          <RefreshCw className="size-3" />
          点击行末&quot;重推&quot;可重新推送到所有启用通道
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline tabular-nums">
            导出当前筛选结果 (共 {signals.length} 条)
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline" size="sm"
                className="h-8 gap-1.5 border-quant text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleExportClick}
                disabled={signals.length === 0 || loading}
              >
                <Download className="size-3.5" />
                导出 CSV
              </Button>
            </TooltipTrigger>
            {(signals.length === 0 || loading) && (
              <TooltipContent side="left">
                {loading ? '数据加载中, 请稍候' : '无信号可导出'}
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </div>

      {/* R13-3c: 导出确认对话框 (>500 条时弹窗) */}
      <AlertDialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <AlertDialogContent className="bg-quant-card border-quant">
          <AlertDialogHeader>
            <AlertDialogTitle>导出确认</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              即将导出{' '}
              <span className="text-amber-400 font-semibold tabular-nums">{signals.length}</span>
              {' '}条信号到 CSV 文件, 是否继续?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-quant hover:bg-quant/40">取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300"
              onClick={() => { setExportDialogOpen(false); handleExportCSV() }}
            >
              <Download className="size-3.5 mr-1.5" />
              确认导出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 表格 */}
      {loading ? (
        <LoadingState rows={10} />
      ) : signals.length === 0 ? (
        <Card className="bg-quant-card border-quant">
          <EmptyState
            text={totalCount === 0 ? '暂无信号' : '当前筛选条件下无信号'}
            description={totalCount === 0 ? '调整筛选条件或稍后再试' : `已过滤 ${totalCount} 条信号, 尝试调整通道筛选`}
          />
        </Card>
      ) : (
        <StockTable
          columns={columns}
          data={signals}
          rowKey={(s) => s.id}
          maxHeight="32rem"
          pageSize={30}
          rowClassName={rowClassName}
          onRowClick={onOpenDetail}
        />
      )}
    </>
  )
}

// ============================================================================
// R14-3: 同板块联动按钮 + Popover (仅 SignalList 内使用)
// ============================================================================

interface SectorLinkageButtonProps {
  signalId: string
  stockCode: string
}

function SectorLinkageButton({ signalId, stockCode }: SectorLinkageButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [data, setData] = React.useState<SectorLinkageDTO | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await signalAPI.getRelated(signalId))
    } catch (e) {
      setError((e as Error).message || '查询联动股失败')
    } finally {
      setLoading(false)
    }
  }, [signalId])

  React.useEffect(() => {
    if (open) load()
  }, [open, load])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost" size="sm"
          className="h-7 px-2 text-xs hover:bg-cyan-500/10 hover:text-cyan-400"
          onClick={(e) => e.stopPropagation()}
          title={`查看 ${stockCode} 同板块联动股`}
        >
          <Link2 className="size-3" />
          <span className="hidden lg:inline">联动</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left" align="center"
        className="w-80 p-3 bg-quant-card border-quant text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-quant">
          <Link2 className="size-3.5 text-cyan-400" />
          <span className="text-xs font-semibold">同板块联动</span>
          {data?.stock_code && (
            <span className="text-[10px] text-muted-foreground font-mono ml-auto">
              {data.stock_name || data.stock_code}
            </span>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 mr-2 animate-spin text-cyan-400" />
            正在查询联动股...
          </div>
        )}

        {!loading && error && (
          <div className="py-4">
            <EmptyState icon={AlertCircle} text="查询失败" description={error} />
          </div>
        )}

        {!loading && !error && data && data.items.length === 0 && (
          <div className="py-4">
            <EmptyState icon={Database} text="无联动股" description="该信号股无概念板块，或联动股不在监控池" />
          </div>
        )}

        {!loading && !error && data && data.items.length > 0 && (
          <div className="space-y-2.5 max-h-80 overflow-y-auto quant-scroll">
            {data.items.map((sector) => (
              <div key={sector.sector_code}
                className="rounded-md border border-quant/60 bg-quant-bg/40 p-2">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
                  <span className="text-xs font-semibold truncate">{sector.sector_name}</span>
                  <Badge variant="outline" className="text-[9px] ml-auto border-quant font-mono">
                    {sector.stocks.length} 只
                  </Badge>
                </div>
                <div className="space-y-0.5">
                  {sector.stocks.map((st) => (
                    <div key={st.code}
                      className="flex items-center justify-between text-[11px] hover:bg-quant-bg/80 rounded px-1 py-0.5">
                      <span className="font-mono text-muted-foreground truncate">{st.code}</span>
                      <span className="text-foreground/80 truncate ml-1">{st.name || '—'}</span>
                      <span className="ml-auto tabular-nums font-mono"
                        style={{
                          color: st.pct > 0 ? 'var(--quant-up)'
                            : st.pct < 0 ? 'var(--quant-down)'
                            : 'var(--quant-flat)',
                        }}
                      >{(st.pct * 100).toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
