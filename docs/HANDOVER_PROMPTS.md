# TdxQuant 项目交接提示词组

> **用途**:本文档提供 8 组可直接复制粘贴给 AI Agent 的场景化提示词。每个提示词自包含,复制后即可执行。
>
> **适用对象**:接手本项目的 AI Agent(Claude / GLM / GPT 等)或人类运维。
>
> **生成日期**:2026-06-21(R11 末)
> **配套文档**:`PROJECT_HANDOVER.md`(深度交接) · `QUICKSTART_10MIN.md`(快速上手) · `PROJECT_MAINTENANCE.md`(运维总纲) · `worklog.md`(开发全程记录)

---

## 项目一句话背景

TdxQuant 是基于通达信量化 API 的 A 股选股+实盘监控系统,**Python FastAPI(8000)+ Next.js 16(3000)+ DuckDB**,5 层架构,7 个前端 tab,11 轮迭代已交付。不换语言,不求高精度(MVP 级),能复用就不重写,每步验证,不破坏现有功能。

---

## 通用约束(所有提示词共享,接手 AI 必须遵守)

1. **不换语言**:Python(后端)+ TypeScript(前端),不允许换 Rust/Go 等
2. **MVP 级精度**:不求高精度,优先能跑通,复杂度后置
3. **复用优先**:用现有组件/工具/shadcn-ui,不重造轮子
4. **每步验证**:改一步验一步,不积压多步一起验
5. **不破坏现有**:smoke_test.sh 18/18 必须持续 PASS
6. **worklog 强制**:开工前读 `worklog.md` 末 5 段;收工后按模板 append 一段
7. **Task ID 规范**:`R<轮次>-<序号>`,如 `R13-1`,并行用 `R13-1a/R13-1b`
8. **质量门禁**:`bun run lint` exit 0 + `bash scripts/smoke_test.sh` 18/18 + agent-browser 截图验证

---

## 提示词 1:首次接手冷启动

**适用场景**:全新 AI 第一次接触本项目,需要快速理解现状并确认可运行。

```text
你是 TdxQuant 量化交易系统的接手维护者。请按以下步骤完成首次接手:

【第一步:读文档建立认知】(10 分钟)
1. 读 /home/z/my-project/worklog.md 的最后 250 行,了解 R9-R11 最近三轮进展
2. 读 /home/z/my-project/docs/PROJECT_HANDOVER.md 全文(接手必读)
3. 读 /home/z/my-project/docs/QUICKSTART_10MIN.md 全文(10 分钟上手)

【第二步:确认服务可运行】(5 分钟)
1. 检查 FastAPI: curl http://localhost:8000/api/monitor/status 应返回 200
2. 检查 Next.js: curl http://localhost:3000/ 应返回 200
3. 若服务未启动,执行: bash /home/z/my-project/scripts/start_all.sh
4. 跑冒烟测试: bash /home/z/my-project/scripts/smoke_test.sh 应 18/18 PASS

【第三步:agent-browser 可视化验证】(5 分钟)
1. 用 agent-browser 打开 http://localhost:3000/
2. 截图确认 7 个 tab 全可见:实时大屏/策略管理/选股结果/信号中心/板块管理/匹配策略/自选股
3. 切到"实时大屏"tab,确认"引擎健康度"卡片可见(状态徽章+6 指标+趋势图)
4. 检查 console 无 error

【第四步:回报】
回报内容:
- worklog 末段轮次号 + 最近一轮做了什么
- 服务状态(FastAPI/Next.js 是否 200)
- smoke_test 结果(PASS/FAIL 数)
- agent-browser 截图确认的 tab 数 + 健康度卡片是否可见
- 任何发现的异常或风险

【约束】
- 本轮只做"理解+验证",不改任何代码
- 若发现服务挂了或 smoke_test 失败,先尝试重启(start_all.sh),仍失败则回报问题不深挖
- 不要运行 bun run build
```

---

## 提示词 2:修 Bug

**适用场景**:发现 bug(报错/功能异常/测试失败),需要定位并修复。

