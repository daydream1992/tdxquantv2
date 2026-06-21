# R14-1 个股板块归属查询（方案 A）

**任务 ID**: R14-1  
**Agent**: full-stack-developer  
**任务**: 个股板块归属查询 - 后端 GET /api/stocks/{code}/sectors + Next.js 代理 + WatchlistManager HoverCard

## 文件变更清单

### 新增
- `engine/api/routes/stocks.py` (~250 行) - 后端板块归属查询路由 + LRU 缓存 + Pydantic schemas
- `src/app/api/stocks/[code]/sectors/route.ts` (24 行) - Next.js 动态路由代理

### 修改
- `engine/api/main.py` (+2 行) - import stocks_routes + 注册 `app.include_router(stocks_routes.router, prefix="/api/stocks")`
- `src/lib/api.ts` (+26 行) - StockSectorItemDTO/StockSectorsDTO 接口 + `stockAPI.getSectors()` 方法
- `src/components/quant/WatchlistManager.tsx` (+125 行) - HoverCard 组件导入 + StockSectorHover + SectorGroup 子组件 + TableCell 替换

## 后端实现要点

### 端点签名
```python
GET /api/stocks/{code}/sectors
→ StockSectorsResponse {
    stock_code: str,
    concept: [StockSectorItem],
    industry: [StockSectorItem],
    region: [StockSectorItem],
    other: [StockSectorItem],
    total: int,
    from_cache: bool,
    fetched_at: str (ISO-8601 UTC)
  }
```

### BlockType 中文 → 英文枚举映射
```python
_TYPE_MAP = {
    "概念": "concept", "行业": "industry", "地区": "region",
    "指数": "index", "风格": "style",
    "系统定义": "system", "自定义": "custom",
}
```
- index/style/system/custom 全部归入 `other` 分组
- 未知 BlockType: lowercase 后塞 `other`

### 缓存策略
- 模块级 LRU `OrderedDict` + `threading.Lock()` 互斥
- key=归一化后 code，TTL=60s，容量上限 1000
- 命中时 `model_copy(update={"from_cache": True})` 返回副本，不污染原对象
- 命中后 `move_to_end` 维护 LRU 顺序；过期主动淘汰；容量超限 FIFO 弹出

### 错误处理
- `normalize()` 抛 `ValueError` → 422 `{"detail": "非法代码: xxx"}`
- `adapter.get_relation()` 抛异常 → 502 `{"detail": "查询板块归属失败: xxx"}`
- 空结果 → 200，所有分组列表为空，total=0

### 简化决策
未调 `get_stock_list('18')` 翻译行业名。原因：
1. Mock 模式 `BlockName` 已是中文名（"酿酒"/"白酒"/"煤炭" 等）
2. Real 模式 `BlockName` 同样是名字
3. 减少不必要的适配器调用

## 前端实现要点

### Next.js 代理
`src/app/api/stocks/[code]/sectors/route.ts` 模仿 `by-sector/[sector_code]/route.ts` 模板：
- `params: Promise<{ code: string }>` (Next.js 16 异步动态参数)
- `forwardFastAPI(`/api/stocks/${encodeURIComponent(code)}/sectors`)` + `relayJSON`
- 422 透传 detail → error 字段（前端 `fetchAPI` 可读）

### `stockAPI` namespace
```typescript
export const stockAPI = {
  getSectors: (code: string) =>
    fetchAPI<StockSectorsDTO>(`/api/stocks/${encodeURIComponent(code)}/sectors`),
}
```

### StockSectorHover 组件
- `HoverCard` (Radix) - hover 即触发，不打断用户操作流
- `HoverCardTrigger asChild` 包裹 `<span>` (cursor-help + 虚线下划线)
- `HoverCardContent side="right" align="start" w-80` 显示三组 Badge 列表
- `useRef<Record<string, StockSectorsDTO>>` 缓存已加载 code，避免同一只股反复 hover 重复请求
- `onOpenChange(open=true)` 触发拉取；缓存命中直接用
- 加载中: Loader2 spin + "加载板块归属..."
- 失败: AlertCircle + 错误信息
- 成功: 三组 SectorGroup (概念/行业/地区) + 底部 "共 N 个板块" + (from_cache ? "缓存命中" : "")
- 空组显示 "无"

## 验证结果

### bun run lint: exit 0 ✓

### FastAPI 端点 curl 验证

