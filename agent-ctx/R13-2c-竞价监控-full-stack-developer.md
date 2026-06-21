# R13-2c 竞价监控面板

## Task
新增 AuctionPanel.tsx 作为第 8 个 tab"竞价监控",展示竞价强弱排行,支持 9:15-9:25 轮询。

## 前置条件
- 后端 GET /api/monitor/auction 已就绪 (R13-2a+2b 已完成)
- 评分公式: surge(40) + zt_flag(20) + vol_ratio(30) + l2(10) = 100

## 实现

### 文件变更
1. **新增** `src/lib/api.ts` (+33 行):
   - AuctionItemDTO 类型 (含 score_detail)
   - AuctionResponseDTO 类型
   - monitorAPI.getAuction(codes?, count=50)

2. **新增** `src/app/api/monitor/auction/route.ts` (24 行):
   - GET 透传到 FastAPI /api/monitor/auction?count=&codes=
   - 降级返回 {items: [], count: 0, in_auction_hours: false}

3. **新增** `src/components/quant/AuctionPanel.tsx` (~440 行):
   - 顶部状态条: Gavel 图标 + 竞价状态 Badge + 股票数 + 自动刷新 Switch + 手动刷新 + 自定义代码
   - 左主区: 排行表 (8 列) + 评分进度条 + 行点击展开评分明细
   - 右侧: Top5 强弱榜 + 评分公式图例
   - 轮询: in_auction_hours=true 时 3s, false 时 30s, Switch 关闭不轮询

4. **修改** `src/app/page.tsx` (+3 行):
   - import Gavel + AuctionPanel
   - TABS 追加 { value: 'auction', label: '竞价监控', icon: Gavel }
   - TabsList grid-cols-7 → grid-cols-8
   - main 追加条件渲染

## 验证
- bun run lint: exit 0
- agent-browser:
  * tab 数: 8 (确认 [role=tab] length = 8)
  * 排行表行数: 31 (默认 count=50)
  * 自动刷新: 关掉 delta=0, 打开 5s delta=3 (3s 轮询)
  * 自定义代码: 输入 600519.SH → 1 行
  * 行展开: 4 段评分进度条 + 9 个原始字段
  * console 无 error
- 截图: /home/z/my-project/agent-ctx/r13-2c-auction-panel.png

## 后端依赖
- FastAPI 已用 setsid 双 fork 守护 (port 8000)
- Mock 模式下 in_auction_hours 强制 true (沙箱友好)
