'use client'

/**
 * TdxQuant 量化交易系统 - 主题系统
 *
 * 与 config/theme.yaml 对应，通过 /api/theme 加载，
 * 通过 CSS 变量注入到 :root，支持运行时切换。
 *
 * 颜色规范（A股惯例，专业金融深色风）：
 *   - 主色：琥珀金（#f59e0b）
 *   - 涨色：红（#ef4444）
 *   - 跌色：绿（#22c55e）
 */

import * as React from 'react'

export interface ThemeConfig {
  mode: 'dark' | 'light'
  primaryColor: string
  upColor: string // 涨色（红）
  downColor: string // 跌色（绿）
  flatColor: string
  background: string
  cardBackground: string
  borderColor: string
  fontFamily: string
}

/** 默认主题（专业金融深色风），与 config/theme.yaml 保持一致 */
export const defaultTheme: ThemeConfig = {
  mode: 'dark',
  primaryColor: '#f59e0b', // 琥珀金
  upColor: '#ef4444', // 红（A股涨）
  downColor: '#22c55e', // 绿（A股跌）
  flatColor: '#6b7280',
  background: '#0a0a0a',
  cardBackground: '#171717',
  borderColor: '#262626',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
}

/** 浅色主题（白底，金融阅读模式） */
export const lightTheme: ThemeConfig = {
  mode: 'light',
  primaryColor: '#d97706', // 深琥珀金（在白底更醒目）
  upColor: '#dc2626', // 深红
  downColor: '#16a34a', // 深绿
  flatColor: '#475569',
  background: '#f8fafc',
  cardBackground: '#ffffff',
  borderColor: '#e2e8f0',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
}

const THEME_STORAGE_KEY = 'tdxquant-theme-mode'

/** 从 localStorage 读取上次保存的主题模式 */
function loadStoredMode(): 'dark' | 'light' | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'dark' || v === 'light') return v
  } catch {
    /* noop */
  }
  return null
}

/** 持久化主题模式到 localStorage */
function storeMode(mode: 'dark' | 'light'): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    /* noop */
  }
}

const ThemeContext = React.createContext<ThemeConfig>(defaultTheme)

/**
 * 把 ThemeConfig 注入到 CSS 变量。
 * 变量名采用 --quant-* 前缀，避免与 shadcn 默认变量冲突。
 */
export function applyTheme(theme: ThemeConfig): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--quant-primary', theme.primaryColor)
  root.style.setProperty('--quant-up', theme.upColor)
  root.style.setProperty('--quant-down', theme.downColor)
  root.style.setProperty('--quant-flat', theme.flatColor)
  root.style.setProperty('--quant-bg', theme.background)
  root.style.setProperty('--quant-card', theme.cardBackground)
  root.style.setProperty('--quant-border', theme.borderColor)
  root.style.setProperty('--quant-font', theme.fontFamily)

  // 同步给 shadcn 变量（让 Card/Button 等组件融入金融深色风）
  root.style.setProperty('--background', hexToOklch(theme.background))
  root.style.setProperty('--foreground', theme.mode === 'dark' ? '#fafafa' : '#0a0a0a')
  root.style.setProperty('--card', hexToOklch(theme.cardBackground))
  root.style.setProperty('--card-foreground', theme.mode === 'dark' ? '#fafafa' : '#0a0a0a')
  root.style.setProperty('--popover', hexToOklch(theme.cardBackground))
  root.style.setProperty('--popover-foreground', theme.mode === 'dark' ? '#fafafa' : '#0a0a0a')
  root.style.setProperty('--primary', hexToOklch(theme.primaryColor))
  root.style.setProperty('--primary-foreground', '#0a0a0a')
  root.style.setProperty('--secondary', hexToOklch(theme.borderColor))
  root.style.setProperty('--secondary-foreground', '#fafafa')
  root.style.setProperty('--muted', hexToOklch(theme.borderColor))
  root.style.setProperty('--muted-foreground', theme.mode === 'dark' ? '#a3a3a3' : '#525252')
  root.style.setProperty('--accent', hexToOklch(theme.borderColor))
  root.style.setProperty('--accent-foreground', '#fafafa')
  root.style.setProperty('--border', hexToOklch(theme.borderColor))
  root.style.setProperty('--input', hexToOklch(theme.borderColor))
  root.style.setProperty('--ring', hexToOklch(theme.primaryColor))

  // 切换 dark class
  if (theme.mode === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

/** 简易 hex → oklch 占位转换（保留 hex 兜底，shadcn v4 已支持任意 CSS 颜色字符串） */
function hexToOklch(hex: string): string {
  // shadcn v4 + Tailwind v4 支持 var() / 任意 CSS 颜色，直接透传
  return hex
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<ThemeConfig>(() => {
    // 启动时读取 localStorage 持久化模式
    const storedMode = loadStoredMode()
    if (storedMode === 'light') return lightTheme
    return defaultTheme
  })

  // 挂载后从 /api/theme 拉取配置（带降级，失败用默认），但保留 localStorage 的 mode
  React.useEffect(() => {
    let mounted = true
    fetch('/api/theme')
      .then((r) => (r.ok ? r.json() : defaultTheme))
      .then((data) => {
        if (!mounted) return
        // 优先用 localStorage 的 mode，避免刷新后被服务端配置覆盖
        const storedMode = loadStoredMode()
        const baseTheme = storedMode === 'light' ? lightTheme : defaultTheme
        const merged: ThemeConfig = {
          ...defaultTheme,
          ...(data ?? {}),
          mode: storedMode ?? (data?.mode ?? 'dark'),
          // 如果是 light 模式，强制使用 light 配色
          ...(storedMode === 'light' || (data?.mode === 'light' && !storedMode)
            ? lightTheme
            : {}),
        }
        void baseTheme // 占位避免 lint 警告
        setTheme(merged)
        applyTheme(merged)
      })
      .catch(() => {
        applyTheme(defaultTheme)
      })
    return () => {
      mounted = false
    }
  }, [])

  // 切换 dark/light 模式（同时切换完整配色 + 持久化）
  const toggleMode = React.useCallback(() => {
    setTheme((prev) => {
      const nextMode = prev.mode === 'dark' ? 'light' : 'dark'
      // 切换时使用完整的 light/dark 主题（避免半暗半亮混合）
      const next: ThemeConfig = nextMode === 'light' ? lightTheme : defaultTheme
      applyTheme(next)
      storeMode(nextMode)
      return next
    })
  }, [])

  return React.createElement(
    ThemeContext.Provider,
    { value: theme },
    React.createElement(ThemeModeContext.Provider, { value: { toggleMode } }, children)
  )
}

const ThemeModeContext = React.createContext<{ toggleMode: () => void }>({
  toggleMode: () => {},
})

export function useTheme(): ThemeConfig {
  return React.useContext(ThemeContext)
}

export function useThemeMode(): { toggleMode: () => void; theme: ThemeConfig } {
  const theme = React.useContext(ThemeContext)
  const { toggleMode } = React.useContext(ThemeModeContext)
  return { toggleMode, theme }
}
