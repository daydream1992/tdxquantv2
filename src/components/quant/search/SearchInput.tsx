'use client'

/**
 * SearchInput — 搜索框 + 防抖 + 键盘导航 + 结果组装
 *
 * 持有 query/loading/result/activeIdx/recentSearches/searchError 等搜索态,
 * 通过 useEffect 实现: 防抖搜索 (200ms) / 加载最近搜索 / 关闭时重置 / 保存最近搜索 /
 * activeIdx 越界保护 / 滚动到 active 项。
 * flatItems 由 shared.buildFlatItems 计算, grouped/flatIdxMap 派生。
 *
 * 注: Cmd+K 全局快捷键 (用于在 Dialog 关闭时打开) 由容器 GlobalSearch 持有,
 *     因其需 always-mounted listener; SearchInput 内的 ⌘K kbd 仅作视觉提示。
 *
 * 渲染: 顶部输入框 + 顶部提示条 + <SearchResult />。
 */

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Search, CornerDownLeft, ArrowUp, ArrowDown, X,
} from 'lucide-react'
import { searchAPI, type SearchResponseDTO } from '@/lib/api'
import {
  buildFlatItems, RECENT_KEY, MAX_RECENT,
  type FlatItem, type GlobalSearchProps,
} from './shared'
import { SearchResult } from './SearchResult'

export interface SearchInputProps extends GlobalSearchProps {
  open: boolean
  onClose: () => void
}

export function SearchInput({
  open, onClose, onNavigate, onToggleTheme, onOpenSettings, onRunAll,
}: SearchInputProps) {
  const [query, setQuery] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<SearchResponseDTO | null>(null)
  const [activeIdx, setActiveIdx] = React.useState(0)
  const [recentSearches, setRecentSearches] = React.useState<string[]>([])
  const [searchError, setSearchError] = React.useState<string | null>(null)

  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const close = React.useCallback(() => onClose(), [onClose])

  const goTab = React.useCallback((tab: string) => {
    onNavigate?.(tab)
    close()
  }, [onNavigate, close])

  // ----- 加载最近搜索 -----
  React.useEffect(() => {
    if (!open) return
    try {
      const raw = window.localStorage.getItem(RECENT_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) {
          setRecentSearches(arr.filter((x) => typeof x === 'string').slice(0, MAX_RECENT))
        }
      }
    } catch { /* noop */ }
  }, [open])

  // ----- debounce 搜索 (200ms) -----
  React.useEffect(() => {
    const kw = query.trim()
    if (!kw) {
      setResult(null); setLoading(false); setSearchError(null)
      return
    }
    setLoading(true); setSearchError(null)
    const t = window.setTimeout(async () => {
      try {
        setResult(await searchAPI.search(kw, 20))
      } catch (e) {
        setSearchError((e as Error).message || '搜索失败')
        setResult(null)
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => window.clearTimeout(t)
  }, [query])

  // ----- 关闭时重置 / 打开时聚焦 -----
  React.useEffect(() => {
    if (!open) {
      setQuery(''); setResult(null); setActiveIdx(0); setSearchError(null)
    } else {
      const t = window.setTimeout(() => inputRef.current?.focus(), 50)
      return () => window.clearTimeout(t)
    }
  }, [open])

  // ----- 保存最近搜索 -----
  const saveRecent = React.useCallback((kw: string) => {
    const k = kw.trim()
    if (!k) return
    setRecentSearches((prev) => {
      const next = [k, ...prev.filter((x) => x !== k)].slice(0, MAX_RECENT)
      try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }, [])

  // ----- 扁平化结果列表 (用于键盘导航) -----
  const flatItems = React.useMemo<FlatItem[]>(() => buildFlatItems({
    query, result, recentSearches,
    onNavigate, onToggleTheme, onOpenSettings, onRunAll,
    goTab, close, setQuery,
  }), [query, result, recentSearches, onNavigate, onToggleTheme, onOpenSettings, onRunAll, goTab, close])

  // ----- activeIdx 越界保护 -----
  React.useEffect(() => {
    if (activeIdx >= flatItems.length) setActiveIdx(0)
  }, [flatItems.length, activeIdx])

  // ----- 滚动到 active 项 -----
  React.useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-search-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  // ----- 键盘导航 -----
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % Math.max(flatItems.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => (i - 1 + flatItems.length) % Math.max(flatItems.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = flatItems[activeIdx]
      if (item) {
        if (query.trim()) saveRecent(query.trim())
        item.action()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (query) setQuery('')
      else onClose()
    }
  }

  // ----- 渲染分组 -----
  const grouped = React.useMemo(() => {
    const m = new Map<string, FlatItem[]>()
    flatItems.forEach((it) => {
      if (!m.has(it.group)) m.set(it.group, [])
      m.get(it.group)!.push(it)
    })
    return Array.from(m.entries())
  }, [flatItems])

  // 全局扁平 idx (用于键盘导航高亮 + 滚动定位)
  const flatIdxMap = React.useMemo(() => {
    const m = new Map<FlatItem, number>()
    flatItems.forEach((it, idx) => m.set(it, idx))
    return m
  }, [flatItems])

  const handleSelect = React.useCallback((it: FlatItem) => {
    if (query.trim()) saveRecent(query.trim())
    it.action()
  }, [query, saveRecent])

  return (
    <>
      {/* 顶部搜索框 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-quant">
        <Search className="size-5 text-quant-primary shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0) }}
          onKeyDown={handleKeyDown}
          placeholder="搜索策略 / 股票 / 信号, 或输入快捷操作..."
          className="flex-1 bg-transparent outline-none text-lg placeholder:text-muted-foreground/60 text-foreground"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            onClick={() => { setQuery(''); inputRef.current?.focus() }}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="清空"
          >
            <X className="size-4" />
          </button>
        )}
        <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-quant text-[10px] text-muted-foreground font-mono">
          ESC
        </kbd>
      </div>

      {/* 顶部提示条 */}
      <div className="flex items-center justify-between px-4 py-1.5 text-[11px] text-muted-foreground border-b border-quant/50 bg-quant-bg/30">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded border border-quant font-mono text-[10px]">⌘K</kbd>
            打开
          </span>
          <span className="flex items-center gap-1">
            <ArrowUp className="size-3" />
            <ArrowDown className="size-3" />
            选择
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-3" />
            确认
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="flex items-center gap-1 text-quant-primary">
              <span className="size-1.5 rounded-full bg-quant-primary animate-pulse" />
              搜索中...
            </span>
          )}
          {result && !loading && (
            <span>共 {result.total} 条结果</span>
          )}
        </div>
      </div>

      <SearchResult
        flatItems={flatItems} grouped={grouped} activeIdx={activeIdx}
        flatIdxMap={flatIdxMap} setActiveIdx={setActiveIdx} onSelect={handleSelect}
        query={query} loading={loading} result={result} searchError={searchError}
        listRef={listRef}
      />
    </>
  )
}
