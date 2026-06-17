'use client'

import * as React from 'react'
import { ThemeProvider } from '@/lib/theme'
import { Toaster as Sonner } from '@/components/ui/sonner'

/**
 * Client-side providers wrapper.
 * ThemeProvider 注入 CSS 变量，Sonner Toaster 用于全局 toast。
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <Sonner position="top-right" richColors closeButton />
    </ThemeProvider>
  )
}
