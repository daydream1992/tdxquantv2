# V8 选股系统 5 策略逻辑详解（AI 维护必读）

> **本文档是 P1-2 任务产出，是后续生成 `strategies/strategy_*.yaml` 的唯一依据，提取自 V8.1 源码 `docs/v8-data/stock_selection_v8_1_standalone/run.py`（1059 行）。**
> **维护原则：精确提取，不概括；所有代码原样保留；阈值/系数一字不差。**
> **最后更新**：P1 阶段 Task P1-2
> **源码版本**：V8.1（6月16日盘后版）

---

## 一、12 步选股总流程

V8.1 主程序 `run.py` 共分 12 个步骤，按顺序执行（对应源码 `# ========== N. xxx ==========` 注释段）。

### 步骤 1：数据加载（L2 快照 + 名称映射）

```python
SNAPSHOT_FILE = 'data/全市场L2快照_20260616.csv'
KLINE_FILES = [
    'data/kline_20260520_0529_daily.csv',
    'data/kline_20260601_0611_daily.csv',
    'data/kline_20260612_daily.csv',
    'data/kline_20260615_daily.csv',
    'data/kline_20260616_daily.csv',  # ★新增6月16日K线
]
NAME_FILE = 'data/stock_name_mapping.csv'
INDUSTRY_FILE = 'data/股票行业三级分类_20260616_033518.csv'
BLOCK_RELATION_FILE = 'data/stock_block_relation.csv'
OUTPUT_FILE = 'output/盘后选股模型_V8_1_20260616_盘后.xlsx'

df = pd.read_csv(SNAPSHOT_FILE, encoding='utf-8-sig')
print(f"[1] 快照数据: {len(df)} 条, 列数: {len(df.columns)}")
print(f"    快照时间: {df['查询时间'].iloc[0] if '查询时间' in df.columns else 'N/A'}")
print(f"    行情日期: {df['HqDate'].iloc[0] if 'HqDate' in df.columns else 'N/A'}")

name_df = pd.read_csv(NAME_FILE, encoding='utf-8-sig')
name_map = dict(zip(name_df['code'], name_df['name']))
df['股票名称'] = df['code'].map(name_map).fillna(df['code'])
```

### 步骤 2：ST 过滤

```python
st_mask = df['股票名称'].str.contains(r'\*?ST', case=False, na=False)
st_count = st_mask.sum()
df = df[~st_mask].copy()
print(f"[2] ST过滤: 排除 {st_count} 只, 剩余 {len(df)} 只")
```

### 步骤 3：基础过滤

```python
mask = (
    (df['IsT0Fund'] == 0) &
    (df['IsKzz'] == 0) &
    (df['TPFlag'] == 0) &
    (df['SafeValue'] != -1)
)
code_mask = df['code'].str.match(r'^(6|0|3|4|8)\d{5}\.(SZ|SH|BJ)$', na=False)
df_valid = df[mask & code_mask].copy()
print(f"[3] 基础过滤后: {len(df_valid)} 只")
```

### 步骤 3.1：数据清洗（5 项 Bug 修复）— 详见本文档【二】

### 步骤 3.2：老登过滤（剔除长期无活跃度股票）— 详见本文档【四】

### 步骤 4：加载 K 线 + 计算技术指标 — 详见本文档【三】

### 步骤 5：合并行业 + 板块 + K 线技术指标 + 涨停判断 + 辅助字段 — 详见本文档【五/六/七】

### 步骤 6：压力位计算 — 详见本文档【八】

### 步骤 7：5 策略评分（每策略 4 维度）— 详见本文档【九】

### 步骤 8：执行评分

```python
print("\n===== 执行五策略评分 =====")
scores_daban = score_daban(df_valid)
scores_qushi = score_qushi(df_valid)
scores_cuoshai = score_cuoshai(df_valid)
scores_ruozhuan = score_ruozhuanqiang(df_valid)
scores_qzr = score_qiangzhuanruo(df_valid)

THRESHOLDS = {'daban': 35, 'qushi': 60, 'cuoshai': 55, 'ruozhuan': 50, 'qzr': 50}
MAX_PER_MODEL = 30

print(f"打板≥{THRESHOLDS['daban']}: {(scores_daban['总分'] >= THRESHOLDS['daban']).sum()} 只")
print(f"趋势≥{THRESHOLDS['qushi']}: {(scores_qushi['总分'] >= THRESHOLDS['qushi']).sum()} 只")
print(f"错杀≥{THRESHOLDS['cuoshai']}: {(scores_cuoshai['总分'] >= THRESHOLDS['cuoshai']).sum()} 只")
print(f"弱转强≥{THRESHOLDS['ruozhuan']}: {(scores_ruozhuan['总分'] >= THRESHOLDS['ruozhuan']).sum()} 只")
print(f"强转弱≥{THRESHOLDS['qzr']}: {(scores_qzr['总分'] >= THRESHOLDS['qzr']).sum()} 只")
```

**5 策略阈值表（核心参数）**：

| 策略 ID | 函数名 | 阈值（min_score） | 最大保留数（top_n） |
|---------|--------|-------------------|---------------------|
| dbqzt   | `score_daban` | 35 | 30 |
| qszsl   | `score_qushi` | 60 | 30 |
| cslx    | `score_cuoshai` | 55 | 30 |
| rzq     | `score_ruozhuanqiang` | 50 | 30（注：使用说明 sheet 中写"≤15"，源码 `MAX_PER_MODEL=30`，以源码为准） |
| qzrfc   | `score_qiangzhuanruo` | 50 | 30 |

### 步骤 9：构建结果（筛选 + 排序 + Top N + 压力位）

```python
COL_RENAME = {
    'code': '股票代码', '股票名称': '股票名称', 'ZAF': '涨幅%', 'fHSL': '换手率%',
    'Wtb': '量比', 'Zsz': '总市值(亿)', 'Zjl': '主力净流入(万)',
    'FCAmo': '封单额(万)', 'FCb': '封成比', 'fLianB': '连板数',
    'VOpenZAF': '竞价涨幅%', 'OpenZAF': '开盘涨幅%', 'FzAmo': '尾盘金额(万)',
    'OpenAmo': '竞价金额', 'ZAFYesterday': '前日涨幅%',
    'ZAFPre5': '5日涨幅%', 'ZAFPre10': '10日涨幅%', 'ZAFPre20': '20日涨幅%', 'ZAFPre60': '60日涨幅%',
    'YearZTDay': '年涨停天数', '行业': '行业', '行业涨停数': '行业涨停数',
    '行业涨停率': '行业涨停率%', '行业平均涨幅': '行业平均涨幅%',
    '最新价': '最新价', '大买占比': '大买占比',
    '排名': '排名', '选股模型': '选股模型',
    '封板强度': '封板强度', '连板辨识度': '连板辨识度', '竞价抢筹': '竞价抢筹', '风险扣分': '风险扣分',
    '均线多头': '均线多头', '量价配合': '量价配合', 'MACD方向': 'MACD方向', '大单流入': '大单流入',
    '恐慌深度': '恐慌深度', '承接力度': '承接力度', '恐慌极值': '恐慌极值', '催化剂': '催化剂',
    '竞价异动': '竞价异动', '预期差': '预期差', '点火信号': '点火信号', '股性': '股性',
    '主力被套深度': '主力被套深度', '回踩幅度': '回踩幅度', '板块支撑': '板块支撑', '反抽信号': '反抽信号',
    '总分': '总分', '选股逻辑': '选股逻辑', '次日确认': '次日确认',
    '压力位': '压力位', '压力位类型': '压力位类型', '压力位幅度%': '压力位幅度%',
    '入选策略数': '入选策略数', '入选策略': '入选策略',
    '价格估算': '价格估算',
    '次日确认条件数': '次日确认条件数',
}

BASE_COLS_MAP = {
    'daban': ['code', '股票名称', 'ZAF', 'fHSL', 'Wtb', 'Zsz', 'Zjl', 'FCAmo', 'FCb', 'fLianB', 'VOpenZAF', '行业涨停数', '最新价', '价格估算'],
    'qushi': ['code', '股票名称', 'ZAF', 'fHSL', 'Wtb', 'Zsz', 'Zjl', '行业', '最新价', '价格估算'],
    'cuoshai': ['code', '股票名称', 'ZAF', 'fHSL', 'Wtb', 'Zsz', 'Zjl', 'ZAFPre20', 'ZAFPre60', '行业', '行业涨停率', '最新价', '大买占比', '价格估算'],
    'ruozhuan': ['code', '股票名称', 'ZAF', 'fHSL', 'Wtb', 'Zsz', 'Zjl', 'VOpenZAF', 'OpenZAF', 'FzAmo', 'ZAFYesterday', 'ZAFPre5', 'YearZTDay', '最新价', '价格估算'],
    'qzr': ['code', '股票名称', 'ZAF', 'fHSL', 'Wtb', 'Zsz', 'Zjl', 'ZAFYesterday', '行业', '行业涨停率', '最新价', '大买占比', '价格估算'],
}

def build_result(df_data, scores, model_name, threshold, strategy_key, kline_data):
    result = pd.DataFrame(index=scores.index)
    base_cols = BASE_COLS_MAP.get(strategy_key, ['code', '股票名称', 'ZAF', '最新价'])
    for col in base_cols:
        if col in df_data.columns: result[col] = df_data.loc[scores.index, col]
    score_cols = [c for c in scores.columns if c not in ['code', '股票名称', 'ZAF']]
    for col in score_cols: result[col] = scores[col]
    result = result[result['总分'] >= threshold].copy()
    result = result.sort_values('总分', ascending=False).head(MAX_PER_MODEL).reset_index(drop=True)
    result.insert(0, '排名', range(1, len(result) + 1))
    result.insert(1, '选股模型', model_name)
    if len(result) > 0:
        pv = []; pn = []
        for idx, row in result.iterrows():
            code = row['code']; close = row.get('最新价', np.nan)
            if pd.notna(close) and close > 0:
                v, n = calc_pressure_level(code, kline_data, close)
                pv.append(v); pn.append(n)
            else:
                pv.append(np.nan); pn.append('')
        result['压力位'] = pv; result['压力位类型'] = pn
        result['压力位幅度%'] = result.apply(
            lambda r: round((r['压力位'] - r['最新价']) / r['最新价'] * 100, 2)
            if pd.notna(r['压力位']) and pd.notna(r['最新价']) and r['最新价'] > 0 else np.nan, axis=1)
    result = result.rename(columns=COL_RENAME)
    return result

result_daban = build_result(df_valid, scores_daban, '🔥打板求涨停', THRESHOLDS['daban'], 'daban', kline_latest)
result_qushi = build_result(df_valid, scores_qushi, '📈趋势主升浪', THRESHOLDS['qushi'], 'qushi', kline_latest)
result_cuoshai = build_result(df_valid, scores_cuoshai, '🩹错杀低吸', THRESHOLDS['cuoshai'], 'cuoshai', kline_latest)
result_ruozhuan = build_result(df_valid, scores_ruozhuan, '⚡弱转强', THRESHOLDS['ruozhuan'], 'ruozhuan', kline_latest)
result_qzr = build_result(df_valid, scores_qzr, '🔄强转弱反抽', THRESHOLDS['qzr'], 'qzr', kline_latest)
```

### 步骤 10：多策略共振（≥2 策略交叉确认）

```python
print("\n===== 多策略共振 =====")
all_selected = {}
all_next_day_confirm = {}
for name, result in [('打板', result_daban), ('趋势', result_qushi), ('错杀', result_cuoshai), ('弱转强', result_ruozhuan), ('强转弱', result_qzr)]:
    for _, r in result.iterrows():
        code = r['股票代码']
        if code not in all_selected: all_selected[code] = []
        if name not in all_selected[code]:
            all_selected[code].append(name)
        confirm = r.get('次日确认', '') if '次日确认' in r else ''
        if code not in all_next_day_confirm: all_next_day_confirm[code] = []
        if confirm: all_next_day_confirm[code].append((name, confirm))

resonance_rows = []
for code, models in all_selected.items():
    if len(models) >= 2:
        row_data = df_valid[df_valid['code'] == code]
        if len(row_data) == 0: continue
        row = row_data.iloc[0]
        close = row.get('最新价', np.nan)
        if pd.notna(close) and close > 0: p_val, p_name = calc_pressure_level(code, kline_latest, close)
        else: p_val, p_name = np.nan, ''
        confirm_list = all_next_day_confirm.get(code, [])
        if confirm_list:
            unified_confirm = ' 且 '.join([f'[{n}]{c}' for n, c in confirm_list])
        else:
            unified_confirm = ''
        confirm_count = len(confirm_list)
        resonance_rows.append({'code': code, '股票名称': row.get('股票名称', code), 'ZAF': row.get('ZAF', 0),
                               'fHSL': row.get('fHSL', 0), 'Zjl': row.get('Zjl', 0), '行业': row.get('行业', ''),
                               '入选策略数': len(models), '入选策略': '、'.join(models),
                               '最新价': close, '压力位': p_val, '压力位类型': p_name,
                               '次日确认条件数': confirm_count,
                               '次日确认': unified_confirm})

result_resonance = pd.DataFrame(resonance_rows)
if len(result_resonance) > 0:
    result_resonance = result_resonance.sort_values('入选策略数', ascending=False).reset_index(drop=True)
    result_resonance.insert(0, '排名', range(1, len(result_resonance) + 1))
    result_resonance = result_resonance.rename(columns=COL_RENAME)
print(f"多策略共振(≥2策略): {len(result_resonance)} 只")
```

