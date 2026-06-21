# Task ID: R14-3 - 方案 B 监控池概念热度 + 方案 C 同板块联动（含开关）

Agent: full-stack-developer
Date: 2026-06-21

## 任务概述
在 R14-1（个股板块归属）+ R14-2（三层限流）基础上，实现方案 B（监控池概念热度 Top N）+ 方案 C（信号同板块联动股），全部带 enabled 开关，关闭时端点返回 enabled:false + 前端隐藏。

## 文件清单

### 新增
- `engine/api/routes/sector_heatmap.py` (~280 行) - 方案 B 后端，GET /api/monitor/sector-heatmap
- `engine/api/routes/sector_linkage.py` (~320 行) - 方案 C 后端，GET /api/signals/{id}/related
- `src/app/api/monitor/sector-heatmap/route.ts` (24 行) - Next.js 代理
- `src/app/api/signals/[signalId]/related/route.ts` (25 行) - Next.js 动态代理
- `src/components/quant/SectorHeatmap.tsx` (~360 行) - 概念热度卡片

### 修改
- `engine/api/main.py` - 注册 sector_heatmap_routes (prefix=/api/monitor) + sector_linkage_routes (prefix=/api/signals)
- `config/monitor_rules.yaml` - 加 monitor.sector_heatmap + monitor.sector_linkage 段（含 enabled/top_n/cache_ttl/scan_timeout）
- `src/lib/api.ts` - 加 5 个 DTO + monitorAPI.getSectorHeatmap + signalAPI.getRelated
- `src/components/quant/Dashboard.tsx` - import SectorHeatmap + 在 FlowRanking 下方加 <SectorHeatmap />
- `src/components/quant/SignalCenter.tsx` - 加 linkageEnabled 探测 + SectorLinkageButton 子组件 + Popover

## 验证结果

### 1. bun run lint: exit 0 ✓

### 2. smoke_test.sh: 18/18 PASS ✓

### 3. 方案 B 端点 (GET /api/monitor/sector-heatmap)
- 第一次调用: enabled=true, total_stocks=31, scanned_stocks=31, items=10, from_cache=false, duration=380ms
  * Top 5: 绿色电力(concept, count=8) / 储能(concept, count=7) / 房地产开发(industry, count=7) / 芯片(concept, count=7) / 汽车电子(concept, count=6)
- 第二次调用: from_cache=true (LRU 60s 命中)

### 4. 方案 C 端点 (GET /api/signals/{id}/related)
- 信号 37f49e63... (000601.SZ 韶能股份): enabled=true, items=7, from_cache=false
  * 板块: 生物质能(1) / 充电桩(2) / 东数西算(3) / 储能(5) / 绿色电力(5) / 数据中心(3) / 新能源车(4)
  * pct 全为 0.0 (EngineState 未缓存实时行情，注释说明)
- 第二次调用: from_cache=true (LRU 30s 命中)
- 404 测试: 不存在的 signal_id → {"detail":"信号 xxx 不存在或无 stock_code"} (HTTP 404)

### 5. 开关验证
- 改 monitor_rules.yaml enabled=false + POST /api/config/reload:
  * heatmap 返回 {enabled:false, items:[], total_stocks:0}
  * linkage 返回 {enabled:false, items:[], stock_code:""}
- 改回 true + reload:
  * heatmap 返回 enabled=true, items=10 (热加载真生效)
- ConfigLoader 按 alphabetical 加载 yaml, monitor_rules.yaml 在 app.yaml 之后加载, 故 monitor.* 配置统一放在 monitor_rules.yaml 避免被覆盖

### 6. Next.js 代理 (port 3000 带 XTransformPort=8000)
- /api/monitor/sector-heatmap?XTransformPort=8000 → 200, enabled=true, items=10
- /api/signals/{id}/related?XTransformPort=8000 → 200, enabled=true, items=7

### 7. agent-browser
- localhost:3000 实时大屏 tab → 滚动到底部 "概念热度 Top10" 卡片可见
  * 显示扫描 31/31 只, Top10 板块进度条 (绿色电力 8 只/储能 7 只/房地产开发 7 只/芯片 7 只/汽车电子 6 只...)
  * 概念板块 amber 色, 行业板块 emerald 色, 桌面端 2 列布局
  * 截图: r14-3-heatmap.png (121KB)
- 信号中心 tab → 信号行 "联动" 按钮可见 + 点击弹 Popover
  * Popover 显示 "同板块联动 韶能股份" + 7 个概念板块分组 (生物质能/充电桩/东数西算/储能/绿色电力/数据中心/新能源车)
  * 每板块含联动股列表 (code+name+pct Badge)
  * 截图: r14-3-linkage.png (154KB)
- console 无 error/exception (仅 HMR/Fast Refresh info 日志)

### 8. dev.log 末 30 行
- 全部 200 OK, 包含:
  * GET /api/monitor/sector-heatmap 200 (多次, 5-23ms)
  * GET /api/signals/{id}/related 200 (350ms 首次 + 78ms 缓存命中)
- 无任何 error/exception/traceback

## 设计要点
1. **双层缓存**: 后端 OrderedDict + threading.Lock LRU (B: 60s 单条, C: 30s 200 条 FIFO) + 前端 useRef 防同 session 重复请求
2. **开关热加载**: cfg.get("monitor.sector_heatmap.enabled") 实时读, 改 yaml + POST /api/config/reload 立即生效
3. **限流保护**: B 遍历受 R14-2 令牌桶保护 (Real 模式 qps=10), Mock 模式不限流; 整体 scan_timeout=30s 超时返回部分结果
4. **降级**: B 单股 get_relation 失败跳过; C 单板块 get_stock_list_in_sector 失败跳过; 信号不存在返回 404
5. **pct 字段**: EngineState 当前不缓存实时行情 (_quotes 字段不存在), C 端点 pct 一律返回 0.0, 注释说明, 前端按 0 渲染
6. **BlockType 归一化**: 模块级 _TYPE_MAP 中文→英文 (concept/industry/region/index/style/system/custom), 与 R14-1 stocks.py 保持一致, 不跨模块 import (复制一份)
7. **不破坏现有 8 tab + 健康卡片 + 限流卡片**: SectorHeatmap 只追加在 FlowRanking 下方, 不动其它卡片
8. **联动按钮三态**: linkageEnabled===true 显示按钮, ===false 隐藏, ===null (加载中) 不显示; 用 probe 信号 getRelated 一次确定开关状态
9. **配置位置**: monitor.sector_heatmap/sector_linkage 放在 monitor_rules.yaml 的 monitor 段下, 不放 app.yaml - 因 ConfigLoader 按 alphabetical 加载, monitor_rules.yaml 后于 app.yaml, 会覆盖 app.yaml 中的同名 key

## 未解决问题
1. **pct 字段全 0**: EngineState 未缓存实时行情, C 端点 pct 一律 0.0; 后续若 EngineState 加 _quotes 缓存可从 state 取最新 pct 补全
2. **联动按钮 probe 时机**: SignalCenter 首次加载信号列表后 probe 第一个有 stock_code 的信号 getRelated, 若该信号 404 (无 stock_code) 则视为 enabled=true (按钮显示), 网络超时则视为 false (按钮隐藏)
3. **监控池为空时 heatmap 显示空态**: total_stocks=0 时显示 "监控池为空，请先添加监控股票" EmptyState, 不是 bug
4. **scan_timeout 超时**: B 遍历监控池超 30s 时停止扫描, 返回部分结果 + warning 日志 (Mock 模式 31 只 380ms 远低于超时, Real 模式若监控池 100+ 只可能触发)
