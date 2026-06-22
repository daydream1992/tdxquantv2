'use client'

/**
 * SearchResult — 搜索结果下拉
 *
 * 渲染分组结果列表 (策略 / 股票 / 信号 / 操作 / 最近搜索) + 空状态 + 底部 footer。
 * 纯展示组件, flatItems/grouped/activeIdx 等由父组件 SearchInput 计算并传入。
 * - 空状态: "输入关键词搜索策略/股票/信号"
 * - 无结果: "未找到匹配结果"
 * - 搜索失败: 显示错误信息
 * - 选中项: 琥珀色背景 + 左侧 2px 边框 + 右侧 Enter 图标
 */

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Search, X, CornerDownLeft, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchResponseDTO } from '@/lib/api'
import type { FlatItem } from './shared'

export interface SearchResultProps {
  flatItems: FlatItem[]
  grouped: [string, FlatItem[]][]
  activeIdx: number
  flatIdxMap: Map<FlatItem, number>
  setActiveIdx: (idx: number | ((prev: number) => number)) => void
  onSelect: (item: FlatItem) => void
  query: string
  loading: boolean
  result: SearchResponseDTO | null
  searchError: string | null
  listRef: React.RefObject<HTMLDivElement | null>
}

export function SearchResult({
  flatItems, grouped, activeIdx, flatIdxMap, setActiveIdx, onSelect,
  query, loading, result, searchError, listRef,
}: SearchResultProps) {
  const kw = query.trim()
  const hasNonActionItems = flatItems.some((i) => i.kind !== 'action')

  return (
    <>
      {/* 结果列表 */}
      <div ref={listRef} className="max-h-[60vh] overflow-y-auto quant-scroll py-2">
        {!kw && flatItems.length === 0 ? (
          <EmptyHint icon={Search} text="输入关键词搜索策略/股票/信号" description="或选择下方的快捷操作" />
        ) : kw && !loading && result && !hasNonActionItems ? (
          <EmptyHint icon={Search} text="未找到匹配结果" description={`关键词 "${kw}" 未命中策略 / 股票 / 信号`} />
        ) : kw && searchError ? (
          <EmptyHint icon={X} text="搜索失败" description={searchError} />
        ) : (
          grouped.map(([group, items]) => (
            <div key={group} className="mb-1">
              <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {group} · {items.length}
              </div>
              {items.map((it) => {
                const idx = flatIdxMap.get(it) ?? 0
                const Icon = it.icon
                const isActive = idx === activeIdx
                return (
                  <button
                    key={it.id}
                    data-search-idx={idx}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => onSelect(it)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors border-l-2',
                      isActive
                        ? 'bg-amber-500/15 border-quant-primary text-foreground'
                        : 'border-transparent hover:bg-amber-500/5 text-foreground/90'
                    )}
                  >
                    <Icon
                      className="size-4 shrink-0"
                      style={it.iconColor ? { color: it.iconColor } : undefined}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{it.title}</div>
                      {it.subtitle && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {it.subtitle}
                        </div>
                      )}
                    </div>
                    {it.badge && (
                      <Badge variant="outline" className="text-[10px] border-quant font-mono shrink-0">
                        {it.badge}
                      </Badge>
                    )}
                    {it.shortcut && (
                      <kbd className="text-[10px] text-muted-foreground font-mono px-1.5 py-0.5 rounded border border-quant shrink-0">
                        {it.shortcut}
                      </kbd>
                    )}
                    {isActive && (
                      <CornerDownLeft className="size-3 text-quant-primary shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* 底部 footer */}
      <div className="flex items-center justify-between px-4 py-2 text-[10px] text-muted-foreground border-t border-quant/50 bg-quant-bg/30">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-3 text-quant-primary" />
          <span>TdxQuant Global Search</span>
        </div>
        <div className="flex items-center gap-3">
          <span>策略 · 股票 · 信号</span>
        </div>
      </div>
    </>
  )
}

// ============================================================================
// 内部子组件
// ============================================================================

function EmptyHint({
  icon: Icon,
  text,
  description,
}: {
  icon: React.ElementType
  text: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-6">
      <div className="flex items-center justify-center size-12 rounded-full bg-muted/30 text-muted-foreground mb-3">
        <Icon className="size-5" />
      </div>
      <div className="text-sm font-medium text-foreground/80">{text}</div>
      {description && (
        <div className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</div>
      )}
    </div>
  )
}
