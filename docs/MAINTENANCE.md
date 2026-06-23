# 运维手册 + 交接提示词

> 本文档涵盖日常运维、8 个高频交接场景的标准提示词、限流方案说明、故障排查。

---

## 一、日常运维

### 1.1 常用命令

```bash
python scripts/dev.py start          # 启动双服务
python scripts/dev.py stop           # 停止
python scripts/dev.py setup          # 环境初始化
python scripts/dev.py reload         # 热加载配置
python scripts/dev.py test --smoke   # 8 端点冒烟测试
python scripts/dev.py test --lint    # ESLint
python scripts/dev.py test --all     # 全部
python scripts/dev.py paths --env windows  # 路径替换
python scripts/dev.py daemon         # 守护进程
```

### 1.2 配置热加载

改 YAML 后无需重启，调 `POST /api/config/reload` 即可：
```bash
python scripts/dev.py reload
```

会触发：
- `RuleSet` 重新加载策略规则
- `MatchRegistry` 重新加载匹配策略
- `ChannelRegistry` 惰性重载（下次访问时重载）
- `reset_limiter()` 重置限流器（qps/burst 变更生效）

**不支持热加载的**：
- `adapter_mode`（mock ↔ real）→ 必须重启
- `api.rate_limit.rules`（中间件启动时加载）→ 必须重启

### 1.3 数据库

```bash
python scripts/init_db.py    # 初始化/升级 QuestDB schema (R18 替代 DuckDB)
```

R18 起 DuckDB 已替换为 **QuestDB** (服务端架构, 无文件锁)。`DuckDBStore` 名字保留为
`QuestDBStore` 别名, 旧代码零改动迁移。启动 QuestDB 见 `docker/questdb/docker-compose.yml`。

8 张表 (Schema 文件 `config/questdb_schema.sql`):
- `strategies` / `selection_results` / `signal_events` / `sector_snapshots`
- `strategy_runs` / `monitor_subscriptions` / `config_changes` / `kline_cache`

QuestDB 是服务端进程, 须先启动 (`docker compose up -d` 或 `questdb.exe start`)。
沙箱/mock 模式无 QuestDB 时自动降级 (不依赖 DB 仍可运行)。详见下文「§QuestDB 运维」。

---

## 二、三层限流方案（R12 已实施）

### 2.1 架构

```
Layer 1: 令牌桶（tqcenter 调用守卫）
  - 位置: engine/data_adapter/rate_limiter.py
  - 应用: real_adapter.py 20 个查询方法加 acquire_or_skip()
  - 配置: config/app.yaml → tqcenter.rate_limit (qps/burst/enabled)

Layer 2: 端点中间件（API 限流）
  - 位置: engine/api/middleware/rate_limit.py
  - 应用: 7 条规则按 path + method 限流
  - 配置: config/app.yaml → api.rate_limit (rules/enabled)
  - fail-open: 中间件异常放行，不误杀

Layer 3: 监控统计
  - 位置: engine/api/state.py (6 字段 + 3 方法)
  - 展示: GET /api/monitor/health → api_stats + rate_limit
  - 前端: EngineHealthCard.tsx (Dashboard 大屏，15s 刷新)
```

### 2.2 限流规则（7 条）

| Path | Method | QPM |
|---|---|---|
| `/api/strategies/{id}/run` | POST | 10 |
| `/api/strategies` | POST | 5 |
| `/api/sectors` | POST | 3 |
| `/api/config/reload` | POST | 10 |
| `/api/monitor/match-strategies` | POST | 5 |
| `/api/backtest/run` | POST | 3 |
| `/api/export` | POST | 10 |

超限返回 429 + `Retry-After` header + JSON body `{error, rule_id, retry_after, message}`。

### 2.3 紧急关闭

限流误杀正常请求时，编辑 `config/app.yaml`：
```yaml
api:
  rate_limit:
    enabled: false    # 临时关闭 Layer 2
tqcenter:
  rate_limit:
    enabled: false    # 临时关闭 Layer 1
```
然后 `python scripts/dev.py reload`（Layer 2 需重启）。

