/**
 * 实时数据 Hook (轮询模式)
 *
 * 通过定时轮询获取:
 *   - quotes   : 全量行情快照 (10s)
 *   - status   : 监控状态 (15s)
 *   - signals  : 信号列表 (10s)
 *
 * 简单可靠, 无 SSE/WebSocket 依赖
 */

'use client'

import * as React from 'react'
import {
  monitorAPI,
  signalAPI,
  type MonitorStatusDTO,
  type QuoteDTO,
  type SignalDTO,
} from '@/lib/api'

interface RealtimeState {
  connected: boolean
  quotes: QuoteDTO[]
  status: MonitorStatusDTO | null
  signals: SignalDTO[]
  lastSignalAt: number | null
  lastUpdated: number | null
  refreshing: boolean
  mode: 'sse' | 'poll' | 'offline'
}

export function useRealtimeQuotes(opts: { autoRefresh?: boolean } = {}) {
  const { autoRefresh = true } = opts
  const [state, setState] = React.useState<RealtimeState>({
    connected: false,
    quotes: [],
    status: null,
    signals: [],
    lastSignalAt: null,
    lastUpdated: null,
    refreshing: false,
    mode: 'offline',
  })

  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const knownIdsRef = React.useRef<Set<string>>(new Set())
  const firstLoadRef = React.useRef<boolean>(true)

  const tick = React.useCallback(async () => {
    setState((prev) => ({ ...prev, refreshing: true }))
    try {
      const [s, sig, q] = await Promise.all([
        monitorAPI.getStatus(),
        signalAPI.list({ limit: 20 }),
        monitorAPI.getQuotes(100),
      ])
      let newAt: number | null = null
      const newIds = new Set(knownIdsRef.current)
      if (!firstLoadRef.current) {
        for (const s of sig) {
          if (!knownIdsRef.current.has(s.id)) newAt = Date.now()
          newIds.add(s.id)
        }
      } else {
        for (const s of sig) newIds.add(s.id)
        firstLoadRef.current = false
      }
      knownIdsRef.current = newIds

      setState((prev) => ({
        ...prev,
        status: s,
        signals: sig,
        quotes: q,
        mode: 'poll',
        connected: true,
        lastSignalAt: newAt ?? prev.lastSignalAt,
        lastUpdated: Date.now(),
        refreshing: false,
      }))
    } catch {
      setState((prev) => ({ ...prev, connected: false, mode: 'poll', refreshing: false }))
    }
  }, [])

  const refresh = React.useCallback(() => {
    tick()
  }, [tick])

  React.useEffect(() => {
    if (!autoRefresh) return
    tick()
    pollRef.current = setInterval(tick, 10_000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [autoRefresh, tick])

  return { ...state, refresh }
}