```text
你是 TdxQuant 项目的 bug 修复者。任务:修复以下 bug。

【Bug 描述】
<在此粘贴 bug 现象:报错信息/复现步骤/预期 vs 实际>

【修复流程】
1. 读 /home/z/my-project/worklog.md 末 200 行,确认这个 bug 是否之前被记录过
2. 定位 bug:
   - 后端 bug:查 engine/ 目录相关文件,读 data/logs/fastapi.log 找堆栈
   - 前端 bug:查 src/components/quant/ 相关组件,用 agent-browser 看 console error
   - 配置 bug:查 config/*.yaml + engine/config/loader.py
3. 最小改动修复:只改 bug 相关代码,不顺手重构,不扩大改动范围
4. 验证修复(三步全过才算修完):
   a. bun run lint → exit 0
   b. bash scripts/smoke_test.sh → 18/18 PASS
   c. 用 agent-browser 复现原 bug 场景,确认已消失
5. 若 bug 涉及后端,改完重启 FastAPI:
   pkill -f uvicorn; sleep 1; nohup python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --log-level warning > data/logs/fastapi.log 2>&1 &

【worklog 追加】(append 到 /home/z/my-project/worklog.md 末尾)
---
Task ID: R<轮次>-bugfix-<bug简称>
Agent: <你的角色>
Task: 修复 <bug 一句话描述>

Work Log:
- 定位: <根因>
- 修复: <改了什么文件,改了什么>
- 验证: lint <exit码> / smoke_test <PASS数> / agent-browser <通过/失败>

Stage Summary:
- 文件变更: <清单>
- 根因: <一句话>
- 未解决问题: <无 或 遗留>

【约束】
- 不换语言,不改架构,不顺手重构
- 若 bug 无法在本轮修完(需大改),回报现状 + 建议下一轮处理,不要硬改
- 修完必须三步验证全过才能回报"已修复"
```

---

## 提示词 3:加新选股策略

**适用场景**:需要新增一个选股策略(含因子定义+权重+阈值)。

```text
你是 TdxQuant 项目的策略开发者。任务:新增一个选股策略。

【策略需求】
<在此描述:策略名称/选股逻辑/用哪些因子/权重/筛选阈值>

【开发流程】(参考 docs/STRATEGY_FACTOR_EXTENSION.md 详版)
1. 读 /home/z/my-project/strategies/strategy__template.yaml 理解策略 YAML 结构
2. 读 /home/z/my-project/strategies/strategy_rzq.yaml(弱转强策略)作为参考案例
3. 创建新策略文件: /home/z/my-project/strategies/strategy_<新策略id>.yaml
   必填字段:strategy_id / strategy_name / strategy_emoji / version / enabled / sector_code / description / factors(每个含 factor_id+weight) / cleaning_rules
4. 若需要新因子(现有因子不够):
   a. 读 /home/z/my-project/engine/factors/registry.py 理解因子注册机制
   b. 读 /home/z/my-project/engine/factors/base.py 理解 Base 类契约
   c. 在 engine/factors/ 下新建 <因子名>.py,实现 calc 方法
   d. 在 registry.py 注册新因子
5. 验证策略:
   - curl -X POST http://localhost:8000/api/strategies/<新策略id>/run 应返回 200 + 选出股票
   - 前端切到"策略管理"tab,确认新策略出现在列表
   - 前端切到"选股结果"tab,确认有新策略的选股结果
6. bun run lint → exit 0
7. bash scripts/smoke_test.sh → 18/18 PASS(确认没破坏其他)

【worklog 追加】
---
Task ID: R<轮次>-newstrategy-<策略id>
Agent: full-stack-developer(或 general-purpose)
Task: 新增选股策略 <策略名>

Work Log:
- 读模板 + 参考案例
- 创建 strategy_<id>.yaml(字段清单)
- [若加新因子] 创建 engine/factors/<名>.py + 注册
- 验证: run 返回 <数> 只 / 前端可见 / lint 0 / smoke 18/18

Stage Summary:
- 新增文件: strategies/strategy_<id>.yaml [ + engine/factors/<名>.py ]
- 策略逻辑: <一句话>
- 选股结果: <运行后选出 N 只>
- 未解决问题: <无 或 因子数据源待补等>

【约束】
- 策略 YAML 字段必须和 _template.yaml 对齐,不能少字段
- 新因子必须继承 Base,不能绕过 registry 直接调用
- 不要改现有 5 个策略的策略逻辑(阈值/公式),只加新的
```

---

## 提示词 4:加新预警规则 + 匹配策略