---

## 三、8 个交接场景提示词

> 复制对应场景的提示词到对话开头，AI 即可快速进入工作状态。

### 场景一：首次接手项目

```text
你是 TdxQuant 项目的 AI 维护者。先读以下文档建立认知：
1. docs/README.md（项目总览）
2. docs/maintenance/ARCHITECTURE.md（5 层架构，改代码前必读）
3. docs/MAINTENANCE.md（运维 + 8 场景提示词）
4. worklog.md 最后 5 段（近期变更）
5. config/app.yaml（当前配置）

然后告诉我：当前 adapter_mode / 引擎状态 / 最近一次变更内容。
```

### 场景二：修 Bug

```text
你是 TdxQuant 项目的 AI 维护者。需要修复以下 Bug：

【Bug 描述】
<在这里描述现象、复现步骤、期望行为>

【排查流程】
1. 读 worklog.md 最后 200 行，看是否已记录
2. 读 docs/maintenance/ARCHITECTURE.md 确认所属层
3. 定位代码文件，读上下文
4. 改最小范围（优先改 YAML/配置，其次改插件，最后改引擎）
5. 验证 4 项：
   - bun run lint → exit 0
   - python scripts/dev.py test --smoke → 8 端点 200
   - agent-browser 打开 / 验证 UI 正常
   - append worklog.md（Task ID: Bug-<简述>）

【约束】
- 不要改 engine/ 已稳定代码（除非 Bug 在引擎层）
- 改前先在 worklog 写理由
- 不要引入新依赖
```

### 场景三：加新策略

```text
你是 TdxQuant 项目的策略开发者。需要新增选股策略。

【策略需求】
<描述策略逻辑、目标股票池、买卖条件>

【实施流程】
1. 读 docs/STRATEGY_FACTOR.md 了解策略 YAML 结构
2. 读 strategies/_template.yaml 了解模板
3. 读 strategies/strategy_dbqzt.yaml（打板策略）作为参考
4. 创建 strategies/strategy_<id>.yaml
5. 选择因子（26 个内置，见 engine/factors/）
6. 配置清洗规则（config/cleaning_rules.yaml）
7. 验证 4 项：
   - bun run lint → exit 0
   - POST /api/strategies/<id>/run → ok:true
   - GET /api/selections?strategy_id=<id> → 非空
   - agent-browser → Strategies Tab 看到新策略
8. append worklog.md（Task ID: 策略-<id>）

【约束】
- 不改引擎代码（Pipeline 不动）
- 不改因子代码（用现有 26 个）
- 如需新因子，走场景五
```

### 场景四：加新预警通道

```text
你是 TdxQuant 项目的通道开发者。需要新增预警推送通道。

【通道需求】
<描述通道名、API、认证方式>

【实施流程】
1. 读 docs/maintenance/ARCHITECTURE.md §通道层
2. 读 engine/channels/base.py（Channel 基类）
3. 读 engine/channels/feishu.py 作为参考
4. 创建 engine/channels/<name>.py
5. 在 config/channels.yaml 加配置
6. 验证 4 项：
   - bun run lint → exit 0
   - POST /api/config/reload → ok:true
   - 触发信号 → 通道收到推送
   - 失败场景验证（webhook 错误时 ok=False + 日志告警）
7. append worklog.md（Task ID: 通道-<name>）
```

### 场景五：加新因子

