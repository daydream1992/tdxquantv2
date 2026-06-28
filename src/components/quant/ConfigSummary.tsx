'use client'

/**
 * R13-3a: 配置摘要 Dialog
 *
 * 消费 GET /api/config (后端 ConfigSummaryResponse),以 Dialog 形式展示:
 *   区块1: 应用信息 (name / version / adapter_mode / log_level)
 *   区块2: 统计概览 (4 个 StatCard: 策略总数 / 启用策略 / 预警模板 / 匹配策略)
 *   区块3: 通道状态 (channels 列表 + enabled Badge)
 *   区块4: 关键路径 (paths 5 个 + monospace + 复制按钮)
 *
 * 触发: Settings2 图标按钮,头部状态栏常驻
 * 数据: Dialog 打开时按需拉取,提供刷新 / 重试
 *
 * 主题: 琥珀/橙金色 (var(--quant-primary)),适配 mock=amber / real=emerald Badge
 */

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Settings2,
  RefreshCw,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  Server,
  Cpu,
  Bell,
  Crosshair,
  FolderTree,
  Radio,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { configAPI, type ConfigSummaryDTO } from '@/lib/api'

// ===== 常量 =====

/** 关键路径白名单 (按重要性排序,其他路径在「其他路径」中展示) */
const KEY_PATHS = [
  'duckdb',
  'strategies_dir',
  'monitor_rules',
  'match_strategies',
  'channels',
] as const

const PATH_LABELS: Record<string, string> = {
  duckdb: 'QuestDB 数据库',
  csv_output: 'CSV 输出',
  excel_output: 'Excel 输出',
  logs: '日志目录',
  strategies_dir: '策略目录',
  monitor_rules: '监控规则',
  match_strategies: '匹配策略',
  channels: '通道配置',
}

// ===== StatCard 子组件 (轻量内联,不引入外部 StatCard 的 sparkline) =====

interface MiniStatProps {
  label: string
  value: number
  icon: React.ElementType
  tone?: 'primary' | 'up' | 'down' | 'flat'
  hint?: string
}

const TONE_COLOR: Record<NonNullable<MiniStatProps['tone']>, string> = {
  primary: 'var(--quant-primary)',
  up: 'var(--quant-up)',
  down: 'var(--quant-down)',
  flat: 'var(--quant-flat)',
}

function MiniStat({ label, value, icon: Icon, tone = 'primary', hint }: MiniStatProps) {
  const color = TONE_COLOR[tone]
  return (
    <div
      className="rounded-md border border-quant bg-quant-card/60 p-3 flex flex-col gap-1.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground truncate">{label}</span>
        <Icon className="size-3.5 shrink-0" style={{ color }} />
      </div>
      <div
        className="text-2xl font-semibold tabular-nums leading-none"
        style={{ color }}
      >
        {value.toLocaleString('zh-CN')}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground truncate">{hint}</div>}
    </div>
  )
}

// ===== 主组件 =====

