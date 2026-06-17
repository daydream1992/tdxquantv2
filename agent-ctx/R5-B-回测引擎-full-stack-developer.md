---
Task ID: R5-B-回测引擎
Agent: full-stack-developer (subagent)
Task: 回测引擎 API + UI 实现 (后端 FastAPI + 前端 Next.js)

# 工作摘要

## 后端 (Python)
- **engine/api/routes/backtest.py** (新增, ~580 行)
  - 3 个端点:
    - `POST /api/backtest/run` — 启动回测 (入参 BacktestRunRequest, 出参 BacktestResultResponse)
    - `GET /api/backtest/history` — 历史回测列表 (出参 list[BacktestHistoryItem])
    - `GET /api/backtest/{run_id}` — 单次回测详情 (从 result_json 反序列化)
  - 简化版回测引擎 `_run_backtest()`:
    - 从 `selection_results` 表读策略历史选股信号 (按 run_date 升序)
    - 无数据时 mock 20 个交易日 × 3-5 只股票
    - 等权买入 top_n、持有 N 天卖出
    - 用 `hashlib.md5(stock_code|day_index)` 生成 -3%~+5% 确定性日涨幅 (同一股票每次回测一致)
    - 计算: 总收益 / 年化 / 最大回撤 / 夏普(sqrt(252)年化) / 胜率 / Alpha / Beta
  - 持久化到 DuckDB `backtest_results` 表 (惰性 CREATE TABLE IF NOT EXISTS，含 result_json 完整快照)
  - 错误处理: 表不存在时返回空数组而非 500

- **engine/api/main.py** (修改)
  - import `backtest as backtest_routes`
  - `app.include_router(backtest_routes.router, prefix="/api/backtest")`

## 前端 (TypeScript)

### API 代理 (3 个新文件)
- `src/app/api/backtest/run/route.ts` — POST 代理，校验必填字段
- `src/app/api/backtest/history/route.ts` — GET 代理
- `src/app/api/backtest/[runId]/route.ts` — GET 单条代理

### API 客户端 (修改 src/lib/api.ts)
新增:
- `BacktestParamsDTO` / `BacktestResultDTO` / `BacktestDailyEquityDTO` / `BacktestTradeDTO` / `BacktestHistoryItemDTO` 类型
- `backtestAPI.run(params)` / `backtestAPI.history()` / `backtestAPI.get(runId)`

### UI 组件 (新增 src/components/quant/BacktestView.tsx, ~750 行)
5 大区块:
1. **顶部表单 Card** — 策略 Select / 日期 input[type=date] / 初始资金 / top_n (3/5/10) / hold_days (1/3/5/10/20) + "运行回测"按钮 (Loader2 加载态)
2. **统计指标 Grid** (8 卡片, 4×2) — 总收益/年化/最大回撤/夏普/胜率/交易次数/Alpha/Beta，每个带 tone 色 + 渐变光晕 + 底部装饰条 (复用 StatCard 风格)
3. **收益曲线 SVG** (920×320, 纯手绘, 参考 MiniKline.tsx 风格)
   - 主线: 策略资产曲线 (琥珀金 var(--quant-primary))
   - 对比线: 基准曲线 (灰色虚线)
   - 阴影: 回撤区间 (红色半透明 var(--quant-down) fillOpacity=0.06)
   - hover: 十字光标 + tooltip (日期/资产/收益/回撤)
   - 网格线 + Y 轴 5 档刻度 + X 轴 6 档日期
4. **交易记录表格** (复用 StockTable) — 9 列: 代码/名称/买入日/卖出日/买入价/卖出价/持仓天数/收益率/收益金额；正绿负红；顶部 6 项汇总 (总次数/盈/亏/胜率/累计盈亏/平均收益率)
5. **历史回测列表** (Collapsible 折叠, 默认收起) — 8 列: run_id/策略/日期范围/总收益/最大回撤/夏普/创建时间/查看按钮；点击查看加载该次回测详情到上方

### 集成 (修改 src/components/quant/SelectionResults.tsx)
- 现有 ToggleGroup 增加 "回测" 第 4 个 toggle (History icon)
- viewMode 类型扩展: `'detail' | 'agg' | 'compare' | 'backtest'`
- 选中时渲染 `<BacktestView />`

## UI 设计原则遵守
- 全程使用 `var(--quant-*)` CSS 变量 (琥珀金/红涨绿跌 A 股惯例)，不用 indigo/blue
- 收益率正数红 `var(--quant-up)` / 负数绿 `var(--quant-down)`
- 加载态: Loader2 旋转 + Skeleton
- 空状态: EmptyState 组件
- 响应式: mobile 单列 / sm 2 列 / lg 4 列
- Footer sticky (未修改 page.tsx 的 footer 结构)

## QA 验证

### lint
```
$ bun run lint
$ eslint .
exit: 0
```

### curl 后端直连
```
POST http://127.0.0.1:8000/api/backtest/run
  strategy_id=dbqzt, start_date=2025-01-01, end_date=2025-03-01
  → run_id=e3e15fadd4e4, total_return=29.65%, 21 trades (17 profit)

GET http://127.0.0.1:8000/api/backtest/history
  → 4 条历史回测

GET http://127.0.0.1:8000/api/backtest/c31afc47c730
  → 单条详情完整返回
```

### curl Next.js 代理 (端口 3000)
```
POST /api/backtest/run 200 in 116ms
GET /api/backtest/history 200 in 108ms
GET /api/backtest/c31afc47c730 200 in 564ms
GET / 200 in 125ms (页面渲染正常)
```

### FastAPI 重启
```bash
# sandbox 进程保活方案 (subprocess.Popen + start_new_session=True)
cd /home/z/my-project && /home/z/.venv/bin/python3 -c "
import subprocess
p = subprocess.Popen(
    ['/home/z/.venv/bin/python3', '-m', 'uvicorn', 'engine.api.main:app',
     '--host', '0.0.0.0', '--port', '8000', '--log-level', 'warning'],
    stdout=open('/tmp/fastapi.log', 'ab'),
    stderr=subprocess.STDOUT,
    stdin=subprocess.DEVNULL,
    start_new_session=True,
    cwd='/home/z/my-project',
)
print('spawned pid', p.pid)
"
```

## 未解决问题
1. 回测 mock 价格涨幅范围 -3%~+5% 偏向多头，年化收益率虚高 (906% 等)，仅用作演示；真实回测需对接 tqcenter.get_market_data
2. DuckDB backtest_results 表无 SEQUENCE/索引 (简化版)
3. sandbox 进程保活仍依赖 Python subprocess.Popen，若 sandbox 重启需手动重新派生
4. result_json 全量持久化，长时间使用会让 DuckDB 文件增大；后续可加定期清理

## 下一阶段优先事项
1. 回测引擎接入真实历史价 (tqcenter.get_market_data)
2. 回测结果导出 (PDF/Excel 报告)
3. 多策略并排回测对比
4. 信号重推按钮 UI 集成 (R5 主 agent 后端已就绪)
5. Settings Dialog (推送通道配置 UI)
