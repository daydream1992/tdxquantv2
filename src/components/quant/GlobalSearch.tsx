'use client'

/**
 * 全局搜索 (Cmd+K / Ctrl+K)
 *
 * 功能:
 * - 用户按 Cmd+K (Mac) / Ctrl+K (Win/Linux) 打开搜索 Dialog
 * - 搜索框支持: 策略名/策略 ID / 股票代码 / 股票名 / 信号类型
 * - 实时搜索 (debounce 200ms), 结果分组显示: 策略 / 股票 / 信号 / 操作
 * - 键盘导航: ↑↓ 选择, Enter 确认, Esc 关闭
 * - 空状态: "输入关键词搜索策略/股票/信号"
 * - 无结果: "未找到匹配结果"
 * - 最近搜索: 记录最近 5 个关键词 (localStorage)
 *
 * UI:
 * - shadcn Dialog (顶部弹出, sm:max-w-2xl)
 * - 选中项: 琥珀色背景 + 左侧 2px 边框
 * - 顶部提示: "⌘K 打开 · ↑↓ 选择 · Enter 确认"
 */

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import {
  Search,
  Cpu,
  BarChart3,
  Bell,
  Activity,
  Layers,
  Settings,
  Sun,
  Play,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  History,
  X,
  Hash,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  searchAPI,
  type SearchResponseDTO,
  type SearchStrategyItemDTO,
  type SearchStockItemDTO,
  type SearchSignalItemDTO,
} from '@/lib/api'

// ============================================================================
// 类型
// ============================================================================

export interface GlobalSearchHandle {
  open: () => void
  close: () => void
}

export interface GlobalSearchProps {
  /** tab 跳转回调: 'dashboard' | 'strategies' | 'selections' | 'signals' | 'sectors' */
  onNavigate?: (tab: string) => void
  /** 切换主题 */
  onToggleTheme?: () => void
  /** 打开推送通道配置 */
  onOpenSettings?: () => void
  /** 一键运行所有策略 */
  onRunAll?: () => void
}

type ItemKind = 'strategy' | 'stock' | 'signal' | 'action' | 'recent'

interface FlatItem {
  id: string
  kind: ItemKind
  group: string
  icon: React.ElementType
  iconColor?: string
  title: string
  subtitle?: string
  badge?: string
  shortcut?: string
  action: () => void
}

const RECENT_KEY = 'tdxquant-recent-searches'
const MAX_RECENT = 5

// ============================================================================
// 组件
// ============================================================================

