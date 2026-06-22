/**
 * PatternBuilder 共享工具 — 自定义形态预警构建器核心
 *
 * 职责:
 *   - 定义 CustomPattern 类型(扩展 PatternMeta, 带 custom/id/时间戳)
 *   - 变量白名单(对齐后端 engine/monitor/rules.py snap_to_variables)
 *   - 表达式校验 + 求值(前端本地 simpleeval 等价实现)
 *   - 参数占位符提取
 *   - localStorage 持久化
 *   - ID 生成 + emoji 列表
 *
 * 设计要点:
 *   - 求值用 new Function + 白名单字符校验, 防 XSS
 *   - 派生变量计算与后端 snap_to_variables 完全对齐, 保证试跑结果一致
 *   - localStorage key: tdxquant:custom-patterns
 */

import type { PatternMeta, PatternSnap } from './shared'

// ============================================================================
// 类型
// ============================================================================

export interface CustomPattern extends PatternMeta {
  /** 标记为自定义形态(预设形态没有此字段) */
  custom: true
  /** 唯一 ID(localStorage 主键, 也是 alert_type) */
  id: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

// ============================================================================
// 变量白名单 — 与后端 engine/monitor/rules.py snap_to_variables 对齐
// ============================================================================

export interface VarSpec {
  name: string
  desc: string
  /** 示例值(用于生成默认试跑快照) */
  example: number
  /** 计算方式(展示用) */
  formula?: string
}

export const VARIABLE_WHITELIST: readonly VarSpec[] = [
  {
    name: 'pct_change',
    desc: '当日涨跌幅(小数, 0.03 = +3%)',
    example: 0.03,
    formula: 'ZAF / 100',
  },
  {
    name: 'open_pct',
    desc: '开盘涨跌幅(小数, -0.028 = -2.8%)',
    example: -0.028,
    formula: 'OpenZAF / 100',
  },
  {
    name: 'volume_ratio',
    desc: '量比(1 = 正常, <1 = 缩量, >1.5 = 放量)',
    example: 1.6,
    formula: 'Wtb',
  },
  {
    name: 'main_inflow',
    desc: '主力净流入(万, 负 = 流出)',
    example: -200,
    formula: 'Zjl',
  },
  {
    name: 'his_high',
    desc: '历史最高价(元)',
    example: 1820,
    formula: 'HisHigh',
  },
  {
    name: 'his_low',
    desc: '历史最低价(元)',
    example: 1500,
    formula: 'HisLow',
  },
  {
    name: 'ma5',
    desc: '5 日均价(元)',
    example: 1760,
    formula: 'MA5Value',
  },
  {
    name: 'last_vs_high_pct',
    desc: '距前高的距离(his_high - last) / his_high, 0 = 在前高, 负 = 破前高',
    example: 0.022,
    formula: '(HisHigh - Now) / HisHigh',
  },
  {
    name: 'last_vs_low_pct',
    desc: '距前低的距离(last - his_low) / his_low, 0 = 在前低, 负 = 破前低',
    example: 0.18,
    formula: '(Now - HisLow) / HisLow',
  },
  {
    name: 'last_vs_open_pct',
    desc: '盘中相对开盘的涨跌(zaf - openzaf) / 100, 正 = 拉回, 负 = 回落',
    example: 0.015,
    formula: '(ZAF - OpenZAF) / 100',
  },
] as const

/** 关键字(求值时允许的英文词) */
const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false'])

// ============================================================================
// 派生变量计算 — 与后端 snap_to_variables 完全对齐
// ============================================================================

export function deriveVars(snap: PatternSnap): Record<string, number> {
  const last = snap.Now || 0
  const hisHigh = snap.HisHigh || 0
  const hisLow = snap.HisLow || 0
  const zaf = snap.ZAF || 0
  const openZaf = snap.OpenZAF || 0
  return {
    pct_change: zaf / 100,
    open_pct: openZaf / 100,
    volume_ratio: snap.Wtb || 0,
    main_inflow: snap.Zjl || 0,
    his_high: hisHigh,
    his_low: hisLow,
    ma5: snap.MA5Value || 0,
    last_vs_high_pct: hisHigh > 0 ? (hisHigh - last) / hisHigh : 0,
    last_vs_low_pct: hisLow > 0 ? (last - hisLow) / hisLow : 0,
    last_vs_open_pct: (zaf - openZaf) / 100,
  }
}

// ============================================================================
// 表达式校验 + 求值
// ============================================================================

// 安全字符正则: 字母/数字/加减乘除/圆括号/比较运算符/逗号点/空格
const SAFE_EXPR_RE = /^[a-z_0-9\s+\-*/()<>=.,]+$/i

export interface ExprValidation {
  ok: boolean
  error?: string
}

/** 校验表达式(已替换 {param} 后的最终表达式) */
export function validateExpr(expr: string): ExprValidation {
  if (!expr.trim()) return { ok: false, error: '表达式不能为空' }
  if (!SAFE_EXPR_RE.test(expr)) {
    return { ok: false, error: '含非法字符(只允许字母/数字/+-*/()<>=.,和空格)' }
  }
  // 提取所有标识符, 校验是否在白名单或关键字
  const tokens = expr.match(/[a-z_][a-z_0-9]*/gi) || []
  const allowed = new Set<string>([
    ...VARIABLE_WHITELIST.map((v) => v.name),
    ...KEYWORDS,
  ])
  for (const t of tokens) {
    if (!allowed.has(t.toLowerCase())) {
      return { ok: false, error: `未知变量或关键字: "${t}"` }
    }
  }
  return { ok: true }
}

export interface EvalResult {
  hit: boolean
  error?: string
  vars: Record<string, number>
  /** 替换 {param} 后的表达式(展示用) */
  resolvedExpr: string
}

/**
 * 求值 condition
 *
 * @param condition 带 {param} 占位符的表达式, 如 "pct_change > {pct_threshold} and volume_ratio < {vol_ratio}"
 * @param params 参数值, 如 { pct_threshold: 0.03, vol_ratio: 1.2 }
 * @param snap 试跑快照
 */
export function evalCondition(
  condition: string,
  params: Record<string, number>,
  snap: PatternSnap,
): EvalResult {
  // 1. 替换 {param} 占位符
  let resolved = condition
  for (const [k, v] of Object.entries(params)) {
    resolved = resolved.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  }
  // 检查是否还有未替换的 {xxx}
  const unresolved = resolved.match(/\{[^}]+\}/)
  if (unresolved) {
    return {
      hit: false,
      error: `未定义参数: ${unresolved[0]}`,
      vars: {},
      resolvedExpr: resolved,
    }
  }
  // 2. 校验
  const v = validateExpr(resolved)
  if (!v.ok) {
    return { hit: false, error: v.error, vars: {}, resolvedExpr: resolved }
  }
  // 3. 计算派生变量
  const vars = deriveVars(snap)
  // 4. Python 关键字 → JS 运算符(simpleeval 用 and/or/not, JS 用 &&/||/!)
  //    用词边界避免误伤变量名(如 main_inflow 里的 "in")
  const jsExpr = resolved
    .replace(/\band\b/gi, '&&')
    .replace(/\bor\b/gi, '||')
    .replace(/\bnot\b/gi, '!')
  // 5. 求值(new Function 注入变量名)
  try {
    const keys = Object.keys(vars)
    const vals = Object.values(vars)
    const fn = new Function(...keys, `"use strict"; return (${jsExpr});`)
    const result = fn(...vals)
    return {
      hit: !!result,
      error: undefined,
      vars,
      resolvedExpr: resolved,
    }
  } catch (e) {
    return {
      hit: false,
      error: (e as Error).message,
      vars,
      resolvedExpr: resolved,
    }
  }
}

