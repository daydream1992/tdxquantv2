/**
 * PatternAlert 形态预警共享元信息 + 类型
 *
 * 7 类形态(对应 config/monitor.yaml 的 alert_templates):
 *   1. near_high_reject        接近前高回落
 *   2. drop_exhaustion         下跌枯竭
 *   3. open_bait_bears         开盘诱空
 *   4. open_bait_bulls         开盘诱多
 *   5. intraday_low_vol_bait   无量诱多
 *   6. intraday_real_drop      急跌真跌
 *   7. rebound_setup           准备反弹
 */

export interface PatternMeta {
  alert_type: string
  emoji: string
  label: string
  /** 短场景描述(卡片副标题) */
  scenario: string
  /** 完整说明(展开后显示) */
  description: string
  /** condition 表达式(展示用,实际从后端拿) */
  condition: string
  /** 默认参数 */
  defaultParams: Record<string, number>
  /** 模拟触发的预设快照(用于"试跑"按钮) */
  presetSnap: PatternSnap
  /** 涉及的关键变量(用于说明) */
  keyVars: Array<{ name: string; desc: string }>
  /** 风险等级(高/中) */
  risk: 'high' | 'medium'
  /** 建议操作 */
  advice: string
  /** 是否为自定义形态(预设形态无此字段) */
  custom?: boolean
  /** 自定义形态唯一 ID(自定义形态才有) */
  id?: string
}

/** 模拟快照(扁平,直接传给 /test 接口) */
export interface PatternSnap {
  code: string
  name?: string
  ZAF: number          // 当前涨跌幅(百分数,如 3.21 表示 +3.21%)
  OpenZAF: number      // 开盘涨跌幅(百分数)
  Wtb: number          // 量比
  Zjl: number          // 主力净流入(万)
  HisHigh: number      // 历史最高价
  HisLow: number       // 历史最低价
  MA5Value: number     // 5日均价
  Now: number          // 现价
  Volume: number       // 成交量
  Amount: number       // 成交额
}