### 步骤 11：写入 Excel（8 Sheet）

```python
wb = Workbook()
# ...（样式定义略）

# 8 Sheet 输出顺序：
write_sheet(wb, '🔥打板求涨停', result_daban, f'封板+连板+竞价 (≥{THRESHOLDS["daban"]}分)')
write_sheet(wb, '📈趋势主升浪', result_qushi, f'均线+量价+MACD+大单 (≥{THRESHOLDS["qushi"]}分)')
write_sheet(wb, '🩹错杀低吸', result_cuoshai, f'恐慌+承接+极值+催化剂 (≥{THRESHOLDS["cuoshai"]}分)')
write_sheet(wb, '⚡弱转强', result_ruozhuan, f'竞价异动+预期差+点火 (≥{THRESHOLDS["ruozhuan"]}分)')
write_sheet(wb, '🔄强转弱反抽', result_qzr, f'主力被套+回踩+支撑+反抽 (≥{THRESHOLDS["qzr"]}分)')
write_sheet(wb, '多策略共振', result_resonance, '≥2策略交叉确认')

# 还有：模型总览（Sheet 1）、模型使用方法（Sheet 8）、V8.1修复说明（Sheet 9）
# 总 Sheet 数 = 9（"模型总览"+"5策略"+"多策略共振"+"模型使用方法"+"V8.1修复说明"）
```

**最终 Excel 8 Sheet 对应映射表**：

| Sheet 名 | 内容来源 | 对应策略 ID |
|----------|---------|-------------|
| 模型总览 | 5 策略阈值/入选数/核心驱动 | （全局） |
| 🔥打板求涨停 | `result_daban` | dbqzt |
| 📈趋势主升浪 | `result_qushi` | qszsl |
| 🩹错杀低吸 | `result_cuoshai` | cslx |
| ⚡弱转强 | `result_ruozhuan` | rzq |
| 🔄强转弱反抽 | `result_qzr` | qzrfc |
| 多策略共振 | `result_resonance` | （跨策略） |
| 模型使用方法 | 静态文本 | （说明） |
| V8.1修复说明 | 静态文本 | （说明） |

### 步骤 12：打印结果

```python
def pr(result, title):
    print(f"\n{'='*80}\n{title}\n{'='*80}")
    if len(result) == 0: print("  无符合条件标的"); return
    for _, row in result.head(10).iterrows():
        print(f"  {row.get('排名','')}. {row.get('股票名称','')}({row.get('股票代码','')}) | 总分:{row.get('总分',0)}")
        print(f"     逻辑: {row.get('选股逻辑','')}")
        print(f"     次日确认: {row.get('次日确认','')}")
        print()

pr(result_daban, '🔥打板求涨停')
pr(result_qushi, '📈趋势主升浪')
pr(result_cuoshai, '🩹错杀低吸')
pr(result_ruozhuan, '⚡弱转强')
pr(result_qzr, '🔄强转弱反抽')
print("\n===== V8.1 五策略尖刀模型 (6月16日盘后) 运行完成 =====")
```

---

## 二、通用数据清洗规则（5 项 Bug 修复）

> **位置**：源码 `# ========== 3.1 数据清洗 (修复V8.1审核Bug) ==========` 段（run.py 第 70-107 行）
> **作用**：所有 5 策略共用，先清洗后评分；选股逻辑不变，但保证字段语义正确。

### 1. Wtb 负值过滤（Bug1）

**问题**：Wtb 量比存在大量负值 (-99.8 ~ -0.0) 和 0，均为异常值
**修复**：置 NaN，防止趋势策略误判

```python
# Bug1: Wtb量比存在大量负值(-99.8~-0.0)和0,均为异常值,需置NaN
wtb_before = df_valid['Wtb'].copy()
df_valid['Wtb'] = pd.to_numeric(df_valid['Wtb'], errors='coerce')
wtb_invalid = ((df_valid['Wtb'] < 0) | (df_valid['Wtb'] == 0)).sum()
df_valid.loc[(df_valid['Wtb'] < 0) | (df_valid['Wtb'] == 0), 'Wtb'] = np.nan
```

**影响策略**：qszsl（量价配合维度用 Wtb）/ cslx（催化剂维度用 Wtb）/ rzq（点火信号维度用 Wtb）

### 2. FCb/FCAmo 负值清洗（Bug2）

**问题**：FCb/FCAmo 存在 11 条负值
**修复**：负值置 0

```python
# Bug2: FCb/FCAmo 存在负值,需清洗为0
fcb_neg = (pd.to_numeric(df_valid['FCb'], errors='coerce') < 0).sum()
fcamo_neg = (pd.to_numeric(df_valid['FCAmo'], errors='coerce') < 0).sum()
df_valid['FCb'] = pd.to_numeric(df_valid['FCb'], errors='coerce').where(lambda x: x >= 0, 0)
df_valid['FCAmo'] = pd.to_numeric(df_valid['FCAmo'], errors='coerce').where(lambda x: x >= 0, 0)
```

**影响策略**：dbqzt（封板强度维度用 FCb 和 FCAmo）

### 3. 卖撤率公式重写（Bug3）

**问题**：原公式 `SCancel/L2OrderNum` 中位 1.30 (>1 不合理)
**修复**：改用同单位公式 `SCancel/(SCancel+TotalSVol)`，范围 [0,1]，中位约 0.77；缺失用中位 0.5 兜底

```python
# Bug3: 卖撤率公式单位错配, 改用同单位公式 SCancel/(SCancel+TotalSVol)
#   - 原公式 SCancel/L2OrderNum 中位1.30(>1不合理)
#   - 新公式: 卖单撤单占比, 范围[0,1], 中位约0.77
sc = pd.to_numeric(df_valid['SCancel'], errors='coerce')
tsv = pd.to_numeric(df_valid['TotalSVol'], errors='coerce')
df_valid['卖撤率'] = (sc / (sc + tsv + 1)).fillna(0.5)  # 缺失用中位0.5兜底
```

**影响策略**：dbqzt（风险扣分维度用「卖撤率」字段，新阈值 >0.95/-7、>0.90/-3）

### 4. fLianB 语义重定义（Bug4）

**问题**：原 fLianB 字段实为"封板强度系数"（涨停股中位 1.23，非涨停股中位 0.96），并非连板数
**修复**：
- 真正连板数取 `ConZAFDateNum`（涨停股中位 2，最小 1，最大 7）
- 保留原 fLianB 值作为「封板强度系数」（供打板策略参考）
- 非涨停股的 ConZAFDateNum 后置清洗（步骤 5.2）置 0

```python
# Bug4: fLianB 实为"涨停系数/封板强度"(涨停股中位1.23,非涨停股中位0.96),非连板数
#   - 真正连板数应取 ConZAFDateNum (涨停股中位2,最小1,最大7)
#   - 涨停股保留 ConZAFDateNum 作为连板数;非涨停股置0
#   - 保留 fLianB 但语义改为"封板强度系数"(供打板策略参考)
df_valid['封板强度系数'] = pd.to_numeric(df_valid['fLianB'], errors='coerce').fillna(0)
df_valid['fLianB'] = pd.to_numeric(df_valid['ConZAFDateNum'], errors='coerce').fillna(0).clip(lower=0)
# 非涨停股的 ConZAFDateNum 可能是连续上涨天数(非涨停意义),置0
# 此处先保留,后面涨停判断后再清洗
```

**后续清洗（步骤 5.2）**：

```python
# 修复Bug4: 非涨停股的fLianB(原ConZAFDateNum)可能不代表连板数,需置0
df_valid.loc[~df_valid['是否涨停'], 'fLianB'] = 0
# fLianB现在语义为"连板数",范围[0,7]整数,需取整
df_valid['fLianB'] = df_valid['fLianB'].astype(int)
```

**影响策略**：dbqzt（连板辨识度维度用 fLianB；封板强度维度用「封板强度系数」）

### 5. 数值字段统一转 numeric（Bug5）

**问题**：ZAF/Zjl/Zsz 等数值字段可能为字符串类型，影响后续计算
**修复**：统一转 numeric

```python
# Bug5: ZAF/Zjl/Zsz 等数值字段统一转 numeric
for col in ['ZAF','Zjl','Zsz','fHSL','VOpenZAF','OpenZAF','FzAmo','OpenAmo',
            'ZAFYesterday','ZAFPre5','ZAFPre10','ZAFPre20','ZAFPre60',
            'YearZTDay','BetaValue','TotalBVol','TotalSVol','BCancel','SCancel',
            'FCAmo','FCb','CJJEPre1','L2OrderNum','MA5Value','OpenAmoPre1']:
    if col in df_valid.columns:
        df_valid[col] = pd.to_numeric(df_valid[col], errors='coerce')

print(f"[3.1] 数据清洗: Wtb异常{wtb_invalid}只置NaN, FCb负值{fcb_neg}只, FCAmo负值{fcamo_neg}只, 卖撤率公式已重写")
```

**转换字段清单（25 个）**：
`ZAF, Zjl, Zsz, fHSL, VOpenZAF, OpenZAF, FzAmo, OpenAmo, ZAFYesterday, ZAFPre5, ZAFPre10, ZAFPre20, ZAFPre60, YearZTDay, BetaValue, TotalBVol, TotalSVol, BCancel, SCancel, FCAmo, FCb, CJJEPre1, L2OrderNum, MA5Value, OpenAmoPre1`

---

## 三、K 线技术指标计算

> **位置**：源码 `# ========== 4. 加载K线数据 ==========` 段（run.py 第 117-158 行）
> **数据源**：5 个 K 线 CSV（字段：`code,date,open,high,low,close,volume,amount,change_pct,turnover,forward_factor`）
> **去重**：按 `code,date` 去重（保留最后一条），按 `code,date` 升序排序

```python
kline_dfs = []
for f in KLINE_FILES:
    kline_dfs.append(pd.read_csv(f, encoding='utf-8-sig'))
kline = pd.concat(kline_dfs, ignore_index=True)
kline = kline.drop_duplicates(subset=['code', 'date'], keep='last')
kline = kline.sort_values(['code', 'date']).reset_index(drop=True)
kline = kline[kline['code'].str.match(r'^(6|0|3|4|8)\d{5}\.(SZ|SH|BJ)$', na=False)].copy()
print(f"[4] K线数据: {len(kline)} 条, 日期范围: {kline['date'].min()} ~ {kline['date'].max()}")


def calc_technical_indicators(group):
    group = group.sort_values('date').reset_index(drop=True)
    if len(group) < 5:
        return group
    close = group['close'].astype(float)
    volume = group['volume'].astype(float)
    amount = group['amount'].astype(float)

    # 均线：MA5 / MA10 / MA20
    group['MA5'] = close.rolling(5, min_periods=1).mean()
    group['MA10'] = close.rolling(10, min_periods=1).mean()
    group['MA20'] = close.rolling(20, min_periods=1).mean()

    # MACD：EMA12/EMA26 → DIF → DEA(EMA9) → MACD_BAR = 2*(DIF-DEA)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    dif = ema12 - ema26
    dea = dif.ewm(span=9, adjust=False).mean()
    group['DIF'] = dif
    group['DEA'] = dea
    group['MACD_BAR'] = 2 * (dif - dea)

    # 布林带：BOLL_MID = MA20, BOLL_UP = MA20 + 2*std
    group['BOLL_MID'] = close.rolling(20, min_periods=1).mean()
    boll_std = close.rolling(20, min_periods=1).std()
    group['BOLL_UP'] = group['BOLL_MID'] + 2 * boll_std
    return group


print("[4] 计算技术指标中...")
kline = kline.groupby('code', group_keys=False).apply(calc_technical_indicators)
latest_date = kline['date'].max()
kline_latest = kline[kline['date'] == latest_date].set_index('code')
print(f"[4] 最新K线日期: {latest_date}, 股票数: {len(kline_latest)}")
```

**技术指标清单**：
- **均线**：MA5 / MA10 / MA20（min_periods=1）
- **MACD**：DIF = EMA12 - EMA26 / DEA = EMA9(DIF) / MACD_BAR = 2 * (DIF - DEA)
- **布林带**：BOLL_MID = MA20 / BOLL_UP = BOLL_MID + 2 * std(MA20)

