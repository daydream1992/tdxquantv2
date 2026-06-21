'use client'

/**
 * 自选股管理 (WatchlistManager)
 *
 * 功能：
 *  1. 表格列出所有 watchlist 项: stock_code / strategy_id badge / subscriber
 *     / subscribed_at (格式化) / active 状态
 *  2. 顶部: 输入框 (股票代码逗号分隔) + strategy_id 下拉 (可选, 默认 _manual) + 加入按钮
 *  3. 每行右侧: 移除按钮 (调 DELETE)
 *  4. 顶部状态条: 显示总数 + active 数 + 按 strategy_id 分组统计
 *  5. 支持 filter (按 strategy_id 筛选 / 按 active 状态筛选)
 *  6. 顶部右侧: 刷新按钮
 *  7. ScrollArea + max-h-96 overflow-y-auto 处理长列表
 *
 * 后端 API:
 *   GET    /api/monitor/watchlist                列表
 *   POST   /api/monitor/watchlist                批量加入 {codes, strategy_id, subscriber}
 *   DELETE /api/monitor/watchlist?code=xxx       移除单只
 */

import * as React from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Star,
  RefreshCw,
  Plus,
  Trash2,
  Loader2,
  Activity,
  AlertCircle,
  Filter,
  X,
  Upload,
  CheckCircle2,
  XCircle,
  ListChecks,
  Layers,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  watchlistAPI,
  strategyAPI,
  sectorAPI,
  stockAPI,
  type WatchlistItemDTO,
  type StrategyDTO,
  type SectorDTO,
  type StockSectorsDTO,
  type StockSectorItemDTO,
} from '@/lib/api'

const MANUAL_STRATEGY = '_manual'

// ============================================================================
// 批量导入: 解析逻辑 & 类型
// ============================================================================

interface ParsedRow {
  code: string
  name: string
  strategy: string
  valid: boolean
  reason: string
}

/**
 * 解析批量导入输入文本。
 *
 * 支持两种格式:
 *  1. CSV 行: `code, name, strategy_id` (第2/3列可空)
 *  2. 仅代码: 每行一个或逗号 / 空格分隔
 *
 * 校验: A股代码必须 6 位纯数字 (前端轻校验, 后端会再做一次)
 */
function parseBatchInput(text: string, defaultStrategy: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  return lines.map((line) => {
    const parts = line
      .split(/[,，\s]+/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length === 0) {
      return { code: '', name: '', strategy: '', valid: false, reason: '空行' }
    }
    const rawCode = parts[0]
    // 去掉可能的 .SH / .SZ / .BJ 后缀
    const code = rawCode.replace(/\.(SH|SZ|BJ)$/i, '')
    const valid = /^\d{6}$/.test(code)
    const name = parts[1] || ''
    const strategy = parts[2] || defaultStrategy
    return {
      code,
      name,
      strategy,
      valid,
      reason: valid ? '' : '代码格式错误(需6位数字)',
    }
  })
}

// ============================================================================
// R14-1: 个股所属板块 HoverCard
// ============================================================================

/**
 * 板块分组渲染（概念/行业/地区子组件）。
 * items 为空时显示 "无"。
 */
