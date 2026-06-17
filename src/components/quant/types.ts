/**
 * 选股结果相关共享类型
 * 抽离到独立文件避免 SelectionResults ↔ StrategyCompareView 循环依赖
 */

export interface StockAggRow {
  stock_code: string
  stock_name: string
  strategy_count: number
  strategy_ids: string[]
  strategy_names: string[]
  best_score: number
  best_rank: number
  avg_score: number
  runs: Array<{ strategy_id: string; strategy_name: string; score: number; rank: number }>
}
