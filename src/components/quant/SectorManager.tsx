'use client'

/**
 * 板块管理
 * - 策略↔板块映射表
 * - 每板块：查看股票/手动刷新/编辑映射（占位）
 * - 板块股票表格 + 涨跌幅 + 统计汇总
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { RefreshCw, Eye, Layers, Link2, Calendar, TrendingUp, TrendingDown, Activity, CandlestickChart, X, Download, FileSpreadsheet, FileText } from 'lucide-react'
import { StockTable, type Column } from './StockTable'
import { ScoreBadge } from './ScoreBadge'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'
import { MiniKline, generateMockKline } from './MiniKline'
import { toast } from 'sonner'
import {
  sectorAPI,
  monitorAPI,
  type SectorDTO,
  type SectorStockDTO,
  type QuoteDTO,
} from '@/lib/api'

export function SectorManager() {
  const [sectors, setSectors] = React.useState<SectorDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState<string | null>(null)
  const [viewSector, setViewSector] = React.useState<SectorDTO | null>(null)
  const [stocks, setStocks] = React.useState<SectorStockDTO[]>([])
  const [stocksLoading, setStocksLoading] = React.useState(false)
  const [quotes, setQuotes] = React.useState<Record<string, QuoteDTO>>({})
  // K线图弹窗
  const [klineStock, setKlineStock] = React.useState<SectorStockDTO | null>(null)
  const [klineDays, setKlineDays] = React.useState<30 | 60 | 120>(30)
  // 缓存 mock kline 数据 (避免每次重新生成)
  const klineCache = React.useRef<Map<string, ReturnType<typeof generateMockKline>>>(new Map())
  // 导出全部: loading 状态
  const [exporting, setExporting] = React.useState<'csv' | 'excel' | null>(null)

  const getKline = (code: string, days: number) => {
    const key = `${code}:${days}`
    if (!klineCache.current.has(key)) {
      klineCache.current.set(key, generateMockKline(code, days))
    }
    return klineCache.current.get(key)!
  }

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await sectorAPI.list()
      setSectors(data)
    } catch (e) {
      toast.error('加载板块失败', { description: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const handleRefresh = async (code: string) => {
    setRefreshing(code)
    try {
      const r = await sectorAPI.refresh(code)
      toast.success(`板块 ${code} 已刷新`, { description: `当前 ${r.count} 只股票` })
      await load()
    } catch (e) {
      toast.error('刷新失败', { description: (e as Error).message })
    } finally {
      setRefreshing(null)
    }
  }

  const handleView = async (s: SectorDTO) => {
    setViewSector(s)
    setStocksLoading(true)
    setQuotes({})
    try {
      const data = await sectorAPI.getStocks(s.code)
      setStocks(data)
      // 同时拉取这些股票的实时行情（通过 monitor quotes，拉取更多以保证覆盖）
      try {
        const qs = await monitorAPI.getQuotes(200)
        const qmap: Record<string, QuoteDTO> = {}
        for (const q of qs) {
          qmap[q.code] = q
        }
        setQuotes(qmap)
      } catch {
        /* 行情拉取失败不阻断 */
      }
    } catch (e) {
      toast.error('加载股票失败', { description: (e as Error).message })
    } finally {
      setStocksLoading(false)
    }
  }

  // 导出全部板块
  const handleExportAll = async (format: 'csv' | 'excel') => {
    if (sectors.length === 0) {
      toast.warning('暂无板块数据可导出')
      return
    }
    setExporting(format)
    const toastId = toast.loading(`正在导出全部板块 (${format.toUpperCase()})...`)
    try {
      const blob = await sectorAPI.exportAll(format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      a.download = `sectors_all_${dateStr}.${format === 'csv' ? 'csv' : 'xlsx'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${sectors.length} 个板块 (${format.toUpperCase()})`, {
        id: toastId,
        description: `文件已下载到本地`,
      })
    } catch (e) {
      toast.error('导出失败', {
        id: toastId,
        description: (e as Error).message,
      })
    } finally {
      setExporting(null)
    }
  }

  // 派生统计：根据 quotes 计算涨跌分布
  const stats = React.useMemo(() => {
    const codes = stocks.map((s) => s.stock_code)
    const matched = codes.map((c) => quotes[c]).filter(Boolean)
    if (matched.length === 0) {
      return { total: stocks.length, up: 0, down: 0, flat: 0, avgPct: 0, hasQuote: false }
    }
    const up = matched.filter((q) => q.pct > 0).length
    const down = matched.filter((q) => q.pct < 0).length
    const flat = matched.length - up - down
    const avgPct = matched.reduce((sum, q) => sum + q.pct, 0) / matched.length
    return {
      total: stocks.length,
      up,
      down,
      flat,
      avgPct: avgPct * 100,
      hasQuote: true,
    }
  }, [stocks, quotes])

  const stockColumns: Column<SectorStockDTO>[] = [
    {
      key: 'code',
      header: '代码',
      width: '6rem',
      render: (r) => <span className="font-mono text-xs">{r.stock_code}</span>,
    },
    {
      key: 'name',
      header: '名称',
      width: '8rem',
      render: (r) => <span className="text-xs">{r.stock_name || '—'}</span>,
    },
    {
      key: 'price',
      header: '现价',
      align: 'right',
      width: '5rem',
      render: (r) => {
        const q = quotes[r.stock_code]
        if (!q) return <span className="text-xs text-muted-foreground/50">—</span>
        return (
          <span className="text-xs tabular-nums" style={{ color: q.pct >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}>
            {q.last.toFixed(2)}
          </span>
        )
      },
      sortValue: (r) => quotes[r.stock_code]?.last ?? 0,
    },
    {
      key: 'pct',
      header: '涨跌幅',
      align: 'right',
      width: '6rem',
      render: (r) => {
        const q = quotes[r.stock_code]
        if (!q) return <span className="text-xs text-muted-foreground/50">—</span>
        const pct = q.pct * 100
        const isUp = pct >= 0
        return (
          <span
            className="text-xs tabular-nums font-medium px-1.5 py-0.5 rounded"
            style={{
              color: isUp ? 'var(--quant-up)' : 'var(--quant-down)',
              backgroundColor: isUp
                ? 'rgba(239, 68, 68, 0.1)'
                : 'rgba(16, 185, 129, 0.1)',
            }}
          >
            {isUp ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
          </span>
        )
      },
      sortValue: (r) => quotes[r.stock_code]?.pct ?? 0,
    },
    {
      key: 'score',
      header: '得分',
      align: 'right',
      width: '7rem',
      render: (r) => <ScoreBadge score={r.score} size="sm" />,
      sortValue: (r) => r.score,
    },
    {
      key: 'added',
      header: '加入时间',
      align: 'right',
      render: (r) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {r.added_at
            ? new Date(r.added_at).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '—'}
        </span>
      ),
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      width: '4rem',
      render: (r) => (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs hover:bg-amber-500/10 hover:text-amber-400"
          onClick={(e) => {
            e.stopPropagation()
            setKlineStock(r)
          }}
          title="查看K线图"
        >
          <CandlestickChart className="size-3.5" />
          K线
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {/* 顶部说明 */}
      <Card className="p-3 gap-0 bg-quant-card border-quant">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Layers className="size-4 text-quant-primary" />
            <span className="font-semibold">策略 ↔ 板块映射</span>
            <Badge variant="outline" className="border-quant">
              {sectors.length} 个板块
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-quant hover:border-[var(--quant-primary)]/40 hover:bg-amber-500/10 hover:text-amber-400"
                  disabled={!!exporting || loading || sectors.length === 0}
                  title="导出全部板块成份股"
                >
                  <Download className={`size-3.5 ${exporting ? 'animate-pulse' : ''}`} />
                  <span className="hidden sm:inline">{exporting ? `导出中(${exporting.toUpperCase()})` : '导出全部'}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  选择导出格式
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => handleExportAll('csv')}
                >
                  <FileText className="size-4 text-amber-400" />
                  <div className="flex flex-col">
                    <span className="text-sm">CSV</span>
                    <span className="text-[10px] text-muted-foreground">多段空行分隔</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => handleExportAll('excel')}
                >
                  <FileSpreadsheet className="size-4 text-emerald-400" />
                  <div className="flex flex-col">
                    <span className="text-sm">Excel (.xlsx)</span>
                    <span className="text-[10px] text-muted-foreground">每板块一个 Sheet</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" className="h-8" onClick={load} disabled={loading}>
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mt-1.5">
          板块 Code 命名规则：<span className="font-mono">ZD_&lt;策略拼音大写&gt;01</span>
          ，数据来源 <span className="font-mono">config/sector_mapping.yaml</span>
        </div>
      </Card>

      {/* 板块卡片网格 */}
      {loading ? (
        <LoadingState variant="cards" rows={5} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3" />
      ) : sectors.length === 0 ? (
        <Card className="bg-quant-card border-quant">
          <EmptyState text="暂无板块映射" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {sectors.map((s) => (
            <Card key={s.code} className="p-4 gap-2 bg-quant-card border-quant hover:border-[var(--quant-primary)]/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{s.name}</div>
                  <div className="text-xs font-mono text-quant-primary truncate">{s.code}</div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    s.auto_update
                      ? 'text-up border-[var(--quant-up)]/30 bg-[var(--quant-up)]/10'
                      : 'text-muted-foreground border-quant'
                  }
                >
                  {s.auto_update ? '自动更新' : '手动'}
                </Badge>
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Link2 className="size-3" />
                  {s.strategy_name}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-quant-primary tabular-nums font-semibold">
                  {s.stock_count} 只
                </span>
                <span className="text-muted-foreground">
                  模式: {s.update_mode === 'replace' ? '替换' : '追加'}
                </span>
              </div>

              {/* 股票数量进度条 (相对 30 目标) */}
              <div className="h-1 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500/60 to-amber-400 transition-all duration-500"
                  style={{ width: `${Math.min(100, (s.stock_count / 30) * 100)}%` }}
                />
              </div>

              {s.last_update && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Calendar className="size-3" />
                  {new Date(s.last_update).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              )}

              <div className="flex items-center gap-1 pt-1.5 border-t border-quant">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 flex-1 text-xs"
                  onClick={() => handleView(s)}
                >
                  <Eye className="size-3" />
                  查看股票
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => handleRefresh(s.code)}
                  disabled={refreshing === s.code}
                  title="手动刷新"
                >
                  <RefreshCw className={`size-3 ${refreshing === s.code ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 查看股票 Dialog */}
      <Dialog open={!!viewSector} onOpenChange={(v) => !v && setViewSector(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="size-5 text-quant-primary" />
              {viewSector?.name}
              <Badge variant="outline" className="ml-2 font-mono text-xs border-quant">
                {viewSector?.code}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              关联策略 {viewSector?.strategy_name} · 共 {stocks.length} 只股票
            </DialogDescription>
          </DialogHeader>

          {/* 统计汇总栏 */}
          {stocks.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2 rounded-md border border-quant bg-quant-card/50">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center rounded size-7 bg-amber-500/10">
                  <Activity className="size-3.5 text-amber-400" />
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">总数</div>
                  <div className="text-sm font-semibold tabular-nums">{stats.total}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center rounded size-7 bg-[var(--quant-up)]/10">
                  <TrendingUp className="size-3.5" style={{ color: 'var(--quant-up)' }} />
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">上涨</div>
                  <div className="text-sm font-semibold tabular-nums" style={{ color: 'var(--quant-up)' }}>
                    {stats.up}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center rounded size-7 bg-[var(--quant-down)]/10">
                  <TrendingDown className="size-3.5" style={{ color: 'var(--quant-down)' }} />
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">下跌</div>
                  <div className="text-sm font-semibold tabular-nums" style={{ color: 'var(--quant-down)' }}>
                    {stats.down}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center justify-center rounded size-7"
                  style={{
                    backgroundColor: stats.avgPct >= 0
                      ? 'rgba(239, 68, 68, 0.1)'
                      : 'rgba(16, 185, 129, 0.1)',
                  }}
                >
                  <span
                    className="text-xs font-bold tabular-nums"
                    style={{ color: stats.avgPct >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}
                  >
                    {stats.avgPct >= 0 ? '▲' : '▼'}
                  </span>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">平均涨跌</div>
                  <div
                    className="text-sm font-semibold tabular-nums"
                    style={{ color: stats.avgPct >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}
                  >
                    {stats.hasQuote ? `${stats.avgPct >= 0 ? '+' : ''}${stats.avgPct.toFixed(2)}%` : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {stocksLoading ? (
              <LoadingState rows={6} />
            ) : stocks.length === 0 ? (
              <EmptyState text="板块暂无股票" />
            ) : (
              <StockTable
                columns={stockColumns}
                data={stocks}
                rowKey={(r) => r.stock_code}
                maxHeight="28rem"
                pageSize={50}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* K线图弹窗 */}
      <Dialog open={!!klineStock} onOpenChange={(v) => !v && setKlineStock(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <CandlestickChart className="size-5 text-amber-400" />
              <span className="font-mono">{klineStock?.stock_code}</span>
              <span>{klineStock?.stock_name || '—'}</span>
              {quotes[klineStock?.stock_code ?? ''] && (
                <Badge variant="outline" className="ml-2 font-mono text-xs border-quant">
                  <span style={{ color: quotes[klineStock!.stock_code].pct >= 0 ? 'var(--quant-up)' : 'var(--quant-down)' }}>
                    现价 {quotes[klineStock!.stock_code].last.toFixed(2)}
                  </span>
                </Badge>
              )}
              {klineStock && (
                <Badge variant="outline" className="font-mono text-xs border-quant">
                  得分 {klineStock.score.toFixed(1)}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7"
                onClick={() => setKlineStock(null)}
              >
                <X className="size-4" />
              </Button>
            </DialogTitle>
            <DialogDescription>
              模拟 K线图（30 / 60 / 120 日）· 实盘模式将从 tqcenter 拉取真实数据
            </DialogDescription>
          </DialogHeader>

          {/* 周期切换 */}
          <div className="flex items-center gap-1.5">
            {([30, 60, 120] as const).map((d) => (
              <Button
                key={d}
                size="sm"
                variant={klineDays === d ? 'default' : 'outline'}
                className={
                  klineDays === d
                    ? 'h-7 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25'
                    : 'h-7 border-quant text-xs'
                }
                onClick={() => setKlineDays(d)}
              >
                {d}日
              </Button>
            ))}
            <span className="ml-auto text-[10px] text-muted-foreground">
              数据源: mock · 刷新即重新生成
            </span>
          </div>

          {/* K线主体 */}
          {klineStock && (
            <div className="rounded-md border border-quant bg-quant-card/30 p-3">
              <MiniKline
                bars={getKline(klineStock.stock_code, klineDays)}
                width={720}
                height={280}
                title={`${klineStock.stock_name || klineStock.stock_code} · 日K`}
              />
            </div>
          )}

          {/* 关键统计 */}
          {klineStock && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {(() => {
                const bars = getKline(klineStock.stock_code, klineDays)
                if (bars.length === 0) return null
                const last = bars[bars.length - 1]
                const first = bars[0]
                const high = Math.max(...bars.map((b) => b.high))
                const low = Math.min(...bars.map((b) => b.low))
                const totalVol = bars.reduce((s, b) => s + b.volume, 0)
                const changePct = ((last.close - first.open) / first.open) * 100
                const isUp = changePct >= 0
                return (
                  <>
                    <div className="rounded-md p-2 border border-quant bg-background/40">
                      <div className="text-[10px] text-muted-foreground">区间涨跌</div>
                      <div
                        className="font-mono font-semibold tabular-nums"
                        style={{ color: isUp ? 'var(--quant-up)' : 'var(--quant-down)' }}
                      >
                        {isUp ? '+' : ''}
                        {changePct.toFixed(2)}%
                      </div>
                    </div>
                    <div className="rounded-md p-2 border border-quant bg-background/40">
                      <div className="text-[10px] text-muted-foreground">最高价</div>
                      <div className="font-mono font-semibold tabular-nums text-up">
                        {high.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-md p-2 border border-quant bg-background/40">
                      <div className="text-[10px] text-muted-foreground">最低价</div>
                      <div className="font-mono font-semibold tabular-nums text-down">
                        {low.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-md p-2 border border-quant bg-background/40">
                      <div className="text-[10px] text-muted-foreground">总成交</div>
                      <div className="font-mono font-semibold tabular-nums text-foreground/80">
                        {(totalVol / 100000000).toFixed(2)}亿
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