function SectorGroup({
  label,
  items,
}: {
  label: string
  items: StockSectorItemDTO[]
}) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
      {items.length === 0 ? (
        <span className="text-[10px] text-muted-foreground">无</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((it) => (
            <Badge
              key={`${it.code || 'na'}-${it.name}`}
              variant="outline"
              className="text-[10px] border-amber-500/40 text-amber-500 bg-amber-500/5"
            >
              {it.name || it.code}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 监控池表格中 stock_code 单元格内的悬停板块查看器。
 * - useRef 缓存已加载过的 code, 避免同一只股反复 hover 重复请求
 * - onOpenChange(open=true) 时: 缓存命中直接用, 否则调 stockAPI.getSectors
 */
function StockSectorHover({ stockCode }: { stockCode: string }) {
  const [data, setData] = React.useState<StockSectorsDTO | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const cacheRef = React.useRef<Record<string, StockSectorsDTO>>({})

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) return
      // 缓存命中
      const cached = cacheRef.current[stockCode]
      if (cached) {
        setData(cached)
        setLoading(false)
        setError('')
        return
      }
      // 拉新
      setLoading(true)
      setError('')
      setData(null)
      stockAPI
        .getSectors(stockCode)
        .then((d) => {
          cacheRef.current[stockCode] = d
          setData(d)
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : '加载板块归属失败')
        })
        .finally(() => setLoading(false))
    },
    [stockCode]
  )

  return (
    <HoverCard openDelay={250} closeDelay={150} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">
          {stockCode}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        className="w-80 text-xs p-3"
      >
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            <span>加载板块归属...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-red-500">
            <AlertCircle className="size-3 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        ) : data ? (
          <div className="space-y-2">
            <div className="font-medium text-foreground">
              {data.stock_code} · 板块归属
            </div>
            <SectorGroup label="概念" items={data.concept} />
            <SectorGroup label="行业" items={data.industry} />
            <SectorGroup label="地区" items={data.region} />
            <div className="pt-1.5 mt-1.5 border-t border-quant text-[10px] text-muted-foreground flex items-center justify-between">
              <span>共 {data.total} 个板块</span>
              {data.from_cache ? (
                <span className="text-emerald-500/70">缓存命中</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  )
}

// ============================================================================
// 主组件
// ============================================================================

export function WatchlistManager() {
  const [items, setItems] = React.useState<WatchlistItemDTO[]>([])
  const [strategies, setStrategies] = React.useState<StrategyDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [adding, setAdding] = React.useState(false)
  const [removingCode, setRemovingCode] = React.useState<string | null>(null)
  // 加入表单
  const [codesInput, setCodesInput] = React.useState('')
  const [strategyId, setStrategyId] = React.useState<string>(MANUAL_STRATEGY)
  // 过滤
  const [filterStrategy, setFilterStrategy] = React.useState<string>('__all__')
  const [filterActive, setFilterActive] = React.useState<'all' | 'active' | 'inactive'>('all')
  // 删除确认
  const [deleteTarget, setDeleteTarget] = React.useState<WatchlistItemDTO | null>(null)
  // 批量导入
  const [batchOpen, setBatchOpen] = React.useState(false)
  const [batchText, setBatchText] = React.useState('')
  const [batchDefaultStrategy, setBatchDefaultStrategy] =
    React.useState<string>(MANUAL_STRATEGY)
  const [batchImporting, setBatchImporting] = React.useState(false)
  // R13-3b: 按板块批量加入
  const [sectors, setSectors] = React.useState<SectorDTO[]>([])
  const [sectorsLoading, setSectorsLoading] = React.useState(false)
  const [bySectorOpen, setBySectorOpen] = React.useState(false)
  const [bySectorCode, setBySectorCode] = React.useState<string>('')
  const [bySectorStrategy, setBySectorStrategy] =
    React.useState<string>(MANUAL_STRATEGY)
  const [bySectorLoading, setBySectorLoading] = React.useState(false)

  // ------------------------------------------------------------------
  // 加载
  // ------------------------------------------------------------------
  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await watchlistAPI.list()
      setItems(data || [])
    } catch (e) {
      toast.error('加载自选股失败', { description: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [])

  const loadStrategies = React.useCallback(async () => {
    try {
      const data = await strategyAPI.list()
      setStrategies(data || [])
    } catch {
      /* 非关键失败，静默 */
    }
  }, [])

  /**
   * R13-3b: 加载板块列表 (供 "按板块加入" Dialog 的 Select 使用)。
   *
   * 只在 Dialog 首次打开且 sectors 为空时拉取, 拉到后缓存到 state。
   */
  const loadSectors = React.useCallback(async () => {
    if (sectors.length > 0 || sectorsLoading) return
    setSectorsLoading(true)
    try {
      const data = await sectorAPI.list()
      setSectors(data || [])
    } catch {
      /* 静默, 用户重开 Dialog 会重试 */
    } finally {
      setSectorsLoading(false)
    }
  }, [sectors.length, sectorsLoading])

  React.useEffect(() => {
    load()
    loadStrategies()
  }, [load, loadStrategies])

  // ------------------------------------------------------------------
  // 加入
  // ------------------------------------------------------------------
  const handleAdd = async () => {
    const codes = codesInput
      .split(/[,，\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (codes.length === 0) {
      toast.error('请输入至少一个股票代码')
      return
    }
    setAdding(true)
    const tid = toast.loading(`正在加入 ${codes.length} 只股票...`)
    try {
      const r = await watchlistAPI.add({
        codes,
        strategy_id: strategyId,
        subscriber: 'web_watchlist',
      })
      toast.success('已加入监控池', {
        id: tid,
        description: r.message,
      })
      setCodesInput('')
      await load()
    } catch (e) {
      toast.error('加入失败', { id: tid, description: (e as Error).message })
    } finally {
      setAdding(false)
    }
  }

  // ------------------------------------------------------------------
  // 移除
  // ------------------------------------------------------------------
  const handleRemove = async () => {
    if (!deleteTarget) return
    setRemovingCode(deleteTarget.stock_code)
    const tid = toast.loading(`正在移除 ${deleteTarget.stock_code}...`)
    try {
      await watchlistAPI.remove(deleteTarget.stock_code)
      toast.success('已移除', {
        id: tid,
        description: deleteTarget.stock_code,
      })
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast.error('移除失败', { id: tid, description: (e as Error).message })
    } finally {
      setRemovingCode(null)
    }
  }

  // ------------------------------------------------------------------
  // 派生统计
  // ------------------------------------------------------------------
  const stats = React.useMemo(() => {
    const total = items.length
    const active = items.filter((x) => x.active).length
    const inactive = total - active
    const byStrategy = new Map<string, number>()
    for (const it of items) {
      const k = it.strategy_id || '(空)'
      byStrategy.set(k, (byStrategy.get(k) || 0) + 1)
    }
    return { total, active, inactive, byStrategy }
  }, [items])

  const strategyOptions = React.useMemo(() => {
    const set = new Set<string>()
    items.forEach((x) => set.add(x.strategy_id || ''))
    strategies.forEach((s) => set.add(s.strategy_id))
    set.add(MANUAL_STRATEGY)
    return Array.from(set).filter(Boolean).sort()
  }, [items, strategies])

  const filtered = React.useMemo(() => {
    return items
      .filter((x) => {
        if (filterStrategy !== '__all__' && x.strategy_id !== filterStrategy) {
          return false
        }
        if (filterActive === 'active' && !x.active) return false
        if (filterActive === 'inactive' && x.active) return false
        return true
      })
      .sort((a, b) => {
        // active 优先, 同 active 按 stock_code
        if (a.active !== b.active) return a.active ? -1 : 1
        return a.stock_code.localeCompare(b.stock_code)
      })
  }, [items, filterStrategy, filterActive])

  // ------------------------------------------------------------------
  // 批量导入: 解析预览 + 分组提交
  // ------------------------------------------------------------------
  const parsedRows = React.useMemo(
    () => parseBatchInput(batchText, batchDefaultStrategy),
    [batchText, batchDefaultStrategy],
  )
  const batchStats = React.useMemo(() => {
    const total = parsedRows.length
    const valid = parsedRows.filter((r) => r.valid).length
    return { total, valid, invalid: total - valid }
  }, [parsedRows])

  const handleBatchImport = async () => {
    const validRows = parsedRows.filter((r) => r.valid)
    if (validRows.length === 0) {
      toast.error('没有可导入的有效行')
      return
    }
    // 按 strategy_id 分组 (后端 add 只接受单个 strategy_id)
    const grouped: Record<string, string[]> = {}
    for (const r of validRows) {
      const sid = r.strategy || batchDefaultStrategy
      ;(grouped[sid] = grouped[sid] || []).push(r.code)
    }
    setBatchImporting(true)
    const tid = toast.loading(
      `正在导入 ${validRows.length} 只股票 (分 ${Object.keys(grouped).length} 组)...`,
    )
    let totalAdded = 0
    let totalSkipped = 0
    const errors: string[] = []
    try {
      for (const [sid, codes] of Object.entries(grouped)) {
        try {
          const r = await watchlistAPI.add({
            codes,
            strategy_id: sid,
            subscriber: 'web_watchlist',
          })
          totalAdded += r.added || 0
          totalSkipped += r.skipped || 0
        } catch (e) {
          errors.push(`${sid}: ${(e as Error).message}`)
        }
      }
      if (errors.length === 0) {
        toast.success('批量导入完成', {
          id: tid,
          description: `新增 ${totalAdded} 只, 跳过 ${totalSkipped} 只`,
        })
      } else if (totalAdded > 0) {
        toast.warning('批量导入部分完成', {
          id: tid,
          description: `新增 ${totalAdded} / 跳过 ${totalSkipped}; 失败 ${errors.length} 组: ${errors[0]}`,
        })
      } else {
        toast.error('批量导入失败', {
          id: tid,
          description: errors.join('; '),
        })
      }
      if (totalAdded > 0) {
        setBatchOpen(false)
        setBatchText('')
        await load()
      }
    } finally {
      setBatchImporting(false)
    }
  }

  // ------------------------------------------------------------------
  // R13-3b: 按板块批量加入
  // ------------------------------------------------------------------
  /** 选中板块的预览信息 (成份股数从 sectorDTO.stock_count 取, 不另发请求) */
  const selectedSector = React.useMemo(
    () => sectors.find((s) => s.code === bySectorCode) || null,
    [sectors, bySectorCode],
  )

  const handleBySectorOpen = (open: boolean) => {
    if (bySectorLoading) return
    setBySectorOpen(open)
    if (open) {
      loadSectors()
      // 重置选项 (每次打开都恢复默认, 防止误操作)
      setBySectorCode('')
      setBySectorStrategy(MANUAL_STRATEGY)
    }
  }

  const handleBySectorAdd = async () => {
    if (!bySectorCode) {
      toast.error('请先选择板块')
      return
    }
    setBySectorLoading(true)
    const sectorLabel = selectedSector
      ? `${selectedSector.code} · ${selectedSector.name}`
      : bySectorCode
    const tid = toast.loading(`正在加入板块 ${sectorLabel} 的成分股...`)
    try {
      const r = await watchlistAPI.addBySector(bySectorCode, bySectorStrategy)
      toast.success('按板块加入成功', {
        id: tid,
        description: `已加入 ${r.added} 只 (${sectorLabel}), 跳过 ${r.skipped} 只`,
      })
      setBySectorOpen(false)
      await load()
    } catch (e) {
      toast.error('按板块加入失败', {
        id: tid,
        description: (e as Error).message,
      })
    } finally {
      setBySectorLoading(false)
    }
  }

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* 顶部状态条 */}
      <Card className="p-3 gap-0 bg-quant-card border-quant">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Star className="size-4 text-amber-400" />
            <span className="font-semibold">自选股管理</span>
            <Badge variant="outline" className="border-quant font-mono">
              {stats.total} 只
            </Badge>
            <Badge
              variant="outline"
              className="border-[var(--quant-up)]/30 bg-[var(--quant-up)]/10 text-[var(--quant-up)] font-mono"
            >
              <Activity className="size-2.5 mr-1" />
              {stats.active} 活跃
            </Badge>
            {stats.inactive > 0 && (
              <Badge
                variant="outline"
                className="border-quant text-muted-foreground font-mono"
              >
                {stats.inactive} 已退订
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            <span className="hidden sm:inline">刷新</span>
          </Button>
        </div>

        {/* 分组统计 */}
        {stats.byStrategy.size > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2 text-[10px] text-muted-foreground">
            <span className="font-medium">按策略分组:</span>
            {Array.from(stats.byStrategy.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([sid, cnt]) => (
                <Badge
                  key={sid}
                  variant="outline"
                  className="text-[10px] border-quant font-mono cursor-pointer hover:border-amber-500/30"
                  onClick={() => setFilterStrategy(sid)}
                >
                  {sid || '(空)'}: {cnt}
                </Badge>
              ))}
          </div>
        )}
      </Card>

      {/* 加入表单 */}
      <Card className="p-4 bg-quant-card border-quant">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Plus className="size-4 text-amber-400" />
              <span className="text-sm font-semibold">加入监控池</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-quant hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30"
                onClick={() => handleBySectorOpen(true)}
              >
                <Layers className="size-3.5 mr-1" />
                按板块加入
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-quant hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30"
                onClick={() => setBatchOpen(true)}
              >
                <Upload className="size-3.5 mr-1" />
                批量导入
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">
                股票代码 (逗号 / 空格分隔)
              </Label>
              <Input
                className="h-8 font-mono text-xs"
                placeholder="如 600519.SH,000001.SZ,300750.SZ"
                value={codesInput}
                onChange={(e) => setCodesInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !adding) handleAdd()
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">策略 strategy_id</Label>
              <Select value={strategyId} onValueChange={setStrategyId}>
                <SelectTrigger className="h-8 text-xs w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUAL_STRATEGY} className="text-xs">
                    _manual · 临时盯盘
                  </SelectItem>
                  {strategies
                    .filter((s) => s.strategy_id !== MANUAL_STRATEGY)
                    .map((s) => (
                      <SelectItem
                        key={s.strategy_id}
                        value={s.strategy_id}
                        className="text-xs"
                      >
                        {s.strategy_id} · {s.strategy_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                className="h-8 w-full sm:w-auto bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
                onClick={handleAdd}
                disabled={adding}
              >
                {adding ? (
                  <Loader2 className="size-3.5 animate-spin mr-1" />
                ) : (
                  <Plus className="size-3.5 mr-1" />
                )}
                加入
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* 筛选 + 表格 */}
      <Card className="bg-quant-card border-quant">
        <CardHeader className="p-3 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Filter className="size-3.5 text-muted-foreground" />
              监控池明细
              <Badge variant="outline" className="text-[10px] border-quant font-mono ml-1">
                {filtered.length} / {items.length}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select
                value={filterStrategy}
                onValueChange={setFilterStrategy}
              >
                <SelectTrigger className="h-7 text-xs w-32 sm:w-40">
                  <SelectValue placeholder="策略筛选" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">
                    全部策略
                  </SelectItem>
                  {strategyOptions.map((sid) => (
                    <SelectItem key={sid} value={sid} className="text-xs">
                      {sid || '(空)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5 border border-quant rounded-md px-2 py-1">
                <Label className="text-[10px] text-muted-foreground">仅活跃</Label>
                <Switch
                  checked={filterActive === 'active'}
                  onCheckedChange={(v) =>
                    setFilterActive(v ? 'active' : 'all')
                  }
                />
              </div>
              {(filterStrategy !== '__all__' || filterActive !== 'all') && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setFilterStrategy('__all__')
                    setFilterActive('all')
                  }}
                >
                  <X className="size-3" />
                  清筛选
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-7 w-full bg-muted/20 rounded" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
              <Star className="size-6 mb-2 opacity-40" />
              {items.length === 0
                ? '监控池为空，请在上方输入股票代码加入'
                : '当前筛选条件下无匹配项'}
            </div>
          ) : (
            <ScrollArea className="max-h-96">
              <Table>
                <TableHeader>
                  <TableRow className="border-quant hover:bg-transparent">
                    <TableHead className="text-xs h-8">股票代码</TableHead>
                    <TableHead className="text-xs h-8">策略</TableHead>
                    <TableHead className="text-xs h-8">订阅方</TableHead>
                    <TableHead className="text-xs h-8">订阅时间</TableHead>
                    <TableHead className="text-xs h-8 text-center">状态</TableHead>
                    <TableHead className="text-xs h-8 text-center">批次</TableHead>
                    <TableHead className="text-xs h-8 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((it) => (
                    <TableRow
                      key={`${it.stock_code}-${it.batch_no}`}
                      className="border-quant"
                    >
                      <TableCell className="text-xs font-mono py-1.5">
                        <StockSectorHover stockCode={it.stock_code} />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] font-mono border-quant',
                            it.strategy_id === MANUAL_STRATEGY
                              ? 'text-muted-foreground'
                              : 'text-quant-primary'
                          )}
                        >
                          {it.strategy_id || '(空)'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-1.5">
                        {it.subscriber || '—'}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground tabular-nums py-1.5">
                        {it.subscribed_at
                          ? new Date(it.subscribed_at).toLocaleString('zh-CN', {
                              year: '2-digit',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </TableCell>
                      <TableCell className="text-center py-1.5">
                        {it.active ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-[var(--quant-up)]/30 bg-[var(--quant-up)]/10 text-[var(--quant-up)]"
                          >
                            活跃
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-quant text-muted-foreground"
                          >
                            退订
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-center text-muted-foreground tabular-nums py-1.5">
                        {it.batch_no ?? 0}
                      </TableCell>
                      <TableCell className="text-right py-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs hover:bg-red-500/10 hover:text-red-500"
                          onClick={() => setDeleteTarget(it)}
                          disabled={removingCode === it.stock_code}
                        >
                          {removingCode === it.stock_code ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Trash2 className="size-3" />
                          )}
                          <span className="hidden sm:inline ml-1">移除</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* 批量导入 Dialog */}
      <Dialog
        open={batchOpen}
        onOpenChange={(v) => {
          if (batchImporting) return
          setBatchOpen(v)
          if (!v) setBatchText('')
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-4 bg-quant-card border-quant">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="size-5 text-amber-400" />
              批量导入自选股
            </DialogTitle>
            <DialogDescription className="text-xs">
              每行一只, 逗号分隔。第 1 列股票代码(必填, 6 位数字),
              第 2 列名称(可空, 仅显示用), 第 3 列 strategy_id(可空, 默认用下方下拉值)。
              也支持只粘贴代码(每行一个或逗号 / 空格分隔)。
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">
                粘贴 CSV / 代码列表
              </Label>
              <Textarea
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder={`600519, 贵州茅台, rzq_ignite\n000858, 五粮液, rzq_ignite\n002594, 比亚迪, _manual\n\n# 也支持只粘贴代码:\n600519 000858 002594`}
                className="min-h-[150px] font-mono text-xs resize-y bg-transparent"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5 md:w-44">
              <Label className="text-[10px] text-muted-foreground">
                默认策略 strategy_id
              </Label>
              <Select
                value={batchDefaultStrategy}
                onValueChange={setBatchDefaultStrategy}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUAL_STRATEGY} className="text-xs">
                    _manual · 临时盯盘
                  </SelectItem>
                  {strategies
                    .filter((s) => s.strategy_id !== MANUAL_STRATEGY)
                    .map((s) => (
                      <SelectItem
                        key={s.strategy_id}
                        value={s.strategy_id}
                        className="text-xs"
                      >
                        {s.strategy_id} · {s.strategy_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
                CSV 行未填 strategy_id 时使用此默认值。
              </p>
            </div>
          </div>

          {/* 预览表 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                <ListChecks className="size-3" />
                解析预览
              </Label>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="text-[10px] border-quant font-mono"
                >
                  共 {batchStats.total}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-[10px] border-[var(--quant-up)]/30 bg-[var(--quant-up)]/10 text-[var(--quant-up)] font-mono"
                >
                  <CheckCircle2 className="size-2.5 mr-1" />
                  有效 {batchStats.valid}
                </Badge>
                {batchStats.invalid > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-red-500/30 bg-red-500/10 text-red-500 font-mono"
                  >
                    <XCircle className="size-2.5 mr-1" />
                    无效 {batchStats.invalid}
                  </Badge>
                )}
              </div>
            </div>
            <div className="rounded-md border border-quant overflow-hidden">
              <ScrollArea className="max-h-60">
                <Table>
                  <TableHeader>
                    <TableRow className="border-quant hover:bg-transparent">
                      <TableHead className="text-[10px] h-7 w-12 text-center">#</TableHead>
                      <TableHead className="text-[10px] h-7">股票代码</TableHead>
                      <TableHead className="text-[10px] h-7">名称</TableHead>
                      <TableHead className="text-[10px] h-7">策略</TableHead>
                      <TableHead className="text-[10px] h-7">状态 / 原因</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedRows.length === 0 ? (
                      <TableRow className="border-quant">
                        <TableCell
                          colSpan={5}
                          className="text-xs text-muted-foreground text-center py-6"
                        >
                          粘贴或输入内容后会在此预览解析结果
                        </TableCell>
                      </TableRow>
                    ) : (
                      parsedRows.map((r, i) => (
                        <TableRow
                          key={`${i}-${r.code}`}
                          className={cn(
                            'border-quant',
                            !r.valid && 'bg-red-500/10',
                          )}
                        >
                          <TableCell className="text-[10px] text-muted-foreground text-center py-1 tabular-nums">
                            {i + 1}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-xs font-mono py-1',
                              r.valid ? 'text-foreground' : 'text-red-500',
                            )}
                          >
                            {r.code || '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground py-1">
                            {r.name || '—'}
                          </TableCell>
                          <TableCell className="py-1">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] font-mono border-quant',
                                r.strategy === MANUAL_STRATEGY
                                  ? 'text-muted-foreground'
                                  : 'text-quant-primary',
                              )}
                            >
                              {r.strategy || '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[10px] py-1">
                            {r.valid ? (
                              <span className="inline-flex items-center text-[var(--quant-up)]">
                                <CheckCircle2 className="size-3 mr-1" />
                                有效
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-red-500">
                                <XCircle className="size-3 mr-1" />
                                {r.reason}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="border-quant"
              onClick={() => setBatchText('')}
              disabled={batchImporting || batchText.length === 0}
            >
              清空
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (!batchImporting) setBatchOpen(false)
              }}
              disabled={batchImporting}
            >
              取消
            </Button>
            <Button
              className="bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
              onClick={handleBatchImport}
              disabled={batchImporting || batchStats.valid === 0}
            >
              {batchImporting ? (
                <Loader2 className="size-3.5 animate-spin mr-1" />
              ) : (
                <Upload className="size-3.5 mr-1" />
              )}
              导入 {batchStats.valid > 0 ? `(${batchStats.valid})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* R13-3b: 按板块批量加入 Dialog */}
      <Dialog
        open={bySectorOpen}
        onOpenChange={handleBySectorOpen}
      >
        <DialogContent className="sm:max-w-lg max-w-[95vw] flex flex-col gap-4 bg-quant-card border-quant">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="size-5 text-amber-400" />
              按板块批量加入监控
            </DialogTitle>
            <DialogDescription className="text-xs">
              将整个板块的成分股一次性加入监控池, 绑定所选策略。
              适用于"先把整个赛道纳入盯盘, 后续再逐只调优"的场景。
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3">
            {/* 板块选择 */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Layers className="size-3" />
                选择板块
              </Label>
              <Select
                value={bySectorCode}
                onValueChange={setBySectorCode}
                disabled={bySectorLoading}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue
                    placeholder={
                      sectorsLoading
                        ? '加载板块中...'
                        : sectors.length === 0
                          ? '暂无板块数据'
                          : '选择板块'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {sectors.map((s) => (
                    <SelectItem
                      key={s.code}
                      value={s.code}
                      className="text-xs"
                    >
                      <span className="font-mono">{s.code}</span>
                      {' · '}
                      <span>{s.name}</span>
                      <span className="ml-1 text-muted-foreground">
                        ({s.stock_count})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* 选中板块预览 */}
              {selectedSector && (
                <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1.5 pt-0.5">
                  <Badge
                    variant="outline"
                    className="text-[10px] border-quant font-mono"
                  >
                    {selectedSector.code}
                  </Badge>
                  <span className="font-medium text-foreground">
                    {selectedSector.name}
                  </span>
                  <span>·</span>
                  <span>成分股</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] border-[var(--quant-up)]/30 bg-[var(--quant-up)]/10 text-[var(--quant-up)] font-mono"
                  >
                    {selectedSector.stock_count} 只
                  </Badge>
                  <span>·</span>
                  <span>当前绑定策略</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] border-quant font-mono text-quant-primary"
                  >
                    {selectedSector.strategy_id || '(空)'}
                  </Badge>
                </div>
              )}
            </div>

            {/* 策略绑定 */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">
                绑定策略 strategy_id
              </Label>
              <Select
                value={bySectorStrategy}
                onValueChange={setBySectorStrategy}
                disabled={bySectorLoading}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUAL_STRATEGY} className="text-xs">
                    _manual · 临时盯盘
                  </SelectItem>
                  {strategies
                    .filter((s) => s.strategy_id !== MANUAL_STRATEGY)
                    .map((s) => (
                      <SelectItem
                        key={s.strategy_id}
                        value={s.strategy_id}
                        className="text-xs"
                      >
                        {s.strategy_id} · {s.strategy_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground leading-relaxed pt-0.5">
                板块内每只股票都以此 strategy_id 写入 monitor_subscriptions,
                决定走哪个 match 套餐。
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => handleBySectorOpen(false)}
              disabled={bySectorLoading}
            >
              取消
            </Button>
            <Button
              className="bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
              onClick={handleBySectorAdd}
              disabled={bySectorLoading || !bySectorCode}
            >
              {bySectorLoading ? (
                <Loader2 className="size-3.5 animate-spin mr-1" />
              ) : (
                <Layers className="size-3.5 mr-1" />
              )}
              确认加入
              {selectedSector ? ` (${selectedSector.stock_count})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && !removingCode && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-5 text-red-500" />
              确认移出自选股
            </AlertDialogTitle>
            <AlertDialogDescription>
              即将把 <span className="font-mono font-semibold">{deleteTarget?.stock_code}</span>
              {' '}移出监控池。
              <span className="block mt-1 text-muted-foreground">
                后端会把对应 monitor_subscriptions 记录置为 active=false（保留归档），
                该股票将不再触发任何预警。
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!removingCode}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25"
              onClick={handleRemove}
              disabled={!!removingCode}
            >
              {removingCode ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : (
                <Trash2 className="size-4 mr-1" />
              )}
              确认移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
