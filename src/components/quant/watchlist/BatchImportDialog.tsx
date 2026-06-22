'use client'

/**
 * BatchImportDialog — 批量导入 + 按板块加入 两个弹窗
 * 1. 批量导入: 粘贴 CSV/代码列表 → 解析预览 → 按 strategy_id 分组提交
 * 2. 按板块加入: 选板块 + 选策略 → 调 watchlistAPI.addBySector 一次性加入成分股
 * 容器注入 strategies + onRefresh + 两个 Dialog 的 open 状态。
 */

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Upload, Loader2, CheckCircle2, XCircle, ListChecks, Layers,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  watchlistAPI, sectorAPI,
  type StrategyDTO, type SectorDTO,
} from '@/lib/api'
import { MANUAL_STRATEGY, parseBatchInput } from './shared'

export interface BatchImportDialogProps {
  strategies: StrategyDTO[]
  onRefresh: () => void | Promise<void>
  batchOpen: boolean
  onBatchOpenChange: (open: boolean) => void
  bySectorOpen: boolean
  onBySectorOpenChange: (open: boolean) => void
}

export function BatchImportDialog({
  strategies, onRefresh,
  batchOpen, onBatchOpenChange,
  bySectorOpen, onBySectorOpenChange,
}: BatchImportDialogProps) {
  return (
    <>
      <BatchImport
        strategies={strategies} onRefresh={onRefresh}
        open={batchOpen} onOpenChange={onBatchOpenChange}
      />
      <BySectorAdd
        strategies={strategies} onRefresh={onRefresh}
        open={bySectorOpen} onOpenChange={onBySectorOpenChange}
      />
    </>
  )
}

// ============================================================================
// 1. 批量导入 Dialog
// ============================================================================

interface BatchImportProps {
  strategies: StrategyDTO[]
  onRefresh: () => void | Promise<void>
  open: boolean
  onOpenChange: (open: boolean) => void
}