**注**：`volume` / `amount` 计算但未在源码后续使用（保留供未来扩展）。

---

## 四、老登过滤逻辑

> **位置**：源码 `# ========== 3.1 数据清洗 ==========` 段末尾（run.py 第 109-115 行）
> **作用**：剔除长期无活跃度股票（年涨停 0 + 换手<1% + Beta<0.8）

```python
is_laodeng = (
    (df_valid['YearZTDay'] == 0) &
    (df_valid['fHSL'] < 1) &
    (df_valid['BetaValue'] < 0.8)
)
df_valid = df_valid[~is_laodeng].copy()
print(f"[3] 老登过滤后: {len(df_valid)} 只")
```

**3 条件 AND 逻辑**：
1. `YearZTDay == 0`（一年内 0 次涨停）
2. `fHSL < 1`（换手率 < 1%，低活跃）
3. `BetaValue < 0.8`（Beta < 0.8，弱于大盘）

**影响**：所有 5 策略共用此过滤。

---

## 五、涨停判断逻辑（FCAmo 判据）

> **位置**：源码 `# ========== 5. 合并行业+板块+K线 ==========` 段（run.py 第 176-183 行）
> **核心**：区分板块（创业板/科创板 19.5%、北交所 29.5%、主板/中小板 9.8%）

```python
# 行业统计 (修复V8.1 Bug7: 区分板块计算涨停数)
def _is_zt_for_row(r):
    code = str(r['code'])
    zaf = float(r['ZAF']) if pd.notna(r['ZAF']) else 0
    if code.startswith(('688','689','300','301','302')): return zaf >= 19.5
    elif code.startswith(('8','4')): return zaf >= 29.5
    else: return zaf >= 9.8
df_valid['_is_zt'] = df_valid.apply(_is_zt_for_row, axis=1)
```

**3 档涨停阈值**：
- 创业板（300/301/302）、科创板（688/689）：`ZAF >= 19.5`（20% 涨停）
- 北交所（8/4 开头）：`ZAF >= 29.5`（30% 涨停）
- 主板/中小板（其他）：`ZAF >= 9.8`（10% 涨停）

**派生字段**：
- `df_valid['是否涨停'] = df_valid['_is_zt']`

**后续使用**：
- dbqzt pool 筛选（`df['是否涨停']`）
- dbqzt 封板强度维度（涨停基础分 10）
- cslx 惩罚规则（已反弹不算错杀）
- rzq 惩罚规则（涨停股总分清 0）
- fLianB 非涨停股置 0

---

## 六、行业统计 + 辅助字段计算

### 6.1 行业统计

> **位置**：源码 run.py 第 161-194 行

```python
industry_df = pd.read_csv(INDUSTRY_FILE, encoding='utf-8-sig')
industry_map = {}
for _, row in industry_df.iterrows():
    industry_map[row['stock_code']] = row.get('行业一级', '')
df_valid['行业'] = df_valid['code'].map(lambda c: industry_map.get(c, '其他'))

block_df = pd.read_csv(BLOCK_RELATION_FILE, encoding='utf-8-sig')
block_industry = block_df[block_df['block_type'] == '行业'].copy()
block_map = {}
for _, row in block_industry.iterrows():
    if row['stock_code'] not in block_map:
        block_map[row['stock_code']] = []
    block_map[row['stock_code']].append(row['block_name'])
df_valid['所属板块'] = df_valid['code'].map(lambda c: '|'.join(block_map.get(c, [])))

# 行业统计 (修复V8.1 Bug7: 区分板块计算涨停数)
def _is_zt_for_row(r):
    code = str(r['code'])
    zaf = float(r['ZAF']) if pd.notna(r['ZAF']) else 0
    if code.startswith(('688','689','300','301','302')): return zaf >= 19.5
    elif code.startswith(('8','4')): return zaf >= 29.5
    else: return zaf >= 9.8
df_valid['_is_zt'] = df_valid.apply(_is_zt_for_row, axis=1)
industry_stats = df_valid.groupby('行业').agg(
    行业总数=('code', 'count'),
    行业涨停数=('_is_zt', 'sum'),
    行业平均涨幅=('ZAF', 'mean'),
    行业主力净流入=('Zjl', 'sum'),
).reset_index()
industry_stats['行业涨停率'] = (industry_stats['行业涨停数'] / industry_stats['行业总数'] * 100).round(2)
df_valid = df_valid.merge(
    industry_stats[['行业', '行业总数', '行业涨停数', '行业涨停率', '行业平均涨幅', '行业主力净流入']],
    on='行业', how='left'
)
```

**派生字段**：`行业`、`所属板块`、`行业总数`、`行业涨停数`、`行业涨停率`、`行业平均涨幅`、`行业主力净流入`

### 6.2 合并 K 线技术指标

```python
# 合并K线技术指标
kline_tech = kline_latest[['MA5', 'MA10', 'MA20', 'DIF', 'DEA', 'MACD_BAR', 'BOLL_UP']].copy()
kline_tech.columns = ['KL_MA5', 'KL_MA10', 'KL_MA20', 'KL_DIF', 'KL_DEA', 'KL_MACD_BAR', 'KL_BOLL_UP']
df_valid = df_valid.merge(kline_tech, left_on='code', right_index=True, how='left')
```

**派生字段**：`KL_MA5`、`KL_MA10`、`KL_MA20`、`KL_DIF`、`KL_DEA`、`KL_MACD_BAR`、`KL_BOLL_UP`

### 6.3 最新价计算（兜底优先级）

```python
# 最新价 (修复V8.1 Bug5: 不再用MA5Value兌底,改为缺K线则剔除)
def get_latest_close(code):
    if code in kline_latest.index:
        row = kline_latest.loc[code]
        if isinstance(row, pd.DataFrame): row = row.iloc[0]
        return float(row['close'])
    return np.nan

df_valid['最新价'] = df_valid['code'].apply(get_latest_close)
# 兌底优先级: 1)K线收盘价 2)快照现价(如有) 3) MA5Value (最后乲底, 标记为估算)
ma5_snap = df_valid.get('MA5Value', pd.Series(np.nan, index=df_valid.index))
# 记录哪些股票用MA5兌底(估算价)
est_price_mask = df_valid['最新价'].isna() & ma5_snap.notna() & (ma5_snap > 0)
df_valid['最新价'] = df_valid['最新价'].fillna(ma5_snap)
df_valid['价格估算'] = est_price_mask  # 后续可据此标记
```

**派生字段**：`最新价`（K 线收盘价 → MA5Value 兜底）、`价格估算`（布尔）

### 6.4 辅助字段计算

```python
# 辅助字段
df_valid['大买占比'] = df_valid['TotalBVol'] / (df_valid['TotalBVol'] + df_valid['TotalSVol'] + 1)
# df_valid['卖撤率'] 已在数据清洗阶段重新计算 (SCancel/(SCancel+TotalSVol))
df_valid['恐慌量'] = df_valid['fHSL'] * df_valid['ZAF'].abs()

# 涨停判断 (沿用 _is_zt_for_row)
df_valid['是否涨停'] = df_valid['_is_zt']
print(f"[5] 辅助计算完成, 当日涨停: {df_valid['是否涨停'].sum()} 只, 价格估算{est_price_mask.sum()}只")

# 修复Bug4: 非涨停股的fLianB(原ConZAFDateNum)可能不代表连板数,需置0
df_valid.loc[~df_valid['是否涨停'], 'fLianB'] = 0
# fLianB现在语义为"连板数",范围[0,7]整数,需取整
df_valid['fLianB'] = df_valid['fLianB'].astype(int)
```

**派生字段**：
- `大买占比 = TotalBVol / (TotalBVol + TotalSVol + 1)`
- `恐慌量 = fHSL * |ZAF|`
- `是否涨停`（布尔）
- `fLianB`（重定义为连板数，非涨停股置 0，取整）

---

## 七、压力位计算逻辑

> **位置**：源码 run.py 第 235-256 行
> **作用**：取最接近现价的"压力位"作为参考，用于选股结果展示

```python
def calc_pressure_level(code, kline_data, latest_close):
    if code not in kline_data.index:
        return latest_close * 1.02, '估算'
    row = kline_data.loc[code]
    if isinstance(row, pd.DataFrame): row = row.iloc[0]
    candidates = []
    prev_high = float(row.get('high', 0))
    if prev_high > latest_close * 1.005: candidates.append((prev_high, '前日高点'))
    boll_up = row.get('BOLL_UP', np.nan)
    if pd.notna(boll_up) and float(boll_up) > latest_close * 1.005: candidates.append((float(boll_up), '布林上轨'))
    for ma_key in ['MA20', 'MA10', 'MA5']:
        ma_val = row.get(ma_key, np.nan)
        if pd.notna(ma_val) and float(ma_val) > latest_close * 1.003: candidates.append((float(ma_val), ma_key))
    if not candidates:
        zt_price = latest_close * 1.10
        code_str = str(code)
        if code_str.startswith(('688','689','300','301','302')): zt_price = latest_close * 1.20
        elif code_str.startswith(('8','4')): zt_price = latest_close * 1.30
        return round(zt_price, 2), '涨停价'
    candidates.sort(key=lambda x: abs(x[0] - latest_close))
    return round(candidates[0][0], 2), candidates[0][1]
```

**候选压力位优先级**：
1. 前日高点（`high > close*1.005`）
2. 布林上轨（`BOLL_UP > close*1.005`）
3. MA20 / MA10 / MA5（均需 `> close*1.003`）
4. 涨停价（无候选时）：主板 1.10 / 创科 1.20 / 北交 1.30
5. 无 K 线：`close*1.02`，标签"估算"

**最终取值**：所有候选按 `|candidate - close|` 升序排序，取最接近者。

**派生字段**：`压力位`、`压力位类型`、`压力位幅度% = (压力位 - 最新价) / 最新价 * 100`

---

## 八、5 策略详解

### 策略 1: 🔥 打板求涨停 (dbqzt)

#### 元信息
- **策略函数名**：`score_daban`
- **核心驱动**：情绪 × 流动性（合并旧打板 + 连板）
- **阈值**：≥35 分
- **Top N**：30（`MAX_PER_MODEL`）
- **Excel Sheet**：`🔥打板求涨停`（注：sheet 名含 emoji）
- **基础列**：`['code', '股票名称', 'ZAF', 'fHSL', 'Wtb', 'Zsz', 'Zjl', 'FCAmo', 'FCb', 'fLianB', 'VOpenZAF', '行业涨停数', '最新价', '价格估算']`

#### 股票池筛选

```python
pool = df[
    (df['是否涨停']) |
    (df['ZAF'] >= 7)
].copy()
```

**pool 条件**：涨停股 OR 当日涨幅 ≥ 7%

#### 评分维度 1：封板强度（0-40 分）

**计算公式**（涨停基础分 + 封成比加成 + 封单额加成 + 封板强度系数加成）：

```python
# (1) 封板强度(0-40) — fLianB已重定义为连板数,补充原fLianB作为封板强度系数
#     涨停基础分10 + 封成比加成(0-20) + 封单额加成(0-10) + 封板强度系数加成(0-5)
scores['封板强度'] = 0
fc_b = pool['FCb']; fc_amo = pool['FCAmo']
fcb_strength = pool.get('封板强度系数', pd.Series(0, index=pool.index))
scores.loc[pool['是否涨停'], '封板强度'] += 10
for idx in pool[pool['是否涨停']].index: lp[idx].append('涨停')
scores.loc[fc_b >= 0.5, '封板强度'] += 20
scores.loc[(fc_b >= 0.2) & (fc_b < 0.5), '封板强度'] += 14
scores.loc[(fc_b >= 0.05) & (fc_b < 0.2), '封板强度'] += 8
scores.loc[(fc_b > 0) & (fc_b < 0.05), '封板强度'] += 3
for idx in pool[fc_b >= 0.2].index: lp[idx].append('封板稳固')
scores.loc[fc_amo >= 30000, '封板强度'] += 10
scores.loc[(fc_amo >= 10000) & (fc_amo < 30000), '封板强度'] += 8
scores.loc[(fc_amo >= 5000) & (fc_amo < 10000), '封板强度'] += 5
scores.loc[(fc_amo >= 1000) & (fc_amo < 5000), '封板强度'] += 2
for idx in pool[fc_amo >= 10000].index: lp[idx].append('大封单')
# 补充: 用封板强度系数(原fLianB值)作为额外加分,阈值适配其原始分布(中位~1.0)
scores.loc[fcb_strength >= 2, '封板强度'] += 5
scores.loc[(fcb_strength >= 1.5) & (fcb_strength < 2), '封板强度'] += 3
scores['封板强度'] = scores['封板强度'].clip(0, 40)
```

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 涨停基础分 | `是否涨停` | True | +10 |
| 封成比 FCb | `FCb` | ≥0.5 | +20 |
| 封成比 FCb | `FCb` | [0.2, 0.5) | +14 |
| 封成比 FCb | `FCb` | [0.05, 0.2) | +8 |
| 封成比 FCb | `FCb` | (0, 0.05) | +3 |
| 封单额 FCAmo | `FCAmo` | ≥30000 | +10 |
| 封单额 FCAmo | `FCAmo` | [10000, 30000) | +8 |
| 封单额 FCAmo | `FCAmo` | [5000, 10000) | +5 |
| 封单额 FCAmo | `FCAmo` | [1000, 5000) | +2 |
| 封板强度系数 | `封板强度系数` | ≥2 | +5 |
| 封板强度系数 | `封板强度系数` | [1.5, 2) | +3 |

