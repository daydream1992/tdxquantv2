'use client'

/**
 * MatchStrategyList — 匹配策略列表 + 顶部工具栏 + 删除确认 + 启用/禁用切换
 *
 * 职责：
 *  1. 顶部工具栏 (重载 YAML / 新建 / 刷新) + 项数 Badge
 *  2. 卡片网格 (加载骨架 / 空态 / 多列卡片)
 *  3. 单张卡片 MatchCard (name / match_id badge / enabled Switch / alerts / debounce / 操作)
 *  4. 启用/禁用 Switch (乐观更新, 调 PUT)
 *  5. 删除确认 AlertDialog (兜底套餐 _default 禁用删除)
 *
 * items / strategies 由容器 (MatchStrategyManager) 通过 props 注入,
 * 本组件负责所有"列表内部"的 UI 状态 (toggle / delete) 与对应的 API 调用,
 * 保存/创建成功后通过 onRefresh 让容器重新拉取列表。
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Crosshair,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  FlaskConical,
  Loader2,
  Shield,
  Clock,
  AlertCircle,
  Copy,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  matchStrategyAPI,
  type MatchStrategyDTO,
  type StrategyDTO,
} from '@/lib/api'
import { isDefault, scopeSummary } from './shared'

// ----------------------------------------------------------------------------
// Props
// ----------------------------------------------------------------------------

export interface MatchStrategyListProps {
  items: MatchStrategyDTO[]
  setItems: React.Dispatch<React.SetStateAction<MatchStrategyDTO[]>>
  strategies: StrategyDTO[]
  loading: boolean
  reloading: boolean
  onReload: () => void
  onRefresh: () => void
  onCreate: () => void
  onEdit: (s: MatchStrategyDTO) => void
  onTest: (s: MatchStrategyDTO) => void
  onCopy: (s: MatchStrategyDTO) => void
}

// ----------------------------------------------------------------------------
// 主组件
// ----------------------------------------------------------------------------

export function MatchStrategyList({
  items,
  setItems,
  strategies,
  loading,
  reloading,
  onReload,
  onRefresh,
  onCreate,
  onEdit,
  onTest,
  onCopy,
}: MatchStrategyListProps) {
  // 启用/禁用切换 (单卡片立即生效, 乐观更新)
  const [togglingId, setTogglingId] = React.useState<string | null>(null)
  const handleToggle = async (s: MatchStrategyDTO, next: boolean) => {
    setTogglingId(s.match_id)
    try {
      await matchStrategyAPI.update(s.match_id, { enabled: next })
      setItems((prev) =>
        prev.map((x) =>
          x.match_id === s.match_id ? { ...x, enabled: next } : x,
        ),
      )
      toast.success(`${s.name || s.match_id} 已${next ? '启用' : '禁用'}`, {
        description: `match_id: ${s.match_id}`,
      })
    } catch (e) {
      toast.error('切换状态失败', { description: (e as Error).message })
    } finally {
      setTogglingId(null)
    }
  }

  // 删除确认
  const [deleteTarget, setDeleteTarget] = React.useState<MatchStrategyDTO | null>(null)
  const [deleteSaving, setDeleteSaving] = React.useState(false)
  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleteSaving(true)
    const tid = toast.loading(`正在删除 ${deleteTarget.match_id}...`)
    try {
      await matchStrategyAPI.remove(deleteTarget.match_id)
      toast.success('已删除', { id: tid, description: deleteTarget.match_id })
      setDeleteTarget(null)
      await onRefresh()
    } catch (e) {
      const msg = (e as Error).message || ''
      if (msg.includes('_default') || msg.includes('兜底')) {
        toast.error('不允许删除兜底套餐 _default', {
          id: tid,
          description: '兜底套餐系统保留，不可删除',
        })
      } else {
        toast.error('删除失败', { id: tid, description: msg })
      }
    } finally {
      setDeleteSaving(false)
    }
  }

  return (
    <>
      {/* 顶部工具栏 */}
      <Card className="p-3 gap-0 bg-quant-card border-quant">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Crosshair className="size-4 text-quant-primary" />
            <span className="font-semibold">匹配策略管理</span>
            <Badge variant="outline" className="border-quant font-mono">
              {items.length} 项
            </Badge>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              match_strategies.yaml · 三层模型 L2 装配单
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 border-quant" onClick={onReload} disabled={reloading}>
              <RefreshCw className={cn('size-3.5', reloading && 'animate-spin')} />
              <span className="hidden sm:inline">重载 YAML</span>
            </Button>
            <Button
              size="sm"
              className="h-8 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
              onClick={onCreate}
            >
              <Plus className="size-3.5" />
              <span className="hidden sm:inline">新建匹配策略</span>
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* 卡片列表 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-4 bg-quant-card border-quant">
              <div className="h-4 w-1/2 bg-muted/30 rounded mb-2" />
              <div className="h-3 w-2/3 bg-muted/20 rounded mb-3" />
              <div className="h-16 w-full bg-muted/10 rounded" />
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="bg-quant-card border-quant">
          <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
            <Crosshair className="size-6 mb-2 opacity-40" />
            暂无匹配策略，点击右上角&quot;新建&quot;创建
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((s) => (
            <MatchCard
              key={s.match_id}
              data={s}
              strategies={strategies}
              toggling={togglingId === s.match_id}
              onToggle={(next) => handleToggle(s, next)}
              onEdit={() => onEdit(s)}
              onTest={() => onTest(s)}
              onCopy={() => onCopy(s)}
              onDelete={() => setDeleteTarget(s)}
            />
          ))}
        </div>
      )}

      {/* 删除确认 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && !deleteSaving && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-5 text-red-500" />
              确认删除匹配策略
            </AlertDialogTitle>
            <AlertDialogDescription>
              即将删除 <span className="font-mono font-semibold">{deleteTarget?.match_id}</span>
              （{deleteTarget?.name}）。
              {deleteTarget && isDefault(deleteTarget.match_id) && (
                <span className="block mt-2 text-red-500 font-medium">
                  ⚠ _default 为兜底套餐，后端会返回 403 拒绝删除。
                </span>
              )}
              <span className="block mt-1">该操作不可恢复，删除后相关股票将不再产生预警。</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSaving}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25"
              onClick={handleDelete}
              disabled={deleteSaving}
            >
              {deleteSaving ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : (
                <Trash2 className="size-4 mr-1" />
              )}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ----------------------------------------------------------------------------
// 单张卡片
// ----------------------------------------------------------------------------

interface MatchCardProps {
  data: MatchStrategyDTO
  strategies: StrategyDTO[]
  toggling: boolean
  onToggle: (next: boolean) => void
  onEdit: () => void
  onTest: () => void
  onCopy: () => void
  onDelete: () => void
}

function MatchCard({
  data,
  strategies,
  toggling,
  onToggle,
  onEdit,
  onTest,
  onCopy,
  onDelete,
}: MatchCardProps) {
  const def = isDefault(data.match_id)
  const linkedStrategy = strategies.find((s) => s.strategy_id === data.strategy_id)
  const hitCount = (data.alerts || []).filter(Boolean).length
  const highCount = (data.alerts || []).filter((a) => a.priority === 'high').length

  return (
    <Card className="p-4 gap-2 bg-quant-card border-quant hover:border-[var(--quant-primary)]/40 transition-colors flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm truncate">{data.name || data.match_id}</span>
            {def && (
              <Badge
                variant="outline"
                className="text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-400 gap-0.5"
              >
                <Shield className="size-2.5" />
                兜底
              </Badge>
            )}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground truncate">
            {data.match_id}
          </div>
        </div>
        <Switch
          checked={data.enabled}
          onCheckedChange={onToggle}
          disabled={toggling}
          aria-label="启用/禁用"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <Badge
          variant="outline"
          className={
            data.strategy_id
              ? 'border-quant text-quant-primary font-mono'
              : 'border-quant text-muted-foreground'
          }
        >
          {data.strategy_id ? `策略: ${data.strategy_id}` : '全局兜底'}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          {hitCount} alerts
        </Badge>
        {highCount > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {highCount} high
          </Badge>
        )}
      </div>

      <div className="text-[11px] text-muted-foreground leading-relaxed bg-muted/20 rounded p-1.5">
        {scopeSummary(data.scope)}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          debounce:
          <span className="font-mono text-foreground/80">
            {data.debounce_override === null || data.debounce_override === undefined
              ? '全局默认'
              : `${data.debounce_override}s`}
          </span>
        </span>
        {linkedStrategy && (
          <span className="truncate max-w-[10rem]">→ {linkedStrategy.strategy_name}</span>
        )}
      </div>

      {data.alerts && data.alerts.length > 0 && (
        <div className="space-y-0.5">
          {data.alerts.slice(0, 3).map((a, i) => (
            <div
              key={`${a.alert_type}-${i}`}
              className="flex items-center gap-1.5 text-[10px] font-mono"
            >
              <span
                className={cn(
                  'inline-block size-1.5 rounded-full',
                  a.priority === 'high'
                    ? 'bg-red-500'
                    : a.priority === 'medium'
                    ? 'bg-amber-400'
                    : 'bg-muted-foreground',
                )}
              />
              <span className="text-foreground/80">{a.alert_type}</span>
              {a.channels.length > 0 && (
                <span className="text-muted-foreground truncate">
                  → {a.channels.join(',')}
                </span>
              )}
            </div>
          ))}
          {data.alerts.length > 3 && (
            <div className="text-[10px] text-muted-foreground">
              ...还有 {data.alerts.length - 3} 条
            </div>
          )}
        </div>
      )}

      <Separator className="my-1" />

      <div className="flex items-center gap-1 mt-auto">
        <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={onEdit}>
          <Pencil className="size-3" />
          编辑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 flex-1 text-xs hover:bg-amber-500/10 hover:text-amber-400"
          onClick={onTest}
        >
          <FlaskConical className="size-3" />
          测试
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs hover:bg-amber-500/10 hover:text-amber-400"
          onClick={onCopy}
          title={`基于「${data.name || data.match_id}」创建副本`}
          aria-label="复制策略"
        >
          <Copy className="size-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-7 px-2 text-xs',
            def
              ? 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground'
              : 'hover:bg-red-500/10 hover:text-red-500',
          )}
          onClick={onDelete}
          disabled={def}
          title={def ? '兜底套餐不允许删除' : '删除'}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </Card>
  )
}
