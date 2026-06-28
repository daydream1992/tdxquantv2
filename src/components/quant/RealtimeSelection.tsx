'use client'

/**
 * RealtimeSelection — 实时选股容器
 *
 * 数据流:
 *   定时器(可配置间隔) → strategyAPI.runAll() → 延迟 → selectionAPI.list({limit:200})
 *                       → 与 prevScoreMap 对比 → 推入 stream 顶部 + 更新 stockBoard
 *
 * 持有状态:
 *   - running / intervalSec / threshold / currentRoundNo
 *   - rounds: RoundSnapshot[] (顶部最新)
 *   - boardRows: StockBoardRow[] (去重聚合)
 *   - expandedId / activeView: 'stream' | 'board'
 *   - state: RealtimeState (传给控制栏)
 */

import * as React from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { Radio, Layers3, Bell } from 'lucide-react'
import { strategyAPI, selectionAPI, type SelectionRowDTO } from '@/lib/api'
import { toast } from 'sonner'
import { RealtimeControl, RunningBadge } from './realtime/RealtimeControl'
import { RealtimeStream } from './realtime/RealtimeStream'
import { RealtimeStockBoard } from './realtime/RealtimeStockBoard'
import {
  MAX_STREAM_ROUNDS,
  MAX_BOARD_ROWS,
  RUNALL_DELAY_MS,
  type RoundSnapshot,
  type StockBoardRow,
  type RealtimeState,
} from './realtime/shared'