**clip 上限**：40

#### 评分维度 2：连板辨识度（0-30 分）

**计算公式**（连板数 fLianB 分档，fLianB 已重定义为 ConZAFDateNum 整数）：

```python
# (2) 连板辨识度(0-30) — fLianB现为真正连板数(整数), 阈值重校准
#     ≥7=30 / ≥5=26 / 4=22 / 3=18 / 2=12 / 1=6 / 0=0
scores['连板辨识度'] = 0
lb = pool['fLianB']  # 现为整数: 0=未涨停, 1=首板, 2=2连板, 3=3连板...
scores.loc[lb >= 7, '连板辨识度'] = 30
scores.loc[(lb >= 5) & (lb < 7), '连板辨识度'] = 26
scores.loc[(lb >= 4) & (lb < 5), '连板辨识度'] = 22
scores.loc[(lb == 3), '连板辨识度'] = 18
scores.loc[(lb == 2), '连板辨识度'] = 12
scores.loc[(lb == 1), '连板辨识度'] = 6
for idx in pool[lb >= 3].index: lp[idx].append(f'{lb[idx]:.0f}连板')
for idx in pool[lb == 2].index: lp[idx].append('2连板')
for idx in pool[lb == 1].index: lp[idx].append('首板')
```

| 字段 | 阈值 | 加分 |
|------|------|------|
| `fLianB` | ≥7 | 30 |
| `fLianB` | [5, 7) | 26 |
| `fLianB` | [4, 5) | 22 |
| `fLianB` | ==3 | 18 |
| `fLianB` | ==2 | 12 |
| `fLianB` | ==1 | 6 |
| `fLianB` | ==0 | 0 |

#### 评分维度 3：竞价抢筹（0-20 分）

**计算公式**（竞价涨幅 VOpenZAF + 尾盘金额 FzAmo）：

```python
# (3) 竞价抢筹(0-20) — 竞价涨幅 + 竞价金额比 + 尾盘抢筹
scores['竞价抢筹'] = 0
vopen = pool.get('VOpenZAF', pd.Series(0, index=pool.index))
fz_amo = pool['FzAmo']
scores.loc[vopen >= 3, '竞价抢筹'] += 10
scores.loc[(vopen >= 1.5) & (vopen < 3), '竞价抢筹'] += 7
scores.loc[(vopen >= 0.5) & (vopen < 1.5), '竞价抢筹'] += 4
for idx in pool[vopen >= 1.5].index: lp[idx].append('竞价抢筹')
scores.loc[fz_amo >= 2000, '竞价抢筹'] += 10
scores.loc[(fz_amo >= 500) & (fz_amo < 2000), '竞价抢筹'] += 7
scores.loc[(fz_amo >= 200) & (fz_amo < 500), '竞价抢筹'] += 4
for idx in pool[fz_amo >= 500].index: lp[idx].append('尾盘抢筹')
scores['竞价抢筹'] = scores['竞价抢筹'].clip(0, 20)
```

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 竞价涨幅 | `VOpenZAF` | ≥3 | +10 |
| 竞价涨幅 | `VOpenZAF` | [1.5, 3) | +7 |
| 竞价涨幅 | `VOpenZAF` | [0.5, 1.5) | +4 |
| 尾盘金额 | `FzAmo` | ≥2000 | +10 |
| 尾盘金额 | `FzAmo` | [500, 2000) | +7 |
| 尾盘金额 | `FzAmo` | [200, 500) | +4 |

**clip 范围**：[0, 20]

#### 评分维度 4：风险扣分（0 ~ -10 分）

**计算公式**（卖撤率高扣分 + 孤板风险扣分）：

```python
# (4) 风险扣分(0~-10) — 卖撤率阈值重校准(新公式中位~0.77,范围[0,1])
#     卖撤率高扣分(-7/-3) + 孤板风险(-8/-4)
scores['风险扣分'] = 0
scr = pool.get('卖撤率', pd.Series(0.5, index=pool.index))  # 新公式范围[0,1]
# 新阈值: >0.95表示几乎全部撤单(异常), >0.90明显偏高
scores.loc[scr > 0.95, '风险扣分'] -= 7
scores.loc[(scr > 0.90) & (scr <= 0.95), '风险扣分'] -= 3
for idx in pool[scr > 0.92].index: lp[idx].append('⚠卖撤率高')
for idx in pool.index:
    lb_val = lb[idx]
    ind_zt = pool.loc[idx, '行业涨停数'] if '行业涨停数' in pool.columns else 0
    # 修复Bug: 行业涨停数修复后是准确值,孤板阈值由<=1校准为<=2
    #   - 修复前(不分板块用9.8): 行业涨停数被低估,阈值<=1过严
    #   - 修复后(区分9.8/19.5/29.5): 行业涨停数准确,阈值<=2更合理
    if lb_val >= 4 and ind_zt <= 2:
        scores.loc[idx, '风险扣分'] -= 8; lp[idx].append('⚠高位孤板')
    elif lb_val >= 3 and ind_zt <= 2:
        scores.loc[idx, '风险扣分'] -= 4; lp[idx].append('⚠孤板风险')
```

| 子项 | 字段 | 阈值 | 扣分 |
|------|------|------|------|
| 卖撤率 | `卖撤率` | >0.95 | -7 |
| 卖撤率 | `卖撤率` | (0.90, 0.95] | -3 |
| 高位孤板 | `fLianB` ≥4 且 `行业涨停数` ≤2 | - | -8 |
| 孤板风险 | `fLianB` ≥3 且 `行业涨停数` ≤2 | - | -4 |

#### 总分公式

```python
scores['总分'] = scores['封板强度'] + scores['连板辨识度'] + scores['竞价抢筹'] + scores['风险扣分']
```

#### 惩罚/过滤规则

```python
mask_weak = (~pool['是否涨停']) & (pool['FCb'] == 0) & (pool['fLianB'] < 1)
scores.loc[mask_weak, '总分'] = (scores.loc[mask_weak, '总分'] * 0.5).round(1)
```

**惩罚条件**：未涨停 + 封成比为 0 + 连板数 < 1 → 总分 × 0.5（弱股减半）

#### 次日确认（条件分支）

```python
scores['次日确认'] = ''
for idx in scores.index:
    if scores.loc[idx, '总分'] < 35: continue
    fc_b_v = pool.loc[idx, 'FCb']; lb_v = pool.loc[idx, 'fLianB']
    is_zt = pool.loc[idx, '是否涨停']
    if lb_v >= 3: scores.loc[idx, '次日确认'] = '竞价不低开(>0%)+竞价量放大'
    elif is_zt and fc_b_v >= 0.2: scores.loc[idx, '次日确认'] = '竞价涨幅>1.5%+不低开'
    elif is_zt and fc_b_v > 0: scores.loc[idx, '次日确认'] = '竞价涨幅>2%+量比>1.5'
    elif is_zt: scores.loc[idx, '次日确认'] = '竞价涨幅>2%+量比>1.5'
    else: scores.loc[idx, '次日确认'] = '竞价涨幅>3%+量比>2+5分钟涨>2%'
    if lb_v >= 5 and fc_b_v < 0.1:
        scores.loc[idx, '次日确认'] += '(⚠封板弱,若低开放弃入场)'
```

#### 选股逻辑

```python
scores['选股逻辑'] = ''
for idx in scores.index:
    parts = lp.get(idx, [])
    if scores.loc[idx, '总分'] <= 0: continue
    if not parts: parts.append(f'涨幅{pool.loc[idx,"ZAF"]:.1f}%')
    scores.loc[idx, '选股逻辑'] = '、'.join(parts) + ' → 打板入选'
```

---

### 策略 2: 📈 趋势主升浪 (qszsl)

#### 元信息
- **策略函数名**：`score_qushi`
- **核心驱动**：均线 × 筹码
- **阈值**：≥60 分
- **Top N**：30
- **Excel Sheet**：`📈趋势主升浪`
- **基础列**：`['code', '股票名称', 'ZAF', 'fHSL', 'Wtb', 'Zsz', 'Zjl', '行业', '最新价', '价格估算']`

#### 股票池筛选

**无 pool 筛选**，对全市场 df 评分（每只股都可入选）：

```python
def score_qushi(df):
    scores = pd.DataFrame(index=df.index)
    scores['code'] = df['code']; scores['股票名称'] = df['股票名称']
    lp = {idx: [] for idx in df.index}

    ma5 = df.get('KL_MA5', pd.Series(np.nan, index=df.index))
    ma10 = df.get('KL_MA10', pd.Series(np.nan, index=df.index))
    ma20 = df.get('KL_MA20', pd.Series(np.nan, index=df.index))
    has_kline = pd.notna(ma5) & pd.notna(ma10) & pd.notna(ma20)
```

**注**：`has_kline` 标记是否有完整 K 线数据（MA5/MA10/MA20 全部非 NaN）

#### 评分维度 1：均线多头（0-35 分）

```python
# (1) 均线多头(0-35) — MA5>MA10>MA20=35, 部分多头按比例给分
scores['均线多头'] = 0
full_bull = has_kline & (ma5 > ma10) & (ma10 > ma20)
scores.loc[full_bull, '均线多头'] = 35
for idx in df[full_bull].index: lp[idx].append('均线多头排列')
short_bull = has_kline & (ma5 > ma10) & (ma10 <= ma20)
scores.loc[short_bull, '均线多头'] = 22
for idx in df[short_bull].index: lp[idx].append('短期均线多头')
r5 = df['ZAFPre5']; r10 = df['ZAFPre10']
scores.loc[~has_kline & (r5 > 0) & (r10 > 0), '均线多头'] = 20
scores.loc[~has_kline & (r5 > 0) & (r10 <= 0), '均线多头'] = 8
```

| 子项 | 条件 | 加分 |
|------|------|------|
| 完整多头 | `has_kline & MA5>MA10 & MA10>MA20` | 35 |
| 短期多头 | `has_kline & MA5>MA10 & MA10≤MA20` | 22 |
| 无K线+多周期上涨 | `~has_kline & ZAFPre5>0 & ZAFPre10>0` | 20 |
| 无K线+仅短期上涨 | `~has_kline & ZAFPre5>0 & ZAFPre10≤0` | 8 |

#### 评分维度 2：量价配合（0-25 分）

```python
# (2) 量价配合(0-25) — 涨+量比>1.5=25, 缩量上涨扣分
scores['量价配合'] = 0
zaf = df['ZAF']; wtb = df['Wtb']
scores.loc[(zaf > 0) & (wtb > 1.5), '量价配合'] = 25
scores.loc[(zaf > 0) & (wtb > 1) & (wtb <= 1.5), '量价配合'] = 18
scores.loc[(zaf > 0) & (wtb > 0.8) & (wtb <= 1), '量价配合'] = 10
scores.loc[(zaf > 0) & (wtb <= 0.8), '量价配合'] = 4
for idx in df[(zaf > 0) & (wtb > 1.5)].index: lp[idx].append('量价齐升')
for idx in df[(zaf > 0) & (wtb <= 0.8)].index: lp[idx].append('⚠缩量上涨')
```

| 子项 | 条件 | 加分 |
|------|------|------|
| 量价齐升 | `ZAF>0 & Wtb>1.5` | 25 |
| 量价配合 | `ZAF>0 & Wtb∈(1, 1.5]` | 18 |
| 量能温和 | `ZAF>0 & Wtb∈(0.8, 1]` | 10 |
| 缩量上涨 | `ZAF>0 & Wtb≤0.8` | 4 |

**注**：`Wtb` 已在数据清洗阶段把负值/0 置 NaN，所以 `wtb <= 0.8` 实际只匹配 (0, 0.8]；NaN 不匹配任何条件（赋 0）

#### 评分维度 3：MACD 方向（0-20 分）

