'use client'

/**
 * 板块管理
 * - 策略↔板块映射表
 * - 每板块：查看股票/手动刷新/编辑映射（占位）
 * - 板块股票表格
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { RefreshCw, Eye, Layers, Link2, Calendar } from 'lucide-react'
import { StockTable, type Column } from './StockTable'
import { ScoreBadge } from './ScoreBadge'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'
import { toast } from 'sonner'
import {
  sectorAPI,
  type SectorDTO,
  type SectorStockDTO,
} from '@/lib/api'

export function SectorManager() {
  const [sectors, setSectors] = React.useState<SectorDTO[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState<string | null>(null)
  const [viewSector, setViewSector] = React.useState<SectorDTO | null>(null)
  const [stocks, setStocks] = React.useState<SectorStockDTO[]>([])
  const [stocksLoading, setStocksLoading] = React.useState(false)

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
    try {
      const data = await sectorAPI.getStocks(s.code)
      setStocks(data)
    } catch (e) {
      toast.error('加载股票失败', { description: (e as Error).message })
    } finally {
      setStocksLoading(false)
    }
  }

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
      render: (r) => <span className="text-xs">{r.stock_name}</span>,
    },
    {
      key: 'score',
      header: '得分',
      align: 'right',
      width: '8rem',
      render: (r) => <ScoreBadge score={r.score} size="sm" />,
      sortValue: (r) => r.score,
    },
    {
      key: 'added',
      header: '加入时间',
      align: 'right',
      render: (r) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {new Date(r.added_at).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
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
          <Button size="sm" variant="ghost" className="h-8" onClick={load} disabled={loading}>
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
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
                maxHeight="32rem"
                pageSize={50}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
