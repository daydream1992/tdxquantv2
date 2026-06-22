'use client'

/**
 * PatternCard — 单个形态预警卡片
 *
 * 展示: emoji + label + scenario + condition + 关键变量 + 风险等级 + 建议操作
 * 操作: 启停开关(实际控制 pattern_alerts 套餐的整体 enabled) + 试跑按钮
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ChevronDown, ChevronUp, Play, Variable, AlertTriangle, Lightbulb, Pencil, Trash2, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { riskStyle, type PatternMeta } from './shared'

interface Props {
  meta: PatternMeta
  /** 该形态在套餐中的启用状态(由父组件从 match.alerts 里查) */
  enabled: boolean
  onToggle: (alertType: string, enabled: boolean) => void
  onTest: (meta: PatternMeta) => void
  /** 自定义形态: 编辑回调 */
  onEdit?: (meta: PatternMeta) => void
  /** 自定义形态: 删除回调 */
  onDelete?: (meta: PatternMeta) => void
  /** 克隆回调(预设/自定义均可克隆) */
  onClone?: (meta: PatternMeta) => void
}

export function PatternCard({ meta, enabled, onToggle, onTest, onEdit, onDelete, onClone }: Props) {
  const [open, setOpen] = React.useState(false)

  return (
    <Card
      className={cn(
        'bg-quant-card p-0 overflow-hidden transition-all',
        meta.custom
          ? 'border-amber-500/40 border-dashed'
          : 'border-quant',
        enabled ? (meta.custom ? 'border-amber-500/50 border-dashed' : 'border-amber-500/30') : 'opacity-60',
        open && 'shadow-lg shadow-amber-500/5'
      )}
    >
      {/* 头部 */}
      <div className="p-3 flex items-start gap-2.5">
        <div className="flex items-center justify-center size-10 rounded-md bg-amber-500/10 shrink-0 text-xl">
          {meta.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold">{meta.label}</span>
            <Badge variant="outline" className={cn('text-[9px] font-mono', riskStyle(meta.risk))}>
              {meta.risk === 'high' ? '高风险' : '中风险'}
            </Badge>
            <Badge variant="outline" className="text-[9px] font-mono border-quant text-muted-foreground">
              {meta.alert_type}
            </Badge>
            {meta.custom && (
              <Badge variant="outline" className="text-[9px] font-mono border-amber-500/40 text-amber-400 bg-amber-500/10">
                自定义
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{meta.scenario}</div>
          {/* 操作按钮行 */}
          <div className="flex items-center gap-1 mt-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onClone?.(meta)}
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:bg-amber-500/10 hover:text-amber-400"
              title="克隆此形态为自定义"
            >
              <Copy className="size-3" />
              克隆
            </Button>
            {meta.custom && onEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onEdit(meta)}
                className="h-5 px-1.5 text-[10px] text-muted-foreground hover:bg-amber-500/10 hover:text-amber-400"
                title="编辑自定义形态"
              >
                <Pencil className="size-3" />
                编辑
              </Button>
            )}
            {meta.custom && onDelete && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDelete(meta)}
                className="h-5 px-1.5 text-[10px] text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                title="删除自定义形态"
              >
                <Trash2 className="size-3" />
                删除
              </Button>
            )}
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => onToggle(meta.alert_type, v)}
          className="scale-90 shrink-0"
        />
      </div>

      {/* 折叠区 */}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-muted-foreground hover:bg-amber-500/5 transition-colors border-t border-quant/40">
            {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {open ? '收起' : '展开详情'}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2.5 border-t border-quant/40">
            {/* 完整说明 */}
            <div className="pt-2">
              <div className="text-[10px] text-muted-foreground mb-0.5">形态说明</div>
              <div className="text-[11px] text-foreground/90 leading-relaxed">{meta.description}</div>
            </div>

            {/* condition 表达式 */}
            <div>
              <div className="text-[10px] text-muted-foreground mb-0.5 font-mono">condition</div>
              <pre className="text-[10px] font-mono text-amber-400/90 bg-amber-500/5 border border-amber-500/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {meta.condition}
              </pre>
            </div>

            {/* 关键变量 */}
            <div>
              <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                <Variable className="size-2.5" />
                关键变量
              </div>
              <div className="space-y-1">
                {meta.keyVars.map((v) => (
                  <div key={v.name} className="flex items-start gap-2 text-[10px]">
                    <code className="font-mono text-quant-primary bg-quant-primary/10 px-1 rounded shrink-0">
                      {v.name}
                    </code>
                    <span className="text-muted-foreground">{v.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 默认参数 */}
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">默认参数</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(meta.defaultParams).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-[9px] font-mono border-quant">
                    {k}={v}
                  </Badge>
                ))}
              </div>
            </div>

            {/* 建议操作 */}
            <div className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/5 border border-amber-500/20">
              <Lightbulb className="size-3 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] text-amber-400 font-medium">建议操作</div>
                <div className="text-[10px] text-foreground/80 mt-0.5">{meta.advice}</div>
              </div>
            </div>

            {/* 试跑按钮 */}
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              onClick={() => onTest(meta)}
            >
              <Play className="size-3" />
              模拟试跑(用预设快照)
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

/** 顶部说明 banner */
export function PatternLibraryBanner({
  enabledCount,
  totalCount,
  customCount,
  onCreate,
}: {
  enabledCount: number
  totalCount: number
  customCount: number
  onCreate: () => void
}) {
  return (
    <Card className="bg-gradient-to-r from-amber-500/10 to-transparent border-amber-500/30 p-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-amber-400">
              形态预警库 · {totalCount} 类形态
            </span>
            {customCount > 0 && (
              <Badge variant="outline" className="text-[9px] font-mono border-amber-500/40 text-amber-400 bg-amber-500/10">
                自定义 {customCount}
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            基于扩展变量(his_high/his_low/open_pct/last_vs_high_pct 等)实现的典型盘中形态预警。
            预设形态套餐 ID 为 <code className="font-mono text-amber-400">pattern_alerts</code>, 对所有股票生效(兜底套餐)。
            支持克隆预设或从空白创建自定义形态, 自定义形态本地持久化(localStorage), 可随时编辑/删除。
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[10px]">
            <span className="text-muted-foreground">
              已启用 <span className="text-amber-400 font-mono">{enabledCount}</span> / {totalCount}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              防抖 <span className="font-mono">120s</span>
            </span>
            <Button
              size="sm"
              onClick={onCreate}
              className="h-6 ml-auto bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300 text-[10px] px-2"
            >
              <span className="text-base leading-none">+</span>
              新建自定义形态
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