```python
# (3) MACD方向(0-20) — 金叉/向上发散
scores['MACD方向'] = 0
dif = df.get('KL_DIF', pd.Series(np.nan, index=df.index))
dea = df.get('KL_DEA', pd.Series(np.nan, index=df.index))
has_macd = pd.notna(dif) & pd.notna(dea)
scores.loc[has_macd & (dif > 0) & (dif > dea), 'MACD方向'] = 20
scores.loc[has_macd & (dif > 0) & (dif <= dea), 'MACD方向'] = 12
scores.loc[has_macd & (dif <= 0) & (dif > dea), 'MACD方向'] = 10
for idx in df[has_macd & (dif > 0) & (dif > dea)].index: lp[idx].append('MACD金叉')
scores.loc[~has_macd & (r5 > 3), 'MACD方向'] = 14
scores.loc[~has_macd & (r5 > 0) & (r5 <= 3), 'MACD方向'] = 8
```

| 子项 | 条件 | 加分 |
|------|------|------|
| MACD 金叉且水上 | `has_macd & DIF>0 & DIF>DEA` | 20 |
| MACD 水上但下行 | `has_macd & DIF>0 & DIF≤DEA` | 12 |
| MACD 水下但上行 | `has_macd & DIF≤0 & DIF>DEA` | 10 |
| 无 MACD + 强涨 | `~has_macd & ZAFPre5>3` | 14 |
| 无 MACD + 弱涨 | `~has_macd & ZAFPre5∈(0, 3]` | 8 |

#### 评分维度 4：大单流入（0-20 分）

```python
# (4) 大单流入(0-20) — 主力净流入+大单占比
scores['大单流入'] = 0
zjl = df['Zjl']; big_ratio = df['大买占比']
scores.loc[(zjl > 0) & (big_ratio > 0.4), '大单流入'] = 20
scores.loc[(zjl > 0) & (big_ratio > 0.3) & (big_ratio <= 0.4), '大单流入'] = 14
scores.loc[(zjl > 0) & (big_ratio <= 0.3), '大单流入'] = 8
for idx in df[(zjl > 5000) & (big_ratio > 0.3)].index: lp[idx].append('大单持续流入')
```

| 子项 | 条件 | 加分 |
|------|------|------|
| 大单强势 | `Zjl>0 & 大买占比>0.4` | 20 |
| 大单中等 | `Zjl>0 & 大买占比∈(0.3, 0.4]` | 14 |
| 大单弱势 | `Zjl>0 & 大买占比≤0.3` | 8 |

#### 总分公式

```python
scores['总分'] = scores['均线多头'] + scores['量价配合'] + scores['MACD方向'] + scores['大单流入']
```

#### 惩罚/过滤规则

```python
not_uptrend = has_kline & (ma5 <= ma10)
scores.loc[not_uptrend, '总分'] = (scores.loc[not_uptrend, '总分'] * 0.3).round(1)
```

**惩罚条件**：有 K 线但 MA5 ≤ MA10（短期均线空头）→ 总分 × 0.3

#### 次日确认

```python
scores['次日确认'] = ''
for idx in scores.index:
    if scores.loc[idx, '总分'] < 60: continue
    ma5_val = ma5[idx] if pd.notna(ma5[idx]) else None
    if ma5_val: scores.loc[idx, '次日确认'] = f'开盘不破MA5({ma5_val:.2f}元)+量比>0.8'
    else: scores.loc[idx, '次日确认'] = '开盘不跌破昨收+量比>0.8'
```

#### 选股逻辑

```python
scores['选股逻辑'] = ''
for idx in scores.index:
    parts = lp.get(idx, [])
    if scores.loc[idx, '总分'] < 60: continue
    if not parts: parts.append('趋势向上')
    scores.loc[idx, '选股逻辑'] = '、'.join(parts) + ' → 趋势主升浪入选'
```

---

### 策略 3: 🩹 错杀低吸 (cslx)

#### 元信息
- **策略函数名**：`score_cuoshai`
- **核心驱动**：恐慌极值 × 承接
- **阈值**：≥55 分
- **Top N**：30
- **Excel Sheet**：`🩹错杀低吸`
- **基础列**：`['code', '股票名称', 'ZAF', 'fHSL', 'Wtb', 'Zsz', 'Zjl', 'ZAFPre20', 'ZAFPre60', '行业', '行业涨停率', '最新价', '大买占比', '价格估算']`

#### 股票池筛选（3 种场景 OR）

```python
def score_cuoshai(df):
    # 修复Bug: pool 改 OR → AND,确保是"当日下跌 + 中期超跌"的真正错杀股
    # 同时保留两种主要场景: (1)当日明显下跌(ZAF<-3) (2)中期深度超跌+当日下跌(ZAF<-1 & ZAFPre20<-8)
    pool = df[
        (df['ZAF'] < -3) |
        ((df['ZAF'] < -1) & (df['ZAFPre20'] < -8)) |
        ((df['ZAF'] < -1) & (df['ZAFPre60'] < -15))
    ].copy()
```

| 场景 | 条件 |
|------|------|
| 当日明显下跌 | `ZAF < -3` |
| 中期超跌 + 当日下跌 | `ZAF<-1 & ZAFPre20<-8` |
| 长期超跌 + 当日下跌 | `ZAF<-1 & ZAFPre60<-15` |

#### 评分维度 1：恐慌深度（0-30 分）

```python
# (1) 恐慌深度(0-30) — 当日跌+20日跌+60日跌
scores['恐慌深度'] = 0
zaf = pool['ZAF']; zaf20 = pool['ZAFPre20']; zaf60 = pool['ZAFPre60']
scores.loc[zaf <= -7, '恐慌深度'] += 15
scores.loc[(zaf > -7) & (zaf <= -5), '恐慌深度'] += 12
scores.loc[(zaf > -5) & (zaf <= -3), '恐慌深度'] += 8
scores.loc[(zaf > -3) & (zaf <= -1), '恐慌深度'] += 3
for idx in pool[zaf <= -5].index: lp[idx].append('当日恐慌杀跌')
scores.loc[zaf60 <= -25, '恐慌深度'] += 10
scores.loc[(zaf60 > -25) & (zaf60 <= -15), '恐慌深度'] += 7
scores.loc[(zaf20 <= -15), '恐慌深度'] += 8
scores.loc[(zaf20 <= -8) & (zaf20 > -15), '恐慌深度'] += 5
for idx in pool[zaf60 <= -15].index: lp[idx].append('中期超跌')
scores['恐慌深度'] = scores['恐慌深度'].clip(0, 30)
```

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 当日跌 | `ZAF` | ≤-7 | +15 |
| 当日跌 | `ZAF` | (-7, -5] | +12 |
| 当日跌 | `ZAF` | (-5, -3] | +8 |
| 当日跌 | `ZAF` | (-3, -1] | +3 |
| 60日跌 | `ZAFPre60` | ≤-25 | +10 |
| 60日跌 | `ZAFPre60` | (-25, -15] | +7 |
| 20日跌 | `ZAFPre20` | ≤-15 | +8 |
| 20日跌 | `ZAFPre20` | (-15, -8] | +5 |

**clip 范围**：[0, 30]

#### 评分维度 2：承接力度（0-30 分）

```python
# (2) 承接力度(0-30) — 大买占比+主力净流入
scores['承接力度'] = 0
big_ratio = pool['大买占比']; zjl = pool['Zjl']
scores.loc[big_ratio >= 0.5, '承接力度'] += 18
scores.loc[(big_ratio >= 0.4) & (big_ratio < 0.5), '承接力度'] += 14
scores.loc[(big_ratio >= 0.3) & (big_ratio < 0.4), '承接力度'] += 8
for idx in pool[big_ratio >= 0.4].index: lp[idx].append('大单承接强')
scores.loc[zjl >= 5000, '承接力度'] += 12
scores.loc[(zjl >= 1000) & (zjl < 5000), '承接力度'] += 8
scores.loc[(zjl >= 0) & (zjl < 1000), '承接力度'] += 3
for idx in pool[zjl >= 1000].index: lp[idx].append('资金抄底')
scores['承接力度'] = scores['承接力度'].clip(0, 30)
```

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 大买占比 | `大买占比` | ≥0.5 | +18 |
| 大买占比 | `大买占比` | [0.4, 0.5) | +14 |
| 大买占比 | `大买占比` | [0.3, 0.4) | +8 |
| 主力净流入 | `Zjl` | ≥5000 | +12 |
| 主力净流入 | `Zjl` | [1000, 5000) | +8 |
| 主力净流入 | `Zjl` | [0, 1000) | +3 |

**clip 范围**：[0, 30]

#### 评分维度 3：恐慌极值（0-20 分）

```python
# (3) 恐慌极值(0-20) — 换手×跌幅
scores['恐慌极值'] = 0
pv = pool['恐慌量']
scores.loc[pv >= 100, '恐慌极值'] = 20
scores.loc[(pv >= 50) & (pv < 100), '恐慌极值'] = 16
scores.loc[(pv >= 30) & (pv < 50), '恐慌极值'] = 12
scores.loc[(pv >= 15) & (pv < 30), '恐慌极值'] = 6
for idx in pool[pv >= 50].index: lp[idx].append('恐慌放量')
```

**字段**：`恐慌量` = `fHSL * |ZAF|`（已在辅助字段计算）

| 阈值 | 加分 |
|------|------|
| ≥100 | 20 |
| [50, 100) | 16 |
| [30, 50) | 12 |
| [15, 30) | 6 |

#### 评分维度 4：催化剂（0-20 分）

```python
# (4) 催化剂(0-20) — 行业涨停率 + 量比异常
scores['催化剂'] = 0
ind_zt_rate = pool['行业涨停率']; wtb = pool['Wtb']
scores.loc[ind_zt_rate >= 5, '催化剂'] += 12
scores.loc[(ind_zt_rate >= 2) & (ind_zt_rate < 5), '催化剂'] += 8
scores.loc[(ind_zt_rate >= 1) & (ind_zt_rate < 2), '催化剂'] += 3
for idx in pool[ind_zt_rate >= 2].index: lp[idx].append('板块催化')
scores.loc[wtb >= 3, '催化剂'] += 8
scores.loc[(wtb >= 2) & (wtb < 3), '催化剂'] += 5
for idx in pool[wtb >= 2].index: lp[idx].append('底部放量')
scores['催化剂'] = scores['催化剂'].clip(0, 20)
```

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 行业涨停率 | `行业涨停率` | ≥5 | +12 |
| 行业涨停率 | `行业涨停率` | [2, 5) | +8 |
| 行业涨停率 | `行业涨停率` | [1, 2) | +3 |
| 量比 | `Wtb` | ≥3 | +8 |
| 量比 | `Wtb` | [2, 3) | +5 |

**clip 范围**：[0, 20]

#### 总分公式

```python
scores['总分'] = scores['恐慌深度'] + scores['承接力度'] + scores['恐慌极值'] + scores['催化剂']
```

#### 惩罚/过滤规则

```python
scores.loc[pool['ZAF'] > 3, '总分'] = 0  # 已反弹的股票不算错杀
# 修复Bug: 惩罚系数0.4过严,改为0.5保留一定分数
scores.loc[scores['催化剂'] < 5, '总分'] = (scores.loc[scores['催化剂'] < 5, '总分'] * 0.5).round(1)
```

**惩罚 1**：`ZAF > 3`（已反弹）→ 总分清 0
**惩罚 2**：催化剂 < 5（板块/量能催化不足）→ 总分 × 0.5

#### 次日确认

```python
scores['次日确认'] = ''
for idx in scores.index:
    if scores.loc[idx, '总分'] < 55: continue
    zaf_val = pool.loc[idx, 'ZAF']
    if zaf_val <= -5: scores.loc[idx, '次日确认'] = '开盘不创新低+竞价不低开'
    else: scores.loc[idx, '次日确认'] = '开盘>前日最低+竞价有买单'
```

#### 选股逻辑

```python
scores['选股逻辑'] = ''
for idx in scores.index:
    parts = lp.get(idx, [])
    if scores.loc[idx, '总分'] < 55: continue
    if not parts: parts.append('超跌+有承接')
    scores.loc[idx, '选股逻辑'] = '、'.join(parts) + ' → 错杀低吸入选'
```

---

### 策略 4: ⚡ 弱转强 (rzq)

#### 元信息
- **策略函数名**：`score_ruozhuanqiang`
- **核心驱动**：预期差 × 点火
- **阈值**：≥50 分
- **Top N**：30（使用说明 sheet 中写"≤15"，源码 `MAX_PER_MODEL=30`，以源码为准）
- **Excel Sheet**：`⚡弱转强`
- **基础列**：`['code', '股票名称', 'ZAF', 'fHSL', 'Wtb', 'Zsz', 'Zjl', 'VOpenZAF', 'OpenZAF', 'FzAmo', 'ZAFYesterday', 'ZAFPre5', 'YearZTDay', '最新价', '价格估算']`

#### 股票池筛选

```python
def score_ruozhuanqiang(df):
    # 修复Bug: 阈值收紧, "前日弱"应该是前日跌或平盘,而非"前日涨幅<2%"
    pool = df[
        (df['VOpenZAF'] > 1) &
        (df['ZAFYesterday'] < 0)  # 前日确实下跌才算"弱"
    ].copy()
```

