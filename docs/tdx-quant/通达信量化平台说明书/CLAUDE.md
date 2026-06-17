# 数据库重构项目规范

## 🚨 启动必读
接续本项目前，**必须先 Read** `K:\DB数据库_v2\dbv2-skeleton.md`
读完才能动手；骨架够用就不要再 Read 业务文件全文。

## 🚫 禁止清单
1. 禁止实现 fetch_data() 业务逻辑，只留 WARNING 占位（**需用户明确授权**）
2. 禁止创建目录结构以外的任何文件和目录
3. 禁止 import 旧目录和 legacy/ 任何代码
4. 禁止自作主张加功能，提示词说做什么就只做什么
5. 禁止跳过 git commit
6. 禁止编造表名/列名，必须先 DESCRIBE 确认再写
7. 增删表后必须更新脚本头部的 @meta

##⚠️ 敏感操作须确认
以下操作超出用户明确指令范围时，**必须先征得用户确认**再动手：
- **扩展字段/列** — 如在入库脚本里加新的展开列（本会话中加 34 个展开列属此类，应先问）
- **改变数据存储方式** — 如删 JSON、换存储结构
- **修改表结构** — ALTER TABLE 加列/删列
- **改变 MODE** — increment↔ full 切换
- **改动涉及已有数据** — 可能丢失或重写现有数据
- **重写函数架构** — fetch_data/save_data 重构（生成器/batch 等）
- **删代码** — 删除函数或代码块（build_rows 死代码删了属此类）

## 路径
- 数据库：K:\DB数据库_v2\db\profit_radar.duckdb
- 本项目：K:\DB数据库_v2\

## 工作准则
1. **非必要不查询** — 查询前判断答案是否改变下一步（需求明确时直接按需重写，禁止为参考而读取旧文件）
2. **想清楚再开始** — 先说计划，确认后再动手
3. **用脑判断替代用token探测** — 基于已知需求推导，避免用 Token 试错
4. **先扫全量再动手** — 修改配置/路径/变量前，必须先全量搜索影响面，列出所有受影响的文件清单，确认后再一次性修改，严禁边找边改
5. **提交前必看 `git status --short`** — 确认改动范围正确，无多余文件
6. **精准切片，依赖溯源** — 严禁 cat 全量文件，先 grep 锁定坐标再读；修改涉及同项目函数/变量/类时，必须 grep 溯源签名，确认无连锁影响后方可动手

## 目录结构
1_入库/   ← 采集入库（sort编号，fetch_data无参数）
2_计算/   ← SQL派生（sort编号，fetch_data传con）
3_策略/ 4_工具/ config/ output/ archive/ logs/ reports/ legacy/

## 分类规则
- source含API/爬虫/TDX/文件 → 1_入库
- source含SQL/派生/聚合 → 2_计算

## 脚本规范
- 入口 run(force=False) 返回 True/False
- 必须 ensure_table(con) + fetch_data() + save_data(con,df)
- 增量先DELETE再INSERT，全量先清空再INSERT
- 顶部常量：DB_PATH / TABLE / MODE / SCHEDULE
- 列名全小写下划线，禁中文禁空格

### 头部 @meta 元数据
改脚本时必须同步更新，run.py 从 @meta 读取：
```python
# @meta table=表名 cn=中文名 dir=1_入库 sort=000
# @meta schedule=daily mode=increment source=数据源
```
- **table** - 表名（必须）
- **cn** - 中文名
- **dir** - 目录（1_入库 / 2_计算）
- **sort** - 排序编号（3位数字）
- **schedule** - 更新周期（daily/weekly/monthly/once）
- **mode** - 模式（increment/full）
- **source** - 数据源

## 模板文件
- 1_入库：config/template_ingestion.py
- 2_计算：config/template_compute.py
- 配置格式：config/tables_format.md

## run.py命令
all[--weekly/--full] / 1/2/10/kline / scan / check / get / add / remove / fix / backup

## 📚 项目知识库 memory/
确认项目事实后，**立即写入** `memory/` 目录，避免重复探测。

### 规则
- **写什么**：表结构差异、代码模式、业务规则、踩坑记录
- **怎么写**：每个 fact 一个 `.md` 文件，含 `name`/`description`/`metadata`
- **何时写**：第1次确认后立即写，不要等对话结束
- **索引**：`memory/MEMORY.md` 列出一行一个

### 格式模板
```markdown
---
name: fact-slug
description: 一句话描述
metadata:
  type: project | pattern | user | reference
---

正文：确认的事实

**Why:** 为什么重要
**How to apply:** 如何应用
```

### 已有记忆
| 文件 | 内容 |
|------|------|
| kline-table-schema.md | K线表架构差异 |
| get_relation-api.md | get_relation API 返回字段和使用方式 |
| sector-tables.md | 板块相关表和脚本映射 |
