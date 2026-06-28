# 变更日志 (CHANGELOG)

> 项目阶段性变更记录。完整历史见 `worklog.md` + `worklog-archive-R5-R13.md.gz`。
> 每轮迭代 append 新条目到本文件顶部。

---

## R21 — QuestDB 9.x 实盘真机验证 + 11 修复 (2026-06-24)

### 背景
按 `AI_HANDOVER.md §五` 切 Real 模式，实测暴露 R18 迁移（DuckDB→QuestDB）与 RealAdapter 集成
**从未在真机验证**的问题。修复后 real 模式端到端打通：`POST /api/strategies/dbqzt/run` 全市场
5535 只 → **24 只选股结果真实落库 QuestDB**（~5–6 分钟）。

### QuestDB 9.x 方言兼容性（6 类，集中兜底）
- `/exec` 只接受 GET（9.x 砍 POST）→ `_http_exec` 改 GET
- 占位符 `$1` → psycopg2 风格 `%s`（`_convert_sql`）
- `CURRENT_DATE`/`CURRENT_TIMESTAMP` 不识别 → 归一为 `timestamp_floor('d',now())`/`now()`
- **不支持 `DELETE FROM`** → 4 处改 `UPDATE active=false` 软删除
- designated timestamp 列 INSERT 必填 → `selection_results` 导出补 `created_at`
- 长时选股连接闲置断开 → `_exec_retry` 重连重试

### RealAdapter / pipeline 集成
- 新增 `RealAdapter.get_market_snapshot_all()`（逐只 `get_more_info` 拼接）+ 3 别名（原缺失→选股无数据）
- `get_market_data` `count<=0` 兜底 250（原传 -1→无界拉 K 线→选股 hang）
- `run_strategy` endpoint 改 `asyncio.to_thread`（原同步阻塞事件循环→选股时服务器全卡死）

### 工具链
- `scripts/dev.py` Windows `_stop_services` 改按端口杀 + 尊重 `--no-fastapi`/`--no-next`

### 修改文件
`engine/storage/questdb_store.py` · `engine/data_adapter/real_adapter.py` ·
`engine/api/routes/{watchlist,strategies}.py` · `engine/pipeline/runner.py` ·
`engine/monitor/engine.py` · `engine/exporters/duckdb_exporter.py` · `scripts/dev.py` ·
`config/app.yaml`

### 新增文档
| 文件 | 用途 |
|---|---|
| `docs/QUESTDB9_REALMODE_FIXES.md` | R21 实战经验：9.x 方言清单 + 11 修复 + 维护 SOP + 经验教训 |

详见 `worklog.md` Task ID `R21-QuestDB9-RealMode-Fixes`。

---

## R18 — QuestDB 替代 DuckDB (2026-06-23)

### Breaking Change

**存储层迁移**: DuckDB (单文件嵌入式) → QuestDB (服务端时序数据库)。彻底解决多 FastAPI 实例并发写报 `database is locked` 的长期痛点。

### 新增文件

| 文件 | 用途 |
|---|---|
| `engine/storage/questdb_store.py` | QuestDBStore 类 (PG wire + HTTP 双通道, 接口与 DuckDBStore 完全一致) |
| `config/questdb_schema.sql` | QuestDB 方言 schema (8 张表, SYMBOL 类型, designated timestamp) |
| `docker/questdb/docker-compose.yml` | QuestDB Docker 启动模板 (PG wire 8812 / HTTP 9000 / ILP 9009) |
| `docker/questdb/questdb.conf` | QuestDB 自定义配置 (可选, 挂载到容器) |
| `docker/questdb/questdb-data/.gitignore` | 数据目录占位 (实际数据 gitignore) |

### 修改文件

