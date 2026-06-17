'use client'

import * as React from 'react'
import { Activity, BarChart3, Cpu, Layers, Bell, Sun, Moon, RefreshCw, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useThemeMode } from '@/lib/theme'
import { monitorAPI, configAPI, type MonitorStatusDTO } from '@/lib/api'
import { toast } from 'sonner'
import { Dashboard } from '@/components/quant/Dashboard'
import { StrategyManager } from '@/components/quant/StrategyManager'
import { SelectionResults } from '@/components/quant/SelectionResults'
import { SignalCenter } from '@/components/quant/SignalCenter'
import { SectorManager } from '@/components/quant/SectorManager'

const TABS = [
  { value: 'dashboard', label: '实时大屏', icon: Activity },
  { value: 'strategies', label: '策略管理', icon: Cpu },
  { value: 'selections', label: '选股结果', icon: BarChart3 },
  { value: 'signals', label: '信号中心', icon: Bell },
  { value: 'sectors', label: '板块管理', icon: Layers },
] as const

export default function Home() {
  const [tab, setTab] = React.useState<string>('dashboard')
  const { toggleMode, theme } = useThemeMode()
  const [status, setStatus] = React.useState<MonitorStatusDTO | null>(null)
  const [reloadSpin, setReloadSpin] = React.useState(false)

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

  const handleReloadConfig = async () => {
    setReloadSpin(true)
    try {
      const r = await configAPI.reload()
      toast.success('配置已热加载', {
        description: `重载 ${r.reloaded.length} 项: ${r.reloaded.slice(0, 5).join(', ')}${r.reloaded.length > 5 ? '...' : ''}`,
      })
    } catch (e) {
      toast.error('配置加载失败', { description: (e as Error).message })
    } finally {
      setTimeout(() => setReloadSpin(false), 500)
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
                className="size-9"
                title="设置（占位）"
                onClick={() => toast.info('设置功能将在 P2 阶段实现')}
              >
                <Settings className="size-4" />
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="bg-transparent border-0 p-0 h-11 w-full grid grid-flow-col auto-cols-min sm:grid-cols-5 sm:w-full overflow-x-auto quant-scroll rounded-none">
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
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'strategies' && <StrategyManager />}
        {tab === 'selections' && <SelectionResults />}
        {tab === 'signals' && <SignalCenter />}
        {tab === 'sectors' && <SectorManager />}
      </main>

      {/* ===== Footer (sticky to bottom) ===== */}
      <footer className="mt-auto border-t border-quant bg-quant-card">
        <div className="container mx-auto max-w-[1600px] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-mono">TdxQuant v0.1.0 (P1)</span>
              <span>·</span>
              <span>Next.js 16 + FastAPI + DuckDB</span>
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
    </div>
  )
}
