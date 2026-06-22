/**
 * StrategyManager 共享类型 + 工具函数
 *
 * - YamlTransformOpts / transformStrategyYaml: 复制策略时行级替换
 *   strategy_id / strategy_name / strategy_emoji / sector.code / sector.name
 * - ID_REGEX: 策略 ID 合法性校验 (英文字母/数字/下划线, 2-30 字符)
 */

export interface YamlTransformOpts {
  newId: string
  newName: string
  newEmoji: string
}

/** 行级替换 YAML 中的 strategy_id / strategy_name / strategy_emoji / sector.code / sector.name */
export function transformStrategyYaml(yaml: string, opts: YamlTransformOpts): string {
  const lines = yaml.split('\n')
  let inSector = false
  let sectorIndent = 0
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.replace(/^\s+/, '')
    // 进入 sector: 块
    if (!inSector && /^sector:\s*$/.test(line)) {
      inSector = true
      sectorIndent = 0
      out.push(line)
      continue
    }
    if (inSector) {
      // 空行/注释行直接保留
      if (line.trim() === '' || line.trim().startsWith('#')) {
        out.push(line)
        continue
      }
      const indent = line.length - trimmed.length
      // 缩进回到 <= sectorIndent 表示出了 sector 块
      if (indent <= sectorIndent) {
        inSector = false
      } else {
        // 在 sector 块内
        if (/^code:\s/.test(trimmed)) {
          out.push(`${' '.repeat(indent)}code: ZD_${opts.newId.toUpperCase()}01`)
          continue
        }
        if (/^name:\s/.test(trimmed)) {
          out.push(`${' '.repeat(indent)}name: ${opts.newName}选股`)
          continue
        }
        out.push(line)
        continue
      }
    }
    // 顶层 key（column 0）
    if (/^strategy_id:\s/.test(line)) {
      out.push(`strategy_id: ${opts.newId}`)
      continue
    }
    if (/^strategy_name:\s/.test(line)) {
      out.push(`strategy_name: ${opts.newName}`)
      continue
    }
    if (/^strategy_emoji:\s/.test(line)) {
      out.push(`strategy_emoji: ${opts.newEmoji}`)
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/** 策略 ID 合法性: 英文字母/数字/下划线, 2-30 字符 */
export const ID_REGEX = /^[a-zA-Z0-9_]{2,30}$/
