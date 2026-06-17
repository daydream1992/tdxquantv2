'use client'

/**
 * 股票表格组件
 * - 支持排序 / 分页 / 虚拟滚动（max-h-96 overflow-y-auto）
 * - 紧凑信息密度，金融风
 */

import * as React from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { EmptyState } from './EmptyState'

export type SortDir = 'asc' | 'desc' | null

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number
  width?: string
  align?: 'left' | 'right' | 'center'
  sticky?: boolean
}

export interface StockTableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T, idx: number) => string
  loading?: boolean
  maxHeight?: string
  /** 已展开的行 key */
  expandedRowKey?: string | null
  /** 行展开时渲染的内容 */
  renderExpanded?: (row: T) => React.ReactNode
  onRowClick?: (row: T) => void
  emptyText?: string
  pageSize?: number
  className?: string
}

export function StockTable<T>({
  columns,
  data,
  rowKey,
  loading,
  maxHeight = '24rem',
  expandedRowKey,
  renderExpanded,
  onRowClick,
  emptyText = '暂无数据',
  pageSize = 50,
  className,
}: StockTableProps<T>) {
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<SortDir>(null)
  const [page, setPage] = React.useState(0)

  const sorted = React.useMemo(() => {
    if (!sortKey || !sortDir) return data
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return data
    const arr = [...data]
    arr.sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va
      }
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va))
    })
    return arr
  }, [data, sortKey, sortDir, columns])

  const paged = React.useMemo(() => sorted.slice(page * pageSize, (page + 1) * pageSize), [sorted, page, pageSize])
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))

  const handleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('desc')
    } else if (sortDir === 'desc') {
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortKey(null)
      setSortDir(null)
    }
  }

  if (loading) {
    return (
      <div className={cn('rounded-lg border border-quant bg-quant-card overflow-hidden', className)}>
        <div className="quant-scroll overflow-auto" style={{ maxHeight }}>
          <table className="quant-table w-full">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={{ width: c.width, textAlign: c.align || 'left' }}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      <Skeleton className="h-4 w-16" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className={cn('rounded-lg border border-quant bg-quant-card', className)}>
        <EmptyState text={emptyText} className="py-12" />
      </div>
    )
  }

  return (
    <div className={cn('rounded-lg border border-quant bg-quant-card overflow-hidden', className)}>
      <div className="quant-scroll overflow-auto" style={{ maxHeight }}>
        <table className="quant-table w-full">
          <thead>
            <tr>
              {columns.map((c) => {
                const isActive = sortKey === c.key
                return (
                  <th
                    key={c.key}
                    style={{ width: c.width, textAlign: c.align || 'left' }}
                    className={cn(c.sortValue && 'cursor-pointer select-none hover:text-foreground')}
                    onClick={() => c.sortValue && handleSort(c.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {c.sortValue &&
                        (isActive && sortDir === 'asc' ? (
                          <ChevronUp className="size-3" />
                        ) : isActive && sortDir === 'desc' ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        ))}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, idx) => {
              const key = rowKey(row, idx)
              const expanded = expandedRowKey === key
              return (
                <React.Fragment key={key}>
                  <tr
                    className={cn(
                      'cursor-default transition-colors',
                      onRowClick && 'cursor-pointer',
                      expanded && 'bg-[var(--quant-primary)]/5'
                    )}
                    onClick={() => onRowClick?.(row)}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        style={{ textAlign: c.align || 'left' }}
                        className={c.sticky ? 'sticky left-0 bg-quant-card z-[1]' : undefined}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                  {expanded && renderExpanded && (
                    <tr>
                      <td colSpan={columns.length} className="bg-muted/30 p-3">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-quant text-xs">
          <span className="text-muted-foreground tabular-nums">
            共 {sorted.length} 条 · 第 {page + 1}/{totalPages} 页
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 border-quant"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 border-quant"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