export function RealtimeSelection() {
  const [running, setRunning] = React.useState(false)
  const [intervalSec, setIntervalSec] = React.useState(30)
  const [threshold, setThreshold] = React.useState(5)
  const [rounds, setRounds] = React.useState<RoundSnapshot[]>([])
  const [boardRows, setBoardRows] = React.useState<StockBoardRow[]>([])
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [activeView, setActiveView] = React.useState<'stream' | 'board'>('stream')
  const [roundNo, setRoundNo] = React.useState(0)
  const [totalRows, setTotalRows] = React.useState(0)
  const [totalNew, setTotalNew] = React.useState(0)
  const [lastRunAt, setLastRunAt] = React.useState<number | null>(null)
  const [nextRunIn, setNextRunIn] = React.useState(0)
  const [ticking, setTicking] = React.useState(false)
  const [lastRoundMs, setLastRoundMs] = React.useState<number | null>(null)

  const prevScoreRef = React.useRef<Map<string, number>>(new Map())
  const boardRef = React.useRef<Map<string, StockBoardRow>>(new Map())
  const tickLockRef = React.useRef(false)
  const roundNoRef = React.useRef(0)
  const thresholdRef = React.useRef(threshold)
  const intervalSecRef = React.useRef(intervalSec)

  // 同步 ref(避免 tick 重建导致 useEffect 重跑)
  React.useEffect(() => { roundNoRef.current = roundNo }, [roundNo])
  React.useEffect(() => { thresholdRef.current = threshold }, [threshold])
  React.useEffect(() => { intervalSecRef.current = intervalSec }, [intervalSec])

  // 单轮执行(零依赖, 通过 ref 读取最新值, 避免 useEffect 重跑)
  const tick = React.useCallback(async () => {
    if (tickLockRef.current) return
    tickLockRef.current = true
    setTicking(true)
    const startedAt = Date.now()
    const thisRoundNo = roundNoRef.current + 1
    const currentThreshold = thresholdRef.current
    try {
      const r = await strategyAPI.runAll()
      const okCount = r.results?.filter((x) => x.ok).length ?? 0
      const totalCount = r.results?.length ?? 0
      // 等后端落库
      await new Promise((res) => setTimeout(res, RUNALL_DELAY_MS))
      const rows = await selectionAPI.list({ limit: 200 })
      // 计算 NEW / 涨分 / 跌分
      const prevMap = prevScoreRef.current
      let newCount = 0
      let upCount = 0
      let downCount = 0
      const currentCodes = new Set<string>()
      const nextMap = new Map<string, number>()
      // 按 stock_code 去重统计 NEW/涨跌分(同一只股票被多策略同时选中,只算一次)
      const seenCodesThisRound = new Set<string>()
      for (const row of rows) {
        currentCodes.add(row.stock_code)
        nextMap.set(row.stock_code, row.score)
        if (seenCodesThisRound.has(row.stock_code)) continue
        seenCodesThisRound.add(row.stock_code)
        const prev = prevMap.get(row.stock_code)
        if (prev === undefined) {
          newCount++
        } else {
          const delta = row.score - prev
          if (delta >= currentThreshold) upCount++
          else if (-delta >= currentThreshold) downCount++
        }
      }
      // 已出:prevMap 有,本轮无
      // (board 更新时处理)

      const snapshot: RoundSnapshot = {
        id: `round-${thisRoundNo}`,
        roundNo: thisRoundNo,
        triggeredAt: startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        rows,
        newCount,
        upCount,
        downCount,
        strategyOk: okCount,
        strategyTotal: totalCount,
      }
      setRounds((prev) => [snapshot, ...prev].slice(0, MAX_STREAM_ROUNDS))
      setRoundNo(thisRoundNo)
      setTotalRows((n) => n + rows.length)
      setTotalNew((n) => n + newCount)
      setLastRunAt(startedAt)
      setLastRoundMs(snapshot.durationMs)
      prevScoreRef.current = nextMap

      // 更新 board
      const board = boardRef.current
      const boardDeltas: StockBoardRow[] = []
      for (const row of rows) {
        const existing = board.get(row.stock_code)
        const prevScore = existing?.currentScore ?? null
        const isFirst = !existing
        const badge: StockBoardRow['badge'] = isFirst
          ? 'new'
          : (() => {
              const d = row.score - (prevScore ?? 0)
              if (d >= currentThreshold) return 'up'
              if (-d >= currentThreshold) return 'down'
              return 'flat'
            })()
        const strategy_ids = existing?.strategy_ids ?? []
        const strategy_names = existing?.strategy_names ?? []
        if (!strategy_ids.includes(row.strategy_id)) {
          strategy_ids.push(row.strategy_id)
          strategy_names.push(row.strategy_name || row.strategy_id)
        }
        const newRow: StockBoardRow = {
          stock_code: row.stock_code,
          stock_name: row.stock_name,
          currentScore: row.score,
          prevScore,
          hitCount: (existing?.hitCount ?? 0) + 1,
          firstSeenAt: existing?.firstSeenAt ?? startedAt,
          lastSeenAt: startedAt,
          strategy_ids,
          strategy_names,
          badge,
          bestRank: existing ? Math.min(existing.bestRank, row.rank) : row.rank,
          lastRoundNo: thisRoundNo,
        }
        board.set(row.stock_code, newRow)
        boardDeltas.push(newRow)
      }
      // 标记已出
      for (const [code, b] of board.entries()) {
        if (!currentCodes.has(code) && b.lastRoundNo === thisRoundNo - 1) {
          board.set(code, { ...b, badge: 'gone' })
        }
      }
      // 限制 board 大小:截断最低分
      const arr = Array.from(board.values()).sort((a, b) => b.currentScore - a.currentScore)
      const kept = arr.slice(0, MAX_BOARD_ROWS)
      boardRef.current = new Map(kept.map((r) => [r.stock_code, r]))
      setBoardRows(kept)

      if (newCount > 0 || upCount > 0) {
        toast.success(`第 ${thisRoundNo} 轮完成`, {
          description: `${rows.length} 只 · NEW ${newCount} · 涨分 ${upCount} · 跌分 ${downCount}`,
        })
      }
    } catch (e) {
      const msg = (e as Error).message
      const snapshot: RoundSnapshot = {
        id: `round-${thisRoundNo}`,
        roundNo: thisRoundNo,
        triggeredAt: startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        rows: [],
        newCount: 0,
        upCount: 0,
        downCount: 0,
        strategyOk: 0,
        strategyTotal: 0,
        error: msg,
      }
      setRounds((prev) => [snapshot, ...prev].slice(0, MAX_STREAM_ROUNDS))
      setRoundNo(thisRoundNo)
      setLastRunAt(startedAt)
      setLastRoundMs(snapshot.durationMs)
      toast.error(`第 ${thisRoundNo} 轮失败`, { description: msg })
    } finally {
      setTicking(false)
      setNextRunIn(intervalSecRef.current)
      tickLockRef.current = false
    }
  }, []) // tick 零依赖, 靠 ref 读最新值

  // 定时器 + 倒计时 (只依赖 running/intervalSec, 不依赖 tick)
  React.useEffect(() => {
    if (!running) return
    setNextRunIn(intervalSec)
    // 立即执行一次
    tick()
    const interval = setInterval(() => {
      setNextRunIn((n) => {
        if (n <= 1) {
          tick()
          return intervalSec
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [running, intervalSec, tick])

  const handleClear = () => {
    setRounds([])
    setBoardRows([])
    setRoundNo(0)
    setTotalRows(0)
    setTotalNew(0)
    setLastRunAt(null)
    setLastRoundMs(null)
    setExpandedId(null)
    prevScoreRef.current = new Map()
    boardRef.current = new Map()
    toast.info('已清空实时选股累计数据')
  }

  const state: RealtimeState = {
    running,
    intervalSec,
    threshold,
    totalRounds: roundNo,
    totalRows,
    totalNew,
    lastRunAt,
    nextRunIn,
    ticking,
  }

  return (
    <div className="space-y-3">
      <Card className="bg-quant-card border-quant p-4 gap-0">
        {/* 标题 */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-7 rounded-md bg-amber-500/10">
              <Radio className="size-4 text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-semibold flex items-center gap-2">
                实时选股
                <RunningBadge running={running} />
              </div>
              <div className="text-[10px] text-muted-foreground">
                定时自动运行全部启用策略,实时输出选股 + 涨跌分提醒
              </div>
            </div>
          </div>
        </div>
        <RealtimeControl
          state={state}
          lastRoundDurationMs={lastRoundMs}
          onToggleRun={() => setRunning((r) => !r)}
          onIntervalChange={setIntervalSec}
          onThresholdChange={setThreshold}
          onClear={handleClear}
        />
      </Card>

      <Tabs value={activeView} onValueChange={(v) => setActiveView(v as 'stream' | 'board')}>
        <TabsList className="bg-transparent border-0 p-0 h-9">
          <TabsTrigger
            value="stream"
            className="flex items-center gap-1.5 px-3 h-9 text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:text-amber-400 data-[state=active]:shadow-none"
          >
            <Layers3 className="size-3.5" />
            流式记录 ({rounds.length})
          </TabsTrigger>
          <TabsTrigger
            value="board"
            className="flex items-center gap-1.5 px-3 h-9 text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:text-amber-400 data-[state=active]:shadow-none"
          >
            <Bell className="size-3.5" />
            股票看板 ({boardRows.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="stream" className="mt-2">
          <RealtimeStream rounds={rounds} expandedId={expandedId} onExpand={setExpandedId} />
        </TabsContent>
        <TabsContent value="board" className="mt-2">
          <RealtimeStockBoard rows={boardRows} currentRoundNo={roundNo} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
