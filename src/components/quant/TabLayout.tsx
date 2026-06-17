'use client'

/**
 * Tab 布局容器
 * - 移动端横向滚动
 * - 桌面端固定等分
 * - 切换有过渡动画
 */

import * as React from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export interface TabItem {
  value: string
  label: string
  icon?: React.ElementType
  badge?: React.ReactNode
  content: React.ReactNode
}

export interface TabLayoutProps {
  tabs: TabItem[]
  value?: string
  onValueChange?: (v: string) => void
  className?: string
  listClassName?: string
}

export function TabLayout({
  tabs,
  value,
  onValueChange,
  className,
  listClassName,
}: TabLayoutProps) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={cn('w-full', className)}>
      <TabsList
        className={cn(
          'bg-quant-card border border-quant h-auto p-1 overflow-x-auto quant-scroll',
          'grid grid-flow-col auto-cols-min sm:grid-cols-5 sm:w-full',
          listClassName
        )}
      >
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm whitespace-nowrap"
            >
              {Icon && <Icon className="size-4" />}
              <span>{t.label}</span>
              {t.badge}
            </TabsTrigger>
          )
        })}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="mt-4">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