**适用场景**:监控层需要新增一种预警(如"放量突破""MACD 金叉"),并装配到匹配策略。

```text
你是 TdxQuant 项目的监控规则开发者。任务:新增预警规则 + 装配到匹配策略。

【预警需求】
<在此描述:预警名称/触发条件表达式/用哪些行情字段/默认阈值/优先级/推哪些通道>

【开发流程】(三层模型:alert_templates → match_strategies → MonitorEngine)
1. 读 /home/z/my-project/config/monitor_rules.yaml 的 alert_templates 段,理解模板结构
   每个模板字段:alert_type / label / emoji / condition(simpleeval 表达式) / default_params / priority / channels
2. 读 /home/z/my-project/engine/expression/evaluator.py 理解 condition 表达式求值机制
3. 在 alert_templates 段追加新模板:
   - alert_type: <新预警id,如 volume_breakout>
   - label / emoji(显示用)
   - condition: <simpleeval 表达式,如 pct_change > pct_threshold and volume_ratio > vol_threshold>
   - default_params: <参数默认值,如 {pct_threshold: 0.03, vol_threshold: 2.0}>
   - priority: high/medium/low
   - channels: [websocket, feishu, ...]
4. 读 /home/z/my-project/config/match_strategies.yaml 理解匹配策略装配结构
5. 在 match_strategies 段追加新 match(或编辑现有 match 加这个 alert):
   - match_id / name / strategy_id(绑定哪个选股策略)/ enabled / scope(markets+排ST+排除码)/ alerts(引用上面的 alert_type + 可覆盖 params)/ debounce_override
6. 热加载:
   curl -X POST http://localhost:8000/api/config/reload
   curl -X POST http://localhost:8000/api/monitor/match-strategies/reload
7. 测试新预警:
   curl -X POST http://localhost:8000/api/monitor/match-strategies/<match_id>/test \
     -H "Content-Type: application/json" \
     -d '{"code":"600519","pct_change":0.05,"volume_ratio":2.5}'
   应返回命中的 alert_type 列表
8. 前端验证:切到"匹配策略"tab,确认新 match 出现 + 点"测试"能命中
9. bun run lint → exit 0 / bash scripts/smoke_test.sh → 18/18 PASS

【worklog 追加】
---
Task ID: R<轮次>-newalert-<预警id>
Agent: general-purpose
Task: 新增预警规则 <预警名> + 装配到匹配策略

Work Log:
- 读 alert_templates 结构 + evaluator 机制
- monitor_rules.yaml 加模板: alert_type=<id>, condition=<表达式>
- match_strategies.yaml 加 match: <match_id>
- 热加载 + test 端点验证命中
- 前端"匹配策略"tab 确认可见 + 测试通过

Stage Summary:
- 修改文件: config/monitor_rules.yaml + config/match_strategies.yaml
- 新预警: <alert_type> / condition=<表达式> / 默认阈值=<params>
- test 命中: <返回的 alert 列表>
- 未解决问题: <无 或 实盘行情字段名待确认等>

【约束】
- condition 表达式用 simpleeval 语法,字段名必须和行情快照一致(参考现有模板)
- 不要改现有 14 个 alert_templates 的 condition,只加新的
- match_strategies 的 _default 兜底套餐不允许删除(三重保护:前端 disabled+后端 403+toast)
- default_params 是默认值,match 的 alerts.params 可覆盖(优先级高)
```

---

## 提示词 5:加新推送通道

**适用场景**:需要新增一个推送通道(如钉钉、企业微信、邮件)。