1. **600519.SH** (茅台) → 200, 43 个板块:
   - concept=2 (通达信88, 白酒概念)
   - industry=1 (酿酒)
   - region=1 (贵州板块)
   - other=39 (style + index 类)
   - `from_cache: false` (首次)

2. **INVALID** → 422 `{"detail":"非法代码: INVALID"}`

3. **600519.SH 第二次请求** → `from_cache: true` (后端 LRU 命中)

4. **000001.SH** (上证综指, 不在 CSV) → 200, total=0, 各分组全空

5. **600000.SH** (浦发银行) → 200, 25 个板块

### Next.js 代理验证

- `GET /api/stocks/600519.SH/sectors?XTransformPort=8000` → 200, 返回相同数据 (含 `from_cache: true`)
- `GET /api/stocks/INVALID/sectors?XTransformPort=8000` → 422 `{"detail":"非法代码: INVALID","error":"非法代码: INVALID"}` (relayJSON 把 detail → error 字段)

### agent-browser 验证

- 打开 http://localhost:3000/
- 8 tab 全可见: 实时大屏/策略管理/选股结果/信号中心/板块管理/匹配策略/自选股/竞价监控
- 切到第 7 个 tab "自选股", 监控池表格 31 行
- `document.querySelectorAll('[data-slot=hover-card-trigger]').length` = 31 (每行都有)
- hover 第一行 (000001.SZ):
  * `data-state="open"` 确认 hover card 打开
  * 内容: "000001.SZ · 板块归属 / 概念: 跨境支付CIPS / 行业: 全国性银行 / 地区: 深圳板块 / 共 33 个板块"
  * 截图: `/home/z/my-project/agent-ctx/r14-1-sector-hover.png` (80KB)
- console.error 监听 3s: **0 errors**
- FastAPI log: `GET /api/stocks/000001.SZ/sectors HTTP/1.1" 200 OK`

### 8 tab 完整性

切换到自选股 tab 后, 8 个 tab 仍全部可见可点击:
```
["实时大屏","策略管理","选股结果","信号中心","板块管理","匹配策略","自选股","竞价监控"]
```

## 设计要点

1. **HoverCard vs Popover**: 选 HoverCard - hover 即触发，不打断用户操作流；Popover 需点击切换状态，会打断阅读
2. **useRef 缓存 vs useState**: 用 useRef 而非 useState 缓存，因为缓存数据不需要触发重渲染，避免不必要的 render 开销
3. **后端 LRU + 前端 useRef 双层缓存**: 后端 60s TTL 防同一只股多次 hover 重复调适配器；前端 useRef 防同 session 重复请求后端
4. **`from_cache` badge 显示逻辑**: 仅当后端 LRU 命中 (例如页面刷新后 60s 内再次 hover) 时显示 "缓存命中"；useRef 命中不会触发后端请求所以不显示 badge，符合任务规范"from_cache 控制"
5. **`model_copy(update={...})`**: 返回缓存副本而非原对象，避免 Pydantic 不可变约束被破坏
6. **OrderedDict + Lock**: 简单可靠的线程安全 LRU 实现，无需引入第三方库
7. **未识别 BlockType fallback**: lowercase 后归 `other` 分组，保证未来通达信新增 BlockType 不会报错
8. **`type_raw` 字段保留中文**: 前端如需展示原始类型可读取，调试也更方便

## 未解决问题

1. **缓存命中 badge 仅在页面刷新 60s 内显示**: 因 useRef 缓存命中后不调后端，`from_cache` 始终是 false。如希望"任何缓存命中都显示"，需在前端 useRef 命中时手动设置 `from_cache=true` 显示。当前实现严格遵守"from_cache 由后端控制"语义。
2. **000001.SH (上证综指) 返回空**: 它是指数代码, 在 stock_block_relation.csv 中确实没有归属板块记录, 这是数据特性而非 bug
3. **HoverCard 在快速移动鼠标时可能闪烁**: openDelay=250ms 已尽量减少误触发, 但仍可能在快速扫过表格时短暂打开
4. **未测试 Real 模式**: 当前为 Mock 模式验证, Real 模式下 tqcenter.get_relation() 字段名 (BlockCode/BlockName/BlockType/GPNume) 应一致, 但需真实环境验证

## 截图路径

`/home/z/my-project/agent-ctx/r14-1-sector-hover.png` (80KB, hover card 显示 000001.SZ 板块归属)

## FastAPI 状态

进程仍在运行 (PID 11584, uptime 270s+), 监听 :8000, 健康检查正常。
