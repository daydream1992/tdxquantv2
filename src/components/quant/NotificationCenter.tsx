'use client'

/**
 * 通知中心
 *
 * 功能：
 * - header "通知"按钮 (Bell 图标)，有未读时显示红点 + 数量
 * - 点击打开 Popover 显示历史通知列表（最近 50 条）
 * - 每条通知: 图标(成功绿/错误红/警告琥珀) + 标题 + 描述 + 相对时间
 * - 顶部: "全部已读" + "清空" 按钮
 * - 未读通知加粗 + 左侧琥珀色边框
 * - 点击单条可标记已读
 * - 数据源: useNotificationStore (zustand)，由 notifySuccess/Error/Warning 写入
 */

import * as React from 'react'
import { Bell, CheckCheck, Trash2, CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  useNotificationStore,
  formatRelativeTime,
  type NotificationItem,
  type NotificationType,
} from '@/lib/notifications'

const ICON_MAP: Record<
  NotificationType,
  { icon: React.ComponentType<{ className?: string }>; color: string; bg: string }
> = {
  success: { icon: CheckCircle2, color: 'text-[var(--quant-up)]', bg: 'bg-[var(--quant-up)]/10' },
  error: { icon: XCircle, color: 'text-[var(--quant-down)]', bg: 'bg-[var(--quant-down)]/10' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  info: { icon: Info, color: 'text-sky-400', bg: 'bg-sky-500/10' },
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const markRead = useNotificationStore((s) => s.markRead)
  const meta = ICON_MAP[item.type] || ICON_MAP.info
  const Icon = meta.icon
  return (
    <button
      type="button"
      onClick={() => {
        if (!item.read) markRead(item.id)
      }}
      className={cn(
        'group w-full flex items-start gap-2.5 p-2.5 rounded-md text-left transition-colors hover:bg-quant-border/40 border-l-2',
        item.read
          ? 'border-transparent pl-3'
          : 'border-[var(--quant-primary)] bg-amber-500/5 pl-[10px]'
      )}
    >
      <div className={cn('flex items-center justify-center size-7 rounded-md shrink-0 mt-0.5', meta.bg)}>
        <Icon className={cn('size-3.5', meta.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs truncate',
              item.read ? 'font-normal text-foreground/80' : 'font-semibold text-foreground'
            )}
          >
            {item.title}
          </span>
          {!item.read && (
            <span className="size-1.5 rounded-full bg-[var(--quant-primary)] shrink-0" aria-hidden />
          )}
        </div>
        {item.description && (
          <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 break-words">
            {item.description}
          </div>
        )}
        <div className="text-[10px] text-muted-foreground/70 mt-1 tabular-nums">
          {formatRelativeTime(item.timestamp)}
        </div>
      </div>
    </button>
  )
}

export function NotificationCenter() {
  const [open, setOpen] = React.useState(false)
  const items = useNotificationStore((s) => s.items)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const clear = useNotificationStore((s) => s.clear)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 relative hover:bg-amber-500/10"
          title={unreadCount > 0 ? `有 ${unreadCount} 条未读通知` : '通知中心'}
          aria-label="通知中心"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center ring-2 ring-background tabular-nums"
              aria-label={`${unreadCount} 条未读`}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[360px] sm:w-[400px] p-0 bg-quant-card border-quant"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-quant">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-quant-primary" />
            <span className="text-sm font-semibold">通知中心</span>
            {unreadCount > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/5"
              >
                {unreadCount} 未读
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] hover:bg-amber-500/10"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              title="全部已读"
            >
              <CheckCheck className="size-3.5" />
              全部已读
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
              onClick={() => {
                if (items.length === 0) return
                if (confirm('确认清空所有通知历史？')) clear()
              }}
              disabled={items.length === 0}
              title="清空通知"
            >
              <Trash2 className="size-3.5" />
              清空
            </Button>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto quant-scroll p-1.5">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="size-8 mb-2 opacity-25" />
              <div className="text-xs">暂无通知</div>
              <div className="text-[10px] mt-0.5 opacity-70">
                系统操作的结果会在这里汇总
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((it) => (
                <NotificationRow key={it.id} item={it} />
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="px-3 py-1.5 border-t border-quant text-[10px] text-muted-foreground/70 text-center">
            共 {items.length} 条 · 最多保留 50 条
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
