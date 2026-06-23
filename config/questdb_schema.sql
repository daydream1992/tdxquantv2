-- ============================================================================
-- TdxQuant Engine - QuestDB Schema
-- 8 张核心表：策略 / 选股结果 / 信号事件 / 板块快照 / 执行日志
--              / 监控订阅 / 配置变更审计 / K线缓存
-- ============================================================================
-- QuestDB 关键差异（vs DuckDB）：
--   1. 无 SEQUENCE/AUTOINCREMENT → 应用层生成 ID（时间戳+随机，见 QuestDBStore._gen_id）
--   2. 无 UNIQUE 约束 → 应用层去重（UPSERT 模式：先 DELETE 再 INSERT）
--   3. 无文件锁 → 通过 PG wire (8812) / HTTP (9000) / ILP (9009) 访问，彻底无锁
--   4. designated timestamp → 时序表用 `timestamp(ts)` 标记，自动 partition + 优化
--   5. symbol 类型 → 低基数字符串（如 stock_code/alert_type）用 symbol，自动去重+压缩
--   6. 无 information_schema.tables → 用 tables() / pg_catalog 查询
--   7. 参数化查询 → PG wire 用 $1,$2,...（DuckDB 用 ?）
--
-- 维护原则：所有表结构变更走本文件，配合 QuestDBStore.init_db() 幂等执行
-- ============================================================================

-- 1. 策略注册表（非时序，无 designated timestamp）
CREATE TABLE IF NOT EXISTS strategies (
    strategy_id      SYMBOL CAPACITY 256,            -- 拼音首字母小写，全局唯一
    strategy_name    STRING,
    strategy_emoji   STRING,
    version          STRING,
    enabled          BOOLEAN,
    sector_code      SYMBOL CAPACITY 256,
    sector_name      STRING,
    yaml_path        STRING,
    config_hash      STRING,
    created_at       TIMESTAMP,
    updated_at       TIMESTAMP
);

-- 2. 选股结果（一次跑出 N 只 → N 行）
--    designated timestamp = created_at（时序优化，按天 partition）
CREATE TABLE IF NOT EXISTS selection_results (
    id               LONG,                            -- 应用层生成（时间戳+随机）
    run_id           SYMBOL CAPACITY 1024,            -- 关联 strategy_runs.run_id
    strategy_id      SYMBOL CAPACITY 256,
    run_date         DATE,
    stock_code       SYMBOL CAPACITY 4096,            -- 600519.SH 等
    stock_name       STRING,
    total_score      DOUBLE,
    factor_scores    STRING,                          -- JSON: {factor_id: score}
    rank             INT,
    extra_data       STRING,                          -- 策略专属扩展字段
    created_at       TIMESTAMP
) timestamp(created_at);

-- 3. 信号事件（监控引擎产生，时序表）
CREATE TABLE IF NOT EXISTS signal_events (
    id               LONG,
    event_id         SYMBOL CAPACITY 4096,            -- UUID
    strategy_id      SYMBOL CAPACITY 256,
    stock_code       SYMBOL CAPACITY 4096,
    stock_name       STRING,
    alert_type       SYMBOL CAPACITY 64,              -- limit_up / drop_alert / ...
    condition_expr   STRING,
    snapshot         STRING,                          -- 触发时行情快照 JSON
    severity         SYMBOL CAPACITY 16,              -- info / warn / error
    channels_fired   STRING,                          -- JSON: 已推送通道
    triggered_at     TIMESTAMP
) timestamp(triggered_at);

-- 4. 板块快照（每次板块更新留痕）
CREATE TABLE IF NOT EXISTS sector_snapshots (
    id               LONG,
    sector_code      SYMBOL CAPACITY 256,
    sector_name      STRING,
    strategy_id      SYMBOL CAPACITY 256,
    stock_count      INT,
    stock_list       STRING,                          -- JSON: ["600519.SH", ...]
    operation        SYMBOL CAPACITY 16,              -- replace / append / remove
    snapshot_at      TIMESTAMP
) timestamp(snapshot_at);

-- 5. 策略执行日志
CREATE TABLE IF NOT EXISTS strategy_runs (
    run_id           SYMBOL CAPACITY 1024,            -- UUID，主键
    strategy_id      SYMBOL CAPACITY 256,
    run_date         DATE,
    status           SYMBOL CAPACITY 16,              -- pending / running / success / failed
    started_at       TIMESTAMP,
    finished_at      TIMESTAMP,
    duration_ms      LONG,
    universe_count   INT,
    result_count     INT,
    error_message    STRING,
    context          STRING                           -- JSON: 运行参数/环境信息
);

-- 6. 监控订阅（subscribe_hq 跟踪）
--    注：QuestDB 无 UNIQUE，应用层用 UPSERT 模式（DELETE WHERE stock_code=? AND active=true 再 INSERT）
CREATE TABLE IF NOT EXISTS monitor_subscriptions (
    id               LONG,
    strategy_id      SYMBOL CAPACITY 256,
    stock_code       SYMBOL CAPACITY 4096,
    subscriber       SYMBOL CAPACITY 256,
    subscribed_at    TIMESTAMP,
    unsubscribed_at  TIMESTAMP,
    active           BOOLEAN,
    batch_no         INT
) timestamp(subscribed_at);

-- 7. 配置变更审计（YAML 热加载留痕）
CREATE TABLE IF NOT EXISTS config_changes (
    id               LONG,
    config_path      SYMBOL CAPACITY 256,
    change_type      SYMBOL CAPACITY 16,              -- reload / create / delete
    old_hash         STRING,
    new_hash         STRING,
    diff_summary     STRING,
    changed_by       SYMBOL CAPACITY 64,
    changed_at       TIMESTAMP
) timestamp(changed_at);

-- 8. K线缓存（减少重复 API 调用，时序表）
CREATE TABLE IF NOT EXISTS kline_cache (
    id               LONG,
    stock_code       SYMBOL CAPACITY 4096,
    period           SYMBOL CAPACITY 16,              -- 1d / 5m / 15m / 30m / 60m / 1w / 1M
    dividend_type    SYMBOL CAPACITY 16,              -- none / front / back
    trade_date       DATE,
    open             DOUBLE,
    high             DOUBLE,
    low              DOUBLE,
    close            DOUBLE,
    volume           DOUBLE,
    amount           DOUBLE,
    forward_factor   DOUBLE,
    cached_at        TIMESTAMP
) timestamp(cached_at);
