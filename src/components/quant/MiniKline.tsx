'use client'

/**
 * Mini K线图 (SVG 实现, 无第三方依赖)
 *
 * - 日K主线 + 成交量柱
 * - MA5 / MA10 均线叠加
 * - 鼠标 hover 显示十字光标 + OHLC tooltip
 * - 适配深/浅色主题 (用 CSS 变量)
 *
 * 数据来源: 接受 OHLCV[] 数组，由调用方提供
 *   （在 Mock 模式下由 generateMockKline 生成假数据）
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface KlineBar {
  date: string // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface MiniKlineProps {
  bars: KlineBar[]
  width?: number
  height?: number
  showVolume?: boolean
  showMA?: boolean
  className?: string
  title?: string
}

// 计算移动平均线
function calcMA(bars: KlineBar[], n: number): Array<number | null> {
  const ma: Array<number | null> = []
  for (let i = 0; i < bars.length; i++) {
    if (i < n - 1) {
      ma.push(null)
    } else {
      let sum = 0
      for (let j = 0; j < n; j++) sum += bars[i - j].close
      ma.push(sum / n)
    }
  }
  return ma
}

export function MiniKline({
  bars,
  width = 520,
  height = 220,
  showVolume = true,
  showMA = true,
  className,
  title,
}: MiniKlineProps) {
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)

  // 布局参数
  const padding = { top: 12, right: 50, bottom: showVolume ? 38 : 22, left: 6 }
  const volH = showVolume ? 28 : 0
  const priceH = height - padding.top - padding.bottom - volH - (showVolume ? 6 : 0)
  const plotW = width - padding.left - padding.right

  // 价格范围
  const allPrices = bars.flatMap((b) => [b.high, b.low])
  const maxPrice = Math.max(...allPrices)
  const minPrice = Math.min(...allPrices)
  const priceRange = maxPrice - minPrice || 1
  const pricePad = priceRange * 0.08
  const yMax = maxPrice + pricePad
  const yMin = minPrice - pricePad

  // 成交量范围
  const maxVol = Math.max(...bars.map((b) => b.volume), 1)

  // 价格 → y 坐标
  const priceToY = (p: number) =>
    padding.top + (1 - (p - yMin) / (yMax - yMin)) * priceH

  // 索引 → x 坐标
  const n = bars.length
  const barW = Math.max(2, Math.min(12, (plotW / n) * 0.7))
  const idxToX = (i: number) =>
    padding.left + (i + 0.5) * (plotW / n)

  // MA 线
  const ma5 = showMA ? calcMA(bars, 5) : []
  const ma10 = showMA ? calcMA(bars, 10) : []
  const maPath = (arr: Array<number | null>) => {
    let d = ''
    let started = false
    arr.forEach((v, i) => {
      if (v === null) return
      const x = idxToX(i)
      const y = priceToY(v)
      if (!started) {
        d += `M ${x} ${y}`
        started = true
      } else {
        d += ` L ${x} ${y}`
      }
    })
    return d
  }

  // 价格刻度 (5 档)
  const priceTicks = Array.from({ length: 5 }, (_, i) => {
    const ratio = i / 4
    return yMin + ratio * (yMax - yMin)
  })

  // 鼠标交互
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * width
    // 反推索引
    const idx = Math.floor(((x - padding.left) / plotW) * n)
    if (idx >= 0 && idx < n) {
      setHoverIdx(idx)
    } else {
      setHoverIdx(null)
    }
  }

  const hover = hoverIdx !== null ? bars[hoverIdx] : null
  const hoverChange = hover ? hover.close - hover.open : 0
  const hoverPct = hover && hover.open !== 0 ? (hoverChange / hover.open) * 100 : 0

  // 涨跌色 (A股: 红涨绿跌)
  const upColor = 'var(--quant-up)'
  const downColor = 'var(--quant-down)'

  return (
    <div className={cn('relative', className)}>
      {title && (
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-xs font-semibold text-foreground/90 flex items-center gap-2">
            {title}
            {hover && (
              <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
                {hover.date} · O {hover.open.toFixed(2)} · H {hover.high.toFixed(2)} · L{' '}
                {hover.low.toFixed(2)} · C {hover.close.toFixed(2)} ·{' '}
                <span style={{ color: hoverChange >= 0 ? upColor : downColor }}>
                  {hoverChange >= 0 ? '+' : ''}
                  {hoverPct.toFixed(2)}%
                </span>
              </span>
            )}
          </div>
          {showMA && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-amber-400" />MA5
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-purple-400" />MA10
              </span>
            </div>
          )}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ userSelect: 'none' }}
      >
        {/* 价格网格 */}
        {priceTicks.map((p, i) => {
          const y = priceToY(p)
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.06}
                strokeDasharray="2 3"
              />
              <text
                x={width - padding.right + 4}
                y={y + 3}
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.5}
                className="tabular-nums"
              >
                {p.toFixed(2)}
              </text>
            </g>
          )
        })}

        {/* K线柱 */}
        {bars.map((b, i) => {
          const x = idxToX(i)
          const isUp = b.close >= b.open
          const color = isUp ? upColor : downColor
          const yHigh = priceToY(b.high)
          const yLow = priceToY(b.low)
          const yOpen = priceToY(b.open)
          const yClose = priceToY(b.close)
          const bodyTop = Math.min(yOpen, yClose)
          const bodyH = Math.max(1, Math.abs(yClose - yOpen))
          // 成交量柱
          const volY = padding.top + priceH + 6
          const volBarH = (b.volume / maxVol) * volH

          return (
            <g key={i}>
              {/* 影线 */}
              <line
                x1={x}
                y1={yHigh}
                x2={x}
                y2={yLow}
                stroke={color}
                strokeWidth={1}
              />
              {/* 实体 */}
              <rect
                x={x - barW / 2}
                y={bodyTop}
                width={barW}
                height={bodyH}
                fill={isUp ? color : color}
                fillOpacity={isUp ? 0.9 : 1}
                stroke={color}
                strokeWidth={0.5}
              />
              {/* 成交量 */}
              {showVolume && (
                <rect
                  x={x - barW / 2}
                  y={volY + volH - volBarH}
                  width={barW}
                  height={volBarH}
                  fill={color}
                  fillOpacity={0.4}
                />
              )}
            </g>
          )
        })}

        {/* MA5 */}
        {showMA && ma5.length > 0 && (
          <path
            d={maPath(ma5)}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={1.2}
            strokeOpacity={0.85}
          />
        )}
        {/* MA10 */}
        {showMA && ma10.length > 0 && (
          <path
            d={maPath(ma10)}
            fill="none"
            stroke="#a855f7"
            strokeWidth={1.2}
            strokeOpacity={0.85}
          />
        )}

        {/* 十字光标 */}
        {hoverIdx !== null && (
          <g pointerEvents="none">
            <line
              x1={idxToX(hoverIdx)}
              y1={padding.top}
              x2={idxToX(hoverIdx)}
              y2={padding.top + priceH}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeDasharray="2 2"
            />
            <line
              x1={padding.left}
              y1={priceToY(bars[hoverIdx].close)}
              x2={width - padding.right}
              y2={priceToY(bars[hoverIdx].close)}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeDasharray="2 2"
            />
          </g>
        )}

        {/* 成交量标签 */}
        {showVolume && (
          <text
            x={padding.left}
            y={padding.top + priceH + 6 + 6}
            fontSize={8}
            fill="currentColor"
            fillOpacity={0.4}
          >
            VOL
          </text>
        )}
      </svg>
    </div>
  )
}

// ===== Mock 数据生成器 =====
/**
 * 生成 Mock K线数据 (基于 seed 让相同 code 每次相同)
 */
export function generateMockKline(code: string, days = 30): KlineBar[] {
  // 用 code 哈希做 seed
  let seed = 0
  for (let i = 0; i < code.length; i++) seed = (seed * 31 + code.charCodeAt(i)) >>> 0
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }

  // 起始价基于 code 末位
  const lastDigit = parseInt(code.replace(/[^0-9]/g, '').slice(-2) || '10', 10) || 10
  let price = 5 + (lastDigit % 50) + rand() * 10
  const bars: KlineBar[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    // 跳过周末
    if (d.getDay() === 0 || d.getDay() === 6) continue
    const date = d.toISOString().slice(0, 10)
    const open = price
    const drift = (rand() - 0.48) * price * 0.05
    const close = Math.max(1, open + drift)
    const high = Math.max(open, close) + rand() * price * 0.02
    const low = Math.min(open, close) - rand() * price * 0.02
    const volume = Math.floor(500000 + rand() * 5000000)
    bars.push({ date, open, high, low, close, volume })
    price = close
  }
  return bars
}
