'use client'

/**
 * 推送通道配置 Settings Dialog
 *
 * - 4 个通道 (csv_log / websocket / tdx_warn / feishu) 状态展示与配置编辑
 * - csv_log 强制开启 (force_enabled)
 * - websocket 只读 (轮询模式无配置)
 * - tdx_warn / feishu 可配置
 * - 测试 → channelAPI.test(name) → toast
 * - 保存 → channelAPI.update(channels) → toast
 * - 重置 → 重新加载配置
 *
 * 主题: 琥珀/橙金色系 (var(--quant-primary)), 深色金融风
 */

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FileText,
  Radio,
  Bell,
  MessageSquare,
  Loader2,
  RotateCcw,
  Save,
  Send,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  channelAPI,
  type ChannelConfigDTO,
} from '@/lib/api'

// ===== 通道元信息 =====
interface ChannelMeta {
  name: string
  label: string
  description: string
  icon: React.ElementType
  forceEnabled?: boolean
  readOnly?: boolean
}

const CHANNEL_META: Record<string, ChannelMeta> = {
  csv_log: {
    name: 'csv_log',
    label: 'CSV 日志',
    description: '所有信号写入 logs/signals.csv，审计必备',
    icon: FileText,
    forceEnabled: true,
    readOnly: true,
  },
  websocket: {
    name: 'websocket',
    label: 'WebSocket 推送',
    description: 'Web 大屏轮询拉取，无额外配置',
    icon: Radio,
    readOnly: true,
  },
  tdx_warn: {
    name: 'tdx_warn',
    label: '通达信预警',
    description: '推送弹窗到通达信客户端，半自动交易提醒',
    icon: Bell,
  },
  feishu: {
    name: 'feishu',
    label: '飞书推送',
    description: '飞书自定义机器人 Webhook，移动端提醒',
    icon: MessageSquare,
  },
}

const CHANNEL_ORDER = ['csv_log', 'websocket', 'tdx_warn', 'feishu']

// ===== Props =====
interface ChannelSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当 channels 状态有变化时回调 (用于父组件刷新) */
  onSaved?: () => void
}

// ===== 通道表单值类型 (松散映射) =====
type ChannelFormValue = Record<string, unknown>

