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
  Star,
  RefreshCw,
  Plus,
  Trash2,
  Loader2,
  Activity,
  AlertCircle,
  Filter,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  watchlistAPI,
  strategyAPI,
  type WatchlistItemDTO,
  type StrategyDTO,
} from '@/lib/api'

const MANUAL_STRATEGY = '_manual'

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
          <div className="flex items-center gap-2">
            <Plus className="size-4 text-amber-400" />
            <span className="text-sm font-semibold">加入监控池</span>
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
                        {it.stock_code}
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