**pool 条件**：竞价涨幅 > 1% AND 前日涨幅 < 0（前日确实下跌才算"弱"）

#### 评分维度 1：竞价异动（0-30 分）

```python
# (1) 竞价异动(0-30) — VOpenZAF竞价涨幅 + 竞价金额比
scores['竞价异动'] = 0
vopen = pool['VOpenZAF']; open_amo = pool['OpenAmo']; cjjepre1 = pool['CJJEPre1']
scores.loc[vopen >= 5, '竞价异动'] += 15
scores.loc[(vopen >= 3) & (vopen < 5), '竞价异动'] += 12
scores.loc[(vopen >= 2) & (vopen < 3), '竞价异动'] += 8
scores.loc[(vopen >= 1) & (vopen < 2), '竞价异动'] += 4
for idx in pool[vopen >= 3].index: lp[idx].append(f'竞价涨幅{vopen[idx]:.1f}%')
# 注: OpenAmo单位=元, CJJEPre1单位=万元, 故*10000对齐为元
open_amo_ratio = open_amo / (cjjepre1 * 10000 + 1)
scores.loc[open_amo_ratio >= 0.01, '竞价异动'] += 15
scores.loc[(open_amo_ratio >= 0.005) & (open_amo_ratio < 0.01), '竞价异动'] += 10
scores.loc[(open_amo_ratio >= 0.002) & (open_amo_ratio < 0.005), '竞价异动'] += 5
for idx in pool[open_amo_ratio >= 0.005].index: lp[idx].append('竞价放量')
scores['竞价异动'] = scores['竞价异动'].clip(0, 30)
```

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 竞价涨幅 | `VOpenZAF` | ≥5 | +15 |
| 竞价涨幅 | `VOpenZAF` | [3, 5) | +12 |
| 竞价涨幅 | `VOpenZAF` | [2, 3) | +8 |
| 竞价涨幅 | `VOpenZAF` | [1, 2) | +4 |
| 竞价金额比 | `OpenAmo / (CJJEPre1*10000+1)` | ≥0.01 | +15 |
| 竞价金额比 | 同上 | [0.005, 0.01) | +10 |
| 竞价金额比 | 同上 | [0.002, 0.005) | +5 |

**单位说明**：`OpenAmo` 单位为元，`CJJEPre1` 单位为万元，所以 `* 10000` 对齐为元

**clip 范围**：[0, 30]

#### 评分维度 2：预期差（0-25 分）

```python
# (2) 预期差(0-25) — 前日弱 + 今日强
scores['预期差'] = 0
zaf_yest = pool['ZAFYesterday']; zaf_pre5 = pool['ZAFPre5']; zaf_now = pool['ZAF']
scores.loc[(zaf_yest < -2) & (vopen > 3), '预期差'] += 15
scores.loc[(zaf_yest < -2) & (vopen > 1), '预期差'] += 10
scores.loc[(zaf_yest < 0) & (vopen > 2), '预期差'] += 10
scores.loc[(zaf_yest >= 0) & (zaf_yest < 2) & (vopen > 3), '预期差'] += 8
for idx in pool[(zaf_yest < -2) & (vopen > 2)].index: lp[idx].append('强预期差')
scores.loc[(zaf_pre5 < 0) & (zaf_now > 0), '预期差'] += 10
for idx in pool[(zaf_pre5 < 0) & (zaf_now > 0)].index: lp[idx].append('5日趋势反转')
scores['预期差'] = scores['预期差'].clip(0, 25)
```

| 子项 | 条件 | 加分 |
|------|------|------|
| 前日大跌+今日强竞价 | `ZAFYesterday<-2 & VOpenZAF>3` | +15 |
| 前日大跌+今日竞价 | `ZAFYesterday<-2 & VOpenZAF>1` | +10 |
| 前日跌+今日强竞价 | `ZAFYesterday<0 & VOpenZAF>2` | +10 |
| 前日微涨+今日强竞价 | `ZAFYesterday∈[0,2) & VOpenZAF>3` | +8 |
| 5日趋势反转 | `ZAFPre5<0 & ZAF>0` | +10 |

**clip 范围**：[0, 25]

#### 评分维度 3：点火信号（0-25 分）

```python
# (3) 点火信号(0-25) — 开盘跳空 + 量比 + 尾盘抢筹
scores['点火信号'] = 0
open_zaf = pool['OpenZAF']; wtb = pool['Wtb']; fz_amo = pool['FzAmo']
scores.loc[open_zaf >= 3, '点火信号'] += 10
scores.loc[(open_zaf >= 1) & (open_zaf < 3), '点火信号'] += 7
scores.loc[(open_zaf >= 0.5) & (open_zaf < 1), '点火信号'] += 3
for idx in pool[open_zaf >= 2].index: lp[idx].append('开盘跳空')
scores.loc[wtb >= 3, '点火信号'] += 8
scores.loc[(wtb >= 2) & (wtb < 3), '点火信号'] += 5
scores.loc[(wtb >= 1.5) & (wtb < 2), '点火信号'] += 3
for idx in pool[wtb >= 2].index: lp[idx].append('量比放大')
scores.loc[fz_amo >= 500, '点火信号'] += 7
scores.loc[(fz_amo >= 200) & (fz_amo < 500), '点火信号'] += 4
scores['点火信号'] = scores['点火信号'].clip(0, 25)
```

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 开盘涨幅 | `OpenZAF` | ≥3 | +10 |
| 开盘涨幅 | `OpenZAF` | [1, 3) | +7 |
| 开盘涨幅 | `OpenZAF` | [0.5, 1) | +3 |
| 量比 | `Wtb` | ≥3 | +8 |
| 量比 | `Wtb` | [2, 3) | +5 |
| 量比 | `Wtb` | [1.5, 2) | +3 |
| 尾盘金额 | `FzAmo` | ≥500 | +7 |
| 尾盘金额 | `FzAmo` | [200, 500) | +4 |

**clip 范围**：[0, 25]

#### 评分维度 4：股性（0-20 分）

```python
# (4) 股性(0-20) — 年涨停数 + Beta值
scores['股性'] = 0
nzt = pool.get('YearZTDay', pd.Series(0, index=pool.index))
beta = pool.get('BetaValue', pd.Series(0, index=pool.index))
scores.loc[nzt >= 5, '股性'] += 10
scores.loc[(nzt >= 2) & (nzt < 5), '股性'] += 6
for idx in pool[nzt >= 5].index: lp[idx].append('股性活跃')
scores.loc[(beta > 1.2) & (beta <= 2), '股性'] += 10
scores.loc[(beta > 0.8) & (beta <= 1.2), '股性'] += 5
```

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 年涨停天数 | `YearZTDay` | ≥5 | +10 |
| 年涨停天数 | `YearZTDay` | [2, 5) | +6 |
| Beta 值 | `BetaValue` | (1.2, 2] | +10 |
| Beta 值 | `BetaValue` | (0.8, 1.2] | +5 |

**注**：无 clip，理论上限 20

#### 总分公式

```python
scores['总分'] = scores['竞价异动'] + scores['预期差'] + scores['点火信号'] + scores['股性']
```

#### 惩罚/过滤规则

```python
scores.loc[pool['是否涨停'], '总分'] = 0
```

**惩罚条件**：当日涨停股 → 总分清 0（涨停股不属"弱转强"）

#### 次日确认

```python
scores['次日确认'] = '竞价量比>1.5+5分钟内涨幅>1%'
```

**统一规则**（无分支判断）

#### 选股逻辑

```python
scores['选股逻辑'] = ''
for idx in scores.index:
    parts = lp.get(idx, [])
    if scores.loc[idx, '总分'] < 50: continue
    if not parts: parts.append('竞价异动+预期差')
    scores.loc[idx, '选股逻辑'] = '、'.join(parts) + ' → 弱转强入选'
```

---

### 策略 5: 🔄 强转弱反抽 (qzrfc)

#### 元信息
- **策略函数名**：`score_qiangzhuanruo`
- **核心驱动**：主力被套 × 自救
- **阈值**：≥50 分
- **Top N**：30
- **Excel Sheet**：`🔄强转弱反抽`
- **基础列**：`['code', '股票名称', 'ZAF', 'fHSL', 'Wtb', 'Zsz', 'Zjl', 'ZAFYesterday', '行业', '行业涨停率', '最新价', '大买占比', '价格估算']`

#### 股票池筛选

```python
def score_qiangzhuanruo(df):
    pool = df[
        (df['ZAFYesterday'] > 3) &
        (df['ZAF'] < -1)
    ].copy()
```

**pool 条件**：前日涨幅 > 3%（昨日强势）AND 当日跌幅 < -1%（今日转弱）

#### 评分维度 1：主力被套深度（0-30 分）

```python
# (1) 主力被套深度(0-30) — 昨涨-今跌 + 主力逆势流入
scores['主力被套深度'] = 0
zaf_yest = pool['ZAFYesterday']; zjl = pool['Zjl']; zaf = pool['ZAF']
trap_depth = zaf_yest - zaf
scores.loc[trap_depth >= 15, '主力被套深度'] += 20
scores.loc[(trap_depth >= 10) & (trap_depth < 15), '主力被套深度'] += 15
scores.loc[(trap_depth >= 6) & (trap_depth < 10), '主力被套深度'] += 10
scores.loc[trap_depth < 6, '主力被套深度'] += 4
for idx in pool[trap_depth >= 10].index: lp[idx].append('主力深度被套')
scores.loc[zjl > 0, '主力被套深度'] += 10
scores.loc[(zjl <= 0) & (zjl > -5000), '主力被套深度'] += 5
for idx in pool[zjl > 0].index: lp[idx].append('主力逆势流入')
scores['主力被套深度'] = scores['主力被套深度'].clip(0, 30)
```

**核心字段**：`trap_depth = ZAFYesterday - ZAF`（昨涨减今跌 = 被套深度）

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 被套深度 | `ZAFYesterday - ZAF` | ≥15 | +20 |
| 被套深度 | 同上 | [10, 15) | +15 |
| 被套深度 | 同上 | [6, 10) | +10 |
| 被套深度 | 同上 | <6 | +4 |
| 主力净流入 | `Zjl` | >0 | +10 |
| 主力净流入 | `Zjl` | (-5000, 0] | +5 |

**clip 范围**：[0, 30]

#### 评分维度 2：回踩幅度（0-25 分）

```python
# (2) 回踩幅度(0-25) — 当日跌幅区间
scores['回踩幅度'] = 0
scores.loc[(zaf >= -3) & (zaf < -1), '回踩幅度'] = 10
scores.loc[(zaf >= -5) & (zaf < -3), '回踩幅度'] = 18
scores.loc[(zaf >= -8) & (zaf < -5), '回踩幅度'] = 25
scores.loc[zaf < -8, '回踩幅度'] = 15
for idx in pool[(zaf >= -5) & (zaf < -3)].index: lp[idx].append('中度回踩')
for idx in pool[(zaf >= -8) & (zaf < -5)].index: lp[idx].append('深度回踩(反抽空间大)')
```

| 字段 | 阈值 | 加分 |
|------|------|------|
| `ZAF` | [-3, -1) | 10 |
| `ZAF` | [-5, -3) | 18 |
| `ZAF` | [-8, -5) | 25（最大） |
| `ZAF` | <-8 | 15（深度回踩反而扣分，因跌幅过大反抽难度大） |

**注**：这是赋值（=）不是累加（+=），且无 clip

#### 评分维度 3：板块支撑（0-25 分）

```python
# (3) 板块支撑(0-25) — 行业涨停率 + 行业平均涨幅
scores['板块支撑'] = 0
ind_zt_rate = pool['行业涨停率']; ind_avg = pool['行业平均涨幅']
scores.loc[ind_zt_rate >= 5, '板块支撑'] += 15
scores.loc[(ind_zt_rate >= 2) & (ind_zt_rate < 5), '板块支撑'] += 10
scores.loc[(ind_zt_rate >= 1) & (ind_zt_rate < 2), '板块支撑'] += 5
for idx in pool[ind_zt_rate >= 2].index: lp[idx].append('板块仍强势')
scores.loc[ind_avg > 1, '板块支撑'] += 10
scores.loc[(ind_avg > 0) & (ind_avg <= 1), '板块支撑'] += 5
scores['板块支撑'] = scores['板块支撑'].clip(0, 25)
```

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 行业涨停率 | `行业涨停率` | ≥5 | +15 |
| 行业涨停率 | `行业涨停率` | [2, 5) | +10 |
| 行业涨停率 | `行业涨停率` | [1, 2) | +5 |
| 行业平均涨幅 | `行业平均涨幅` | >1 | +10 |
| 行业平均涨幅 | `行业平均涨幅` | (0, 1] | +5 |

