/**
 * GlobalSearch 共享类型 + 工具函数
 *
 * - GlobalSearchHandle / GlobalSearchProps: 容器对外契约 (page.tsx ref + props)
 * - ItemKind / FlatItem: 扁平化搜索结果项 (用于键盘导航 + 分组渲染)
 * - RECENT_KEY / MAX_RECENT: localStorage 最近搜索
 * - buildFlatItems: 把 query/result/recentSearches + 快捷操作 扁平化成 FlatItem[]
 * - typeLabel / formatTime: 信号类型与时间格式化
 */

import * as React from 'react'
import {
  Cpu, BarChart3, Bell, Activity, Layers, Settings, Sun, Play, History, Hash,
} from 'lucide-react'
import type {
  SearchResponseDTO,
  SearchStrategyItemDTO,
  SearchStockItemDTO,
  SearchSignalItemDTO,
} from '@/lib/api'

// ============================================================================
// 容器对外契约
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

// ============================================================================
// 扁平化结果项
// ============================================================================

export type ItemKind = 'strategy' | 'stock' | 'signal' | 'action' | 'recent'

export interface FlatItem {
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

// ============================================================================
// 最近搜索 (localStorage)
// ============================================================================

export const RECENT_KEY = 'tdxquant-recent-searches'
export const MAX_RECENT = 5

// ============================================================================
// 扁平化构建
// ============================================================================

export interface BuildFlatItemsParams {
  query: string
  result: SearchResponseDTO | null
  recentSearches: string[]
  onNavigate?: (tab: string) => void
  onToggleTheme?: () => void
  onOpenSettings?: () => void
  onRunAll?: () => void
  goTab: (tab: string) => void
  close: () => void
  setQuery: (v: string) => void
}

export function buildFlatItems(p: BuildFlatItemsParams): FlatItem[] {
  const items: FlatItem[] = []
  const kw = p.query.trim()

  if (!kw) {
    // 空状态: 最近搜索 + 快捷操作
    if (p.recentSearches.length > 0) {
      p.recentSearches.forEach((s) => {
        items.push({
          id: `recent-${s}`,
          kind: 'recent',
          group: '最近搜索',
          icon: History,
          iconColor: 'var(--quant-flat)',
          title: s,
          subtitle: '回车搜索',
          action: () => { p.setQuery(s) },
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
      { id: 'act-dashboard', icon: Activity, title: '实时大屏', subtitle: '查看行情 + 信号流', run: () => p.goTab('dashboard') },
      { id: 'act-strategies', icon: Cpu, title: '策略管理', subtitle: '5 个策略 · 启停 / 运行', run: () => p.goTab('strategies') },
      { id: 'act-selections', icon: BarChart3, title: '选股结果', subtitle: '明细 / 汇总 / 对比 / 回测', run: () => p.goTab('selections') },
      {
        id: 'act-backtest',
        icon: History,
        title: '切到回测视图',
        subtitle: '基于历史选股模拟交易',
        run: () => {
          p.onNavigate?.('selections')
          try {
            window.dispatchEvent(new CustomEvent('tdxquant:show-backtest', { detail: { source: 'globalsearch' } }))
          } catch { /* noop */ }
          p.close()
        },
      },
      { id: 'act-signals', icon: Bell, title: '信号中心', subtitle: '查看推送状态 / 重推', run: () => p.goTab('signals') },
      { id: 'act-sectors', icon: Layers, title: '板块管理', subtitle: '5 个策略板块', run: () => p.goTab('sectors') },
    ]
    if (p.onRunAll) {
      actions.unshift({
        id: 'act-run-all', icon: Play, title: '运行全部策略',
        subtitle: '一键执行 5 个启用的策略', shortcut: '',
        run: () => { p.onRunAll!(); p.close() },
      })
    }
    if (p.onToggleTheme) {
      actions.push({ id: 'act-theme', icon: Sun, title: '切换主题', subtitle: '深色 / 浅色', run: () => { p.onToggleTheme!(); p.close() } })
    }
    if (p.onOpenSettings) {
      actions.push({ id: 'act-settings', icon: Settings, title: '推送通道配置', subtitle: 'CSV / WebSocket / 通达信 / 飞书', run: () => { p.onOpenSettings!(); p.close() } })
    }
    actions.forEach((a) => {
      items.push({
        id: a.id, kind: 'action', group: '快捷操作',
        icon: a.icon, iconColor: 'var(--quant-primary)',
        title: a.title, subtitle: a.subtitle, shortcut: a.shortcut, action: a.run,
      })
    })
    return items
  }

  // 有 query: 展示搜索结果 (分组)
  if (p.result) {
    p.result.strategies.forEach((s: SearchStrategyItemDTO) => {
      items.push({
        id: `strat-${s.strategy_id}`, kind: 'strategy', group: '策略',
        icon: Cpu, iconColor: 'var(--quant-primary)',
        title: `${s.strategy_emoji || '📊'} ${s.strategy_name}`,
        subtitle: s.description || `ID: ${s.strategy_id}`,
        badge: s.sector_code || s.strategy_id,
        action: () => p.goTab('strategies'),
      })
    })
    p.result.stocks.forEach((s: SearchStockItemDTO) => {
      items.push({
        id: `stock-${s.stock_code}-${s.strategy_id}`, kind: 'stock', group: '股票',
        icon: Hash, iconColor: 'var(--quant-up)',
        title: `${s.stock_name || '—'} · ${s.stock_code}`,
        subtitle: s.strategy_name
          ? `${s.strategy_name} · 得分 ${s.score.toFixed(1)}${s.run_date ? ' · ' + s.run_date : ''}`
          : '选股结果',
        badge: s.strategy_name,
        action: () => p.goTab('selections'),
      })
    })
    p.result.signals.forEach((s: SearchSignalItemDTO) => {
      items.push({
        id: `sig-${s.id}`, kind: 'signal', group: '信号',
        icon: Bell, iconColor: 'var(--quant-down)',
        title: s.content.slice(0, 60) + (s.content.length > 60 ? '…' : ''),
        subtitle: `${s.strategy_name || s.strategy_id || '系统'}${s.stock_name ? ' · ' + s.stock_name : ''}${s.stock_code ? ' · ' + s.stock_code : ''} · ${formatTime(s.time)}`,
        badge: typeLabel(s.type),
        action: () => p.goTab('signals'),
      })
    })
    // 永远展示快捷操作 (即使有结果)
    const quickActions: FlatItem[] = []
    if (p.onRunAll) {
      quickActions.push({
        id: 'act-run-all', kind: 'action', group: '操作',
        icon: Play, iconColor: 'var(--quant-primary)',
        title: '运行全部策略', subtitle: '一键执行 5 个启用的策略',
        action: () => { p.onRunAll!(); p.close() },
      })
    }
    quickActions.push({
      id: 'act-backtest', kind: 'action', group: '操作',
      icon: History, iconColor: 'var(--quant-primary)',
      title: '切到回测视图', subtitle: '选股结果 Tab 的回测 toggle',
      action: () => {
        p.onNavigate?.('selections')
        try {
          window.dispatchEvent(new CustomEvent('tdxquant:show-backtest', { detail: { source: 'globalsearch' } }))
        } catch { /* noop */ }
        p.close()
      },
    })
    if (p.onToggleTheme) {
      quickActions.push({
        id: 'act-theme', kind: 'action', group: '操作',
        icon: Sun, iconColor: 'var(--quant-primary)',
        title: '切换主题', subtitle: '深色 / 浅色',
        action: () => { p.onToggleTheme!(); p.close() },
      })
    }
    if (p.onOpenSettings) {
      quickActions.push({
        id: 'act-settings', kind: 'action', group: '操作',
        icon: Settings, iconColor: 'var(--quant-primary)',
        title: '推送通道配置', subtitle: 'CSV / WebSocket / 通达信 / 飞书',
        action: () => { p.onOpenSettings!(); p.close() },
      })
    }
    quickActions.forEach((q) => items.push(q))
  }
  return items
}

// ============================================================================
// 工具
// ============================================================================

export function typeLabel(t: string): string {
  switch (t) {
    case 'limit_up': return '涨停'
    case 'drop_alert': return '跌警'
    case 'breakout': return '突破'
    case 'selection': return '选股'
    case 'system': return '系统'
    default: return t
  }
}

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / 1000
    if (diff < 60) return '刚刚'
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