| 文件 | 改动 |
|---|---|
| `engine/config/schema.py` | 新增 `QuestDBConfig` dataclass (host/pg_port/http_port/username/password/database/...) |
| `engine/storage/__init__.py` | 导出 `QuestDBStore` + `DuckDBStore` (别名) + `get_store` |
| `engine/storage/duckdb_store.py` | 重写为薄包装, `DuckDBStore = QuestDBStore` 兼容别名 |
| `config/app.yaml` | 新增 `questdb` 段 (host=127.0.0.1, pg_port=8812, http_port=9000, auto_init=true) |
| `requirements.txt` | 新增 `psycopg2-binary>=2.9` / `requests>=2.28` / `questdb-py-client>=0.0.5` |
| `scripts/init_db.py` | docstring 改为 QuestDB; 沙箱无 QuestDB 时优雅降级; JSON 输出加 `available` 字段 |
| `scripts/precheck.py` | 新增 `check_questdb()` (PG wire 端口可达性); `check_duckdb_file()` 改为检查 `questdb_schema.sql` 存在; `check_python_deps()` 加 psycopg2/requests |
| `config/app.windows.example.yaml` | 新增 `questdb` 段 (Windows 默认值) |
| `.env.example` | 新增 6 个 `QUESTDB_*` 环境变量 |
| `WINDOWS_README.md` | DuckDB→QuestDB 全替换; 新增「QuestDB 安装与启动」章节; FAQ 加 4 个 QuestDB 专项问答 |
| `docs/DEPLOY.md` | 新增「QuestDB 数据库」章节; Linux/Windows/沙箱三环境步骤更新 |
| `docs/maintenance/ARCHITECTURE.md` | 存储层描述更新为 QuestDB; 新增「§14 R18 QuestDB 迁移」演进章节 |
| `docs/MAINTENANCE.md` | 新增「§六 QuestDB 运维」(备份/恢复/监控/性能调优/重置); 新增「文件锁问题根治」对比表 |
| `docs/USER_GUIDE.md` | 数据存储章节更新为 QuestDB; FAQ 加 Q16 (R18 数据存储变化); 术语表加 QuestDB/DuckDB 条目 |

### 核心设计

1. **接口零改动迁移**: `DuckDBStore` 名字保留为 `QuestDBStore` 别名, 所有旧代码 `from engine.storage.duckdb_store import DuckDBStore` 仍可用
2. **SQL 方言适配** (QuestDBStore 内部完成):
   - `?` 占位符 → `$1, $2, ...` (PG wire 风格)
   - `SEQUENCE + nextval()` → 应用层 `_gen_id()` 生成 LONG ID
   - `UNIQUE INDEX` → 应用层 UPSERT (DELETE WHERE + INSERT)
   - `information_schema.tables` → `SELECT table_name FROM tables()`
3. **优雅降级**: 沙箱/mock 模式无 QuestDB 时, `_connect()` 失败仅记 WARNING, 不抛异常; mock 模式不依赖 DB 仍可运行
4. **环境变量覆盖**: `QUESTDB_HOST` / `QUESTDB_PG_PORT` / `QUESTDB_HTTP_PORT` / `QUESTDB_USERNAME` / `QUESTDB_PASSWORD` / `QUESTDB_DATABASE` (优先级 > config/app.yaml)
5. **三通道访问**:
   - PG wire (8812): psycopg2 连接, 查询/写入
   - HTTP (9000): DDL / Web 控制台 / /exec 端点
   - ILP (9009): InfluxDB line protocol, 批量写入 (可选, 高性能场景)

### 验证

- `python3 -m py_compile scripts/init_db.py scripts/precheck.py` 全过
- `python3 scripts/precheck.py --json` 13 项检查全执行 (沙箱: 6 PASS / 2 FAIL / 5 WARN, 符合预期)
- `python3 -c "import yaml; yaml.safe_load(open('config/app.windows.example.yaml'))"` YAML 合法
- QuestDB schema (`config/questdb_schema.sql`) 8 张表 DDL 完整

### 未解决问题

1. Real 模式实际可用性仍依赖 Windows + tqcenter + 通达信终端登录, sandbox 无法验证 QuestDB 实际写入性能
2. 旧 DuckDB 数据文件 (`data/duckdb/quant.db`) 不会自动迁移到 QuestDB, 需手动 SQL 导出/导入 (见 MAINTENANCE.md §6.2 备份方式 B)
3. R5-R13 archived worklog 仍提及 DuckDB, 历史记录不回改

### 升级指南 (从 R17 → R18)

1. `pip install -r requirements.txt` (装 psycopg2-binary / requests)
2. 启动 QuestDB: `docker compose -f docker/questdb/docker-compose.yml up -d`
3. 验证连接: `python scripts/precheck.py` 应看到 `[PASS] QuestDB 连接`
4. 重启 FastAPI: `python scripts/dev.py stop && python scripts/dev.py start`
5. (可选) 旧 DuckDB 数据迁移: 用 `python -c "import duckdb; con = duckdb.connect('data/duckdb/quant.db'); print(con.execute('SELECT * FROM selection_results LIMIT 10').fetchdf())"` 导出 CSV, 再用 QuestDB Web 控制台 `/exec` 端点 `COPY` 导入