function BatchImport({ strategies, onRefresh, open, onOpenChange }: BatchImportProps) {
  const [batchText, setBatchText] = React.useState('')
  const [batchDefaultStrategy, setBatchDefaultStrategy] = React.useState<string>(MANUAL_STRATEGY)
  const [batchImporting, setBatchImporting] = React.useState(false)

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
    if (validRows.length === 0) { toast.error('没有可导入的有效行'); return }
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
            codes, strategy_id: sid, subscriber: 'web_watchlist',
          })
          totalAdded += r.added || 0
          totalSkipped += r.skipped || 0
        } catch (e) {
          errors.push(`${sid}: ${(e as Error).message}`)
        }
      }
      if (errors.length === 0) {
        toast.success('批量导入完成', {
          id: tid, description: `新增 ${totalAdded} 只, 跳过 ${totalSkipped} 只`,
        })
      } else if (totalAdded > 0) {
        toast.warning('批量导入部分完成', {
          id: tid,
          description: `新增 ${totalAdded} / 跳过 ${totalSkipped}; 失败 ${errors.length} 组: ${errors[0]}`,
        })
      } else {
        toast.error('批量导入失败', { id: tid, description: errors.join('; ') })
      }
      if (totalAdded > 0) {
        onOpenChange(false)
        setBatchText('')
        await onRefresh()
      }
    } finally {
      setBatchImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (batchImporting) return
        onOpenChange(v)
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
            <Label className="text-[10px] text-muted-foreground">粘贴 CSV / 代码列表</Label>
            <Textarea
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder={`600519, 贵州茅台, rzq_ignite\n000858, 五粮液, rzq_ignite\n002594, 比亚迪, _manual\n\n# 也支持只粘贴代码:\n600519 000858 002594`}
              className="min-h-[150px] font-mono text-xs resize-y bg-transparent"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5 md:w-44">
            <Label className="text-[10px] text-muted-foreground">默认策略 strategy_id</Label>
            <Select value={batchDefaultStrategy} onValueChange={setBatchDefaultStrategy}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={MANUAL_STRATEGY} className="text-xs">_manual · 临时盯盘</SelectItem>
                {strategies.filter((s) => s.strategy_id !== MANUAL_STRATEGY).map((s) => (
                  <SelectItem key={s.strategy_id} value={s.strategy_id} className="text-xs">
                    {s.strategy_id} · {s.strategy_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
              CSV 行未填 strategy_id 时使用此默认值。
            </p></div>
        </div>

        {/* 预览表 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
              <ListChecks className="size-3" />
              解析预览
            </Label>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] border-quant font-mono">
                共 {batchStats.total}
              </Badge>
              <Badge variant="outline"
                className="text-[10px] border-[var(--quant-up)]/30 bg-[var(--quant-up)]/10 text-[var(--quant-up)] font-mono"
              >
                <CheckCircle2 className="size-2.5 mr-1" />
                有效 {batchStats.valid}
              </Badge>
              {batchStats.invalid > 0 && (
                <Badge variant="outline"
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
                      <TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-6">
                        粘贴或输入内容后会在此预览解析结果
                      </TableCell>
                    </TableRow>
                  ) : (
                    parsedRows.map((r, i) => (
                      <TableRow key={`${i}-${r.code}`}
                        className={cn('border-quant', !r.valid && 'bg-red-500/10')}
                      >
                        <TableCell className="text-[10px] text-muted-foreground text-center py-1 tabular-nums">
                          {i + 1}
                        </TableCell>
                        <TableCell
                          className={cn('text-xs font-mono py-1', r.valid ? 'text-foreground' : 'text-red-500')}
                        >{r.code || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground py-1">{r.name || '—'}</TableCell>
                        <TableCell className="py-1">
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] font-mono border-quant',
                              r.strategy === MANUAL_STRATEGY ? 'text-muted-foreground' : 'text-quant-primary',
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
            variant="outline" className="border-quant"
            onClick={() => setBatchText('')}
            disabled={batchImporting || batchText.length === 0}
          >
            清空
          </Button>
          <Button
            variant="ghost"
            onClick={() => { if (!batchImporting) onOpenChange(false) }}
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
  )
}

// ============================================================================
// 2. R13-3b: 按板块批量加入 Dialog
// ============================================================================

interface BySectorAddProps {
  strategies: StrategyDTO[]
  onRefresh: () => void | Promise<void>
  open: boolean
  onOpenChange: (open: boolean) => void
}

function BySectorAdd({ strategies, onRefresh, open, onOpenChange }: BySectorAddProps) {
  const [sectors, setSectors] = React.useState<SectorDTO[]>([])
  const [sectorsLoading, setSectorsLoading] = React.useState(false)
  const [bySectorCode, setBySectorCode] = React.useState<string>('')
  const [bySectorStrategy, setBySectorStrategy] = React.useState<string>(MANUAL_STRATEGY)
  const [bySectorLoading, setBySectorLoading] = React.useState(false)

  /** 选中板块的预览信息 (成份股数从 sectorDTO.stock_count 取, 不另发请求) */
  const selectedSector = React.useMemo(
    () => sectors.find((s) => s.code === bySectorCode) || null,
    [sectors, bySectorCode],
  )

  /**
   * 加载板块列表 (供 "按板块加入" Dialog 的 Select 使用)。
   * 只在 Dialog 首次打开且 sectors 为空时拉取, 拉到后缓存到 state。
   */
  const loadSectors = React.useCallback(async () => {
    if (sectors.length > 0 || sectorsLoading) return
    setSectorsLoading(true)
    try {
      setSectors((await sectorAPI.list()) || [])
    } catch {
      /* 静默, 用户重开 Dialog 会重试 */
    } finally {
      setSectorsLoading(false)
    }
  }, [sectors.length, sectorsLoading])

  const handleOpenChange = (nextOpen: boolean) => {
    if (bySectorLoading) return
    onOpenChange(nextOpen)
    if (nextOpen) {
      loadSectors()
      // 重置选项 (每次打开都恢复默认, 防止误操作)
      setBySectorCode('')
      setBySectorStrategy(MANUAL_STRATEGY)
    }
  }

  const handleBySectorAdd = async () => {
    if (!bySectorCode) { toast.error('请先选择板块'); return }
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
      onOpenChange(false)
      await onRefresh()
    } catch (e) {
      toast.error('按板块加入失败', { id: tid, description: (e as Error).message })
    } finally {
      setBySectorLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] flex flex-col gap-4 bg-quant-card border-quant">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-5 text-amber-400" />
            按板块批量加入监控
          </DialogTitle>
          <DialogDescription className="text-xs">
            将整个板块的成分股一次性加入监控池, 绑定所选策略。
            适用于&quot;先把整个赛道纳入盯盘, 后续再逐只调优&quot;的场景。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3">
          {/* 板块选择 */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Layers className="size-3" />
              选择板块
            </Label>
            <Select value={bySectorCode} onValueChange={setBySectorCode} disabled={bySectorLoading}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue
                  placeholder={
                    sectorsLoading ? '加载板块中...'
                    : sectors.length === 0 ? '暂无板块数据'
                    : '选择板块'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sectors.map((s) => (
                  <SelectItem key={s.code} value={s.code} className="text-xs">
                    <span className="font-mono">{s.code}</span>
                    {' · '}
                    <span>{s.name}</span>
                    <span className="ml-1 text-muted-foreground">({s.stock_count})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* 选中板块预览 */}
            {selectedSector && (
              <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1.5 pt-0.5">
                <Badge variant="outline" className="text-[10px] border-quant font-mono">
                  {selectedSector.code}
                </Badge>
                <span className="font-medium text-foreground">{selectedSector.name}</span>
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
                <Badge variant="outline" className="text-[10px] border-quant font-mono text-quant-primary">
                  {selectedSector.strategy_id || '(空)'}
                </Badge>
              </div>
            )}
          </div>

          {/* 策略绑定 */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">绑定策略 strategy_id</Label>
            <Select value={bySectorStrategy} onValueChange={setBySectorStrategy} disabled={bySectorLoading}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={MANUAL_STRATEGY} className="text-xs">_manual · 临时盯盘</SelectItem>
                {strategies.filter((s) => s.strategy_id !== MANUAL_STRATEGY).map((s) => (
                  <SelectItem key={s.strategy_id} value={s.strategy_id} className="text-xs">
                    {s.strategy_id} · {s.strategy_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground leading-relaxed pt-0.5">
              板块内每只股票都以此 strategy_id 写入 monitor_subscriptions, 决定走哪个 match 套餐。
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={bySectorLoading}>
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
  )
}
