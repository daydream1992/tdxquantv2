# Task R11-1: Dashboard 引擎健康度卡片

**Agent**: full-stack-developer
**Task**: 在 Dashboard 加引擎健康度卡片(状态徽章+6指标+趋势图+自动刷新)

## 前置阅读

- worklog.md 最后 200 行确认 R10-5 已就绪后端 `GET /api/monitor/health` + 前端 `monitorAPI.getHealth()`
- R11-4 段确认后端响应新增 `thresholds` 字段(lag_healthy_seconds/lag_degraded_seconds/error_healthy_threshold),前端接口缺该字段
- Dashboard.tsx 已有 EngineHealthCard 引入与渲染, 但 EngineHealthDTO 接口未含 thresholds 可选字段

## Work Log

1. **环境准备**: 启动 FastAPI 监控守护脚本(sandbox 下 bash 会话结束时会被回收, 用 `setsid -f bash -c 'while true; do uvicorn ...; sleep 3; done'` 启动, 父进程变为 init/1, 与 bun dev 同模式)
   - 验证 `GET /api/monitor/health` 返回 `thresholds: {lag_healthy_seconds: 60, lag_degraded_seconds: 120, error_healthy_threshold: 10}` + `status: healthy`
   - 验证 Next.js 代理 `GET /api/monitor?action=health` 透传成功

2. **修改 src/lib/api.ts (EngineHealthDTO 接口)**:
   - 在接口末尾加 `thresholds?: {lag_healthy_seconds: number; lag_degraded_seconds: number; error_healthy_threshold: number}` 可选字段
   - 注释说明: R11-1 后端透出当前生效阈值, P2-2 后端可热加载, 缺省时前端用 60/120/10 兜底

3. **修改 src/components/quant/EngineHealthCard.tsx (使用 thresholds)**:
   - 卡片本身已存在(状态徽章 + 6 指标 + SVG 趋势图 + 自动刷新 + 手动刷新按钮), 本轮只需:
     - 把 `lagHigh = lag > 60` 硬编码改为 `lag > (health?.thresholds?.lag_healthy_seconds ?? 60)` (后端热加载阈值后, 红色判定也跟随)
     - 新增 `lagDegradedThreshold` / `errHealthyThreshold` 变量, 用于脚注展示
     - 卡片底部新增一行阈值脚注(仅当 `health.thresholds` 存在时显示):
       `阈值 · lag<60s 正常 / <120s 降级 · err>10 异常`
       - 文字 text-[10px] text-muted-foreground/70 tabular-nums truncate, 不抢主信息焦点
       - 便于操作者看到当前生效阈值, 配合 P2-2 热加载验证调参效果

4. **lint**: `bun run lint` exit_code 0 (eslint . 无错误无警告)

5. **agent-browser 截图验证**:
   - 桌面 1280x800 全页截图: `agent-ctx/r11-1-health-desktop.png` (389KB)
   - 桌面 1280x800 顶部截图(只含 4 StatCard + 健康度卡片): `r11-1-health-desktop-top.png` (174KB)
   - 移动 375x720 全页截图: `r11-1-health-mobile.png` (338KB)
   - 移动 375x720 顶部截图: `r11-1-health-mobile-top.png` (74KB)
   - snapshot -c 验证可见元素:
     - "引擎健康度" 标题 ✓
     - "运行正常" 状态徽章(healthy, 绿色) ✓
     - "手动刷新引擎健康度" button ✓
     - image "行情延迟最近 30 次采样" (SVG 趋势图) ✓
     - 6 指标全在: 订阅状态/行情延迟/求值次数/错误次数/去重队列/运行时长 ✓
     - 阈值脚注: "阈值 · lag<60s 正常 / <120s 降级 · err>10 异常" ✓
   - 移动端 375px snapshot 同样显示 6 指标 grid 2 列布局 + 阈值脚注, 无破版
   - 实时数据更新: eval_count 从 3072 → 3776 (1 分钟内), uptime 从 4m51s → 5m56s, 自动刷新生效
   - 浏览器 console 无 error, 只有 Fast Refresh/HMR log
   - 浏览器 errors 命令空(无未捕获异常)

## Stage Summary

### 文件变更

修改 (2 个):
- `src/lib/api.ts`: EngineHealthDTO 接口加 `thresholds?` 可选字段(3 子字段: lag_healthy_seconds / lag_degraded_seconds / error_healthy_threshold)
- `src/components/quant/EngineHealthCard.tsx`:
  - lagHigh 红色阈值改用 `health.thresholds.lag_healthy_seconds` (缺省 60)
  - 新增 lagDegradedThreshold / errHealthyThreshold 局部变量
  - 卡片底部新增阈值脚注(条件渲染, thresholds 存在时显示)

### 验证结果

- **bun run lint**: exit_code 0 ✓
- **FastAPI /api/monitor/health**: 200 OK, status=healthy, thresholds={60,120,10}
- **Next.js proxy /api/monitor?action=health**: 透传成功, 返回完整 EngineHealthDTO 含 thresholds
- **agent-browser 桌面截图**: 健康度卡片可见, 状态徽章(运行正常/绿) + 6 指标 grid + SVG 趋势图 + 阈值脚注全部渲染
- **agent-browser 移动截图(375px)**: 卡片不破版, 指标 grid 2 列, 阈值脚注 truncate 不溢出
- **console errors**: 无, 仅 Fast Refresh/HMR log

### 设计要点

1. **thresholds 设计为可选**: 旧后端(无 P2-2)不返回该字段时, 前端用 60/120/10 兜底, 兼容性好
2. **lagHigh 用动态阈值**: 后端热加载阈值后(lag_healthy_seconds 改 0.001 等), 前端红色判定立即跟随, 不需要前端发版
3. **阈值脚注条件渲染**: 只在后端透出 thresholds 时显示, 既给操作者调参依据, 又不污染旧版视图
4. **守护脚本保 FastAPI**: sandbox 内 bash 会话结束时子进程会被回收, 用 `setsid -f + while true 重启` 模式启动 uvicorn, 父进程变 init/1, 与 bun dev 同生命周期
5. **趋势图 ref + renderTick**: lagHistoryRef.current 是同一引用, 单独 useMemo 不会重算, 用 renderTick useState 触发重算, 避免 lag history 频繁 setState 引起整卡重渲染

### 未解决问题

1. 健康度阈值脚注当前只读, 没有"调参入口"——若要可编辑需新增 PUT /api/monitor/health/thresholds 端点 + 表单 UI, 留给下轮
2. 趋势图目前 30 点采样(5s 间隔 = 2.5 分钟窗口), 长窗口(如 1h)需要更长时间运行才能填满, 可考虑加采样数选择器
3. FastAPI 在 sandbox 内必须靠 while-true 守护脚本保活(直接 setsid 也会被回收), 这是 sandbox 特性, 生产环境用 systemd 即可
4. errCount 标红仍用 `>0`(硬编码), 没用 errHealthyThreshold——spec 明确要求 `>0 标红`, 故未改; 若后续要"达到阈值才标红"可切换