export function ChannelSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: ChannelSettingsDialogProps) {
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testingName, setTestingName] = React.useState<string | null>(null)
  const [configPath, setConfigPath] = React.useState('')
  const [forms, setForms] = React.useState<Record<string, ChannelFormValue>>({})
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({
    feishu: true,
    tdx_warn: false,
  })

  // ===== 加载 =====
  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await channelAPI.list()
      setConfigPath(data.config_path)
      const nextForms: Record<string, ChannelFormValue> = {}
      const nextErrors: Record<string, string[]> = {}
      for (const ch of data.channels) {
        // 深拷贝 config，避免引用问题
        nextForms[ch.name] = { ...(ch.config || {}) }
        // csv_log 强制开启
        if (ch.name === 'csv_log') {
          nextForms[ch.name].enabled = true
        }
        nextErrors[ch.name] = ch.errors || []
      }
      setForms(nextForms)
      setErrors(nextErrors)
    } catch (e) {
      toast.error('加载通道配置失败', {
        description: (e as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (open) {
      load()
    }
  }, [open, load])

  // ===== 字段更新工具 =====
  const updateField = (channel: string, key: string, value: unknown) => {
    setForms((prev) => ({
      ...prev,
      [channel]: {
        ...(prev[channel] || {}),
        [key]: value,
      },
    }))
  }

  const toggleEnabled = (channel: string, enabled: boolean) => {
    updateField(channel, 'enabled', enabled)
  }

  const toggleExpand = (channel: string) => {
    setExpanded((prev) => ({ ...prev, [channel]: !prev[channel] }))
  }

  // ===== 测试 =====
  const handleTest = async (name: string) => {
    setTestingName(name)
    const toastId = toast.loading(`正在测试 ${CHANNEL_META[name]?.label || name} 通道...`)
    try {
      const r = await channelAPI.test(name)
      if (r.ok) {
        toast.success(`测试成功: ${CHANNEL_META[name]?.label || name}`, {
          id: toastId,
          description: r.message,
        })
      } else {
        toast.error(`测试失败: ${CHANNEL_META[name]?.label || name}`, {
          id: toastId,
          description: r.message,
        })
      }
    } catch (e) {
      toast.error(`测试失败: ${CHANNEL_META[name]?.label || name}`, {
        id: toastId,
        description: (e as Error).message,
      })
    } finally {
      setTestingName(null)
    }
  }

  // ===== 保存 =====
  const handleSave = async () => {
    setSaving(true)
    const toastId = toast.loading('正在保存通道配置...')
    try {
      const r = await channelAPI.update(forms)
      if (r.ok) {
        toast.success('通道配置已保存', {
          id: toastId,
          description: '已持久化到 channels.yaml 并热重载',
        })
        // 用后端返回的最新状态刷新
        const nextForms: Record<string, ChannelFormValue> = {}
        const nextErrors: Record<string, string[]> = {}
        for (const ch of r.channels) {
          nextForms[ch.name] = { ...(ch.config || {}) }
          if (ch.name === 'csv_log') {
            nextForms[ch.name].enabled = true
          }
          nextErrors[ch.name] = ch.errors || []
        }
        setForms(nextForms)
        setErrors(nextErrors)
        onSaved?.()
      } else {
        toast.error('保存失败：配置校验未通过', {
          id: toastId,
          description: r.errors.join(' · '),
        })
        // 把校验错误塞到 errors
        const nextErrors: Record<string, string[]> = {}
        for (const ch of r.channels || []) {
          nextErrors[ch.name] = ch.errors || []
        }
        setErrors(nextErrors)
      }
    } catch (e) {
      toast.error('保存通道配置失败', {
        id: toastId,
        description: (e as Error).message,
      })
    } finally {
      setSaving(false)
    }
  }

  // ===== 重置 =====
  const handleReset = () => {
    load()
    toast.info('已重置为最新配置')
  }

  // ===== 渲染单通道卡片 =====
  const renderChannelCard = (name: string) => {
    const meta = CHANNEL_META[name]
    if (!meta) return null
    const Icon = meta.icon
    const form = forms[name] || {}
    const errs = errors[name] || []
    const enabled = Boolean(form.enabled)
    const isExpanded = Boolean(expanded[name])
    const hasErrors = errs.length > 0
    const isTesting = testingName === name

    return (
      <Card
        key={name}
        className={cn(
          'gap-0 py-0 overflow-hidden border-quant bg-quant-card transition-colors',
          hasErrors && 'border-red-500/40',
          enabled && !hasErrors && 'border-amber-500/20'
        )}
      >
        {/* 头部: 图标 + 名称 + 描述 + 状态 + 开关 + 操作 */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div
            className={cn(
              'size-9 rounded-md flex items-center justify-center shrink-0 transition-colors',
              enabled
                ? 'bg-amber-500/15 text-amber-400'
                : 'bg-muted text-muted-foreground'
            )}
          >
            <Icon className="size-4.5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">{meta.label}</span>
              <code className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                {name}
              </code>
              {meta.forceEnabled && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 border-amber-500/40 text-amber-400 bg-amber-500/10"
                >
                  强制开启
                </Badge>
              )}
              {meta.readOnly && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 border-quant text-muted-foreground"
                >
                  只读
                </Badge>
              )}
              {hasErrors ? (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 border-red-500/40 text-red-400 bg-red-500/10 gap-1"
                >
                  <AlertCircle className="size-3" />
                  错误 {errs.length}
                </Badge>
              ) : enabled ? (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 border-emerald-500/40 text-emerald-400 bg-emerald-500/10 gap-1"
                >
                  <CheckCircle2 className="size-3" />
                  已启用
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 border-quant text-muted-foreground"
                >
                  已停用
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {meta.description}
            </div>
          </div>
          {/* 测试按钮 */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs hover:bg-amber-500/10 hover:text-amber-400 shrink-0"
            disabled={isTesting || loading || saving}
            onClick={() => handleTest(name)}
            title={`测试 ${meta.label} 通道连通性`}
          >
            {isTesting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            <span className="hidden sm:inline">测试</span>
          </Button>
          {/* 开关 */}
          <Switch
            checked={enabled}
            onCheckedChange={(v) => toggleEnabled(name, v)}
            disabled={meta.forceEnabled || meta.readOnly || loading || saving}
            className="data-[state=checked]:bg-amber-500/80 shrink-0"
          />
          {/* 展开/收起 (仅可配置通道) */}
          {!meta.readOnly && !meta.forceEnabled && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 hover:bg-amber-500/10"
              onClick={() => toggleExpand(name)}
              title={isExpanded ? '收起配置' : '展开配置'}
            >
              {isExpanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </Button>
          )}
        </div>

        {/* 错误提示 */}
        {hasErrors && (
          <div className="px-4 py-2 bg-red-500/5 border-t border-red-500/20">
            <div className="text-xs text-red-400 flex items-start gap-1.5">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                {errs.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 配置区: csv_log / websocket 只读展示; tdx_warn / feishu 可编辑 */}
        {meta.readOnly ? (
          <div className="px-4 py-3 border-t border-quant bg-muted/20">
            {name === 'csv_log' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">日志路径</Label>
                  <Input
                    readOnly
                    value={String(form.path || 'logs/signals.csv')}
                    className="h-8 font-mono text-xs bg-muted/40 border-quant"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">说明</Label>
                  <div className="text-xs text-muted-foreground h-8 flex items-center">
                    审计强制开启，所有信号写入 CSV
                  </div>
                </div>
              </div>
            ) : name === 'websocket' ? (
              <div className="text-xs text-muted-foreground">
                轮询模式：前端通过 <code className="font-mono px-1 py-0.5 rounded bg-muted">/api/signals</code> 定时拉取，
                无需额外配置
              </div>
            ) : null}
          </div>
        ) : (
          isExpanded && (
            <div className="px-4 py-3 border-t border-quant bg-muted/20 space-y-3">
              {name === 'tdx_warn' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`tdx-duration`} className="text-xs text-muted-foreground">
                      弹窗持续时间 (毫秒)
                    </Label>
                    <Input
                      id={`tdx-duration`}
                      type="number"
                      min={1000}
                      max={60000}
                      step={500}
                      value={Number(form.duration_ms ?? 8000)}
                      onChange={(e) =>
                        updateField('tdx_warn', 'duration_ms', Number(e.target.value))
                      }
                      className="h-8 font-mono text-sm border-quant focus-visible:ring-amber-500/40 focus-visible:border-amber-500/40"
                    />
                    <div className="text-[10px] text-muted-foreground">范围 1000 - 60000 ms</div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">提示音等级</Label>
                    <Select
                      value={String(form.sound_level ?? 1)}
                      onValueChange={(v) => updateField('tdx_warn', 'sound_level', Number(v))}
                    >
                      <SelectTrigger className="h-8 border-quant focus-visible:ring-amber-500/40 focus-visible:border-amber-500/40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0 - 静音</SelectItem>
                        <SelectItem value="1">1 - 普通提示音</SelectItem>
                        <SelectItem value="2">2 - 重要提示音</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="text-[10px] text-muted-foreground">影响客户端声音强度</div>
                  </div>
                </div>
              )}
              {name === 'feishu' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="feishu-webhook" className="text-xs text-muted-foreground">
                      Webhook URL
                    </Label>
                    <Input
                      id="feishu-webhook"
                      type="url"
                      placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx"
                      value={String(form.webhook_url ?? '')}
                      onChange={(e) =>
                        updateField('feishu', 'webhook_url', e.target.value)
                      }
                      className="h-8 font-mono text-xs border-quant focus-visible:ring-amber-500/40 focus-visible:border-amber-500/40"
                    />
                    <div className="text-[10px] text-muted-foreground">
                      飞书自定义机器人 Webhook 地址
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="feishu-secret" className="text-xs text-muted-foreground">
                      签名密钥 (可选)
                    </Label>
                    <Input
                      id="feishu-secret"
                      type="password"
                      placeholder="启用签名校验时填入"
                      value={String(form.secret ?? '')}
                      onChange={(e) => updateField('feishu', 'secret', e.target.value)}
                      className="h-8 font-mono text-xs border-quant focus-visible:ring-amber-500/40 focus-visible:border-amber-500/40"
                    />
                    <div className="text-[10px] text-muted-foreground">
                      留空表示不启用签名；后端会脱敏显示为 ***
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">@ 全员</Label>
                      <div className="flex items-center gap-2 h-8">
                        <Switch
                          checked={Boolean(form.at_all)}
                          onCheckedChange={(v) => updateField('feishu', 'at_all', v)}
                          className="data-[state=checked]:bg-amber-500/80"
                        />
                        <span className="text-xs text-muted-foreground">
                          {form.at_all ? '已开启' : '已关闭'}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="feishu-at-users" className="text-xs text-muted-foreground">
                        @ 用户 (open_id, 逗号分隔)
                      </Label>
                      <Textarea
                        id="feishu-at-users"
                        rows={2}
                        placeholder="ou_xxxxx, ou_yyyyy, ou_zzzzz"
                        value={Array.isArray(form.at_users)
                          ? (form.at_users as string[]).join(', ')
                          : String(form.at_users ?? '')}
                        onChange={(e) => {
                          const arr = e.target.value
                            .split(/[,，\s]+/)
                            .map((s) => s.trim())
                            .filter(Boolean)
                          updateField('feishu', 'at_users', arr)
                        }}
                        className="text-xs font-mono min-h-8 border-quant focus-visible:ring-amber-500/40 focus-visible:border-amber-500/40"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </Card>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] flex flex-col gap-0 p-0 border-quant bg-quant-card">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-quant space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="size-4 text-amber-400" />
            推送通道配置
          </DialogTitle>
          <DialogDescription className="text-xs">
            管理 CSV / WebSocket / 通达信 / 飞书 4 个推送通道。配置写入{' '}
            <code className="font-mono px-1 py-0.5 rounded bg-muted text-amber-400">
              {configPath || 'config/channels.yaml'}
            </code>
            ，保存后自动热重载。
          </DialogDescription>
        </DialogHeader>

        {/* Body: 通道列表 */}
        <div className="flex-1 overflow-y-auto quant-scroll px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="size-6 animate-spin text-amber-400" />
              <div className="text-sm text-muted-foreground">加载通道配置中...</div>
            </div>
          ) : (
            <>
              {CHANNEL_ORDER.map(renderChannelCard)}
              {/* 提示 */}
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400/80 flex items-start gap-2">
                <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium mb-1">使用说明</div>
                  <ul className="space-y-0.5 text-muted-foreground list-disc pl-4">
                    <li>CSV 日志通道强制开启，用于审计</li>
                    <li>WebSocket 通道为轮询模式，无额外配置</li>
                    <li>通达信预警需要在客户端运行环境调用 tqcenter API</li>
                    <li>飞书推送需填入真实 Webhook URL 后才能测试成功</li>
                    <li>修改后请点击"保存"，热重载无需重启服务</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-quant gap-2 flex-row items-center justify-between sm:justify-between">
          <div className="text-[10px] text-muted-foreground hidden sm:block">
            提示: 切换开关后请点击保存生效
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 hover:bg-amber-500/10 hover:text-amber-400"
              onClick={handleReset}
              disabled={loading || saving}
            >
              <RotateCcw className="size-3.5" />
              重置
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-8 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300"
              onClick={handleSave}
              disabled={loading || saving}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              保存配置
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