export function ConfigSummary() {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [data, setData] = React.useState<ConfigSummaryDTO | null>(null)
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)

  // 拉取数据
  const fetchData = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await configAPI.getSummary()
      setData(r)
    } catch (e) {
      setError((e as Error).message || '加载配置摘要失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // Dialog 打开时拉取 (有数据则不重复拉)
  React.useEffect(() => {
    if (open && !data && !loading) {
      fetchData()
    }
  }, [open, data, loading, fetchData])

  // 复制路径
  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      toast.success('已复制', { description: value })
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
    } catch {
      toast.error('复制失败', { description: '请手动选择文本复制' })
    }
  }

  // 派生数据
  const adapterMode = data?.app?.adapter_mode ?? 'mock'
  const enabledChannels = data?.channels?.filter((c) => c.enabled).length ?? 0
  const totalChannels = data?.channels?.length ?? 0

  // 关键路径 + 其他路径
  const pathEntries = React.useMemo(() => {
    if (!data?.paths) return { keyPaths: [], otherPaths: [] }
    const all = Object.entries(data.paths)
    const keyPaths = KEY_PATHS.map((k) => [k, data.paths[k]] as const).filter(
      ([, v]) => v !== undefined
    )
    const keySet = new Set(KEY_PATHS as readonly string[])
    const otherPaths = all.filter(([k]) => !keySet.has(k))
    return { keyPaths, otherPaths }
  }, [data])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 hover:bg-amber-500/10"
          title="配置摘要 (策略数 / 模板数 / 通道状态 / 路径)"
          aria-label="配置摘要"
        >
          <Settings2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[88vh] overflow-hidden flex flex-col gap-0 p-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-quant shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Settings2 className="size-4 text-quant-primary" />
                配置摘要
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                全局配置概览 · 应用信息 / 统计 / 通道 / 路径
                {data?.last_reload_at && (
                  <span className="ml-2 text-muted-foreground/70">
                    · 最近重载: {data.last_reload_at}
                  </span>
                )}
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 shrink-0"
              onClick={fetchData}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </DialogHeader>

        {/* Body (滚动) */}
        <div className="flex-1 overflow-y-auto quant-scroll px-5 py-4">
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Loader2 className="size-6 animate-spin text-quant-primary" />
              <span className="text-sm">正在加载配置摘要…</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <AlertCircle className="size-8 text-red-500" />
              <div className="text-sm text-muted-foreground">加载失败: {error}</div>
              <Button variant="outline" size="sm" onClick={fetchData} className="h-8 gap-1.5">
                <RefreshCw className="size-3.5" />
                重试
              </Button>
            </div>
          ) : data ? (
            <div className="space-y-5">
              {/* ===== 区块1: 应用信息 ===== */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Server className="size-3.5" />
                  应用信息
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <InfoCell label="应用名称" value={data.app?.name || '-'} />
                  <InfoCell label="版本" value={data.app?.version || '-'} mono />
                  <div className="rounded-md border border-quant bg-quant-card/60 p-2.5">
                    <div className="text-[10px] text-muted-foreground mb-1">适配器模式</div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[11px] font-mono border',
                        adapterMode === 'real'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                          : 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                      )}
                    >
                      {adapterMode}
                    </Badge>
                  </div>
                  <InfoCell label="日志级别" value={data.app?.log_level || '-'} mono />
                  <InfoCell
                    label="服务地址"
                    value={`${data.server?.host || '-'}:${data.server?.port || '-'}`}
                    mono
                  />
                  <InfoCell
                    label="通道启用"
                    value={`${enabledChannels}/${totalChannels}`}
                    mono
                  />
                  <InfoCell
                    label="配置文件数"
                    value={(data.config_files?.length ?? 0).toString()}
                    mono
                  />
                </div>
                {data.fallback && (
                  <div className="mt-2 text-[11px] text-amber-500 flex items-center gap-1.5">
                    <AlertCircle className="size-3.5" />
                    后端不可达,显示降级数据
                  </div>
                )}
              </section>

              {/* ===== 区块2: 统计概览 ===== */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Cpu className="size-3.5" />
                  统计概览
                </h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  <MiniStat
                    label="策略总数"
                    value={data.strategies_count ?? 0}
                    icon={Cpu}
                    tone="primary"
                    hint={`启用 ${data.strategies_enabled_count ?? 0}`}
                  />
                  <MiniStat
                    label="启用策略"
                    value={data.strategies_enabled_count ?? 0}
                    icon={Cpu}
                    tone="up"
                    hint={`共 ${data.strategies_count ?? 0}`}
                  />
                  <MiniStat
                    label="预警模板"
                    value={data.alert_templates_count ?? 0}
                    icon={Bell}
                    tone="down"
                    hint="alert_templates"
                  />
                  <MiniStat
                    label="匹配策略"
                    value={data.match_strategies_count ?? 0}
                    icon={Crosshair}
                    tone="flat"
                    hint="match_strategies"
                  />
                </div>
              </section>

              {/* ===== 区块3: 通道状态 ===== */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Radio className="size-3.5" />
                  通道状态
                  <span className="text-muted-foreground/70 normal-case font-normal">
                    ({enabledChannels}/{totalChannels} 启用)
                  </span>
                </h3>
                <Card className="bg-quant-card/40 border-quant p-0">
                  <ScrollArea className="max-h-40">
                    <div className="divide-y divide-quant">
                      {(data.channels || []).length === 0 ? (
                        <div className="p-3 text-center text-xs text-muted-foreground">
                          暂无通道
                        </div>
                      ) : (
                        (data.channels || []).map((c) => (
                          <div
                            key={c.name}
                            className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-quant/40 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={cn(
                                  'inline-block size-1.5 rounded-full shrink-0',
                                  c.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                                )}
                              />
                              <span className="font-mono text-xs truncate">{c.name}</span>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] shrink-0',
                                c.enabled
                                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                                  : 'border-muted-foreground/30 bg-muted/30 text-muted-foreground'
                              )}
                            >
                              {c.enabled ? '启用' : '禁用'}
                            </Badge>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </Card>
              </section>

              {/* ===== 区块4: 关键路径 ===== */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <FolderTree className="size-3.5" />
                  关键路径
                </h3>
                <div className="space-y-1.5">
                  {pathEntries.keyPaths.map(([k, v]) => (
                    <PathRow
                      key={k}
                      pathKey={k}
                      value={v}
                      copied={copiedKey === k}
                      onCopy={() => handleCopy(k, v)}
                    />
                  ))}
                  {pathEntries.otherPaths.length > 0 && (
                    <>
                      <div className="text-[10px] text-muted-foreground/70 pt-2 pb-1">
                        其他路径
                      </div>
                      {pathEntries.otherPaths.map(([k, v]) => (
                        <PathRow
                          key={k}
                          pathKey={k}
                          value={v}
                          copied={copiedKey === k}
                          onCopy={() => handleCopy(k, v)}
                          compact
                        />
                      ))}
                    </>
                  )}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ===== 子组件 =====

function InfoCell({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-md border border-quant bg-quant-card/60 p-2.5 min-w-0">
      <div className="text-[10px] text-muted-foreground mb-1 truncate">{label}</div>
      <div
        className={cn(
          'text-sm font-medium truncate',
          mono && 'font-mono tabular-nums'
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function PathRow({
  pathKey,
  value,
  copied,
  onCopy,
  compact,
}: {
  pathKey: string
  value: string
  copied: boolean
  onCopy: () => void
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-md border border-quant bg-quant-card/40 px-2.5 hover:bg-quant-card/70 transition-colors',
        compact ? 'py-1.5' : 'py-2'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-muted-foreground mb-0.5">
          {PATH_LABELS[pathKey] || pathKey}
          <span className="ml-1.5 text-muted-foreground/60 font-mono">{pathKey}</span>
        </div>
        <div
          className="text-xs font-mono text-foreground/90 truncate"
          title={value}
        >
          {value || '-'}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 hover:bg-amber-500/10"
        onClick={onCopy}
        title="复制路径"
        aria-label={`复制 ${pathKey}`}
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-500" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </div>
  )
}