export const GlobalSearch = React.forwardRef<GlobalSearchHandle, GlobalSearchProps>(
  function GlobalSearch({ onNavigate, onToggleTheme, onOpenSettings, onRunAll }, ref) {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [loading, setLoading] = React.useState(false)
    const [result, setResult] = React.useState<SearchResponseDTO | null>(null)
    const [activeIdx, setActiveIdx] = React.useState(0)
    const [recentSearches, setRecentSearches] = React.useState<string[]>([])
    const [searchError, setSearchError] = React.useState<string | null>(null)

    const inputRef = React.useRef<HTMLInputElement>(null)
    const listRef = React.useRef<HTMLDivElement>(null)

    // ----- 暴露 imperative handle -----
    React.useImperativeHandle(
      ref,
      () => ({
        open: () => setOpen(true),
        close: () => setOpen(false),
      }),
      []
    )

    // ----- Cmd+K / Ctrl+K -----
    React.useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault()
          setOpen((v) => !v)
        }
      }
      window.addEventListener('keydown', handler)
      return () => window.removeEventListener('keydown', handler)
    }, [])

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
      } catch {
        /* noop */
      }
    }, [open])

    // ----- debounce 搜索 (200ms) -----
    React.useEffect(() => {
      const kw = query.trim()
      if (!kw) {
        setResult(null)
        setLoading(false)
        setSearchError(null)
        return
      }
      setLoading(true)
      setSearchError(null)
      const t = window.setTimeout(async () => {
        try {
          const r = await searchAPI.search(kw, 20)
          setResult(r)
        } catch (e) {
          setSearchError((e as Error).message || '搜索失败')
          setResult(null)
        } finally {
          setLoading(false)
        }
      }, 200)
      return () => window.clearTimeout(t)
    }, [query])

    // ----- 关闭时重置 -----
    React.useEffect(() => {
      if (!open) {
        setQuery('')
        setResult(null)
        setActiveIdx(0)
        setSearchError(null)
      } else {
        // 打开时聚焦输入框
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
        try {
          window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
        } catch {
          /* noop */
        }
        return next
      })
    }, [])

    const close = React.useCallback(() => setOpen(false), [])

    // ----- 跳转处理 -----
    const goTab = React.useCallback(
      (tab: string) => {
        onNavigate?.(tab)
        close()
      },
      [onNavigate, close]
    )

    // ----- 扁平化结果列表 (用于键盘导航) -----
    const flatItems = React.useMemo<FlatItem[]>(() => {
      const items: FlatItem[] = []
      const kw = query.trim()

      if (!kw) {
        // 空状态: 最近搜索 + 快捷操作
        if (recentSearches.length > 0) {
          recentSearches.forEach((s) => {
            items.push({
              id: `recent-${s}`,
              kind: 'recent',
              group: '最近搜索',
              icon: History,
              iconColor: 'var(--quant-flat)',
              title: s,
              subtitle: '回车搜索',
              action: () => {
                setQuery(s)
              },
            })
          })
        }
        // 快捷操作
        const actions: Array<{
          id: string
          icon: React.ElementType
          title: string
          subtitle: string
          shortcut?: string
          run: () => void
        }> = [
          {
            id: 'act-dashboard',
            icon: Activity,
            title: '实时大屏',
            subtitle: '查看行情 + 信号流',
            run: () => goTab('dashboard'),
          },
          {
            id: 'act-strategies',
            icon: Cpu,
            title: '策略管理',
            subtitle: '5 个策略 · 启停 / 运行',
            run: () => goTab('strategies'),
          },
          {
            id: 'act-selections',
            icon: BarChart3,
            title: '选股结果',
            subtitle: '明细 / 汇总 / 对比 / 回测',
            run: () => goTab('selections'),
          },
          {
            id: 'act-backtest',
            icon: History,
            title: '切到回测视图',
            subtitle: '基于历史选股模拟交易',
            run: () => {
              onNavigate?.('selections')
              try {
                window.dispatchEvent(
                  new CustomEvent('tdxquant:show-backtest', {
                    detail: { source: 'globalsearch' },
                  })
                )
              } catch {
                /* noop */
              }
              close()
            },
          },
          {
            id: 'act-signals',
            icon: Bell,
            title: '信号中心',
            subtitle: '查看推送状态 / 重推',
            run: () => goTab('signals'),
          },
          {
            id: 'act-sectors',
            icon: Layers,
            title: '板块管理',
            subtitle: '5 个策略板块',
            run: () => goTab('sectors'),
          },
        ]
        if (onRunAll) {
          actions.unshift({
            id: 'act-run-all',
            icon: Play,
            title: '运行全部策略',
            subtitle: '一键执行 5 个启用的策略',
            shortcut: '',
            run: () => {
              onRunAll()
              close()
            },
          })
        }
        if (onToggleTheme) {
          actions.push({
            id: 'act-theme',
            icon: Sun,
            title: '切换主题',
            subtitle: '深色 / 浅色',
            run: () => {
              onToggleTheme()
              close()
            },
          })
        }
        if (onOpenSettings) {
          actions.push({
            id: 'act-settings',
            icon: Settings,
            title: '推送通道配置',
            subtitle: 'CSV / WebSocket / 通达信 / 飞书',
            run: () => {
              onOpenSettings()
              close()
            },
          })
        }
        actions.forEach((a) => {
          items.push({
            id: a.id,
            kind: 'action',
            group: '快捷操作',
            icon: a.icon,
            iconColor: 'var(--quant-primary)',
            title: a.title,
            subtitle: a.subtitle,
            shortcut: a.shortcut,
            action: a.run,
          })
        })
        return items
      }

      // 有 query: 展示搜索结果 (分组)
      if (result) {
        result.strategies.forEach((s: SearchStrategyItemDTO) => {
          items.push({
            id: `strat-${s.strategy_id}`,
            kind: 'strategy',
            group: '策略',
            icon: Cpu,
            iconColor: 'var(--quant-primary)',
            title: `${s.strategy_emoji || '📊'} ${s.strategy_name}`,
            subtitle: s.description || `ID: ${s.strategy_id}`,
            badge: s.sector_code || s.strategy_id,
            action: () => goTab('strategies'),
          })
        })
        result.stocks.forEach((s: SearchStockItemDTO) => {
          items.push({
            id: `stock-${s.stock_code}-${s.strategy_id}`,
            kind: 'stock',
            group: '股票',
            icon: Hash,
            iconColor: 'var(--quant-up)',
            title: `${s.stock_name || '—'} · ${s.stock_code}`,
            subtitle: s.strategy_name
              ? `${s.strategy_name} · 得分 ${s.score.toFixed(1)}${
                  s.run_date ? ' · ' + s.run_date : ''
                }`
              : '选股结果',
            badge: s.strategy_name,
            action: () => goTab('selections'),
          })
        })
        result.signals.forEach((s: SearchSignalItemDTO) => {
          items.push({
            id: `sig-${s.id}`,
            kind: 'signal',
            group: '信号',
            icon: Bell,
            iconColor: 'var(--quant-down)',
            title: s.content.slice(0, 60) + (s.content.length > 60 ? '…' : ''),
            subtitle: `${
              s.strategy_name || s.strategy_id || '系统'
            }${s.stock_name ? ' · ' + s.stock_name : ''}${
              s.stock_code ? ' · ' + s.stock_code : ''
            } · ${formatTime(s.time)}`,
            badge: typeLabel(s.type),
            action: () => goTab('signals'),
          })
        })
        // 永远展示快捷操作 (即使有结果)
        const quickActions: FlatItem[] = []
        if (onRunAll) {
          quickActions.push({
            id: 'act-run-all',
            kind: 'action',
            group: '操作',
            icon: Play,
            iconColor: 'var(--quant-primary)',
            title: '运行全部策略',
            subtitle: '一键执行 5 个启用的策略',
            action: () => {
              onRunAll()
              close()
            },
          })
        }
        quickActions.push({
          id: 'act-backtest',
          kind: 'action',
          group: '操作',
          icon: History,
          iconColor: 'var(--quant-primary)',
          title: '切到回测视图',
          subtitle: '选股结果 Tab 的回测 toggle',
          action: () => {
            // 先切 tab, 再 dispatch 事件让 SelectionResults 自动切到回测视图
            onNavigate?.('selections')
            try {
              window.dispatchEvent(
                new CustomEvent('tdxquant:show-backtest', {
                  detail: { source: 'globalsearch' },
                })
              )
            } catch {
              /* noop */
            }
            close()
          },
        })
        if (onToggleTheme) {
          quickActions.push({
            id: 'act-theme',
            kind: 'action',
            group: '操作',
            icon: Sun,
            iconColor: 'var(--quant-primary)',
            title: '切换主题',
            subtitle: '深色 / 浅色',
            action: () => {
              onToggleTheme()
              close()
            },
          })
        }
        if (onOpenSettings) {
          quickActions.push({
            id: 'act-settings',
            kind: 'action',
            group: '操作',
            icon: Settings,
            iconColor: 'var(--quant-primary)',
            title: '推送通道配置',
            subtitle: 'CSV / WebSocket / 通达信 / 飞书',
            action: () => {
              onOpenSettings()
              close()
            },
          })
        }
        quickActions.forEach((q) => items.push(q))
      }
      return items
    }, [query, result, recentSearches, onNavigate, onToggleTheme, onOpenSettings, onRunAll, goTab, close])

    // ----- activeIdx 越界保护 -----
    React.useEffect(() => {
      if (activeIdx >= flatItems.length) setActiveIdx(0)
    }, [flatItems.length, activeIdx])

    // ----- 滚动到 active 项 -----
    React.useEffect(() => {
      if (!open) return
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-search-idx="${activeIdx}"]`
      )
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
        if (query) {
          setQuery('')
        } else {
          setOpen(false)
        }
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
    // 在 render 时按分组顺序生成, 保证与 flatItems 顺序一致
    const flatIdxMap = React.useMemo(() => {
      const m = new Map<FlatItem, number>()
      flatItems.forEach((it, idx) => m.set(it, idx))
      return m
    }, [flatItems])

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-2xl p-0 gap-0 bg-quant-card border-quant top-[12%] translate-y-0"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">全局搜索</DialogTitle>
          <DialogDescription className="sr-only">
            跨策略 / 股票 / 信号搜索, 快捷操作跳转
          </DialogDescription>

          {/* 顶部搜索框 */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-quant">
            <Search className="size-5 text-quant-primary shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIdx(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="搜索策略 / 股票 / 信号, 或输入快捷操作..."
              className="flex-1 bg-transparent outline-none text-lg placeholder:text-muted-foreground/60 text-foreground"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
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

          {/* 结果列表 */}
          <div
            ref={listRef}
            className="max-h-[60vh] overflow-y-auto quant-scroll py-2"
          >
            {!query.trim() && flatItems.length === 0 ? (
              <EmptyHint
                icon={Search}
                text="输入关键词搜索策略/股票/信号"
                description="或选择下方的快捷操作"
              />
            ) : query.trim() && !loading && result && flatItems.filter((i) => i.kind !== 'action').length === 0 ? (
              <EmptyHint
                icon={Search}
                text="未找到匹配结果"
                description={`关键词 "${query.trim()}" 未命中策略 / 股票 / 信号`}
              />
            ) : query.trim() && searchError ? (
              <EmptyHint
                icon={X}
                text="搜索失败"
                description={searchError}
              />
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
                        onClick={() => {
                          if (query.trim()) saveRecent(query.trim())
                          it.action()
                        }}
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
                          <Badge
                            variant="outline"
                            className="text-[10px] border-quant font-mono shrink-0"
                          >
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
        </DialogContent>
      </Dialog>
    )
  }
)

// ============================================================================
// 子组件
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

// ============================================================================
// 工具
// ============================================================================

function typeLabel(t: string): string {
  switch (t) {
    case 'limit_up':
      return '涨停'
    case 'drop_alert':
      return '跌警'
    case 'breakout':
      return '突破'
    case 'selection':
      return '选股'
    case 'system':
      return '系统'
    default:
      return t
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / 1000
    if (diff < 60) return '刚刚'
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