```text
你是 TdxQuant 项目的因子开发者。需要新增选股因子。

【因子需求】
<描述因子名、计算公式、数据依赖>

【实施流程】
1. 读 docs/STRATEGY_FACTOR.md 了解因子插件结构
2. 读 engine/factors/base.py（Factor 基类）
3. 读 engine/factors/momentum.py 作为参考
4. 创建 engine/factors/<name>.py
5. 如需新数据字段：
   - 读 engine/data_adapter/base.py 是否有获取接口
   - 若无，在 base.py + mock_adapter.py + real_adapter.py 同步添加（3 个文件）
   - Mock: 从 CSV 读 or hash 生成
   - Real: 调 tqcenter API
6. 验证 4 项：
   - bun run lint → exit 0
   - 单测: python -c "from engine.factors.<name> import *; calc()"
   - 策略引用该因子后 POST /api/strategies/<id>/run → ok:true
   - agent-browser → 选股结果含该因子值
7. append worklog.md（Task ID: 因子-<name>）

【约束】
- 不要在 calculate 内调 tqcenter（数据由 Pipeline 预先注入 df）
```

### 场景六：Windows 生产部署

详见 `docs/DEPLOY.md`。

### 场景七：性能优化 / 限流

```text
你是 TdxQuant 项目的性能优化工程师。Real 模式下高频调用卡死通达信终端。

【现状】
R12 已实施三层限流（令牌桶 + 端点中间件 + 监控统计），参考:
- engine/data_adapter/rate_limiter.py
- engine/api/middleware/rate_limit.py
- engine/api/state.py (api_stats 方法)
- GET /api/monitor/health

【优化方向】
1. 调整 tqcenter.rate_limit.qps/burst（config/app.yaml）
2. 调整 api.rate_limit.rules（7 条规则的 QPM）
3. 监控 /api/monitor/health 的 api_stats，看 rejected 比例
4. 如仍卡，考虑批量请求合并（get_kline 改批量）

【约束】
- Mock 模式不限流（开发体验优先）
- 不要改 real_adapter.py 查询逻辑，只调 acquire_or_skip 参数
```

### 场景八：文档同步维护

```text
你是 TdxQuant 项目的文档维护者。需要同步文档。

【同步范围】
1. docs/README.md（项目总览）
2. docs/maintenance/ARCHITECTURE.md（架构，改代码后更新）
3. docs/MAINTENANCE.md（运维，加新脚本/端点后更新）
4. docs/DEPLOY.md（部署，加新环境后更新）
5. docs/STRATEGY_FACTOR.md（策略/因子，加新插件后更新）
6. docs/USER_GUIDE.md（用户手册，加新功能后更新）
7. docs/CHANGELOG.md（变更日志，每轮迭代 append）
8. worklog.md（工作记录，每次改动 append）

【约束】
- 保持精简（每文档 < 800 行）
- 如有新场景，新增到 MAINTENANCE.md §三
- 已有场景如流程变化，更新提示词内容
- 宁可不动，不要乱动
```

---

## 四、故障排查速查

| 现象 | 可能原因 | 排查 |
|---|---|---|
| 前端白屏 | .env 缺失 / Prisma 未初始化 | `bun install` + 检查 `src/lib/api-proxy.ts` |
| `/api/xxx` 404 | FastAPI 没起 / 路由未注册 | `curl http://127.0.0.1:8000/health` |
| `database is locked` | (R18 后已根治,旧 DuckDB 遗留) | 升级 R18 用 QuestDB; 或 `python scripts/dev.py stop` + 重启 |
| `[WARN] QuestDB 连接不可达` | QuestDB 未启动 | `docker compose -f docker/questdb/docker-compose.yml up -d` |
| 信号不推送 | 通道未配 / webhook 错 | 查 `config/channels.yaml` + `/api/monitor/health` |
| 选股结果空 | 策略未启用 / 因子数据缺 | `GET /api/strategies` 看 enabled + 查 K 线 CSV |
| 429 Too Many | 限流触发 | `GET /api/monitor/health` 看 rejected 数 |
| tqcenter 卡死 | 高频调用 | 降 `tqcenter.rate_limit.qps` + 重启 |
| 配置改了不生效 | 不支持热加载的字段 | `adapter_mode` / `rate_limit.rules` 需重启 |
| 端口 8812/9000 被占用 | 旧 QuestDB 进程 | `netstat -ano \| findstr :8812` + `taskkill /PID <pid> /F` |