**clip 范围**：[0, 25]

#### 评分维度 4：反抽信号（0-20 分）

```python
# (4) 反抽信号(0-20) — 大买占比 + 换手率
scores['反抽信号'] = 0
big_ratio = pool['大买占比']; hsl = pool['fHSL']
scores.loc[big_ratio >= 0.4, '反抽信号'] += 12
scores.loc[(big_ratio >= 0.3) & (big_ratio < 0.4), '反抽信号'] += 7
for idx in pool[big_ratio >= 0.35].index: lp[idx].append('有承接单')
scores.loc[(hsl >= 3) & (hsl <= 15), '反抽信号'] += 8
scores.loc[(hsl >= 1) & (hsl < 3), '反抽信号'] += 4
scores.loc[hsl > 15, '反抽信号'] += 2
scores['反抽信号'] = scores['反抽信号'].clip(0, 20)
```

| 子项 | 字段 | 阈值 | 加分 |
|------|------|------|------|
| 大买占比 | `大买占比` | ≥0.4 | +12 |
| 大买占比 | `大买占比` | [0.3, 0.4) | +7 |
| 换手率 | `fHSL` | [3, 15] | +8 |
| 换手率 | `fHSL` | [1, 3) | +4 |
| 换手率 | `fHSL` | >15 | +2 |

**clip 范围**：[0, 20]

#### 总分公式

```python
scores['总分'] = scores['主力被套深度'] + scores['回踩幅度'] + scores['板块支撑'] + scores['反抽信号']
```

#### 惩罚/过滤规则

**无额外惩罚**（直接 4 维度相加）

#### 次日确认

```python
scores['次日确认'] = ''
for idx in scores.index:
    if scores.loc[idx, '总分'] < 50: continue
    zaf_val = pool.loc[idx, 'ZAF']
    if zaf_val <= -5: scores.loc[idx, '次日确认'] = '开盘>-2%+30分钟不创新低'
    else: scores.loc[idx, '次日确认'] = '开盘>-1%+30分钟不创新低'
```

#### 选股逻辑

```python
scores['选股逻辑'] = ''
for idx in scores.index:
    parts = lp.get(idx, [])
    if scores.loc[idx, '总分'] < 50: continue
    if not parts: parts.append('昨日强今日弱')
    scores.loc[idx, '选股逻辑'] = '、'.join(parts) + ' → 强转弱反抽入选'
```

---

## 九、因子清单汇总（去重）

> **此表是后续生成 `strategies/strategy_*.yaml` 中 `factors:` 段的关键依据。**

| 因子名 | 计算公式 | 用于哪些策略 | 建议因子插件 | 建议因子 ID |
|--------|---------|--------------|--------------|-------------|
| 涨停判断 | `if code startswith (688/689/300/301/302): ZAF≥19.5 elif (8/4): ZAF≥29.5 else: ZAF≥9.8` | dbqzt/rzq（也影响所有策略的 fLianB 清洗） | `engine/factors/limit_up.py` | `limit_up` |
| 连板数 | `fLianB = ConZAFDateNum`（非涨停股置 0，取整） | dbqzt | `engine/factors/continuous_limit_up.py` | `continuous_limit_up` |
| 封板强度系数 | `pd.to_numeric(fLianB原始值, errors='coerce').fillna(0)`（原 fLianB 字段） | dbqzt | `engine/factors/seal_strength.py` | `seal_strength` |
| 封成比 | `FCb`（原始字段，负值置 0） | dbqzt | `engine/factors/seal_amount_ratio.py` | `seal_amount_ratio` |
| 封单额 | `FCAmo`（原始字段，单位：万元，负值置 0） | dbqzt | `engine/factors/seal_amount.py` | `seal_amount` |
| 竞价涨幅 | `VOpenZAF`（原始字段） | dbqzt/rzq | `engine/factors/auction_pct.py` | `auction_pct` |
| 尾盘金额 | `FzAmo`（原始字段，单位：万元） | dbqzt/rzq | `engine/factors/closing_amount.py` | `closing_amount` |
| 卖撤率 | `SCancel / (SCancel + TotalSVol + 1)`，缺失用 0.5 兜底 | dbqzt | `engine/factors/sell_cancel_rate.py` | `sell_cancel_rate` |
| 当日涨幅 | `ZAF`（原始字段） | dbqzt/cslx/qszsl/rzq/qzrfc（间接，所有策略） | `engine/factors/pct_change.py` | `pct_change_today` |
| 前日涨幅 | `ZAFYesterday`（原始字段） | rzq/qzrfc | `engine/factors/pct_change_yesterday.py` | `pct_change_yesterday` |
| 5日涨幅 | `ZAFPre5`（原始字段） | qszsl/rzq | `engine/factors/pct_change_5d.py` | `pct_change_5d` |
| 10日涨幅 | `ZAFPre10`（原始字段） | qszsl | `engine/factors/pct_change_10d.py` | `pct_change_10d` |
| 20日涨幅 | `ZAFPre20`（原始字段） | cslx | `engine/factors/pct_change_20d.py` | `pct_change_20d` |
| 60日涨幅 | `ZAFPre60`（原始字段） | cslx | `engine/factors/pct_change_60d.py` | `pct_change_60d` |
| 量比 | `Wtb`（原始字段，负值/0 置 NaN） | qszsl/cslx/rzq | `engine/factors/turnover_ratio.py` | `turnover_ratio` |
| 换手率 | `fHSL`（原始字段） | cslx/qzrfc + 老登过滤 | `engine/factors/turnover_rate.py` | `turnover_rate` |
| 总市值 | `Zsz`（原始字段，单位：亿） | 所有策略（基础列） | `engine/factors/market_cap.py` | `market_cap` |
| 主力净流入 | `Zjl`（原始字段，单位：万） | qszsl/cslx/qzrfc + 行业统计 | `engine/factors/main_inflow.py` | `main_inflow` |
| 大买占比 | `TotalBVol / (TotalBVol + TotalSVol + 1)` | qszsl/cslx/qzrfc | `engine/factors/big_buy_ratio.py` | `big_buy_ratio` |
| 恐慌量 | `fHSL * |ZAF|` | cslx | `engine/factors/panic_volume.py` | `panic_volume` |
| MA5 | `close.rolling(5, min_periods=1).mean()` | qszsl + 压力位 | `engine/factors/ma.py` | `ma5` |
| MA10 | `close.rolling(10, min_periods=1).mean()` | qszsl + 压力位 | `engine/factors/ma.py` | `ma10` |
| MA20 | `close.rolling(20, min_periods=1).mean()` | qszsl + 压力位 | `engine/factors/ma.py` | `ma20` |
| DIF | `EMA12 - EMA26`（EMA: `close.ewm(span=N, adjust=False).mean()`） | qszsl | `engine/factors/macd.py` | `macd_dif` |
| DEA | `EMA9(DIF)` | qszsl | `engine/factors/macd.py` | `macd_dea` |
| MACD_BAR | `2 * (DIF - DEA)` | （技术指标计算，未直接用于评分） | `engine/factors/macd.py` | `macd_bar` |
| BOLL_MID | `close.rolling(20, min_periods=1).mean()` | （技术指标计算，未直接用于评分） | `engine/factors/boll.py` | `boll_mid` |
| BOLL_UP | `BOLL_MID + 2 * close.rolling(20).std()` | 压力位 | `engine/factors/boll.py` | `boll_up` |
| 年涨停天数 | `YearZTDay`（原始字段） | rzq + 老登过滤 | `engine/factors/year_zt_days.py` | `year_zt_days` |
| Beta值 | `BetaValue`（原始字段） | rzq + 老登过滤 | `engine/factors/beta.py` | `beta_value` |
| 开盘涨幅 | `OpenZAF`（原始字段） | rzq | `engine/factors/open_pct.py` | `open_pct` |
| 竞价金额 | `OpenAmo`（原始字段，单位：元） | rzq | `engine/factors/auction_amount.py` | `auction_amount` |
| 昨成交额 | `CJJEPre1`（原始字段，单位：万元） | rzq | `engine/factors/prev_amount.py` | `prev_amount` |
| 行业涨停数 | `df.groupby('行业').agg(行业涨停数=('_is_zt', 'sum'))` | dbqzt（孤板判断） | `engine/factors/industry_zt_count.py` | `industry_zt_count` |
| 行业涨停率 | `行业涨停数 / 行业总数 * 100` | cslx/qzrfc | `engine/factors/industry_zt_rate.py` | `industry_zt_rate` |
| 行业平均涨幅 | `df.groupby('行业').agg(行业平均涨幅=('ZAF', 'mean'))` | qzrfc | `engine/factors/industry_avg_pct.py` | `industry_avg_pct` |
| 前日高点 | K 线 `high` 字段 | 压力位 | `engine/factors/prev_high.py` | `prev_high` |
| 被套深度 | `ZAFYesterday - ZAF` | qzrfc | `engine/factors/trap_depth.py` | `trap_depth` |
| 5日趋势反转 | `ZAFPre5<0 & ZAF>0`（布尔） | rzq | `engine/factors/trend_reversal_5d.py` | `trend_reversal_5d` |
| 竞价金额比 | `OpenAmo / (CJJEPre1*10000+1)` | rzq | `engine/factors/auction_amount_ratio.py` | `auction_amount_ratio` |

**因子总数**：38 个去重因子（含派生字段）。

---

## 十、CSV 字段使用映射

> **此表说明 L2 快照 CSV 88 个字段中哪些被 5 策略使用。**

### 10.1 L2 快照 CSV（`全市场L2快照_20260616.csv`）字段使用

| CSV 字段 | 含义 | 用于哪些策略/步骤 | 是否清洗 |
|----------|------|------------------|----------|
| `code` | 股票代码 | 所有（基础键） | 是（regex 校验） |
| `查询时间` | 快照时间 | 步骤 1（仅打印） | 否 |
| `HqDate` | 行情日期 | 步骤 1（仅打印） | 否 |
| `股票名称` | 派生（name_map 映射） | 所有（基础列）+ ST 过滤 | 否 |
| `IsT0Fund` | T+0 货基标识 | 步骤 3 基础过滤 | 否 |
| `IsKzz` | 可转债标识 | 步骤 3 基础过滤 | 否 |
| `TPFlag` | 停牌标识 | 步骤 3 基础过滤 | 否 |
| `SafeValue` | 安全值 | 步骤 3 基础过滤（≠-1） | 否 |
| `IsZCZGP` | 增持增持股标识 | （未使用） | 否 |
| `ZAF` | 当日涨幅% | 所有策略（核心） | 是（Bug5 numeric） |
| `ZAFYesterday` | 前日涨幅% | rzq/qzrfc | 是（Bug5） |
| `ZAFPre5` | 5日涨幅% | qszsl/rzq | 是（Bug5） |
| `ZAFPre10` | 10日涨幅% | qszsl | 是（Bug5） |
| `ZAFPre20` | 20日涨幅% | cslx | 是（Bug5） |
| `ZAFPre60` | 60日涨幅% | cslx | 是（Bug5） |
| `fHSL` | 换手率% | cslx/qzrfc + 老登过滤 + 恐慌量 | 是（Bug5） |
| `fLianB` | （原）封板强度系数 | dbqzt（重定义为 ConZAFDateNum，作连板数） | 是（Bug4） |
| `ConZAFDateNum` | （原）连板天数 | dbqzt（重定义为 fLianB） | 是（Bug4） |
| `Wtb` | 量比 | qszsl/cslx/rzq | 是（Bug1 负值/0 置 NaN） |
| `Zsz` | 总市值（亿） | 所有策略（基础列） | 是（Bug5） |
| `Zjl` | 主力净流入（万） | qszsl/cslx/qzrfc + 行业统计 | 是（Bug5） |
| `TotalBVol` | 大单买入量 | 大买占比计算（qszsl/cslx/qzrfc） | 是（Bug5） |
| `TotalSVol` | 大单卖出量 | 大买占比 + 卖撤率计算 | 是（Bug5） |
| `BCancel` | 买单撤单 | （Bug5 转换但未使用） | 是 |
| `SCancel` | 卖单撤单 | dbqzt 卖撤率计算 | 是（Bug5） |
| `L2OrderNum` | L2 订单数 | （Bug5 转换但未使用，原卖撤率公式已被弃用） | 是 |
| `FCb` | 封成比 | dbqzt | 是（Bug2 负值置 0） |
| `FCAmo` | 封单额（万） | dbqzt | 是（Bug2 负值置 0） |
| `VOpenZAF` | 竞价涨幅% | dbqzt/rzq | 是（Bug5） |
| `OpenZAF` | 开盘涨幅% | rzq | 是（Bug5） |
| `OpenAmo` | 竞价金额（元） | rzq | 是（Bug5） |
| `OpenAmoPre1` | 昨竞价金额 | （Bug5 转换但未使用） | 是 |
| `FzAmo` | 尾盘金额（万） | dbqzt/rzq | 是（Bug5） |
| `CJJEPre1` | 昨成交额（万元） | rzq | 是（Bug5） |
| `YearZTDay` | 年涨停天数 | rzq + 老登过滤 | 是（Bug5） |
| `BetaValue` | Beta 值 | rzq + 老登过滤 | 是（Bug5） |
| `MA5Value` | MA5（快照字段） | 最新价兜底 | 是（Bug5） |
| `行业`（派生） | 行业一级 | qszsl/cslx/qzrfc（基础列）+ 行业统计 | 否 |
| `所属板块`（派生） | 板块拼接 | （未用于评分，仅展示） | 否 |
| `行业总数`（派生） | 行业总数 | （行业统计中间字段） | 否 |
| `行业涨停数`（派生） | 行业涨停数 | dbqzt（孤板判断） | 否 |
| `行业涨停率`（派生） | 行业涨停率% | cslx/qzrfc | 否 |
| `行业平均涨幅`（派生） | 行业平均涨幅% | qzrfc | 否 |
| `行业主力净流入`（派生） | 行业主力净流入（万） | （未直接用于评分） | 否 |
| `KL_MA5`（派生） | K线 MA5 | qszsl | 否 |
| `KL_MA10`（派生） | K线 MA10 | qszsl | 否 |
| `KL_MA20`（派生） | K线 MA20 | qszsl | 否 |
| `KL_DIF`（派生） | K线 DIF | qszsl | 否 |
| `KL_DEA`（派生） | K线 DEA | qszsl | 否 |
| `KL_MACD_BAR`（派生） | K线 MACD_BAR | （未直接用于评分） | 否 |
| `KL_BOLL_UP`（派生） | K线 BOLL_UP | 压力位 | 否 |
| `最新价`（派生） | K线收盘价（MA5Value 兜底） | 所有策略（基础列）+ 压力位 | 否 |
| `价格估算`（派生） | 是否用 MA5 兜底（布尔） | 所有策略（基础列） | 否 |
| `大买占比`（派生） | `TotalBVol/(TotalBVol+TotalSVol+1)` | qszsl/cslx/qzrfc | 否 |
| `卖撤率`（派生） | `SCancel/(SCancel+TotalSVol+1)`，缺失 0.5 | dbqzt | 否 |
| `恐慌量`（派生） | `fHSL * |ZAF|` | cslx | 否 |
| `是否涨停`（派生） | `_is_zt_for_row` 判断结果 | dbqzt/rzq + fLianB 清洗 | 否 |
| `封板强度系数`（派生） | 原 fLianB 值 | dbqzt | 否 |