// ============================================================================
// 参数占位符提取
// ============================================================================

/** 从 condition 提取所有 {param} 占位符名(去重) */
export function extractParams(condition: string): string[] {
  const matches = condition.match(/\{([a-z_][a-z_0-9]*)\}/gi) || []
  const set = new Set(matches.map((m) => m.slice(1, -1)))
  return Array.from(set)
}

// ============================================================================
// localStorage 持久化
// ============================================================================

const STORAGE_KEY = 'tdxquant:custom-patterns'

export function loadCustomPatterns(): CustomPattern[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as CustomPattern[]) : []
  } catch {
    return []
  }
}

export function saveCustomPatterns(list: CustomPattern[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* quota 超限或隐私模式, 忽略 */
  }
}

// ============================================================================
// ID 生成 + emoji 列表
// ============================================================================

export function genPatternId(): string {
  return 'cp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
}

/** 形态预警常用 emoji(构建器选择器用) */
export const PATTERN_EMOJIS = [
  '📐', '🕳️', '🪤', '🎣', '🫧', '💥', '🔄', '⚠️', '🎯', '🚨',
  '📉', '📈', '🔴', '🟢', '🟡', '⚡', '🔥', '💡', '🧭', '🕯️',
  '📊', '🐋', '🦅', '🐅', '🐢', '🔱', '💠', '🧨',
] as const

// ============================================================================
// 默认试跑快照(从空白创建时用)
// ============================================================================

export const DEFAULT_SNAP: PatternSnap = {
  code: '000001.SZ',
  name: '示例股票',
  ZAF: 1.5,
  OpenZAF: -0.8,
  Wtb: 1.2,
  Zjl: 300,
  HisHigh: 15.8,
  HisLow: 10.5,
  MA5Value: 12.0,
  Now: 12.8,
  Volume: 12000,
  Amount: 15360000,
}

/** 从一个 PatternMeta 克隆出可编辑的 draft(用于"克隆预设"或"编辑自定义") */
export function metaToDraft(meta: PatternMeta): Omit<CustomPattern, 'id' | 'createdAt' | 'updatedAt' | 'custom'> {
  return {
    alert_type: meta.alert_type,
    emoji: meta.emoji,
    label: meta.label,
    scenario: meta.scenario,
    description: meta.description,
    condition: meta.condition,
    defaultParams: { ...meta.defaultParams },
    presetSnap: { ...meta.presetSnap },
    keyVars: meta.keyVars.map((v) => ({ ...v })),
    risk: meta.risk,
    advice: meta.advice,
  }
}

/** 从 condition + params 自动推导 keyVars(用于自定义形态保存时) */
export function deriveKeyVars(condition: string): Array<{ name: string; desc: string }> {
  const vars: Array<{ name: string; desc: string }> = []
  const used = new Set<string>()
  // 提取 condition 里的变量名(非参数占位符)
  const tokens = condition.match(/[a-z_][a-z_0-9]*/gi) || []
  for (const t of tokens) {
    const lower = t.toLowerCase()
    if (used.has(lower)) continue
    const spec = VARIABLE_WHITELIST.find((v) => v.name === lower)
    if (spec) {
      vars.push({ name: spec.name, desc: spec.desc })
      used.add(lower)
    }
  }
  return vars
}