```text
你是 TdxQuant 项目的通道开发者。任务:新增一个推送通道。

【通道需求】
<在此描述:通道名称/类型(webhook/email/...)/接收方/消息格式/是否需要鉴权>

【开发流程】
1. 读 /home/z/my-project/engine/channels/registry.py 理解通道注册机制
2. 读 /home/z/my-project/engine/channels/base.py 理解 BaseChannel 契约
3. 读 /home/z/my-project/engine/channels/ 下现有通道(如 feishu.py / websocket.py)作为参考
4. 创建新通道文件: /home/z/my-project/engine/channels/<通道名>.py
   - 继承 BaseChannel
   - 实现 send(payload) 方法(含重试/错误处理)
   - 在 __init__ 注册到 ChannelRegistry
5. 读 /home/z/my-project/config/channels.yaml,追加新通道配置:
   - type / enabled / endpoint(webhook url) / 鉴权字段 / msg_type
6. 热加载通道配置(R10-3 起支持):
   curl -X POST http://localhost:8000/api/config/reload
   (会自动重载 ChannelRegistry,无需重启)
7. 测试通道:
   curl -X POST http://localhost:8000/api/channels/<通道名>/test
   应返回发送成功/失败
8. 前端验证:点右上角"设置"按钮,确认新通道出现在通道列表 + 可测试
9. bun run lint → exit 0 / bash scripts/smoke_test.sh → 18/18 PASS

【worklog 追加】
---
Task ID: R<轮次>-newchannel-<通道名>
Agent: general-purpose
Task: 新增推送通道 <通道名>

Work Log:
- 读 base.py + registry + 现有通道参考
- 创建 engine/channels/<名>.py(send 实现 + 重试 + 错误处理)
- channels.yaml 加配置
- 热加载 + test 端点验证
- 前端设置弹窗确认可见

Stage Summary:
- 新增文件: engine/channels/<名>.py
- 修改文件: config/channels.yaml
- 通道类型: <webhook/email/...>
- test 结果: <成功/失败 + 响应>
- 未解决问题: <无 或 鉴权密钥待配等>

【约束】
- 必须继承 BaseChannel,不能绕过 registry
- send 方法必须 catch 异常(不能让一个通道挂了影响其他通道)
- webhook 类通道至少重试 2 次,间隔 1s
- 不要在客户端(src/)直接调用 z-ai-web-dev-sdk,只走后端 API
```

---

## 提示词 6:前端加新 Tab 或组件

**适用场景**:前端需要新增一个功能 tab 或在现有 tab 加组件。

```text
你是 TdxQuant 项目的前端开发者。任务:<加新 tab / 在现有 tab 加组件>。

【需求】
<在此描述:新 tab 名称/功能/调哪些 API/展示什么数据/交互>

【开发流程】
1. 读 /home/z/my-project/src/app/page.tsx 理解 tab 注册结构(TABS 数组 + 条件渲染)
2. 读 /home/z/my-project/src/lib/api.ts 理解 API 客户端结构(fetchAPI + 各 xxxAPI 模块)
3. 读 /home/z/my-project/src/lib/api-proxy.ts 理解前端代理转发机制(Next.js route → FastAPI)
4. 若需要新 API 端点:
   a. 后端先加:engine/api/routes/<模块>.py 加 @router 路由
   b. 前端代理:src/app/api/<模块>/route.ts 加转发(forwardFastAPI / relayJSON)
   c. 前端客户端:src/lib/api.ts 加 DTO 接口 + API 方法
5. 创建组件: /home/z/my-project/src/components/quant/<组件名>.tsx
   - 'use client' 指令
   - 用 shadcn/ui 组件(Card/Dialog/Table/Badge/Button 等),不重造轮子
   - 响应式:移动端优先,用 sm:/md:/lg: 前缀
   - 暗色主题友好(用 bg-card/border/text-muted-foreground token,不用硬编码颜色)
   - 长列表用 ScrollArea + max-h-96 + tabular-nums
6. 若加新 tab:在 page.tsx 的 TABS 数组追加,TabsList 的 grid-cols 调整,main 追加条件渲染
7. 验证:
   - bun run lint → exit 0
   - bash scripts/smoke_test.sh → 18/18 PASS
   - agent-browser 打开 http://localhost:3000/,JS 点击新 tab:
     agent-browser eval "document.querySelectorAll('[role=tab]')[<索引>].click(); 'ok'"
   - 截图确认组件渲染正常 + 无 console error

【worklog 追加】
---
Task ID: R<轮次>-fe-<组件名>
Agent: full-stack-developer
Task: 前端 <加新tab/加组件> <名称>

Work Log:
- 读 page.tsx + api.ts + api-proxy.ts
- [若新API] 后端路由 + 前端代理 + 客户端方法
- 创建 src/components/quant/<名>.tsx(<行数>行)
- [若新tab] page.tsx TABS 追加 + 条件渲染
- 验证: lint 0 / smoke 18/18 / agent-browser 截图通过

Stage Summary:
- 新增文件: src/components/quant/<名>.tsx [ + 代理路由 + API 方法]
- 修改文件: src/app/page.tsx [ + src/lib/api.ts]
- 组件功能: <一句话>
- 响应式: <移动端/桌面端表现>
- 未解决问题: <无 或 待优化点>

【约束】
- 只用 shadcn/ui 现有组件,不引入新 UI 库
- 不用 indigo/blue 颜色(除非用户指定)
- footer 必须 sticky 底部(min-h-screen flex flex-col + mt-auto)
- z-ai-web-dev-sdk 只能在后端用,前端不直接 import
- API 请求用相对路径 /api/...,跨端口用 ?XTransformPort=<port>
```