---

## 五、监控指标

### 5.1 GET /api/monitor/health 返回结构

```json
{
  "status": "ok",
  "engine_status": "running",
  "adapter_mode": "mock",
  "uptime_seconds": 3600,
  "monitored_count": 31,
  "today_signal_counts": 39,
  "api_stats": {
    "api_call_total": 148,
    "api_call_rejected": 8,
    "api_call_avg_latency_ms": 34.2,
    "tqcenter_call_total": 0,
    "tqcenter_call_rejected": 0
  },
  "rate_limit": {
    "tqcenter_enabled": true,
    "api_enabled": true,
    "rules_count": 7
  }
}
```

### 5.2 前端展示

- `EngineHealthCard.tsx`（Dashboard 大屏）：4 区块（引擎状态 / API 调用 / tqcenter / 限流开关），15s 刷新
- `SignalCenter.tsx`（Signals Tab）：信号列表 + 30s 轮询
- `NotificationCenter.tsx`：通知中心

---

## 六、QuestDB 运维 (R18 替代 DuckDB)

### 6.1 文件锁问题根治 (DuckDB vs QuestDB 对比)

R18 之前用 DuckDB, 多 FastAPI 实例并发写必冲突报 `database is locked`, 是项目长期痛点:

| 维度 | DuckDB (R5-R17) | QuestDB (R18+) |
|---|---|---|
| 架构 | 单文件嵌入式 (`data/duckdb/quant.db`) | 服务端进程 (PG wire 8812 / HTTP 9000 / ILP 9009) |
| 文件锁 | **单写锁**, 多进程必冲突 | **无文件锁**, 多连接并发写 |
| 并发模型 | 进程内独占, 多 FastAPI 实例必崩 | PG wire 多连接, QuestDB 内部排队/并行 |
| R12 限流 | 缓解 (降低冲突概率) 但未根治 | **不再需要** (服务端架构天生并发安全) |
| 多实例部署 | 必须串行 (一台机器一个 FastAPI) | 可并行 (N 个 FastAPI → 1 个 QuestDB) |
| 报错现象 | `database is locked` / `IO Error: Could not set lock on file` | 不再出现 |
| 升级路径 | 加锁超时 / 重试 (hack) | 直接迁移 QuestDB (clean solution) |

**为什么 R12 限流没根治**: R12 的三层限流是 FastAPI 端点限流 + tqcenter API 限流, 保护的是后端 API 被频繁调用, 但 DuckDB 文件锁冲突是**并发写**层面问题, 不是 API 频率问题。即使每个 API 一秒调一次, 两个 FastAPI 进程同时写 DB 仍会冲突。R18 用服务端架构从根上解决。

### 6.2 备份

**Docker 部署**:
```bash
# 方式 A: 直接打包数据目录 (推荐, 简单粗暴)
cd /path/to/tdxquant
tar -czf questdb-backup-$(date +%Y%m%d).tar.gz docker/questdb/questdb-data/

# 方式 B: SQL 导出 (适合跨版本迁移)
# Web 控制台 http://127.0.0.1:9000 执行:
#   SELECT * FROM selection_results INTO 'selection_backup.csv';
#   SELECT * FROM signal_events INTO 'signals_backup.csv';
```

**原生部署**:
```bash
# 直接打包数据目录
tar -czf questdb-backup-$(date +%Y%m%d).tar.gz /opt/questdb/data/
# 或 Windows
7z a questdb-backup.zip K:\questdb\data\
```

### 6.3 恢复

```bash
# 1. 停 QuestDB
docker compose -f docker/questdb/docker-compose.yml down

# 2. 清空旧数据 (谨慎!)
rm -rf docker/questdb/questdb-data/*

# 3. 解压备份
tar -xzf questdb-backup-YYYYMMDD.tar.gz -C docker/questdb/

# 4. 重启
docker compose -f docker/questdb/docker-compose.yml up -d

# 5. 验证 (Web 控制台执行)
#   SELECT count(*) FROM selection_results;
```