### 10.2 K 线 CSV（`kline_*.csv`）字段使用

| CSV 字段 | 含义 | 用于哪些步骤 |
|----------|------|--------------|
| `code` | 股票代码 | K 线合并键 |
| `date` | 日期 | K 线去重/排序/筛选最新日 |
| `open` | 开盘价 | （未直接使用） |
| `high` | 最高价 | 压力位（前日高点） |
| `low` | 最低价 | （未直接使用） |
| `close` | 收盘价 | MA/DIF/DEA/BOLL/最新价 |
| `volume` | 成交量 | （计算但未直接使用） |
| `amount` | 成交额 | （计算但未直接使用） |
| `change_pct` | 涨跌幅% | （未直接使用） |
| `turnover` | 换手率 | （未直接使用） |
| `forward_factor` | 复权因子 | （未使用，2-i 任务确认全空） |

### 10.3 其他 CSV 字段使用

| CSV 文件 | 字段 | 含义 | 用途 |
|----------|------|------|------|
| `stock_name_mapping.csv` | `code`, `name` | 股票代码-名称 | 步骤 1 映射股票名称 |
| `股票行业三级分类_*.csv` | `stock_code`, `行业一级` 等 | 行业三级分类 | 步骤 5 取「行业一级」字段作行业 |
| `stock_block_relation.csv` | `stock_code`, `block_code`, `block_name`, `block_type` 等 | 板块关系 | 步骤 5 取 `block_type=='行业'` 的 `block_name` 拼「所属板块」 |

---

## 十一、关键参数清单（YAML 配置时必读）

### 11.1 全局阈值（THRESHOLDS）

```python
THRESHOLDS = {'daban': 35, 'qushi': 60, 'cuoshai': 55, 'ruozhuan': 50, 'qzr': 50}
MAX_PER_MODEL = 30
```

### 11.2 涨停判断阈值（3 档）

| 板块 | 代码前缀 | 阈值 |
|------|---------|------|
| 创业板/科创板 | 688/689/300/301/302 | ZAF ≥ 19.5 |
| 北交所 | 8/4 开头 | ZAF ≥ 29.5 |
| 主板/中小板 | 其他 | ZAF ≥ 9.8 |

### 11.3 老登过滤 3 条件

| 字段 | 阈值 |
|------|------|
| `YearZTDay` | == 0 |
| `fHSL` | < 1 |
| `BetaValue` | < 0.8 |

### 11.4 5 策略 pool 筛选条件汇总

| 策略 | pool 条件 |
|------|-----------|
| dbqzt | `是否涨停 OR ZAF>=7` |
| qszsl | （无 pool，全市场评分） |
| cslx | `ZAF<-3 OR (ZAF<-1 AND ZAFPre20<-8) OR (ZAF<-1 AND ZAFPre60<-15)` |
| rzq | `VOpenZAF>1 AND ZAFYesterday<0` |
| qzrfc | `ZAFYesterday>3 AND ZAF<-1` |

### 11.5 5 策略惩罚规则汇总

| 策略 | 惩罚条件 | 惩罚系数 |
|------|---------|----------|
| dbqzt | `~是否涨停 & FCb==0 & fLianB<1` | ×0.5 |
| qszsl | `has_kline & MA5<=MA10`（短期空头） | ×0.3 |
| cslx | `ZAF>3`（已反弹） | =0 |
| cslx | `催化剂<5`（催化不足） | ×0.5 |
| rzq | `是否涨停`（涨停股不属弱转强） | =0 |
| qzrfc | （无额外惩罚） | - |

### 11.6 5 策略 4 维度分值上限汇总

| 策略 | 维度 1 | 维度 2 | 维度 3 | 维度 4 | 理论上限 | 阈值 | 占比 |
|------|--------|--------|--------|--------|----------|------|------|
| dbqzt | 封板强度 0-40 | 连板辨识度 0-30 | 竞价抢筹 0-20 | 风险扣分 0~-10 | 100 | 35 | 35% |
| qszsl | 均线多头 0-35 | 量价配合 0-25 | MACD方向 0-20 | 大单流入 0-20 | 100 | 60 | 60% |
| cslx | 恐慌深度 0-30 | 承接力度 0-30 | 恐慌极值 0-20 | 催化剂 0-20 | 100 | 55 | 55% |
| rzq | 竞价异动 0-30 | 预期差 0-25 | 点火信号 0-25 | 股性 0-20 | 100 | 50 | 50% |
| qzrfc | 主力被套深度 0-30 | 回踩幅度 0-25 | 板块支撑 0-25 | 反抽信号 0-20 | 100 | 50 | 50% |

### 11.7 数据清洗规则汇总（YAML 中 `cleaning.custom_rules` 应配置）

| 规则 ID | 字段 | 操作 | 兜底值 |
|---------|------|------|--------|
| `clean_wtb_negative` | `Wtb` | 负值或 0 置 NaN | NaN |
| `clean_fcb_negative` | `FCb` | 负值置 0 | 0 |
| `clean_fcamo_negative` | `FCAmo` | 负值置 0 | 0 |
| `calc_sell_cancel_rate` | `SCancel`, `TotalSVol` | `SCancel/(SCancel+TotalSVol+1)`，缺失 0.5 | 0.5 |
| `redefine_flianb` | `fLianB`, `ConZAFDateNum` | fLianB→封板强度系数；ConZAFDateNum→fLianB（非涨停置 0，取整） | 0 |
| `to_numeric_all` | 25 个字段（见【二】Bug5） | `pd.to_numeric(errors='coerce')` | NaN |
| `filter_laodeng` | `YearZTDay`, `fHSL`, `BetaValue` | 3 条件 AND 剔除 | - |

### 11.8 辅助字段计算汇总

| 派生字段 | 计算公式 | 用于哪些策略 |
|----------|---------|--------------|
| `大买占比` | `TotalBVol / (TotalBVol + TotalSVol + 1)` | qszsl/cslx/qzrfc |
| `卖撤率` | `SCancel / (SCancel + TotalSVol + 1)`，缺失 0.5 | dbqzt |
| `恐慌量` | `fHSL * |ZAF|` | cslx |
| `最新价` | K 线收盘价 → MA5Value 兜底 | 所有（基础列）+ 压力位 |
| `价格估算` | 布尔，True=用 MA5 兜底 | 所有（基础列） |
| `是否涨停` | 3 档涨停判断 | dbqzt/rzq + fLianB 清洗 |
| `封板强度系数` | 原 fLianB 值 | dbqzt |
| `fLianB`（重定义） | `ConZAFDateNum`，非涨停置 0，取整 | dbqzt |

### 11.9 压力位候选优先级

```python
1. 前日高点（high > close*1.005）
2. 布林上轨 BOLL_UP > close*1.005
3. MA20 > close*1.003
4. MA10 > close*1.003
5. MA5 > close*1.003
6. 涨停价（无候选）：主板 1.10 / 创科 1.20 / 北交 1.30
7. 无 K 线：close*1.02，标签"估算"
```

最终取所有候选中 `|candidate - close|` 最小者。

---

## 十二、互斥性说明（源自 V8.1 模型使用方法 sheet）

| 策略 | 互斥策略 |
|------|---------|
| 🔥打板求涨停 | 与弱转强互斥 |
| 📈趋势主升浪 | 独立（不需情绪） |
| 🩹错杀低吸 | 与打板互斥 |
| ⚡弱转强 | 与打板互斥 |
| 🔄强转弱反抽 | 与打板互斥 |

**实现机制**：源码中并无显式互斥逻辑，互斥性通过 pool 筛选条件自然实现（如 dbqzt pool 要求涨停或涨≥7%，而 cslx pool 要求当日跌，自然不重叠）。

---

## 十三、生成 YAML 时关键提示

1. **每策略 YAML 必须配置 `cleaning.custom_rules`**：所有 5 策略共用相同的 7 条清洗规则，建议在 `config/cleaning_rules.yaml` 统一配置后用 `cleaning.rules_file` 引用。

2. **因子插件设计原则**：
   - 原始字段（如 `ZAF`, `Wtb`）应直接读取，不做转换
   - 派生字段（如 `大买占比`, `恐慌量`, `卖撤率`）应封装为独立因子插件
   - 阈值/系数（如 dbqzt 的 `封成比 ≥0.5=20`）应作为 `params` 配置，不硬编码

3. **评分公式**：每策略 4 维度加分均为「阈值查表」模式，建议用 `scoring.formula` 配合 `penalties` 表达式引擎实现，而非硬编码 if-else。

4. **clip 操作**：5 个策略中 4 个维度的总分上限分别为 40/30/20/10（dbqzt）、35/25/20/20（qszsl）等，必须用 `clip(0, N)` 严格限制，避免累加超上限。

5. **惩罚规则**：每策略 1-2 条惩罚，必须用 `penalties` 段配置，含 `condition`/`multiplier`/`reason` 三字段。

6. **次日确认**：每策略有不同次日确认规则，属"盘后选股→次日开盘确认"两段式理念，建议作为 `monitor.alert_conditions` 配置。

7. **行业统计依赖**：cslx/qzrfc 用到 `行业涨停率`，dbqzt 用到 `行业涨停数`，qzrfc 用到 `行业平均涨幅`，这些字段需要先按 `行业一级` 分组聚合，再 merge 回主表。YAML 中需配置 `pre_calc` 段或独立 step。

8. **fLianB 语义陷阱**：源码中 fLianB 已被重定义为 `ConZAFDateNum`（连板数），而原 fLianB 字段值存入 `封板强度系数`。YAML 中必须明确：
   - `factors` 中 `continuous_limit_up` 因子的输入字段应为 `ConZAFDateNum`（不是 fLianB）
   - `factors` 中 `seal_strength` 因子的输入字段应为原始 `fLianB` 字段

9. **OpenAmo/CJJEPre1 单位差异**：`OpenAmo` 单位为元，`CJJEPre1` 单位为万元，计算 `竞价金额比` 时需 `* 10000` 对齐。YAML 中因子插件应明确处理此单位差异。

---

**本文档为 V8.1 选股系统 5 策略逻辑的唯一权威提取，所有代码原样保留，所有阈值一字不差。后续生成 `strategies/strategy_*.yaml` 时以此为准。**
