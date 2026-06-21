# R13-1b: alert_type 改下拉(新增 /api/monitor/rules + UI 改 Select)

**Task ID**: R13-1b
**Agent**: full-stack-developer
**Date**: 2026-06-21
**Scope**: 修复匹配策略管理页编辑 alerts 时 alert_type 是自由 Input 易拼错的 UX 遗漏

## 问题背景

R13 盘点确认: 后端 `config/monitor_rules.yaml` 有 14 个 `alert_templates`, 但:
- 后端无 "列出 alert_templates" 端点(GET /api/config 只返回 count=14, 不返回详情)
- 前端 `MatchStrategyManager.tsx` 编辑 alerts 时 alert_type 是自由 Input, placeholder="如 rzq_ignite", 用户必须凭记忆输入, 极易拼错导致测试时返回 "<模板不存在>"

## 实现方案

### 第一步: 后端新增端点 GET /api/monitor/rules

文件: `engine/api/routes/monitor.py`

在 `/subscriptions` 路由之前插入新路由:
- 用 `Depends(get_config)` 取 ConfigLoader 单例
- `cfg.get("alert_templates")` 返回 dict(因 ConfigLoader.reload() 把 monitor_rules.yaml 合并到 `_data` 顶层)
- 遍历 dict 转 list of dict, 保留 YAML 声明顺序(Python 3.7+ dict 有序)
- 返回 `{"templates": [...], "count": N}`
- 兼容数组形式 alert_templates(防御性写法)
- 配置缺失返回空列表

返回字段: alert_type / label / emoji / description / condition / default_params / priority / channels

### 第二步: 前端代理

文件: `src/app/api/monitor/rules/route.ts` (新建)

- GET → `tryFastAPI('/api/monitor/rules')` 透传
- 失败降级 `{templates:[], count:0}`(EditForm 检测空数组会回退为 Input)

### 第三步: api.ts 加方法

文件: `src/lib/api.ts`

- 新增 `AlertTemplateDTO` 接口
- `monitorAPI.getRules()` 方法

### 第四步: 改 MatchStrategyManager.tsx

文件: `src/components/quant/MatchStrategyManager.tsx`

主组件新增:
- `alertTemplates` + `alertTemplatesLoading` state
- `loadAlertTemplates` useCallback(失败静默降级, 不弹 toast)
- useEffect 并发调用 `load + loadStrategies + loadAlertTemplates`

EditForm 新增 props: `alertTemplates?` + `alertTemplatesLoading?`

alerts row 的 alert_type 渲染策略(三态):
1. **模板列表非空** → Select 下拉
   - option 显示 `{emoji} {alert_type} — {label}`
   - 选中后若 `params` 为空, 自动填入 `default_params`
   - 已选但不在模板列表的值(历史/自定义), 追加 `⚠ {alert_type} (未在模板列表)` SelectItem
2. **加载中** → 显示 "正在加载 alert 模板..." + `Loader2` spin
3. **加载完成但列表为空**(FastAPI 不可达或配置缺失) → 降级为原 Input 自由输入

附加: 选中模板后下方显示 description + condition + 默认参数, 帮助用户理解模板含义

## 验证结果

### 1. bun run lint: exit 0

### 2. 后端端点

```bash
curl -s http://localhost:8000/api/monitor/rules | python3 -m json.tool
```

返回 14 个模板:
- 🚀 limit_up - 涨停
- ⚠️ drop_alert - 大跌
- 📈 volume_surge - 放量
- 🔨 auction_surge - 竞价异动
- 🚀 trend_accelerate - 趋势加速
- 💔 trend_break - 趋势破位
- 🔄 rebound_signal - 反弹信号
- 📉 continue_drop - 持续下跌
- 💪 big_buy_support - 大单承接
- ⚡ rzq_ignite - 弱转强点火
- 💔 rzq_fail - 弱转强失败
- 🔄 qzrfc_rebound - 强转弱反抽
- ⚠️ qzrfc_fail - 反抽失败
- 🆘 main_self_rescue - 主力自救

### 3. 前端代理

```bash
curl -s http://localhost:3000/api/monitor/rules
```

同样返回 14 个模板, 字段结构与后端一致。

### 4. agent-browser 验证

- 打开 http://localhost:3000/
- JS 切到第 6 个 tab(匹配策略)
- 看到 3 张卡片(rzq_default / qzrfc_default / _default)
- 点 rzq_default 的 "编辑" 按钮 → Dialog 弹出
- alert_type combobox 已显示 "⚡ rzq_ignite — 弱转强点火"(原 Input 已替换)
- 点击该 combobox → 下拉显示 14 个 option(emoji + alert_type + label 三段式)
- 截图: `/home/z/my-project/agent-ctx/r13-1b-alert-type-select.png`

## 文件变更清单

| 操作 | 路径 | 说明 |
|------|------|------|
| 新增 | `src/app/api/monitor/rules/route.ts` | 前端代理(透传到 FastAPI /api/monitor/rules) |
| 修改 | `engine/api/routes/monitor.py` | +60 行: 新增 GET /rules 端点 |
| 修改 | `src/lib/api.ts` | +15 行: AlertTemplateDTO 接口 + monitorAPI.getRules 方法 |
| 修改 | `src/components/quant/MatchStrategyManager.tsx` | +110 行: 状态/加载/EditForm props/Select 替换 Input/描述展示 |

## 运维注意

- 后端 FastAPI 需重启才能加载新端点
- 本环境 bash 工具调用结束时会清理进程组, 普通 `nohup &` + `disown` 不够, 需用 Python 双 fork 守护进程(parent=1) 才能让 FastAPI 跨 bash 调用存活
- 命令: `python -c "double-fork + exec uvicorn"` (见 worklog)
