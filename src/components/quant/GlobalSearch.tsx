'use client'

/**
 * 全局搜索容器 (Cmd+K / Ctrl+K)
 *
 * 持有 `open` 状态 + 全局 Cmd+K 快捷键监听 + imperative handle (open/close)。
 * 通过 forwardRef 暴露给 page.tsx 的 searchRef。
 * 组合 SearchInput (搜索框/防抖/键盘导航/结果组装) 渲染 Dialog 内容。
 *
 * 注: Cmd+K 监听需 always-mounted (Dialog 关闭时也要响应), 故置于容器而非 SearchInput。
 */

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { SearchInput } from './search/SearchInput'
import type { GlobalSearchHandle, GlobalSearchProps } from './search/shared'

// 重新导出容器契约类型, 保持 page.tsx 的 import 路径不变
export type { GlobalSearchHandle, GlobalSearchProps } from './search/shared'

export const GlobalSearch = React.forwardRef<GlobalSearchHandle, GlobalSearchProps>(
  function GlobalSearch(props, ref) {
    const [open, setOpen] = React.useState(false)

    React.useImperativeHandle(ref, () => ({
      open: () => setOpen(true),
      close: () => setOpen(false),
    }), [])

    // ----- Cmd+K / Ctrl+K (always-mounted, 即使 Dialog 关闭也要响应) -----
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
          <SearchInput open={open} onClose={() => setOpen(false)} {...props} />
        </DialogContent>
      </Dialog>
    )
  }
)
