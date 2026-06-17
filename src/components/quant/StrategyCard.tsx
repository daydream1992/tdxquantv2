'use client'

/**
 * 策略卡片
 * 显示：emoji / 名称 / 状态 / 板块code / 上次选股时间 / 股票数
 */

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Play, Eye, Clock, Hash } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StrategyDTO } from '@/lib/api'

export interface StrategyCardProps {
  strategy: StrategyDTO
  onToggle?: (id: string, next: boolean) => void
  onRun?: (id: string) => void
  onViewConfig?: (id: string) => void
  className?: string
}

export function StrategyCard({
  strategy,
  onToggle,
  onRun,
  onViewConfig,
  className,
}: StrategyCardProps) {
  return (
    <Card
      className={cn(
        'relative overflow-hidden p-4 gap-3 bg-quant-card border-quant hover:border-[var(--quant-primary)]/50 transition-colors',
        className
      )}
    >
      {/* 顶部：emoji + 名称 + 状态 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-3xl leading-none shrink-0" aria-hidden>
            {strategy.strategy_emoji || '📊'}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-base truncate">{strategy.strategy_name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {strategy.description}
            </div>
          </div>
        </div>
        <Switch
          checked={strategy.enabled}
          onCheckedChange={(v) => onToggle?.(strategy.strategy_id, v)}
          aria-label={`${strategy.strategy_name} 启用/禁用`}
        />
      </div>

      {/* 中部：状态徽章 */}
      <div className="flex flex-wrap items-center gap-2">
        {strategy.enabled ? (
          <Badge className="bg-[var(--quant-up)]/15 text-up border-[var(--quant-up)]/30 hover:bg-[var(--quant-up)]/20">
            ● 启用中
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground border-quant">
            ○ 已停用
          </Badge>
        )}
        <Badge variant="outline" className="font-mono text-xs border-quant">
          <Hash className="size-3" />
          {strategy.strategy_id}
        </Badge>
        <Badge variant="outline" className="font-mono text-xs border-quant">
          {strategy.sector_code}
        </Badge>
      </div>

      {/* 底部：上次选股信息 + 操作 */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-quant">
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground min-w-0">
          <span className="flex items-center gap-1">
            <Clock className="size-3 shrink-0" />
            <span className="truncate">
              {strategy.last_run_at
                ? `上次选股 ${formatTime(strategy.last_run_at)}`
                : '尚未运行'}
            </span>
          </span>
          <span className="text-quant-primary tabular-nums">
            选出 {strategy.last_run_stocks} 只 · v{strategy.version}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onViewConfig?.(strategy.strategy_id)}
            className="h-8 px-2 text-muted-foreground hover:text-foreground"
            title="查看配置"
          >
            <Eye className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => onRun?.(strategy.strategy_id)}
            disabled={!strategy.enabled}
            className="h-8"
            title="立即运行"
          >
            <Play className="size-3.5" />
            运行
          </Button>
        </div>
      </div>
    </Card>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / 1000
    if (diff < 60) return '刚刚'
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