### 6.4 监控

**Web 控制台** (http://127.0.0.1:9000):
- 表清单 / 行数 / 分区数
- 实时执行 SQL 查询
- 看磁盘占用

**Docker 日志**:
```bash
docker logs tdxquant-questdb --tail 50 -f
```

**关键指标**:
- 内存占用: `docker stats tdxquant-questdb`
- 磁盘占用: `du -sh docker/questdb/questdb-data/`
- 活跃连接数: `SELECT count(*) FROM connections()` (Web 控制台执行)

### 6.5 性能调优

**配置文件**: `docker/questdb/questdb.conf` 或 `docker/questdb/docker-compose.yml` 的环境变量

| 参数 | 默认 | 调优建议 | 说明 |
|---|---|---|---|
| `QDB_SHARED_WORKER_COUNT` | 2 | 4-8 (多核机器) | 共享 worker 数, 影响并发查询能力 |
| `QDB_HTTP_BIND_TO` | 0.0.0.0:9000 | 127.0.0.1:9000 (本机) | HTTP 监听地址, 生产建议绑本机 |
| `QDB_PG_BIND_TO` | 0.0.0.0:8812 | 127.0.0.1:8812 (本机) | PG wire 监听地址 |
| `QDB_TIMEZONE` | UTC | Asia/Shanghai | 时区, 影响 `now()` 等函数返回值 |

**SQL 调优**:
- 时序表必带 `timestamp(col)` → 自动分区 + 列存压缩, 查询快 10-100x
- 低基数字段用 `SYMBOL` 类型 (stock_code/alert_type) → 自动去重 + 压缩
- 大查询用 `LATEST ON` 语法查最新一行 (比 `ORDER BY ... LIMIT 1` 快)
- 避免全表扫描: 查询时尽量带时间范围 `WHERE ts > dateadd('h', -1, now())`

**数据清理**:
- 时序表自动按天分区, 老分区可手动 `DROP PARTITION WHERE timestamp < dateadd('d', -30, now())`
- 非时序表 (strategies/strategy_runs) 需手动 DELETE 老数据

### 6.6 重置/重建

```bash
# 1. 停 QuestDB
docker compose -f docker/questdb/docker-compose.yml down

# 2. 清空数据目录 (谨慎! 不可逆)
rm -rf docker/questdb/questdb-data/*

# 3. 重启 QuestDB (空数据)
docker compose -f docker/questdb/docker-compose.yml up -d

# 4. 重新建表 (QuestDBStore 启动时 auto_init=true 自动执行, 或手动)
python scripts/init_db.py
```

### 6.7 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| `[WARN] QuestDB 连接 PG wire 不可达` | QuestDB 未启动 | `docker compose -f docker/questdb/docker-compose.yml up -d` |
| `psycopg2.OperationalError: could not connect to server` | 端口/密码错 | 检查 `config/app.yaml` 的 `questdb` 段 vs 实际 QuestDB 配置 |
| 端口 8812/9000 占用 | 旧 QuestDB 进程 | `netstat -ano \| findstr :8812` + `taskkill /PID <pid> /F` |
| 数据丢失 | 数据目录被删 / 卷挂载错 | 检查 `docker-compose.yml` 的 volumes 配置; 从备份恢复 |
| 查询慢 | 全表扫描 / 无分区 | 加时间范围 WHERE; 检查 `timestamp(col)` 是否生效 |

---

## 七、worklog 规范

每次改动 append 到 `worklog.md`：

```markdown
---
Task ID: <轮次>-<简述>
Agent: <执行者>
Task: <任务描述>

Work Log:
- <步骤 1>
- <步骤 2>

Stage Summary:
- <完成什么、改了哪些文件、验证结果>
- <未解决问题、下一步建议>
```

---

## 八、升级 / 回滚

详见 `docs/DEPLOY.md` §升级流程。
