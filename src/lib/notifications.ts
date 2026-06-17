/**
 * 全局通知中心 store + 包装 toast 函数
 *
 * 设计：
 * - 用 zustand 维护通知历史（最多 50 条，FIFO）
 * - 包装 sonner toast：notifySuccess/notifyError/notifyWarning 同时调 toast 和 store.add
 * - toast.loading 不进入通知中心（瞬时态）
 *
 * 使用：
 *   import { notifySuccess, notifyError, notifyWarning } from '@/lib/notifications'
 *   notifySuccess('已保存', '策略配置已重载')
 *   notifyError('保存失败', 'YAML 语法错误')
 */

import { create } from 'zustand'
import { toast } from 'sonner'

export type NotificationType = 'success' | 'error' | 'warning' | 'info'

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  description?: string
  timestamp: number
  read: boolean
}

const MAX_NOTIFICATIONS = 50

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

interface NotificationState {
  items: NotificationItem[]
  unreadCount: number
  add: (type: NotificationType, title: string, description?: string) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clear: () => void
  remove: (id: string) => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  unreadCount: 0,
  add: (type, title, description) =>
    set((state) => {
      const next: NotificationItem = {
        id: genId(),
        type,
        title,
        description,
        timestamp: Date.now(),
        read: false,
      }
      const items = [next, ...state.items].slice(0, MAX_NOTIFICATIONS)
      return {
        items,
        unreadCount: items.filter((x) => !x.read).length,
      }
    }),
  markRead: (id) =>
    set((state) => {
      const items = state.items.map((x) =>
        x.id === id ? { ...x, read: true } : x
      )
      return { items, unreadCount: items.filter((x) => !x.read).length }
    }),
  markAllRead: () =>
    set((state) => ({
      items: state.items.map((x) => ({ ...x, read: true })),
      unreadCount: 0,
    })),
  clear: () => set({ items: [], unreadCount: 0 }),
  remove: (id) =>
    set((state) => {
      const items = state.items.filter((x) => x.id !== id)
      return { items, unreadCount: items.filter((x) => !x.read).length }
    }),
}))

// ===== 包装 toast 函数 =====

export function notifySuccess(title: string, description?: string) {
  toast.success(title, description ? { description } : undefined)
  useNotificationStore.getState().add('success', title, description)
}

export function notifyError(title: string, description?: string) {
  toast.error(title, description ? { description } : undefined)
  useNotificationStore.getState().add('error', title, description)
}

export function notifyWarning(title: string, description?: string) {
  toast.warning(title, description ? { description } : undefined)
  useNotificationStore.getState().add('warning', title, description)
}

export function notifyInfo(title: string, description?: string) {
  toast.info(title, description ? { description } : undefined)
  useNotificationStore.getState().add('info', title, description)
}

/** 相对时间格式化 */
export function formatRelativeTime(ts: number): string {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return new Date(ts).toISOString()
  }
}