export const PATTERN_LIST: PatternMeta[] = [
  {
    alert_type: 'near_high_reject',
    emoji: '📐',
    label: '接近前高回落',
    scenario: '接近前高但量能萎缩未冲过,准备回落',
    description:
      '股价接近历史高点(距前高 ≤ 3%),但量能萎缩(量比 < 1.2)且当日涨跌幅为负,说明多方力量不足,难以突破前高,准备回落。',
    condition:
      'last_vs_high_pct > 0 and last_vs_high_pct <= {high_proximity} and volume_ratio < {vol_ratio_threshold} and pct_change < {pct_threshold}',
    defaultParams: { high_proximity: 0.03, vol_ratio_threshold: 1.2, pct_threshold: 0.0 },
    presetSnap: {
      code: '600519.SH',
      name: '贵州茅台',
      ZAF: -0.5,
      OpenZAF: 0.2,
      Wtb: 0.9,
      Zjl: -200,
      HisHigh: 1820.0,
      HisLow: 1500.0,
      MA5Value: 1760.0,
      Now: 1780.0,
      Volume: 12000,
      Amount: 21360000,
    },
    keyVars: [
      { name: 'last_vs_high_pct', desc: '距前高的距离(his_high-last)/his_high,0=在前高' },
      { name: 'volume_ratio', desc: '量比,缩量<1' },
      { name: 'pct_change', desc: '当日涨跌幅' },
    ],
    risk: 'high',
    advice: '减仓或离场,等待有效突破前高后再介入',
  },
  {
    alert_type: 'drop_exhaustion',
    emoji: '🕳️',
    label: '下跌枯竭',
    scenario: '下跌中缩量且接近前期低点,动能枯竭',
    description:
      '股价仍在下跌,但量能极度萎缩(量比 < 0.8),且距离前期低点很近(≤ 5%),说明抛压枯竭,下跌动能不足,准备反弹。',
    condition:
      'pct_change < 0 and volume_ratio < {vol_ratio_threshold} and last_vs_low_pct < {low_proximity} and last_vs_low_pct > 0',
    defaultParams: { vol_ratio_threshold: 0.8, low_proximity: 0.05 },
    presetSnap: {
      code: '000001.SZ',
      name: '平安银行',
      ZAF: -1.2,
      OpenZAF: -0.8,
      Wtb: 0.6,
      Zjl: -150,
      HisHigh: 15.8,
      HisLow: 10.5,
      MA5Value: 11.2,
      Now: 10.8,
      Volume: 8000,
      Amount: 8640000,
    },
    keyVars: [
      { name: 'last_vs_low_pct', desc: '距前低的距离(last-his_low)/his_low,0=在前低' },
      { name: 'volume_ratio', desc: '量比,缩量<1' },
      { name: 'pct_change', desc: '当日涨跌幅(负=下跌)' },
    ],
    risk: 'high',
    advice: '关注,缩量企稳后可轻仓试探性建仓',
  },
  {
    alert_type: 'open_bait_bears',
    emoji: '🪤',
    label: '开盘诱空',
    scenario: '开盘下杀但盘中拉回,诱空洗盘',
    description:
      '开盘下杀(开盘涨跌 < -2%),但盘中拉回(现价高于开盘 +1% 以上),典型的开盘诱空洗盘手法,主力借恐慌吸筹。',
    condition: 'open_pct < -{open_drop_pct} and last_vs_open_pct > {rebound_pct}',
    defaultParams: { open_drop_pct: 0.02, rebound_pct: 0.01 },
    presetSnap: {
      code: '300750.SZ',
      name: '宁德时代',
      ZAF: 1.5,
      OpenZAF: -2.8,
      Wtb: 1.6,
      Zjl: 800,
      HisHigh: 280.0,
      HisLow: 200.0,
      MA5Value: 235.0,
      Now: 240.0,
      Volume: 25000,
      Amount: 60000000,
    },
    keyVars: [
      { name: 'open_pct', desc: '开盘涨跌幅(OpenZAF/100)' },
      { name: 'last_vs_open_pct', desc: '盘中相对开盘的涨跌(ZAF-OpenZAF)/100,正=拉回' },
    ],
    risk: 'high',
    advice: '可逢低介入,止损设在开盘价下方',
  },
  {
    alert_type: 'open_bait_bulls',
    emoji: '🎣',
    label: '开盘诱多',
    scenario: '开盘冲高但盘中回落,诱多出货',
    description:
      '开盘冲高(开盘涨跌 > +2%),但盘中回落(现价低于开盘 -1% 以上),典型的开盘诱多出货手法,主力借追高派发。',
    condition: 'open_pct > {open_rise_pct} and last_vs_open_pct < -{fallback_pct}',
    defaultParams: { open_rise_pct: 0.02, fallback_pct: 0.01 },
    presetSnap: {
      code: '002594.SZ',
      name: '比亚迪',
      ZAF: -1.2,
      OpenZAF: 3.0,
      Wtb: 1.8,
      Zjl: -1200,
      HisHigh: 280.0,
      HisLow: 200.0,
      MA5Value: 240.0,
      Now: 236.0,
      Volume: 30000,
      Amount: 70800000,
    },
    keyVars: [
      { name: 'open_pct', desc: '开盘涨跌幅' },
      { name: 'last_vs_open_pct', desc: '盘中相对开盘的涨跌,负=回落' },
    ],
    risk: 'high',
    advice: '减仓离场,不要追高',
  },
  {
    alert_type: 'intraday_low_vol_bait',
    emoji: '🫧',
    label: '无量诱多',
    scenario: '盘中上涨但量能极度萎缩,无量拉升',
    description:
      '盘中上涨(涨幅 > 2%),但量能极度萎缩(量比 < 0.8),无量拉升难以持续,诱多嫌疑大。',
    condition: 'pct_change > {pct_threshold} and volume_ratio < {vol_ratio_threshold}',
    defaultParams: { pct_threshold: 0.02, vol_ratio_threshold: 0.8 },
    presetSnap: {
      code: '600036.SH',
      name: '招商银行',
      ZAF: 2.5,
      OpenZAF: 0.3,
      Wtb: 0.6,
      Zjl: 100,
      HisHigh: 42.0,
      HisLow: 32.0,
      MA5Value: 36.0,
      Now: 37.0,
      Volume: 5000,
      Amount: 1850000,
    },
    keyVars: [
      { name: 'pct_change', desc: '当日涨跌幅' },
      { name: 'volume_ratio', desc: '量比,无量<0.8' },
    ],
    risk: 'medium',
    advice: '谨慎,无量上涨不可持续,不追高',
  },
  {
    alert_type: 'intraday_real_drop',
    emoji: '💥',
    label: '急跌真跌',
    scenario: '盘中急跌且放量且主力流出,真跌非洗盘',
    description:
      '盘中急跌(跌幅 > 3%)且放量(量比 > 1.5)且主力净流出,三重确认的真跌,不是洗盘,需止损。',
    condition:
      'pct_change < -{pct_threshold} and volume_ratio > {vol_ratio_threshold} and main_inflow < 0',
    defaultParams: { pct_threshold: 0.03, vol_ratio_threshold: 1.5 },
    presetSnap: {
      code: '601318.SH',
      name: '中国平安',
      ZAF: -3.8,
      OpenZAF: -0.5,
      Wtb: 2.1,
      Zjl: -3500,
      HisHigh: 55.0,
      HisLow: 42.0,
      MA5Value: 48.0,
      Now: 46.2,
      Volume: 45000,
      Amount: 207900000,
    },
    keyVars: [
      { name: 'pct_change', desc: '当日涨跌幅(负=下跌)' },
      { name: 'volume_ratio', desc: '量比,放量>1.5' },
      { name: 'main_inflow', desc: '主力净流入(万),负=流出' },
    ],
    risk: 'high',
    advice: '立即止损,不要补仓',
  },
  {
    alert_type: 'rebound_setup',
    emoji: '🔄',
    label: '准备反弹',
    scenario: '接近前期低点+缩量+跌幅收窄,准备反弹',
    description:
      '股价接近前期低点(≤ 3%),量能萎缩(量比 < 1.0),且跌幅收窄(跌幅 < 1%),卖压衰竭,准备反弹。',
    condition:
      'last_vs_low_pct < {low_proximity} and last_vs_low_pct > 0 and volume_ratio < {vol_ratio_threshold} and pct_change > -{pct_threshold}',
    defaultParams: { low_proximity: 0.03, vol_ratio_threshold: 1.0, pct_threshold: 0.01 },
    presetSnap: {
      code: '000651.SZ',
      name: '格力电器',
      ZAF: -0.5,
      OpenZAF: -0.8,
      Wtb: 0.7,
      Zjl: -80,
      HisHigh: 45.0,
      HisLow: 33.0,
      MA5Value: 34.5,
      Now: 33.8,
      Volume: 6000,
      Amount: 2028000,
    },
    keyVars: [
      { name: 'last_vs_low_pct', desc: '距前低的距离,0=在前低' },
      { name: 'volume_ratio', desc: '量比,缩量<1' },
      { name: 'pct_change', desc: '当日涨跌幅,跌幅收窄' },
    ],
    risk: 'high',
    advice: '可轻仓埋伏,止损设在前低下方',
  },
]

/** 把 PatternSnap 转成 test 接口需要的扁平 dict */
export function snapToTestBody(snap: PatternSnap): Record<string, unknown> {
  return { ...snap }
}

/** 风险等级样式 */
export function riskStyle(risk: 'high' | 'medium'): string {
  return risk === 'high'
    ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
}
