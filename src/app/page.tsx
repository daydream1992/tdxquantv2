'use client'

import * as React from 'react'
import { Activity, BarChart3, Cpu, Layers, Bell, Sun, Moon, RefreshCw, Settings, Play, Loader2, Search, Crosshair, Star, Gavel, Radio, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useThemeMode } from '@/lib/theme'
import { monitorAPI, configAPI, strategyAPI, channelAPI, type MonitorStatusDTO } from '@/lib/api'
import { toast } from 'sonner'
import { notifySuccess, notifyError, useNotificationStore } from '@/lib/notifications'
import { Dashboard } from '@/components/quant/Dashboard'
import { StrategyManager } from '@/components/quant/StrategyManager'
import { SelectionResults } from '@/components/quant/SelectionResults'
import { SignalCenter } from '@/components/quant/SignalCenter'
import { SectorManager } from '@/components/quant/SectorManager'
import { MatchStrategyManager } from '@/components/quant/MatchStrategyManager'
import { WatchlistManager } from '@/components/quant/WatchlistManager'
import { AuctionPanel } from '@/components/quant/AuctionPanel'
import { RealtimeSelection } from '@/components/quant/RealtimeSelection'
import { PatternAlertLibrary } from '@/components/quant/PatternAlertLibrary'
import { ConfigSummary } from '@/components/quant/ConfigSummary'
import { ChannelSettingsDialog } from '@/components/quant/ChannelSettingsDialog'
import { GlobalSearch, type GlobalSearchHandle } from '@/components/quant/GlobalSearch'
import { NotificationCenter } from '@/components/quant/NotificationCenter'

const TABS = [
  { value: 'dashboard', label: '实时大屏', icon: Activity },
  { value: 'strategies', label: '策略管理', icon: Cpu },
  { value: 'selections', label: '选股结果', icon: BarChart3 },
  { value: 'signals', label: '信号中心', icon: Bell },
  { value: 'sectors', label: '板块管理', icon: Layers },
  { value: 'match-strategies', label: '匹配策略', icon: Crosshair },
  { value: 'watchlist', label: '自选股', icon: Star },
  { value: 'realtime', label: '实时选股', icon: Radio },
  { value: 'patterns', label: '形态预警', icon: ShieldAlert },
  { value: 'auction', label: '竞价监控', icon: Gavel },
] as const