---

## R17 — 数据接口字段配置 (说明书核对) (2026-06-22)

- 解压 upload/通达信量化平台说明书.7z → docs/tongdaxin-api-docs/ (49 篇 markdown)
- 新建 `engine/data_adapter/tqcenter_fields.py` (29 API 字段权威目录 + V8 快照 91 字段映射)
- `real_adapter.py` 修 9 处 bug (参数名/签名错误, R17 之前必崩)
- `engine/config/schema.py` TqCenterConfig 加 `fields` dict 字段
- `config/app.yaml` tqcenter 段加 `fields` 子段 (5 个字段配置键 + 15 个常用 FN)

详见 `worklog.md` Task ID `R17-数据接口字段配置(说明书核对)`。

---

## R14 — 实时选股 + 形态预警 (2026-06-21)

### R14-1 实时选股

- 新建 5 个文件: `src/components/quant/realtime/` + `RealtimeSelection.tsx`
- 定时器 → runAll → list({limit:200}) → 与 prevScoreMap 对比 → 推入 stream + 更新 board
- Tab 数: 8 → 9 (新增"实时选股")
- 后端零改动, 复用 strategyAPI.runAll + selectionAPI.list

### R14-2 形态预警

- 后端改动 1 个文件: `engine/monitor/rules.py` (RuleSet.snap_to_variables 扩展 6 个变量)
- 配置改动 1 个文件: `config/monitor.yaml` (7 类形态预警套餐)
- 7 类形态: 接近前高回落 / 下跌枯竭 / 准备反弹 / 开盘诱空 / 开盘诱多 / 盘中无量诱多 / 盘中急跌真跌

### R14-3 限流 + 板块热度

- 三层限流 (R12 已实施): 令牌桶 + 端点中间件 + 监控统计
- 板块热度 + 同板块联动开关 (config/monitor.yaml 的 monitor 段)

详见 `worklog.md` Task ID `R14-实时选股` / `R14-形态预警`。

---

## R13 — 文档瘦身 + 6 巨型组件拆分 (2026-06-20)

### R13-1 文档瘦身

- 文档 64 个文件 / 16142 行 → 8 个文件 / ~3500 行 (-78%)
- worklog 13008 行 → ~200 行 + 归档 (-98%)
- 删除 51 个通达信官方文档 / agent-ctx 63 个 QA 截图 / tool-results 中间产物

### R13-2 6 巨型组件拆分

- 6 个 1000+ 行容器 → 6 个 <100 行容器 + 20+ 子组件 (每个 <500 行) + shared.ts
- 拆分: MatchStrategyManager / SignalCenter / WatchlistManager / BacktestView / StrategyManager / GlobalSearch

### R13-3 脚本统一 + 配置合并

- 18 个 .sh/.ps1 双版本 → 8 个文件 (新建 `scripts/dev.py` Python 跨平台 7 子命令)
- `monitor_rules.yaml` + `match_strategies.yaml` → `monitor.yaml` (4 段 326 行)
- 删 Prisma 死代码 (src/lib/db.ts + src/lib/mock-data.ts + prisma/ 目录)

详见 `worklog.md` Task ID `R13-精简-*`。

---

## R12 — 三层限流 (2026-06-15)

- Layer 1: 令牌桶 (`engine/data_adapter/rate_limiter.py`) — tqcenter 调用守卫, real_adapter 20 个查询方法加 `acquire_or_skip()`
- Layer 2: 端点中间件 (`engine/api/middleware/rate_limit.py`) — 7 条规则, 超限返回 429 + Retry-After
- Layer 3: 监控统计 (`engine/api/state.py`) — GET /api/monitor/health 透出 api_stats + rate_limit

---

## R5-R11 — 早期迭代 (已归档)

详见 `worklog-archive-R5-R13.md.gz` (238KB, 13008 行)。

核心里程碑:
- R5: 项目脚手架 + 5 层架构 + 5 策略 + 26 因子
- R7: 资金流向三列 + 信号详情抽屉
- R11: monitor_subscriptions UNIQUE 约束 + DuckDB schema 优化
- R12: 三层限流方案

---

**变更日志结束** · 最新变更见 `worklog.md`。
