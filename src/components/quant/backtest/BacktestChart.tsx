'use client'

/**
 * BacktestChart — 净值曲线 + 回撤图
 *
 * 纯 SVG 实现 (非 recharts):
 * - 策略资产曲线 (实线 + 渐变填充)
 * - 基准曲线 (虚线, 线性插值到 initial_capital * (1 + benchmark_return))
 * - 回撤阴影矩形 (drawdown < -1% 的区间)
 * - 十字光标 + tooltip (鼠标 hover 显示日期/资产/收益/回撤)
 * - Y 轴 5 档刻度 + X 轴最多 6 个日期刻度
 *
 * 纯展示组件, result 由容器传入。
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Activity } from 'lucide-react'
import type { BacktestResultDTO } from '@/lib/api'

export interface BacktestChartProps {
  result: BacktestResultDTO
}

export function BacktestChart({ result }: BacktestChartProps) {
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)

  const W = 920
  const H = 320
  const padding = { top: 16, right: 70, bottom: 32, left: 8 }
  const plotW = W - padding.left - padding.right
  const plotH = H - padding.top - padding.bottom

  const daily = result.daily_equity
  const initialCap = result.initial_capital
  const benchmarkReturn = result.benchmark_return / 100.0

  // 计算基准曲线（线性插值到 final_cap * (1 + benchmark_return)）
  const benchmarkFinal = initialCap * (1 + benchmarkReturn)

  // Y 范围: 取所有 equity 和 benchmarkFinal 的并集，留 8% padding
  const allVals = [...daily.map((d) => d.equity), initialCap, benchmarkFinal]
  const yMax = Math.max(...allVals)
  const yMin = Math.min(...allVals)
  const range = yMax - yMin || 1
  const pad = range * 0.08
  const yTop = yMax + pad
  const yBot = Math.max(0, yMin - pad)
  const yRange = yTop - yBot || 1

  const n = daily.length
  const idxToX = (i: number) => padding.left + (i / Math.max(1, n - 1)) * plotW
  const valToY = (v: number) => padding.top + (1 - (v - yBot) / yRange) * plotH

  // 策略资产路径
  const equityPath = daily
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${idxToX(i).toFixed(1)} ${valToY(d.equity).toFixed(1)}`)
    .join(' ')

  // 策略资产填充区域（到 yBot 基线）
  const equityArea = `${equityPath} L ${idxToX(n - 1).toFixed(1)} ${valToY(yBot).toFixed(1)} L ${idxToX(0).toFixed(1)} ${valToY(yBot).toFixed(1)} Z`

  // 基准路径（线性从 initialCap 到 benchmarkFinal）
  const benchPath = daily
    .map((d, i) => {
      const ratio = n > 1 ? i / (n - 1) : 0
      const v = initialCap + (benchmarkFinal - initialCap) * ratio
      return `${i === 0 ? 'M' : 'L'} ${idxToX(i).toFixed(1)} ${valToY(v).toFixed(1)}`
    })
    .join(' ')

  // 回撤阴影区域: 当 drawdown < 0 时画一个矩形
  const drawdownSegments: Array<{ x1: number; x2: number; yTop: number; yBot: number }> = []
  let segStart: number | null = null
  for (let i = 0; i < n; i++) {
    if (daily[i].drawdown < -0.01) {
      if (segStart === null) segStart = i
    } else {
      if (segStart !== null) {
        drawdownSegments.push({
          x1: idxToX(segStart),
          x2: idxToX(i),
          yTop: padding.top,
          yBot: padding.top + plotH,
        })
        segStart = null
      }
    }
  }
  if (segStart !== null) {
    drawdownSegments.push({
      x1: idxToX(segStart),
      x2: idxToX(n - 1),
      yTop: padding.top,
      yBot: padding.top + plotH,
    })
  }

  // Y 轴刻度 (5 档)
  const yTicks = Array.from({ length: 5 }, (_, i) => yBot + (i / 4) * yRange)

  // X 轴刻度（最多 6 个）
  const xTickEvery = Math.max(1, Math.ceil(n / 6))
  const xTicks: Array<{ x: number; label: string }> = []
  for (let i = 0; i < n; i += xTickEvery) {
    xTicks.push({ x: idxToX(i), label: daily[i].date.slice(5) })
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    // 反推索引
    const idx = Math.round(((x - padding.left) / plotW) * (n - 1))
    if (idx >= 0 && idx < n) {
      setHoverIdx(idx)
    } else {
      setHoverIdx(null)
    }
  }

  const hover = hoverIdx !== null ? daily[hoverIdx] : null
  const benchAtHover = hoverIdx !== null
    ? initialCap + (benchmarkFinal - initialCap) * (n > 1 ? hoverIdx / (n - 1) : 0)
    : 0

  // 图例
  const legend = [
    { color: 'var(--quant-primary)', label: '策略资产', solid: true },
    { color: 'var(--quant-flat)', label: '基准', dashed: true },
    { color: 'var(--quant-down)', label: '回撤区间', fill: true },
  ]

  return (
    <Card className="p-4 gap-0 bg-quant-card border-quant">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-quant-primary" />
          <span className="text-sm font-semibold">收益曲线</span>
          <Badge variant="outline" className="text-[10px] border-quant font-mono">
            {result.daily_equity.length} 个交易日
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {legend.map((l, i) => (
            <span key={i} className="flex items-center gap-1">
              {l.solid && <span className="inline-block w-3 h-0.5" style={{ backgroundColor: l.color }} />}
              {l.dashed && (
                <span
                  className="inline-block w-3 h-0.5"
                  style={{
                    backgroundColor: l.color,
                    backgroundImage: 'linear-gradient(to right, currentColor 50%, transparent 50%)',
                    backgroundSize: '4px 100%',
                  }}
                />
              )}
              {l.fill && <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: l.color, opacity: 0.2 }} />}
              {l.label}
            </span>
          ))}
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ userSelect: 'none' }}
      >
        {/* Y 轴网格 */}
        {yTicks.map((v, i) => {
          const y = valToY(v)
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={W - padding.right}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.06}
                strokeDasharray="2 3"
              />
              <text
                x={W - padding.right + 4}
                y={y + 3}
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.5}
                className="tabular-nums"
              >
                ¥{v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toFixed(0)}
              </text>
            </g>
          )
        })}

        {/* X 轴刻度 */}
        {xTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={t.x}
              y1={padding.top + plotH}
              x2={t.x}
              y2={padding.top + plotH + 4}
              stroke="currentColor"
              strokeOpacity={0.3}
            />
            <text
              x={t.x}
              y={padding.top + plotH + 16}
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.5}
              textAnchor="middle"
              className="tabular-nums"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* 回撤阴影 */}
        {drawdownSegments.map((s, i) => (
          <rect
            key={`dd-${i}`}
            x={s.x1}
            y={s.yTop}
            width={Math.max(0, s.x2 - s.x1)}
            height={s.yBot - s.yTop}
            fill="var(--quant-down)"
            fillOpacity={0.06}
          />
        ))}

        {/* 策略资产填充区 */}
        <path d={equityArea} fill="var(--quant-primary)" fillOpacity={0.08} />

        {/* 基准线 */}
        <path
          d={benchPath}
          fill="none"
          stroke="var(--quant-flat)"
          strokeWidth={1.2}
          strokeOpacity={0.7}
          strokeDasharray="4 3"
        />

        {/* 策略资产曲线 */}
        <path
          d={equityPath}
          fill="none"
          stroke="var(--quant-primary)"
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 十字光标 */}
        {hoverIdx !== null && hover && (
          <g pointerEvents="none">
            <line
              x1={idxToX(hoverIdx)}
              y1={padding.top}
              x2={idxToX(hoverIdx)}
              y2={padding.top + plotH}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeDasharray="2 2"
            />
            <line
              x1={padding.left}
              y1={valToY(hover.equity)}
              x2={W - padding.right}
              y2={valToY(hover.equity)}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeDasharray="2 2"
            />
            {/* 策略点 */}
            <circle
              cx={idxToX(hoverIdx)}
              cy={valToY(hover.equity)}
              r={3.5}
              fill="var(--quant-primary)"
              stroke="var(--quant-bg)"
              strokeWidth={1.5}
            />
            {/* 基准点 */}
            <circle
              cx={idxToX(hoverIdx)}
              cy={valToY(benchAtHover)}
              r={2.5}
              fill="var(--quant-flat)"
              stroke="var(--quant-bg)"
              strokeWidth={1}
            />
          </g>
        )}

        {/* Tooltip 文本 */}
        {hoverIdx !== null && hover && (
          <g pointerEvents="none">
            {/* 背景框 */}
            <rect
              x={Math.min(idxToX(hoverIdx) + 8, W - padding.right - 180)}
              y={padding.top + 4}
              width={172}
              height={64}
              rx={4}
              fill="var(--quant-bg)"
              fillOpacity={0.95}
              stroke="var(--quant-primary)"
              strokeOpacity={0.3}
            />
            <text
              x={Math.min(idxToX(hoverIdx) + 14, W - padding.right - 174)}
              y={padding.top + 18}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.85}
              className="tabular-nums"
            >
              {hover.date}
            </text>
            <text
              x={Math.min(idxToX(hoverIdx) + 14, W - padding.right - 174)}
              y={padding.top + 34}
              fontSize={10}
              fill="var(--quant-primary)"
              className="tabular-nums"
            >
              资产 ¥{hover.equity.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
            </text>
            <text
              x={Math.min(idxToX(hoverIdx) + 14, W - padding.right - 174)}
              y={padding.top + 48}
              fontSize={10}
              fill={hover.return_pct >= 0 ? 'var(--quant-up)' : 'var(--quant-down)'}
              className="tabular-nums"
            >
              收益 {hover.return_pct >= 0 ? '+' : ''}{hover.return_pct.toFixed(2)}%
            </text>
            <text
              x={Math.min(idxToX(hoverIdx) + 14, W - padding.right - 174)}
              y={padding.top + 62}
              fontSize={10}
              fill="var(--quant-down)"
              className="tabular-nums"
            >
              回撤 {hover.drawdown.toFixed(2)}%
            </text>
          </g>
        )}
      </svg>
    </Card>
  )
}