export default function Home() {
  const [tab, setTab] = React.useState<string>('dashboard')
  const { toggleMode, theme } = useThemeMode()
  const [status, setStatus] = React.useState<MonitorStatusDTO | null>(null)
  const [reloadSpin, setReloadSpin] = React.useState(false)
  const [runningAll, setRunningAll] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [channelErrors, setChannelErrors] = React.useState(0)
  const searchRef = React.useRef<GlobalSearchHandle>(null)

  // 拉取监控状态用于顶部状态指示
  React.useEffect(() => {
    let mounted = true
    const fetchStatus = () => {
      monitorAPI
        .getStatus()
        .then((s) => mounted && setStatus(s))
        .catch(() => {})
    }
    fetchStatus()
    const t = setInterval(fetchStatus, 15_000)
    return () => {
      mounted = false
      clearInterval(t)
    }
  }, [])

  // 拉取通道错误数 (用于设置按钮红点提示)
  React.useEffect(() => {
    let mounted = true
    const fetchChannels = async () => {
      try {
        const data = await channelAPI.list()
        const total = (data.channels || []).reduce(
          (s, c) => s + (c.errors?.length || 0),
          0
        )
        if (mounted) setChannelErrors(total)
      } catch {
        /* noop */
      }
    }
    fetchChannels()
    const t = setInterval(fetchChannels, 60_000)
    return () => {
      mounted = false
      clearInterval(t)
    }
  }, [settingsOpen])

  const handleReloadConfig = async () => {
    setReloadSpin(true)
    try {
      const r = await configAPI.reload()
      notifySuccess('配置已热加载', `重载 ${r.reloaded.length} 项: ${r.reloaded.slice(0, 5).join(', ')}${r.reloaded.length > 5 ? '...' : ''}`)
    } catch (e) {
      notifyError('配置加载失败', (e as Error).message)
    } finally {
      setTimeout(() => setReloadSpin(false), 500)
    }
  }

  // 一键运行全部启用策略
  const handleRunAll = async () => {
    setRunningAll(true)
    const toastId = toast.loading('正在批量运行所有启用策略...', {
      description: '请稍候，5 个策略依次执行',
    })
    try {
      const r = await strategyAPI.runAll()
      const total = r.results.reduce((s, x) => s + x.count, 0)
      const ok = r.results.filter((x) => x.ok).length
      const fail = r.results.length - ok
      const desc = r.results.map((x) => `${x.id}: ${x.count}`).join(' · ')
      // 更新 loading toast 为 success（保留 toastId 链路）
      toast.success(`批量运行完成：${ok}/${r.results.length} 成功 · 共选出 ${total} 只`, {
        id: toastId,
        description: desc,
      })
      // 同步写入通知中心历史
      useNotificationStore.getState().add(
        'success',
        `批量运行完成：${ok}/${r.results.length} 成功 · 共选出 ${total} 只${fail ? ` · 失败 ${fail}` : ''}`,
        desc,
      )
      // 触发 status 刷新
      setTimeout(() => {
        monitorAPI.getStatus().then(setStatus).catch(() => {})
      }, 500)
    } catch (e) {
      const msg = (e as Error).message
      toast.error('批量运行失败', { id: toastId, description: msg })
      useNotificationStore.getState().add('error', '批量运行失败', msg)
    } finally {
      setRunningAll(false)
    }
  }

  const engineStatus = status?.engine_status ?? 'unknown'
  const statusColor =
    engineStatus === 'running'
      ? 'var(--quant-down)'
      : engineStatus === 'error'
      ? 'var(--quant-up)'
      : 'var(--quant-flat)'

  return (
    <div className="min-h-screen flex flex-col bg-quant-bg text-foreground">
      {/* ===== Header ===== */}
      <header className="sticky top-0 z-30 border-b border-quant bg-quant-card/95 backdrop-blur supports-[backdrop-filter]:bg-quant-card/80">
        <div className="container mx-auto max-w-[1600px] px-4">
          <div className="flex items-center justify-between h-14 gap-3">
            {/* Logo + Title */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex items-center justify-center size-8 rounded-md bg-[var(--quant-primary)]/15">
                <BarChart3 className="size-5 text-quant-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold leading-tight truncate">
                  TdxQuant <span className="text-quant-primary">量化交易系统</span>
                </div>
                <div className="text-[10px] text-muted-foreground leading-tight">
                  P1 阶段 · Mock 模式
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="hidden md:flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2 rounded-full status-pulse"
                  style={{ backgroundColor: statusColor }}
                />
                <span className="text-muted-foreground">引擎</span>
                <span className="font-medium" style={{ color: statusColor }}>
                  {engineStatus === 'running' ? '运行中' : engineStatus === 'error' ? '异常' : '未知'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">适配器</span>
                <Badge variant="outline" className="text-[10px] border-quant font-mono">
                  {status?.adapter_mode ?? 'mock'}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">监控</span>
                <span className="font-mono tabular-nums text-quant-primary">
                  {status?.monitored_count ?? 0}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">今日信号</span>
                <span className="font-mono tabular-nums">
                  {status?.today_signals ?? 0}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-9 hover:bg-amber-500/10"
                onClick={() => searchRef.current?.open()}
                title="全局搜索 (⌘K / Ctrl+K)"
              >
                <Search className="size-4" />
              </Button>
              <NotificationCenter />
              <ConfigSummary />
              <Button
                variant="default"
                size="sm"
                className="h-9 gap-1.5 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300"
                onClick={handleRunAll}
                disabled={runningAll}
                title="一键运行所有启用的策略"
              >
                {runningAll ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                <span className="hidden sm:inline">{runningAll ? '运行中...' : '运行全部'}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                onClick={handleReloadConfig}
                title="热加载 YAML 配置"
              >
                <RefreshCw className={cn('size-4', reloadSpin && 'animate-spin')} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 hover:bg-amber-500/10"
                onClick={toggleMode}
                title={`切换主题（当前：${theme.mode === 'dark' ? '深色' : '浅色'}）`}
              >
                {theme.mode === 'dark' ? (
                  <Sun className="size-4 text-amber-400" />
                ) : (
                  <Moon className="size-4 text-slate-600" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 relative hover:bg-amber-500/10"
                title={channelErrors > 0 ? `通道有 ${channelErrors} 个错误，点击配置` : '推送通道配置'}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="size-4" />
                {channelErrors > 0 && (
                  <span
                    className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-background"
                    aria-label={`${channelErrors} 个错误`}
                  />
                )}
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="bg-transparent border-0 p-0 h-11 w-full grid grid-flow-col auto-cols-min sm:grid-cols-10 sm:w-full overflow-x-auto quant-scroll rounded-none">
              {TABS.map((t) => {
                const Icon = t.icon
                return (
                  <TabsTrigger
                    key={t.value}
                    value={t.value}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm h-11 rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--quant-primary)] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-quant-primary whitespace-nowrap"
                  >
                    <Icon className="size-4" />
                    <span>{t.label}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* ===== Main ===== */}
      <main className="flex-1 container mx-auto max-w-[1600px] px-4 py-4 w-full">
        {tab === 'dashboard' && (
          <Dashboard
            onNavigateToBacktest={() => {
              setTab('selections')
              // 等待 SelectionResults 挂载后 dispatch 事件
              setTimeout(() => {
                try {
                  window.dispatchEvent(
                    new CustomEvent('tdxquant:show-backtest', {
                      detail: { source: 'dashboard' },
                    })
                  )
                } catch {
                  /* noop */
                }
              }, 100)
            }}
          />
        )}
        {tab === 'strategies' && <StrategyManager />}
        {tab === 'selections' && <SelectionResults />}
        {tab === 'signals' && <SignalCenter />}
        {tab === 'sectors' && <SectorManager />}
        {tab === 'match-strategies' && <MatchStrategyManager />}
        {tab === 'watchlist' && <WatchlistManager />}
        {tab === 'realtime' && <RealtimeSelection />}
        {tab === 'patterns' && <PatternAlertLibrary />}
        {tab === 'auction' && <AuctionPanel />}
      </main>

      {/* ===== Footer (sticky to bottom) ===== */}
      <footer className="mt-auto border-t border-quant bg-quant-card">
        <div className="container mx-auto max-w-[1600px] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-mono">TdxQuant v0.1.0 (P1)</span>
              <span>·</span>
              <span>Next.js 16 + FastAPI + QuestDB</span>
              <span>·</span>
              <span>数据源：{status?.adapter_mode ?? 'mock'} 适配器</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: 'var(--quant-up)' }} />
                涨
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: 'var(--quant-down)' }} />
                跌
              </span>
              <span>
                心跳：{status ? new Date(status.last_hb).toLocaleTimeString('zh-CN') : '--'}
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* ===== Settings Dialog (推送通道配置) ===== */}
      <ChannelSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      {/* ===== 全局搜索 (Cmd+K / Ctrl+K) ===== */}
      <GlobalSearch
        ref={searchRef}
        onNavigate={setTab}
        onToggleTheme={toggleMode}
        onOpenSettings={() => setSettingsOpen(true)}
        onRunAll={handleRunAll}
      />
    </div>
  )
}