---

## 提示词 7:Windows 生产部署

**适用场景**:把项目部署到真实 Windows 服务器(生产环境)。

```text
你是 TdxQuant 项目的部署工程师。任务:部署到 Windows 生产服务器。

【部署流程】(参考 docs/PROJECT_HANDOVER.md 第三章 + docs/QUICKSTART_10MIN.md 第二章)

【前置准备】
1. 确认 Windows 服务器已装:Python 3.11+ / Node.js 20+ / bun / Git
2. 确认通达信 tqcenter 已安装并登录(Real 模式数据源)
3. 确认项目代码已 clone 到 Windows(含 docs/ + engine/ + src/ + config/ + strategies/)

【路径替换】(关键!沙箱路径 → Windows 路径)
1. 读 /home/z/my-project/docs/PATH_REPLACEMENT_GUIDE.md
2. 在 Windows 项目根目录运行:
   powershell -ExecutionPolicy Bypass -File scripts\replace-paths.ps1
   (会把所有硬编码的 /home/z/my-project/ 替换为 Windows 实际路径)

【配置切换:Mock → Real】
1. 编辑 config/app.yaml:
   - data_adapter.type: mock → real
   - data_adapter.tdx_paths 改为 Windows 实际通达信路径
2. 编辑 config/monitor_rules.yaml:
   - trading_hours.mock_force_open: true → false(Real 模式严格交易时段)

【启动】
1. 打开 PowerShell,cd 到项目根目录
2. 运行: .\scripts\start_all.ps1
   (会自动探测 python/python3/py + 启动 FastAPI + Next.js + 跑 smoke_test.ps1)
3. 等待输出 "FastAPI ready" + "Next.js ready" + smoke_test 18/18 PASS

【开机自启】(可选,用 nssm)
1. 下载 nssm: https://nssm.cc/download
2. 注册 FastAPI 服务:
   nssm install TdxQuant-Engine "C:\Python311\python.exe" "-m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000"
   nssm set TdxQuant-Engine AppDirectory "C:\TdxQuant"
   nssm start TdxQuant-Engine
3. 注册 Next.js 服务(类似)
4. 设为开机自启:sc config TdxQuant-Engine start= auto

【验证】
1. curl http://localhost:8000/api/monitor/health → status=healthy
2. curl http://localhost:3000/ → 200
3. agent-browser 打开 http://localhost:3000/,7 tab 全可见
4. 切"实时大屏",确认行情在动(Real 模式交易时段)

【worklog 追加】
---
Task ID: R<轮次>-win-deploy
Agent: general-purpose
Task: Windows 生产部署

Work Log:
- 路径替换: replace-paths.ps1 执行结果
- 配置切换: app.yaml mock→real / trading_hours
- 启动: start_all.ps1 输出
- [若配] nssm 服务注册: TdxQuant-Engine / TdxQuant-Web
- 验证: health / 首页 / 7 tab / 行情推送

Stage Summary:
- 部署环境: Windows <版本> / Python <版本> / Node <版本>
- 路径替换: <替换了多少处>
- 服务状态: FastAPI <200/down> / Next.js <200/down>
- 健康度: status=<healthy/...> / lag=<秒>
- smoke_test: <PASS数>/18
- 未解决问题: <无 或 真实行情字段待对齐等>

【约束】
- 不要在 Windows 用 WSL2(跨启动不好维护),纯 Windows 原生 + nssm
- Real 模式 trading_hours 严格 09:25-11:30/13:00-15:00,非交易时段不预警
- 若真实行情字段名和 Mock 不一致,改 data_adapter/real_adapter.py 做字段映射,不改业务层
- 部署后第一时间验 health 端点,确认 status=healthy 才算成功
```

