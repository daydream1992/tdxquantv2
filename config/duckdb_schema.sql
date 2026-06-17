-- ============================================================================
-- TdxQuant Engine - DuckDB Schema
-- 8 张核心表：策略 / 选股结果 / 信号事件 / 板块快照 / 执行日志
--              / 监控订阅 / 配置变更审计 / K线缓存
-- 维护原则：所有表结构变更走本文件，配合 ConfigLoader 热加载；不要在 Python
--           代码里写 CREATE TABLE。
-- 注：DuckDB 1.x 不支持 ``GENERATED ALWAYS AS IDENTITY``，自增主键统一用
--     ``SEQUENCE`` + ``DEFAULT nextval('seq_xxx')`` 实现。
-- ============================================================================

-- 1. 策略注册表
CREATE TABLE IF NOT EXISTS strategies (
    strategy_id      VARCHAR PRIMARY KEY,              -- 拼音首字母小写，全局唯一
    strategy_name    VARCHAR NOT NULL,                 -- 中文显示名
    strategy_emoji   VARCHAR DEFAULT '',               -- UI 显示 emoji
    version          VARCHAR DEFAULT '1.0',
    enabled          BOOLEAN DEFAULT TRUE,
    sector_code      VARCHAR DEFAULT '',               -- 关联板块 Code
    sector_name      VARCHAR DEFAULT '',
    yaml_path        VARCHAR DEFAULT '',               -- strategies/*.yaml 相对路径
    config_hash      VARCHAR DEFAULT '',               -- YAML 内容 hash，用于变更检测
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 选股结果（一次跑出 N 只 → N 行）
CREATE SEQUENCE IF NOT EXISTS seq_selection_results_id;
CREATE TABLE IF NOT EXISTS selection_results (
    id               BIGINT PRIMARY KEY DEFAULT nextval('seq_selection_results_id'),
    run_id           VARCHAR NOT NULL,                 -- 关联 strategy_runs.run_id
    strategy_id      VARCHAR NOT NULL,
    run_date         DATE NOT NULL,
    stock_code       VARCHAR NOT NULL,                 -- 600519.SH 等
    stock_name       VARCHAR DEFAULT '',
    total_score      DOUBLE DEFAULT 0.0,
    factor_scores    VARCHAR DEFAULT '{}',             -- JSON: {factor_id: score}
    rank             INTEGER DEFAULT 0,
    extra_data       VARCHAR DEFAULT '{}',             -- 策略专属扩展字段
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sel_run_id     ON selection_results(run_id);
CREATE INDEX IF NOT EXISTS idx_sel_strategy   ON selection_results(strategy_id, run_date);
CREATE INDEX IF NOT EXISTS idx_sel_stock      ON selection_results(stock_code);

-- 3. 信号事件（监控引擎产生）
CREATE SEQUENCE IF NOT EXISTS seq_signal_events_id;
CREATE TABLE IF NOT EXISTS signal_events (
    id               BIGINT PRIMARY KEY DEFAULT nextval('seq_signal_events_id'),
    event_id         VARCHAR NOT NULL,                 -- UUID
    strategy_id      VARCHAR DEFAULT '',
    stock_code       VARCHAR NOT NULL,
    stock_name       VARCHAR DEFAULT '',
    alert_type       VARCHAR NOT NULL,                 -- limit_up / drop_alert / ...
    condition_expr   VARCHAR DEFAULT '',               -- 触发条件表达式
    snapshot         VARCHAR DEFAULT '{}',             -- 触发时行情快照 JSON
    severity         VARCHAR DEFAULT 'info',           -- info / warn / error
    channels_fired   VARCHAR DEFAULT '[]',             -- JSON: 已推送通道
    triggered_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sig_stock      ON signal_events(stock_code);
CREATE INDEX IF NOT EXISTS idx_sig_strategy   ON signal_events(strategy_id, triggered_at);

-- 4. 板块快照（每次板块更新留痕，便于回溯）
CREATE SEQUENCE IF NOT EXISTS seq_sector_snapshots_id;
CREATE TABLE IF NOT EXISTS sector_snapshots (
    id               BIGINT PRIMARY KEY DEFAULT nextval('seq_sector_snapshots_id'),
    sector_code      VARCHAR NOT NULL,
    sector_name      VARCHAR DEFAULT '',
    strategy_id      VARCHAR DEFAULT '',
    stock_count      INTEGER DEFAULT 0,
    stock_list       VARCHAR DEFAULT '[]',             -- JSON: ["600519.SH", ...]
    operation        VARCHAR DEFAULT 'replace',        -- replace / append / remove
    snapshot_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sec_code       ON sector_snapshots(sector_code, snapshot_at);

-- 5. 策略执行日志
CREATE TABLE IF NOT EXISTS strategy_runs (
    run_id           VARCHAR PRIMARY KEY,              -- UUID
    strategy_id      VARCHAR NOT NULL,
    run_date         DATE NOT NULL,
    status           VARCHAR DEFAULT 'pending',        -- pending / running / success / failed
    started_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at      TIMESTAMP,
    duration_ms      BIGINT DEFAULT 0,
    universe_count   INTEGER DEFAULT 0,                -- 进入选股的股票池大小
    result_count     INTEGER DEFAULT 0,                -- 选出的股票数
    error_message    VARCHAR DEFAULT '',
    context          VARCHAR DEFAULT '{}'              -- JSON: 运行参数/环境信息
);

CREATE INDEX IF NOT EXISTS idx_run_strategy   ON strategy_runs(strategy_id, run_date);

-- 6. 监控订阅（subscribe_hq 跟踪）
CREATE SEQUENCE IF NOT EXISTS seq_monitor_subscriptions_id;
CREATE TABLE IF NOT EXISTS monitor_subscriptions (
    id               BIGINT PRIMARY KEY DEFAULT nextval('seq_monitor_subscriptions_id'),
    strategy_id      VARCHAR DEFAULT '',
    stock_code       VARCHAR NOT NULL,
    subscriber       VARCHAR DEFAULT '',               -- 订阅方标识
    subscribed_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unsubscribed_at  TIMESTAMP,
    active           BOOLEAN DEFAULT TRUE,
    batch_no         INTEGER DEFAULT 0                 -- subscribe_hq 分批序号
);

CREATE INDEX IF NOT EXISTS idx_mon_stock      ON monitor_subscriptions(stock_code, active);
CREATE INDEX IF NOT EXISTS idx_mon_strategy   ON monitor_subscriptions(strategy_id, active);

-- 7. 配置变更审计（YAML 热加载留痕）
CREATE SEQUENCE IF NOT EXISTS seq_config_changes_id;
CREATE TABLE IF NOT EXISTS config_changes (
    id               BIGINT PRIMARY KEY DEFAULT nextval('seq_config_changes_id'),
    config_path      VARCHAR NOT NULL,                 -- config/app.yaml 等
    change_type      VARCHAR DEFAULT 'reload',         -- reload / create / delete
    old_hash         VARCHAR DEFAULT '',
    new_hash         VARCHAR DEFAULT '',
    diff_summary     VARCHAR DEFAULT '',
    changed_by       VARCHAR DEFAULT 'system',
    changed_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cfg_path       ON config_changes(config_path, changed_at);

-- 8. K线缓存（减少重复 API 调用）
CREATE SEQUENCE IF NOT EXISTS seq_kline_cache_id;
CREATE TABLE IF NOT EXISTS kline_cache (
    id               BIGINT PRIMARY KEY DEFAULT nextval('seq_kline_cache_id'),
    stock_code       VARCHAR NOT NULL,
    period           VARCHAR NOT NULL,                 -- 1d / 5m / 15m / 30m / 60m / 1w / 1M
    dividend_type    VARCHAR DEFAULT 'none',           -- none / front / back
    trade_date       DATE NOT NULL,
    open             DOUBLE,
    high             DOUBLE,
    low              DOUBLE,
    close            DOUBLE,
    volume           DOUBLE,
    amount           DOUBLE,
    forward_factor   DOUBLE,
    cached_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(stock_code, period, dividend_type, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_kline_code     ON kline_cache(stock_code, period, trade_date);
CREATE INDEX IF NOT EXISTS idx_kline_date     ON kline_cache(trade_date);
