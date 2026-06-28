# QuestDB 9.x 与 Real 模式实盘接入修复（R21）

> 暴露的 bug 清单（R21 记录 11 个，R22 追加 Bug 12）；QuestDB 9.x 方言兼容性权威清单；后续维护 SOP 与经验教训。
>
> **适用场景**：升级 QuestDB / 改存储层 / 排查 real 模式故障 / 新 AI 接手时必读。
> **配套文档**：`AI_HANDOVER.md`（总览）、`worklog.md`（R21 详细工作日志）、
> `config/questdb_schema.sql`（8 表 schema）。

---

## 目录

1. [背景：为什么会有这批修复](#一背景为什么会有这批修复)
2. [QuestDB 9.x 方言兼容性权威清单（最重要）](#二questdb-9x-方言兼容性权威清单最重要)
3. [Real 模式数据架构与固有成本](#三real-模式数据架构与固有成本)
4. [11 个修复逐条详解](#四11-个修复逐条详解)
5. [后续维护 SOP](#五后续维护-sop)
6. [故障排查（R21 更新版）](#六故障排查r21-更新版)
7. [经验教训](#七经验教训)

---

## 一、背景：为什么会有这批修复

按 `AI_HANDOVER.md §五` 的"6 步流程"切 Real 模式，理论上 30 分钟搞定，实际一跑暴露 **11 个 bug**。根因是两个"从未验证"：

1. **R18 的 DuckDB→QuestDB 迁移从未在真实 QuestDB 上跑过**
   存储层代码按 **PostgreSQL 方言**写（`?`→`$1`、`CURRENT_DATE`、`DELETE FROM`、`POST /exec`），
   但 QuestDB 有自己的方言，且 9.x 砍掉了若干 8.x 行为。`AI_HANDOVER.md §13.1` 自己也承认
   "Real 模式实际写入性能未在沙箱验证"。

2. **RealAdapter 与选股 pipeline 的数据接线从未完成**
   `load_data` 找的批量快照方法 RealAdapter 没实现；`get_market_data` 的 `count=-1` 直接传给
   tqcenter 导致无界拉取；选股在 async endpoint 里同步执行阻塞事件循环。

> **一句话**：Mock 模式（沙箱 CSV）能跑通，是因为 Mock 不依赖真实 QuestDB、不走 tqcenter；
> 一旦切 Real，所有未验证的代码路径同时暴露。

**修复后实测**：`POST /api/strategies/dbqzt/run` → 全市场 5535 只 → **24 只真实选股结果落库
QuestDB**，耗时 ~5–6 分钟，服务器全程不卡。

---

## 二、QuestDB 9.x 方言兼容性权威清单（最重要）

> 本节是**最可复用的知识**。任何改 `engine/storage/questdb_store.py` 或写 SQL 的人先读这里。
> 版本基准：QuestDB **9.4.3**（2026-06）。8.x 行为不同处已标注。

### 2.1 不支持 / 行为不同（踩坑表）

| # | PG / DuckDB 写法 | QuestDB 9.x 实际行为 | 正确写法 |
|---|---|---|---|
| 1 | `POST /exec`（body 带 query） | **405 Method Not Allowed**（9.x 砍掉 POST） | `GET /exec?query=...`（8.x 两种都支持，统一用 GET） |
| 2 | `$1, $2` 占位符 + psycopg2 params | `undefined bind variable: 0` | **`%s`** 占位符（psycopg2 自动转 wire bind） |
| 3 | `CURRENT_DATE` | `Invalid column: CURRENT_DATE` | `timestamp_floor('d', now())`（今天零点 TIMESTAMP） |
| 4 | `CURRENT_TIMESTAMP` | `Invalid column: CURRENT_TIMESTAMP` | `now()` |
| 5 | `WHERE ts >= today()` | `Invalid date`（DATE 与 TIMESTAMP 比较失败） | `WHERE ts >= timestamp_floor('d', now())` 或 `ts >= now()` |
| 6 | `DELETE FROM t WHERE ...` | `unexpected token [FROM]`（**完全不支持 DELETE**） | `UPDATE ... SET active=false` 软删除（append-only） |
| 7 | `UPDATE t SET ... WHERE ...` | ✅ 支持 | （直接用） |
| 8 | INSERT 不填 designated timestamp 列 | `insert statement must populate timestamp` | 每条 INSERT **必须显式给** timestamp 列赋值 |
| 9 | `SEQUENCE` / `AUTOINCREMENT` | 不支持 | 应用层 `_gen_id()` 生成 LONG |
| 10 | `UNIQUE` 约束 | 不支持 | 应用层 UPSERT（注意 UPSERT 原用 DELETE，9.x 需改 UPDATE） |
| 11 | `DEFAULT CURRENT_TIMESTAMP` | 不支持 | 应用层填值 |

### 2.2 designated timestamp 列（INSERT 必填）

下列表的 designated timestamp 列，**每次 INSERT 都必须显式赋值**，否则报
`insert statement must populate timestamp`：

| 表 | designated timestamp 列 |
|---|---|
| `selection_results` | `created_at` |
| `signal_events` | `triggered_at` |
| `sector_snapshots` | `snapshot_at` |
| `monitor_subscriptions` | `subscribed_at` |
| `config_changes` | `changed_at` |
| `kline_cache` | `cached_at` |
| `strategies` / `strategy_runs` | 无（非时序表，无此约束） |

> R21 修复前，`duckdb_exporter` 写 `selection_results` 时漏了 `created_at` → 选股算出 24 只
> 但 0 行落库。**新增任何写时序表的代码，先对照本表确认 timestamp 列已赋值。**

### 2.3 项目内的集中兜底（已实现，勿重复造轮子）

- **占位符 + 方言归一**：`engine/storage/questdb_store.py::_convert_sql()`
  一次性把 `?`→`%s`、`CURRENT_DATE`→`timestamp_floor('d', now())`、`CURRENT_TIMESTAMP`→`now()`。
  **所有走 `execute/fetchone/query` 的 SQL 自动受益，不要在业务代码里手改这些函数名。**
- **DDL 走 GET**：`_http_exec()` 用 `requests.get(url, params={"query": sql})`。
- **重连重试**：`_exec_retry()` 连接断开自动重连重试一次。

---

## 三、Real 模式数据架构与固有成本

```
选股请求 (POST /api/strategies/{id}/run, 已 asyncio.to_thread 不阻塞事件循环)
  → StrategyRunner.run_strategy
  → load_data:
      ├─ get_stock_list()          → 5535 只 (瞬时)
      ├─ get_market_snapshot_all() → 逐只 get_more_info (88 字段, 0.01s/只)
      │                              ⚠ 受 global_qps=10 令牌桶限流 → ~5–9 分钟
      └─ get_market_data()         → K 线 (count 兜底 250，否则无界 hang)
  → clean → calc_factors → score → filter_sort
  → export → selection_results (QuestDB INSERT，必带 created_at)
```

### 固有成本（非 bug）

- **全市场选股 ~5–9 分钟**：`get_more_info` 逐只取（tqcenter 无批量快照接口），令牌桶
  `qps=10 / burst=20`（`config/app.yaml` 的 `tqcenter.global_qps`）保护通达信终端 GUI 线程。
  **不要为提速盲目调高 qps**，会导致终端卡死/掉线。
- **append-only 无法物理删行**：退订 / 订阅清理用 `UPDATE active=false` 软删除，归档行累积但
  所有订阅查询按 `WHERE active=true` 过滤，不影响业务。

---

## 四、11 个修复逐条详解

> 每条：**症状 → 根因 → 修复 → 文件**。验证方法见 [§五.5](#五5-回归验证清单)。

### Bug 1 — `/exec` 用 POST → 9.x 返 405，8 张表建不出来
- **症状**：`QuestDB HTTP /exec 失败: 405 Method Not Allowed`，`init_db` 全失败。
- **根因**：`_http_exec` 用 `requests.post`；9.x 的 `/exec` 只接受 GET。
- **修复**：`requests.get(url, params={"query": sql})`。
- **文件**：`engine/storage/questdb_store.py::_http_exec`

### Bug 2 — 占位符 `$1` → `undefined bind variable: 0`
- **症状**：所有参数化查询报 `undefined bind variable: 0`。
- **根因**：`_convert_sql` 把 `?`→`$1`（PG 原生占位符），但 psycopg2 需 `%s` 自行 bind。
- **修复**：`_convert_sql` 改产 `%s`。
- **文件**：`engine/storage/questdb_store.py::_convert_sql`

### Bug 3 — `CURRENT_DATE` / `CURRENT_TIMESTAMP` 不识别
- **症状**：`Invalid column: CURRENT_DATE`（状态接口的今日信号统计全挂）。
- **根因**：QuestDB 不识别这两个 PG 标准函数。
- **修复**：`_convert_sql` 加方言归一（`CURRENT_DATE`→`timestamp_floor('d', now())`，
  `CURRENT_TIMESTAMP`→`now()`），集中处理，零调用方改动。
- **文件**：`engine/storage/questdb_store.py::_convert_sql`

### Bug 4 — QuestDB 不支持 `DELETE FROM`
- **症状**：`unexpected token [FROM]`（退订 / 订阅去重 / 每日清理全挂）。
- **根因**：QuestDB append-only，无 DELETE。
- **修复**：4 处 `monitor_subscriptions` 的 DELETE → `UPDATE active=false, unsubscribed_at=now()`
  软删除；`monitor/engine.py` 的每日物理清理改 no-op（归档行已被 `active=true` 过滤隔离）。
- **文件**：`engine/api/routes/watchlist.py`、`engine/pipeline/runner.py`、`engine/monitor/engine.py`

### Bug 5 — 长时选股连接闲置断开
- **症状**：选股跑几分钟，后续查询连续 `connection already closed`。
- **根因**：psycopg2 连接闲置被 QuestDB / 网络关闭，store 无重连。
- **修复**：新增 `_exec_retry()`（连接级错误自动 `_connect()` 重连重试一次），`execute/executemany
  /query/fetchone/fetchall` 全部走它。
- **文件**：`engine/storage/questdb_store.py`

### Bug 6 — RealAdapter 缺批量快照方法 → 选股拿不到数据
- **症状**：`adapter 无可用批量快照接口，返回空 DataFrame`，选股结果永远空。
- **根因**：`load_data._load_snapshot` 找 `get_snapshot_batch` 等方法，RealAdapter 只实现了
  逐只的 `get_more_info`，没批量方法（Mock 有）。
- **修复**：RealAdapter 新增 `get_market_snapshot_all()`（逐只 `get_more_info` 拼接 DataFrame，
  补 `code` 列）+ 3 个别名（`get_snapshot_batch`/`get_all_snapshots`/`get_snapshot`）。
- **文件**：`engine/data_adapter/real_adapter.py`

### Bug 7 — `get_market_data(count=-1)` 无界拉 K 线 → 选股 hang
- **症状**：选股卡死不返回（>20 分钟），CPU 低迷。
- **根因**：策略 YAML 无 `data.kline_count` → 默认 -1 → 直接传 `tq.get_market_data(count=-1)`
  → 无界拉取全部历史 K 线。
- **修复**：`get_market_data` 在 `count<=0` 时兜底 250（约 1 年日线，覆盖动量/突破类因子窗口）。
- **文件**：`engine/data_adapter/real_adapter.py::get_market_data`
- **建议**：后续在各 `strategies/*.yaml` 显式配 `data.kline_count`，更可控。

### Bug 8 — Windows `dev.py stop` 漏杀旧进程 → 重启失败
- **症状**：`dev.py start` 报"Both ready"但实际旧进程还在跑（端口被占），新进程起不来。
- **根因**：原 Windows 分支用 PowerShell 匹配 `commandline + 项目根路径`，但 uvicorn/bun
  命令行**不含**项目根（`K:\tdxquantv2`）→ 漏杀。
- **修复**：改按监听端口杀（`netstat -ano` 找 PID → `taskkill /F`），与 Linux `lsof` 同思路。
- **文件**：`scripts/dev.py::_stop_services`（Windows分支）

### Bug 9 — 同步 `run_strategy` 阻塞事件循环 → 选股时服务器全卡死
- **症状**：选股期间 `/health` 返回 HTTP 000（事件循环被占）。
- **根因**：`async def run_strategy` 里同步调 `runner.run_strategy()`（real 模式 ~5 分钟）。
- **修复**：`await asyncio.to_thread(runner.run_strategy, ...)`（`run_all` 路径同改）。
- **文件**：`engine/api/routes/strategies.py`

### Bug 10 — `selection_results` 导出漏 `created_at` → 结果 0 行落库
- **症状**：API 返回 `count=24`，但 `selection_results` 表 0 行。
- **根因**：`duckdb_exporter` 构造的记录 dict 不含 `created_at`，QuestDB 要求 designated
  timestamp 列必须显式赋值。
- **修复**：记录补 `"created_at": datetime.now()`。
- **文件**：`engine/exporters/duckdb_exporter.py`
- **排查技巧**：API 的 `count` 来自内存 `len(ctx.final)`，与落库是两步；**落库失败只看
  `fastapi.log` 的 `ExporterError`**，别被 `count>0` 误导。

### Bug 11 — `_stop_services` 不尊重 `--no-fastapi`/`--no-next`
- **症状**：`dev.py start --no-next` 把在跑的 Next.js 也杀了（stop 无条件杀双端口）。
- **根因**：`_stop_services()` 不接收 flag。
- **修复**：加 `keep_fastapi`/`keep_next` 参数，`cmd_start` 传 `args.no_fastapi`/`args.no_next`。
- **文件**：`scripts/dev.py`

### Bug 12（R22, 2026-06-24）— `send_user_block` 参数名 `stocks`→`stock_list`，板块回写静默失败
- **症状**：选股流水线 `ExportStep` 跑完，`sector_snapshots` 表写了快照、Web 板块管理页
  也显示正确 `stock_count`，**但通达信客户端自定义板块成分股没变**（`tq.get_stock_list_in_sector`
  返回的还是旧成员）。
- **根因**：`RealAdapter.send_user_block` 用了 `tq.send_user_block(block_code=..., stocks=codes)`，
  但**实测 tqcenter 真实签名是 `send_user_block(block_code, stock_list, show=False)`**——参数名是
  `stock_list` 不是 `stocks`。报 `unexpected keyword argument 'stocks'`。
  代码注释抄了说明书的 `stocks`，但说明书与当前通达信版本对不上（同 [[Bug 清单]] 通病：
  说明书字段/参数名 ≠ 真实 API）。
- **二次根因（更隐蔽）**：`send_user_block` 失败只 `logger.error` 返回 False，`SectorManager.update_stocks`
  返回 False，`SectorExporter` 抛 `ExporterError` 但被 `ExportStep` 的 try/except 吞成 warning——
  **快照已先写、推送后失败，造成"引擎以为成功、客户端没动"的假象**。
- **修复**：`real_adapter.send_user_block` 改 `stock_list=codes`。**排查时必须直接读 tqcenter
  核实**（`tq.get_stock_list_in_sector`），不能只信引擎 API / `sector_snapshots`。
- **文件**：`engine/data_adapter/real_adapter.py`
- **教训**：任何"写通达信客户端"的副作用（板块/预警/消息），验证必须绕过引擎直接问终端，
  不能只看引擎自己的快照表——引擎快照在推送前就已落库。

---

## 五、后续维护 SOP

### 五.1 启动 QuestDB（原生方式，不依赖 Docker）

> Docker Hub 在国内常不可达，推荐原生二进制。一次性安装后长期可用。

```bash
# 1. 下载（GitHub 可达）：解压到 K:\questdb\
#    https://github.com/questdb/questdb/releases (questdb-*-rt-windows-x86-64.tar.gz，-rt 自带 JRE)

# 2. 启动（前台后台均可；install 需管理员，java 直跑无需管理员）
cd /k/questdb/bin
./java.exe -m io.questdb/io.questdb.ServerMain -d 'K:\questdb\bin\qdbroot'
# 监听 9000(HTTP) / 8812(PG wire) / 9009(ILP)；数据在 qdbroot/db

# 3. 验证
curl "http://127.0.0.1:9000/exec?query=SELECT%201"   # 应返回 JSON
```

- `questdb.exe install` 报错 1783 → 需管理员；非管理员用上面的 `java -m` 方式。
- **长期运行**建议管理员权限 `questdb.exe install`（注册 Windows 服务，开机自启）。

### 五.2 启动 / 重启应用

```bash
python scripts/dev.py start          # 启 FastAPI(8000) + Next.js(3000)
python scripts/dev.py start --no-next      # 仅重启 FastAPI（保留 Next.js）
python scripts/dev.py start --no-fastapi   # 仅重启 Next.js（保留 FastAPI）
python scripts/dev.py stop           # 停双服务
python scripts/dev.py restart        # 改 adapter_mode 后用（不支持热加载）
```

> R21 后 stop 按**端口**精准杀 + 尊重 `--no-*` flag，`--no-next`/`--no-fastapi` 不会再误杀另一半。

### 五.3 切换 Mock ↔ Real

```yaml
# config/app.yaml
app:
  adapter_mode: real      # mock | real（改完必须重启，不支持热加载）
tqcenter:
  python_path: "K:\\txdlianghua\\PYPlugins\\user"   # real 必填（留空可自动扫描）
```

### 五.4 日常验证（3 条命令确认健康）

```bash
# 1. 引擎状态（注意是 /api/monitor/status，不是文档旧写的 ?action=status）
curl -s http://127.0.0.1:8000/api/monitor/status | python -m json.tool
#   期望 adapter_mode=real, engine_status=running

# 2. QuestDB 建表 + 数据
curl -s "http://127.0.0.1:9000/exec?query=SELECT%20count(*)%20FROM%20selection_results"

# 3. 跑一次选股（real 约 5–6 分钟）
curl -X POST http://127.0.0.1:8000/api/strategies/dbqzt/run
```

### 五.5 回归验证清单（改存储层 / 升级 QuestDB 后必跑）

```bash
# A. 方言探针（确认 9.x 兼容性未被破坏）
probe() { curl -s "http://127.0.0.1:9000/exec" -G --data-urlencode "query=$1" | head -c 120; echo; }
probe "SELECT CURRENT_DATE"             # 期望 FAIL（确认仍未支持，兜底生效）
probe "DELETE FROM strategies WHERE 1=0" # 期望 FAIL（确认仍无 DELETE）
probe "SELECT now()"                     # 期望 OK
probe "SELECT timestamp_floor('d', now())"  # 期望 OK

# B. 存储读写往返（参数化 + 方言 + 重连）
python -c "
from engine.storage import get_store
from datetime import datetime
s = get_store()
s.execute('INSERT INTO kline_cache(id,stock_code,period,cached_at) VALUES(?,?,?,?)',
          (1,'TEST','1d',datetime.now()))
print('param round-trip:', s.fetchone('SELECT count(*) FROM kline_cache WHERE stock_code=?',('TEST',))[0])
s.execute(\"UPDATE kline_cache SET period='5m' WHERE stock_code='TEST'\")  # UPDATE 路径
print('OK')"

# C. 选股冒烟（real 模式，~5 分钟）
curl -X POST http://127.0.0.1:8000/api/strategies/dbqzt/run
#   期望 ok=true, count>0, 且 selection_results 有对应 run_id 的行
```

---

## 六、故障排查（R21 更新版）

| 症状 | 原因 | 解决 |
|---|---|---|
| `405 Method Not Allowed` on `/exec` | 升级到 9.x / 误改回 POST | `_http_exec` 必须用 GET（见 Bug 1） |
| `undefined bind variable: 0` | 占位符用了 `$1` | `_convert_sql` 产 `%s`（见 Bug 2） |
| `Invalid column: CURRENT_DATE` | 直接用了 PG 函数 | 走 `_convert_sql` 归一，或改 `now()`/`timestamp_floor` |
| `unexpected token [FROM]` (DELETE) | 用了 DELETE | 改 UPDATE 软删除（见 Bug 4） |
| `insert statement must populate timestamp` | INSERT 漏 designated timestamp 列 | 对照 §2.2 补 timestamp 值（见 Bug 10） |
| 选股 hang 不返回 | `get_market_data(count=-1)` 无界 | `count<=0` 兜底（见 Bug 7） |
| 选股期间 `/health` HTTP 000 | 同步阻塞事件循环 | `asyncio.to_thread`（见 Bug 9） |
| `connection already closed` 反复 | 连接闲置断开未重连 | `_exec_retry` 已处理；若仍现，查 QuestDB 是否被重启 |
| 选股 `count>0` 但表 0 行 | 导出失败（看 `ExporterError`） | 查 timestamp 列 / 列名映射（见 Bug 10） |
| `dev.py start` 误杀在跑服务 | stop 不尊重 `--no-*` | 已修（见 Bug 11），确认 dev.py 是 R21+ 版本 |
| Docker Hub 拉镜像失败 | 网络不可达 | 改原生二进制（见 §五.1） |
| `questdb.exe install` 错误 1783 | 需管理员 | 用 `java -m` 直跑，或管理员 shell install |
| `tq.initialize 失败` | 通达信终端未启动/未登录 | 先启动 `tdxw.exe` 并登录一次 |
| 选股结果空（count=0） | 非交易时段 / 终端未下载数据包 | 交易时段重试；通达信客户端手动下载 K 线 + 财务包 |

---

## 七、经验教训

### 教训 1 — "迁移完成" ≠ "迁移可用"
R18 把 DuckDB→QuestDB 标为完成，但代码从未在真实 QuestDB 上跑过一行 INSERT。
**所有 SQL 方言差异（占位符、日期函数、DELETE、timestamp 必填）都是迁移时假设了源库行为。**

> **防范**：任何 DB 迁移，必须有"真库冒烟"——至少跑一次 CREATE + 参数化 INSERT + SELECT +
> DELETE（或确认新库不支持后的替代方案）的往返。沙箱降级路径（mock 模式）会掩盖真库问题。

### 教训 2 — 降级路径掩盖了真实路径
Mock 模式下 `QuestDBStore.is_available=False`，`execute()` 直接 `return -1`，所有写路径
**从未被执行**。导致 11 个 bug 在 Mock 下全部隐身。

> **防范**：降级路径（no-DB / mock）必须与真实路径**分开测试**。给真实路径写至少一个
> 集成测试，即使沙箱跑不了，也要在真机验证清单里列明。

### 教训 3 — API 返回值 ≠ 持久化成功
`count=24`（来自内存 `len(ctx.final)`）让人以为成功了，实际导出 `ExporterError` 被吞，
表里 0 行。**业务结果数与落库是两步，必须分别验证。**

> **防范**：关键写操作后，立即 `SELECT count(*) WHERE run_id=?` 回查落库；导出失败要
> **抛到 API 响应或显眼日志**，不能只 debug 级别吞掉。

### 教训 4 — async endpoint 里的同步阻塞是隐形杀手
`runner.run_strategy()` 同步跑 5 分钟，整个 FastAPI 事件循环卡死，`/health` 都不响应。
本地小数据测试感知不到（毫秒级），real 模式全市场才暴露。

> **防范**：async endpoint 里调任何可能慢的同步函数（DB、外部 API、重计算），一律
> `await asyncio.to_thread(...)` 或 `run_in_executor`。

### 教训 5 — 文档的"推荐方式"可能与环境不符
`AI_HANDOVER.md §五` 推荐 Docker 启动 QuestDB，但国内 Docker Hub 不可达；`?action=status`
的 URL 已过时（实际是 `/status`）。**文档会腐化，验证时以实际端点为准。**

> **防范**：交接文档的命令/URL 要定期用真机过一遍；本次已回修 `AI_HANDOVER.md`。

### 教训 6 — 默认值 -1 / 无界是定时炸弹
`kline_count` 默认 -1 传给外部 API → 无界拉取 → hang。**任何传给外部/不可控接口的"不限"
参数都要在边界兜底为合理上限。**

> **防范**：对外部调用（tqcenter / 第三方 API），count / size / timeout 一律显式上限，
> 不透传 `-1` / `None` / 无限。

---

**本文档随 QuestDB / real 模式演进而更新。重大变更请 append 新章节并更新 §二方言清单。**
**最后更新**：R21（2026-06-24）· **配套**：`worklog.md` R21 条目 · `AI_HANDOVER.md` §五/§七/§十一