---

## 提示词 8:日常巡检 + 自主开发(15 分钟定时任务)

**适用场景**:系统稳定运行期的日常巡检 + 自主推进新需求(对应已配置的 15 分钟 webDevReview 定时任务)。

```text
请先判断当前项目状态,使用 agent-browser 进行必要测试和 QA,然后自主选择本轮最合适的工作重点(修 bug 或提出新需求)并继续开发。

要求:
1. 开始任务的时候需要查看之前的 /home/z/my-project/worklog.md 了解实际的项目进展,并且拆解当前详细的todo
2. 先判断当前项目状态,使用 agent-browser 进行必要测试和 QA(使用 agent-browser 进行网页自动化操作,运行 agent-browser --help 查看所有可用命令),如果存在 bug、报错、测试失败、构建失败、运行错误或明确 QA 问题,优先修复。
3. 如果当前阶段相对稳定,则自主根据任务描述必须提出更多可做的新需求,继续推进合理的下一步开发任务。
4. 样式要越做细节越多!!
5. 功能要越做越多!!
6. 工作告一段落后更新或创建交接文档 /home/z/my-project/worklog.md(工作期间也建议及时进行更新,避免进度丢失),方便下一阶段继续开发。
7. 项目结束后一定要把工作记录写在 /home/z/my-project/worklog.md 里。

建议在交接文档 /home/z/my-project/worklog.md 中包含三部分:
- 项目当前状态描述/判断
- 当前目标/已完成的修改/验证结果
- 未解决问题或风险,建议下一阶段优先事项

项目背景:TdxQuant 量化交易系统,Python FastAPI(8000) + Next.js 16(3000),7 个 tab(实时大屏/策略管理/选股结果/信号中心/板块管理/匹配策略/自选股),已完成监控引擎+匹配策略层+健康度监控+聚合推送。启动服务用 bash scripts/start_all.sh,停止用 bash scripts/stop.sh。FastAPI 单独启动: python -m uvicorn engine.api.main:app --host 0.0.0.0 --port 8000 --log-level warning。

【自主开发候选方向】(若当前稳定,从以下选一个推进)
- 健康度历史持久化(DuckDB 新表 engine_health_snapshots,1 分钟采样)
- 健康度阈值配置页(前端"系统设置"tab)
- 聚合推送效果统计面板(今日聚合次数/节省推送数)
- 信号中心加"按策略/按通道"筛选 + 信号导出 CSV
- 自选股批量导出 + 批量激活/停用
- 匹配策略 alerts 的 alert_type 改下拉(从 monitor_rules 拉模板列表)
- 真实 Windows 环境验证 ps1 脚本(若沙箱支持)

【约束】
- 每轮只推进 1-2 个方向,不贪多
- 改完必须三步验证:lint 0 + smoke 18/18 + agent-browser 截图
- worklog 必须追加(append 模式,不覆盖)
- Task ID 用 R<下一轮次>-<序号>
```

---

## 使用说明

### 如何使用这组提示词

1. **确定场景**:根据要做的任务,选对应提示词(1-8)
2. **复制提示词**:整段复制到 AI 对话框
3. **填充需求**:把 `<在此描述...>` 占位符替换为具体需求
4. **执行**:AI 会按提示词流程执行,产出 worklog 记录
5. **验证**:检查 AI 回报的 lint / smoke_test / agent-browser 结果

### 提示词组合建议

| 场景 | 推荐组合 |
|------|----------|
| 全新接手 | 提示词 1(冷启动)→ 稳定后提示词 8(日常) |
| 加完整监控能力 | 提示词 3(新策略)+ 提示词 4(新预警)+ 提示词 5(新通道) |
| 上线生产 | 提示词 7(Windows 部署)→ 提示词 8(日常巡检) |
| 紧急修 bug | 提示词 2(修 bug)单用 |

### 提示词维护

- 每轮重大架构变更后,更新本文档对应提示词
- 版本标记和 PROJECT_HANDOVER.md / QUICKSTART_10MIN.md 保持一致
- 新增场景时追加到末尾,不插中间

---

**文档版本**:R11 末(2026-06-21)
**下次更新**:R12 重大交付后
