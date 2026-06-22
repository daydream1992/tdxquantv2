/**
 * watchlist/shared.ts
 *
 * Watchlist 子组件共享的常量 / 工具函数 / 类型 (无 JSX)。
 * 由 WatchlistTable / BatchImportDialog 共同 import。
 */

// _manual 是 "临时盯盘" 默认策略 ID
export const MANUAL_STRATEGY = '_manual'

// ----------------------------------------------------------------------------
// 批量导入: 解析逻辑 & 类型
// ----------------------------------------------------------------------------

export interface ParsedRow {
  code: string
  name: string
  strategy: string
  valid: boolean
  reason: string
}

/**
 * 解析批量导入输入文本。
 *
 * 支持两种格式:
 *  1. CSV 行: `code, name, strategy_id` (第2/3列可空)
 *  2. 仅代码: 每行一个或逗号 / 空格分隔
 *
 * 校验: A股代码必须 6 位纯数字 (前端轻校验, 后端会再做一次)
 */
export function parseBatchInput(text: string, defaultStrategy: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  return lines.map((line) => {
    const parts = line
      .split(/[,，\s]+/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length === 0) {
      return { code: '', name: '', strategy: '', valid: false, reason: '空行' }
    }
    const rawCode = parts[0]
    // 去掉可能的 .SH / .SZ / .BJ 后缀
    const code = rawCode.replace(/\.(SH|SZ|BJ)$/i, '')
    const valid = /^\d{6}$/.test(code)
    const name = parts[1] || ''
    const strategy = parts[2] || defaultStrategy
    return {
      code,
      name,
      strategy,
      valid,
      reason: valid ? '' : '代码格式错误(需6位数字)',
    }
  })
}
