# TdxQuant 量化交易系统

> 基于通达信 TdxQuant API 的 A 股量化交易系统：选股 + 实时监控 + 信号预警 + 回测验证。

[![lint](https://img.shields.io/badge/lint-passing-green)]() [![Next.js](https://img.shields.io/badge/Next.js-16-black)]() [![Python](https://img.shields.io/badge/Python-3.13-blue)]() [![License](https://img.shields.io/badge/license-MIT-gray)]()

---

## ✨ 核心能力

| 模块 | 能力 |
|---|---|
| **选股** | 5 大策略（打板求涨停 / 趋势主升浪 / 错杀低吸 / 弱转强 / 强转弱反抽）+ 26 个因子 |
| **监控** | 实时行情订阅 + 10 类预警规则 + 14 个信号模板 + 同板块联动 |
| **预警** | 4 通道（飞书 / Webhook / WebSocket / 站内通知）+ 防抖聚合 |
| **回测** | 历史数据回测 + 净值曲线 + 回撤分析 + 多策略对比 |
| **导出** | CSV / Excel / 板块文件 / DuckDB 4 种导出器 |
| **限流** | 三层保护（tqcenter 令牌桶 + API 中间件 + 监控统计）|

---

## 🏗 技术栈

- **前端**：Next.js 16 + React 19 + TypeScript 5 + Tailwind 4 + shadcn/ui + Zustand + TanStack Query
- **后端**：FastAPI + DuckDB + PyYAML + simpleeval（表达式引擎）
- **数据源**：tqcenter（生产）/ Mock CSV（开发）— 插件式切换，业务层零改动
- **实时**：WebSocket（前端 30s 轮询兜底）

---

## 🚀 快速开始

### 环境要求
- Python 3.13+ / Node.js 18+ / bun
- 通达信金融终端（仅生产环境需要）

### 一键启动

```bash
# 1. 装依赖
pip install -r requirements.txt
bun install

# 2. 初始化数据库
python scripts/init_db.py

# 3. 启动双服务（FastAPI:8000 + Next.js:3000）
python scripts/dev.py start
# 或兼容旧用法: bash scripts/start_all.sh
```

打开 `http://localhost:3000` 即可访问。

### 切换数据源

编辑 `config/app.yaml`：
```yaml
app:
  adapter_mode: mock    # 开发模式（CSV 样本数据）
  # adapter_mode: real   # 生产模式（通达信 tqcenter）
```
改完**必须重启**（适配器模式不支持热加载）。

---

## 📁 项目结构

```
tdxquant/
├── engine/                  # Python 后端
│   ├── api/                 #   FastAPI 路由（40+ 端点）+ 中间件（限流）
│   ├── pipeline/            #   选股流水线（6 步：load→clean→factors→score→filter→export）
│   ├── monitor/             #   监控引擎（subscribe_hq 回调 + 10s 轮询兜底）
│   ├── factors/             #   26 个因子插件
│   ├── channels/            #   4 个预警通道插件
│   ├── data_adapter/        #   数据源适配器（BaseDataAdapter + Mock/Real + 限流器）
│   ├── exporters/           #   4 种导出器
│   ├── storage/             #   DuckDB 存储封装
│   ├── config/              #   配置加载（YAML 热加载）
│   ├── expression/          #   表达式引擎（simpleeval 封装）
│   ├── sector/              #   板块映射
│   └── utils/               #   工具函数
├── src/                     # Next.js 前端
│   ├── app/                 #   5 Tab 页面 + 37 API 代理路由
│   ├── components/quant/    #   25 量化组件
│   ├── components/ui/       #   48 shadcn/ui 组件
│   └── lib/                 #   api-proxy + api + utils + theme + useRealtime
├── config/                  # 7 个 YAML 配置（app/monitor/channels/cleaning/sector/export/theme）
├── strategies/              # 5 个策略 YAML
├── scripts/                 # 8 个运维脚本（dev.py 主入口）
├── data/                    # DuckDB + CSV 样本 + Excel 导出
└── docs/                    # 6 份精简文档
```

---

## 📖 文档导航

| 文档 | 用途 |
|---|---|
| [ARCHITECTURE.md](maintenance/ARCHITECTURE.md) | 5 层架构 + 目录详解 + 设计哲学（改代码前必读）|
| [USER_GUIDE.md](USER_GUIDE.md) | 用户手册（5 Tab 功能说明）|
| [MAINTENANCE.md](MAINTENANCE.md) | 运维手册 + 8 场景交接提示词 + 限流方案 |
| [DEPLOY.md](DEPLOY.md) | 部署指南（Windows/Linux + 沙箱）|
| [STRATEGY_FACTOR.md](STRATEGY_FACTOR.md) | 策略/因子开发指南 |
| [CHANGELOG.md](CHANGELOG.md) | 变更日志（R5-R13）|

---

## 🔧 常用命令

```bash
python scripts/dev.py start    # 启动双服务
python scripts/dev.py stop     # 停止
python scripts/dev.py setup    # 环境初始化
python scripts/dev.py reload   # 热加载配置
python scripts/dev.py test     # 冒烟测试 + lint
python scripts/dev.py paths --env windows  # 路径替换（Windows 部署）
python scripts/dev.py daemon   # 守护进程模式

bun run lint                   # ESLint 检查
bun run dev                    # 单独启动前端
```

---

## 🔄 数据流

```
用户点"执行选股"
  → POST /api/strategies/{id}/run
  → StrategyRunner.run_strategy()
  → Pipeline 6 步执行（load_data → clean → factors → score → filter_sort → export）
  → 结果写 DuckDB selection_results 表
  → 自动订阅 Top 20 到 MonitorEngine
  → MonitorEngine 后台线程（subscribe_hq 回调 or 10s 轮询）
  → on_quote → RuleSet 求值 → 命中规则 → 写 signal_events
  → 4 通道推送（飞书/Webhook/WS/站内）
  → 前端 SignalCenter 30s 轮询展示
```

---

## ⚠️ 重要约束

1. **适配器模式不支持热加载** — 改 `adapter_mode` 必须重启 FastAPI
2. **改 engine/ 已稳定代码前先读 worklog.md** — 避免重复踩坑
3. **DuckDB 单写锁** — 不要开多个 FastAPI 实例（会 `database is locked`）
4. **限流中间件 fail-open** — 中间件异常会放行，不会误杀请求
5. **Mock 模式不限流** — 限流守卫只在 Real 模式触发

---

## 📝 维护原则

- **变与不变分离**：阈值/开关 → YAML；策略/因子 → 插件；流程 → 引擎
- **配置驱动**：绝不硬编码业务参数到代码
- **插件式架构**：加因子/通道/数据源只需加文件，不改引擎
- **worklog 必填**：每次改动 append 到 `worklog.md`，这是项目规范

---

## 📜 License

MIT
