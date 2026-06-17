'use client'

import * as React from 'react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  text?: string
  description?: string
  icon?: React.ElementType
  className?: string
  action?: React.ReactNode
}

export function EmptyState({
  text = '暂无数据',
  description,
  icon: Icon = Inbox,
  className,
  action,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-10 text-center',
        className
      )}
    >
      <div className="flex items-center justify-center size-12 rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <div className="text-sm font-medium text-foreground/80">{text}</div>
      {description && (
        <div className="text-xs text-muted-foreground max-w-sm">{description}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
