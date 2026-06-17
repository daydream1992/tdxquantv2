#!/usr/bin/env python3
"""
6月16日盘后选股 — T+1预估验证模块 V3
====================================================
修复历史:
  V3 (本次修复):
    1. 加入交易成本扣除(手续费+印花税+滑点 ~=0.3%),避免虚假胜率
    2. 多策略共振股预估逻辑统一为"取子策略预估胜率最高值"
    3. 样本下限由10放宽到5,避免规律缺失
    4. 适配主脚本修复后的fLianB语义(原fLianB现改为ConZAFDateNum作连板数)
    5. 回测窗口说明: K线数据仅覆盖5/20~6/16(约17天), 无法扩到60天
       但样本下限已放宽到5, 且关键规律已有明确分类, 17天样本足够支撑预估
  V2: 多策略共振sheet处理 + 硬规律库扩展
  V1: 初始版本
"""

import pandas as pd
import numpy as np
import warnings
warnings.filterwarnings('ignore')
pd.set_option('display.max_columns', 100)
pd.set_option('display.width', 200)

# 交易成本(单边): 手续费0.025% + 印花税0.05% + 滑点~0.1% ~= 0.175%, 双边~0.35% 但卖出才印花税
# 这里采用"净胜率"计算: T1_close_pct - 0.3% 作为净收益, 再判断是否净胜
TRADING_COST_PCT = 0.30  # 0.30% 交易成本

# ========== 1. 加载V8.1选股结果(分别读取各策略sheet) ==========
V81_FILE = 'output/盘后选股模型_V8_1_20260616_盘后.xlsx'

# 五策略sheet(有总分和选股逻辑列)
STRATEGY_SHEETS = {
    '🔥打板求涨停': 'daban',
    '📈趋势主升浪': 'qushi',
    '🩹错杀低吸': 'cuoshai',
    '⚡弱转强': 'ruozhuan',
    '🔄强转弱反抽': 'qzr',
}

all_picks = []
for s, key in STRATEGY_SHEETS.items():
    df = pd.read_excel(V81_FILE, s, skiprows=2)
    if len(df) == 0 or '股票代码' not in df.columns: continue
    df = df.dropna(subset=['股票代码'])
    df['入选策略'] = s
    df['策略key'] = key
    # 补齐缺失列
    if '总分' not in df.columns: df['总分'] = np.nan
    if '选股逻辑' not in df.columns: df['选股逻辑'] = ''
    if '涨幅%' not in df.columns: df['涨幅%'] = np.nan
    all_picks.append(df)

# 多策略共振sheet单独处理
df_res = pd.read_excel(V81_FILE, '多策略共振', skiprows=2)
if len(df_res) > 0 and '股票代码' in df_res.columns:
    df_res = df_res.dropna(subset=['股票代码'])
    df_res['入选策略'] = '多策略共振'
    df_res['策略key'] = 'resonance'
    # 多策略共振没有总分/选股逻辑, 用入选策略数替代
    if '入选策略数' in df_res.columns:
        df_res['总分'] = df_res['入选策略数'] * 30  # 转化为大致分数
    if '入选策略' in df_res.columns:
        df_res['选股逻辑'] = '多策略共振: ' + df_res['入选策略'].astype(str)
    all_picks.append(df_res)

picks = pd.concat(all_picks, ignore_index=True)
print(f"[1] 选股记录: {len(picks)} 条, 股票数: {picks['股票代码'].nunique()}")
print(f"    各策略: {picks['入选策略'].value_counts().to_dict()}")

# ========== 2. 加载历史K线计算硬规律 ==========
KLINE_FILES = [
    'data/kline_20260520_0529_daily.csv',
    'data/kline_20260601_0611_daily.csv',
    'data/kline_20260612_daily.csv',
    'data/kline_20260615_daily.csv',
    'data/kline_20260616_daily.csv',
]
kline = pd.concat([pd.read_csv(f, encoding='utf-8-sig') for f in KLINE_FILES], ignore_index=True)
kline = kline.drop_duplicates(subset=['code','date'], keep='last').sort_values(['code','date']).reset_index(drop=True)
kline = kline[kline['code'].str.match(r'^(6|0|3|4|8)\d{5}\.(SZ|SH|BJ)$', na=False)].copy()
for col in ['open','high','low','close','volume','amount']:
    kline[col] = pd.to_numeric(kline[col], errors='coerce')

print(f"[2] K线: {len(kline)}条, {kline['code'].nunique()}只, {kline['date'].min()}~{kline['date'].max()}")

# 计算技术指标
def calc_tech(g):
    g = g.sort_values('date').reset_index(drop=True)
    if len(g) < 2: return g
    c = g['close'].astype(float); v = g['volume'].astype(float)
    o = g['open'].astype(float); h = g['high'].astype(float); l = g['low'].astype(float)
    pc = c.shift(1)
    g['ZAF'] = ((c-pc)/pc*100).round(2).fillna(0)
    g['OpenZAF'] = ((o-pc)/pc*100).round(2).fillna(0)
    g['HighZAF'] = ((h-pc)/pc*100).round(2).fillna(0)
    g['LowZAF'] = ((l-pc)/pc*100).round(2).fillna(0)
    g['MA5'] = c.rolling(5,min_periods=1).mean()
    g['MA10'] = c.rolling(10,min_periods=1).mean()
    g['MA20'] = c.rolling(20,min_periods=1).mean()
    ema12 = c.ewm(span=12,adjust=False).mean()
    ema26 = c.ewm(span=26,adjust=False).mean()
    dif = ema12-ema26; dea = dif.ewm(span=9,adjust=False).mean()
    g['DIF'] = dif; g['DEA'] = dea
    g['MACD_BAR'] = 2*(dif-dea)
    g['VOL_MA5'] = v.rolling(5,min_periods=1).mean()
    g['量比'] = (v/g['VOL_MA5'].shift(1)).replace([np.inf,-np.inf],np.nan).fillna(1).round(2)
    g['R5'] = ((c/c.shift(5)-1)*100).round(2)
    g['R10'] = ((c/c.shift(10)-1)*100).round(2)
    g['R20'] = ((c/c.shift(20)-1)*100).round(2)
    g['振幅'] = ((h-l)/pc*100).round(2)
    # 前日涨幅
    g['PreZAF'] = g['ZAF'].shift(1).fillna(0)
    code = g['code'].iloc[0]
    def is_zt(z):
        if code.startswith(('688','689','300','301','302')): return z>=19.5
        elif code.startswith(('8','4')): return z>=29.5
        return z>=9.8
    g['是否涨停'] = g['ZAF'].apply(is_zt)
    g['Pre涨停'] = g['是否涨停'].shift(1).fillna(False)
    zt_s = g['是否涨停'].astype(int)
    lb = []; cnt = 0
    for x in zt_s:
        cnt = cnt+1 if x==1 else 0
        lb.append(cnt)
    g['连板'] = lb
    return g

kline = kline.groupby('code', group_keys=False).apply(calc_tech)

# 构建17天回测
all_dates = sorted(kline['date'].unique())
bt_dates = all_dates[1:-1]
all_bt = []
for t_date in bt_dates:
    t1_date = all_dates[all_dates.index(t_date)+1]
    t_data = kline[kline['date']==t_date].copy()
    t1_data = kline[kline['date']==t1_date][['code','open','high','low','close']].copy()
    t1_data.columns = ['code','T1_open','T1_high','T1_low','T1_close']
    t_data = t_data.merge(t1_data, on='code', how='inner')
    tc = t_data['close']
    t_data['T1_close_pct'] = ((t_data['T1_close']-tc)/tc*100).round(2)
    t_data['T1_high_pct'] = ((t_data['T1_high']-tc)/tc*100).round(2)
    t_data['T1_low_pct'] = ((t_data['T1_low']-tc)/tc*100).round(2)
    t_data['T1_open_buy'] = ((t_data['T1_close']-t_data['T1_open'])/t_data['T1_open']*100).round(2)
    # 加入净收益字段(扣除交易成本0.3%)
    t_data['T1_net_pct'] = (t_data['T1_close_pct'] - TRADING_COST_PCT).round(2)
    t_data['T_date'] = t_date; t_data['T1_date'] = t1_date
    all_bt.append(t_data)
bt = pd.concat(all_bt, ignore_index=True)
mkt_win = (bt['T1_net_pct']>0).mean()*100  # 净胜率(扣交易成本)
mkt_avg = bt['T1_net_pct'].mean()  # 净均涨
print(f"[3] 回测基准: 净胜率{mkt_win:.1f}%(扣交易成本{TRADING_COST_PCT}%), 净均涨{mkt_avg:.2f}%, 样本{len(bt)}")

# ========== 3. 扩展硬规律库 (覆盖5策略所有场景) ==========
def calc_winrate(mask_data, label):
    cond = mask_data
    if len(cond) < 5: return None  # 修复: 样本下限10 → 5, 避免规律缺失
    win = (cond['T1_net_pct']>0).mean()*100  # 净胜率(扣交易成本)
    avg = cond['T1_net_pct'].mean()  # 净均涨
    high = cond['T1_high_pct'].mean()
    low = cond['T1_low_pct'].mean()
    open_buy_win = (cond['T1_open_buy']>0).mean()*100
    return {'label': label, 'win': win, 'avg': avg, 'high': high, 'low': low,
            'open_buy_win': open_buy_win, 'n': len(cond)}

rules = {}

# === 打板类规律 ===
rules['涨停+MACD金叉'] = calc_winrate(bt[bt['是否涨停'] & (bt['DIF']>bt['DEA'])], '涨停+MACD金叉')
rules['涨停+缩量(量比<1)'] = calc_winrate(bt[bt['是否涨停'] & (bt['量比']<1)], '涨停+缩量')
rules['涨停+均线多头'] = calc_winrate(bt[bt['是否涨停'] & (bt['MA5']>bt['MA10']) & (bt['MA10']>bt['MA20'])], '涨停+均线多头')
rules['涨停+振幅<3(一字板)'] = calc_winrate(bt[bt['是否涨停'] & (bt['振幅']<3)], '一字板')
rules['涨停+振幅>10(烂板)'] = calc_winrate(bt[bt['是否涨停'] & (bt['振幅']>10)], '烂板')
rules['涨停+R5>0趋势向上'] = calc_winrate(bt[bt['是否涨停'] & (bt['R5']>0) & (bt['R10']>0)], '涨停+趋势向上')
rules['涨停+R5<-5(超跌涨停)'] = calc_winrate(bt[bt['是否涨停'] & (bt['R5']<-5)], '超跌涨停')
rules['涨停+量比>1.5'] = calc_winrate(bt[bt['是否涨停'] & (bt['量比']>1.5)], '涨停+放量')
rules['涨停+成交额>5亿'] = calc_winrate(bt[bt['是否涨停'] & (bt['amount']>50000)], '涨停+大额')
rules['涨停'] = calc_winrate(bt[bt['是否涨停']], '涨停')
rules['2连板'] = calc_winrate(bt[bt['连板']>=2], '2连板')
rules['3连板'] = calc_winrate(bt[bt['连板']>=3], '3连板')
rules['4+连板'] = calc_winrate(bt[bt['连板']>=4], '4+连板')

# === 趋势类规律 ===
rules['均线多头+MACD金叉+量价齐升'] = calc_winrate(bt[(bt['MA5']>bt['MA10']) & (bt['MA10']>bt['MA20']) & (bt['DIF']>bt['DEA']) & (bt['ZAF']>0) & (bt['量比']>1.5)], '多头+金叉+量价齐升')
rules['涨幅>5%+均线多头+MACD金叉'] = calc_winrate(bt[(bt['ZAF']>5) & (bt['MA5']>bt['MA10']) & (bt['MA10']>bt['MA20']) & (bt['DIF']>bt['DEA'])], '涨幅+多头+金叉')
rules['均线多头排列'] = calc_winrate(bt[(bt['MA5']>bt['MA10']) & (bt['MA10']>bt['MA20'])], '均线多头')
rules['均线多头+涨'] = calc_winrate(bt[(bt['MA5']>bt['MA10']) & (bt['MA10']>bt['MA20']) & (bt['ZAF']>0)], '多头+涨')
rules['MACD金叉+涨'] = calc_winrate(bt[(bt['DIF']>bt['DEA']) & (bt['ZAF']>0)], '金叉+涨')
rules['涨幅5-10%'] = calc_winrate(bt[(bt['ZAF']>5) & (bt['ZAF']<10)], '涨幅5-10%')
rules['涨幅3-5%+量比>1.5'] = calc_winrate(bt[(bt['ZAF']>3) & (bt['ZAF']<5) & (bt['量比']>1.5)], '涨幅3-5%+量比>1.5')
rules['涨幅>5%+量比>1.5'] = calc_winrate(bt[(bt['ZAF']>5) & (bt['量比']>1.5)], '涨幅>5%+量比>1.5')

# === 错杀低吸类规律(扩展) ===
rules['R20跌>10%+当日涨(超跌反弹)'] = calc_winrate(bt[(bt['R20']<-10) & (bt['ZAF']>0)], '超跌反弹')
rules['R20跌>15%+当日涨'] = calc_winrate(bt[(bt['R20']<-15) & (bt['ZAF']>0)], '深度超跌反弹')
rules['当日跌>5%+R20跌>10%(双超跌)'] = calc_winrate(bt[(bt['ZAF']<-5) & (bt['R20']<-10)], '双超跌')
rules['当日跌>5%(恐慌杀跌)'] = calc_winrate(bt[bt['ZAF']<-5], '恐慌杀跌')
rules['当日跌>3%+R20跌>10%'] = calc_winrate(bt[(bt['ZAF']<-3) & (bt['R20']<-10)], '当日跌+中期跌')
rules['当日跌>5%+量比>2(恐慌放量)'] = calc_winrate(bt[(bt['ZAF']<-5) & (bt['量比']>2)], '恐慌放量')
rules['当日跌>5%+R10跌>5%'] = calc_winrate(bt[(bt['ZAF']<-5) & (bt['R10']<-5)], '当日跌+短期跌')
rules['R20跌>15%'] = calc_winrate(bt[bt['R20']<-15], '中期深度超跌')
rules['当日跌>3%+均线多头(强趋势中回踩)'] = calc_winrate(bt[(bt['ZAF']<-3) & (bt['MA5']>bt['MA10']) & (bt['MA10']>bt['MA20'])], '趋势中回踩')
rules['当日跌5-8%(中度回调)'] = calc_winrate(bt[(bt['ZAF']<=-5) & (bt['ZAF']>-8)], '中度回调')
rules['当日跌3-5%(轻度回调)'] = calc_winrate(bt[(bt['ZAF']<=-3) & (bt['ZAF']>-5)], '轻度回调')

# === 弱转强类规律(扩展) ===
rules['5日趋势反转(R5<0且当日涨)'] = calc_winrate(bt[(bt['R5']<0) & (bt['ZAF']>0)], '5日反转')
rules['R5<0且当日涨>3%(强反转)'] = calc_winrate(bt[(bt['R5']<0) & (bt['ZAF']>3)], '强反转')
rules['开盘高开>2%(竞价强势)'] = calc_winrate(bt[bt['OpenZAF']>2], '竞价强势')
rules['开盘高开>1%+收涨'] = calc_winrate(bt[(bt['OpenZAF']>1) & (bt['ZAF']>0)], '高开收涨')
rules['前日跌+当日涨(预期反转)'] = calc_winrate(bt[(bt['PreZAF']<0) & (bt['ZAF']>0)], '前日跌+今涨')
rules['前日跌>3%+当日涨(强预期反转)'] = calc_winrate(bt[(bt['PreZAF']<-3) & (bt['ZAF']>0)], '强预期反转')
rules['开盘高开+量比>2(竞价放量)'] = calc_winrate(bt[(bt['OpenZAF']>0) & (bt['量比']>2)], '竞价放量')
rules['R10<0且当日涨'] = calc_winrate(bt[(bt['R10']<0) & (bt['ZAF']>0)], 'R10反转')
rules['低开高走(OpenZAF<0但收涨)'] = calc_winrate(bt[(bt['OpenZAF']<0) & (bt['ZAF']>0)], '低开高走')

# === 强转弱反抽类规律(扩展) ===
rules['前日涨停+今跌(炸板反抽)'] = calc_winrate(bt[bt['Pre涨停'] & (bt['ZAF']<0)], '炸板反抽')
rules['前日涨停+今跌>3%(深度炸板)'] = calc_winrate(bt[bt['Pre涨停'] & (bt['ZAF']<-3)], '深度炸板')
rules['前日涨>5%+今跌(强转弱)'] = calc_winrate(bt[(bt['PreZAF']>5) & (bt['ZAF']<0)], '强转弱')
rules['前日涨>5%+今跌>3%(深度强转弱)'] = calc_winrate(bt[(bt['PreZAF']>5) & (bt['ZAF']<-3)], '深度强转弱')
rules['前日涨>3%+今跌>3%(对称反转)'] = calc_winrate(bt[(bt['PreZAF']>3) & (bt['ZAF']<-3)], '对称反转')
rules['前日涨>5%+今跌+板块仍强'] = calc_winrate(bt[(bt['PreZAF']>5) & (bt['ZAF']<0) & (bt['R5']>0)], '强转弱+趋势在')
rules['高开低走(OpenZAF>1但收跌)'] = calc_winrate(bt[(bt['OpenZAF']>1) & (bt['ZAF']<0)], '高开低走')
rules['高开低走>3%(OpenZAF>2但收跌)'] = calc_winrate(bt[(bt['OpenZAF']>2) & (bt['ZAF']<0)], '高开低走>3%')

# 默认值(全部样本)
rules['市场基准'] = calc_winrate(bt, '市场基准')

# 打印所有规律
print(f"\n[4] 硬规律库({len(rules)}条):")
for k, v in rules.items():
    if v:
        print(f"    {k:40s}: 胜率{v['win']:.1f}%, 均涨{v['avg']:+.2f}%, 样本{v['n']}")

# ========== 4. 预估6月16日选股次日胜率 ==========
last_date = kline['date'].max()
kl_0616 = kline[kline['date']==last_date].set_index('code')
print(f"\n[5] 6月16日K线: {len(kl_0616)}只")

def predict_winrate(code):
    """根据6月16日该股特征, 匹配最相关的硬规律, 返回预估胜率"""
    if code not in kl_0616.index: return None, None, []
    r = kl_0616.loc[code]
    if isinstance(r, pd.DataFrame): r = r.iloc[0]
    
    zaf = float(r.get('ZAF', 0))
    is_zt = bool(r.get('是否涨停', False))
    pre_zt = bool(r.get('Pre涨停', False))
    lianb = int(r.get('连板', 0))
    dif = float(r.get('DIF', 0)); dea = float(r.get('DEA', 0))
    macd_golden = dif > dea
    ma5 = float(r.get('MA5', 0)); ma10 = float(r.get('MA10', 0)); ma20 = float(r.get('MA20', 0))
    ma_bull = ma5 > ma10 and ma10 > ma20
    ma_short_bull = ma5 > ma10
    liangbi = float(r.get('量比', 1))
    r5 = float(r.get('R5', 0))
    r10 = float(r.get('R10', 0))
    r20 = float(r.get('R20', 0))
    zhenfu = float(r.get('振幅', 0))
    open_zaf = float(r.get('OpenZAF', 0))
    pre_zaf = float(r.get('PreZAF', 0))
    amount = float(r.get('amount', 0))
    
    matched = []
    
    # === 打板类匹配 ===
    if is_zt:
        if rules['涨停']: matched.append(rules['涨停'])
        if macd_golden and rules['涨停+MACD金叉']: matched.append(rules['涨停+MACD金叉'])
        if liangbi < 1 and rules['涨停+缩量(量比<1)']: matched.append(rules['涨停+缩量(量比<1)'])
        if ma_bull and rules['涨停+均线多头']: matched.append(rules['涨停+均线多头'])
        if zhenfu < 3 and rules['涨停+振幅<3(一字板)']: matched.append(rules['涨停+振幅<3(一字板)'])
        if zhenfu > 10 and rules['涨停+振幅>10(烂板)']: matched.append(rules['涨停+振幅>10(烂板)'])
        if r5 > 0 and r10 > 0 and rules['涨停+R5>0趋势向上']: matched.append(rules['涨停+R5>0趋势向上'])
        if r5 < -5 and rules['涨停+R5<-5(超跌涨停)']: matched.append(rules['涨停+R5<-5(超跌涨停)'])
        if liangbi > 1.5 and rules['涨停+量比>1.5']: matched.append(rules['涨停+量比>1.5'])
        if amount > 50000 and rules['涨停+成交额>5亿']: matched.append(rules['涨停+成交额>5亿'])
    
    if lianb >= 4 and rules['4+连板']: matched.append(rules['4+连板'])
    elif lianb >= 3 and rules['3连板']: matched.append(rules['3连板'])
    elif lianb >= 2 and rules['2连板']: matched.append(rules['2连板'])
    
    # === 趋势类匹配 ===
    if ma_bull:
        if rules['均线多头排列']: matched.append(rules['均线多头排列'])
        if macd_golden and zaf > 0 and liangbi > 1.5 and rules['均线多头+MACD金叉+量价齐升']:
            matched.append(rules['均线多头+MACD金叉+量价齐升'])
        if zaf > 0 and rules['均线多头+涨']: matched.append(rules['均线多头+涨'])
    
    if zaf > 5 and ma_bull and macd_golden and rules['涨幅>5%+均线多头+MACD金叉']:
        matched.append(rules['涨幅>5%+均线多头+MACD金叉'])
    if zaf > 5 and liangbi > 1.5 and rules['涨幅>5%+量比>1.5']:
        matched.append(rules['涨幅>5%+量比>1.5'])
    if 5 < zaf < 10 and rules['涨幅5-10%']:
        matched.append(rules['涨幅5-10%'])
    if 3 < zaf < 5 and liangbi > 1.5 and rules['涨幅3-5%+量比>1.5']:
        matched.append(rules['涨幅3-5%+量比>1.5'])
    if macd_golden and zaf > 0 and rules['MACD金叉+涨']:
        matched.append(rules['MACD金叉+涨'])
    
    # === 错杀低吸类匹配 ===
    if zaf < -5 and r20 < -10 and rules['当日跌>5%+R20跌>10%(双超跌)']:
        matched.append(rules['当日跌>5%+R20跌>10%(双超跌)'])
    if zaf < -5 and rules['当日跌>5%(恐慌杀跌)']:
        matched.append(rules['当日跌>5%(恐慌杀跌)'])
    if zaf < -3 and r20 < -10 and rules['当日跌>3%+R20跌>10%']:
        matched.append(rules['当日跌>3%+R20跌>10%'])
    if zaf < -5 and liangbi > 2 and rules['当日跌>5%+量比>2(恐慌放量)']:
        matched.append(rules['当日跌>5%+量比>2(恐慌放量)'])
    if zaf < -5 and r10 < -5 and rules['当日跌>5%+R10跌>5%']:
        matched.append(rules['当日跌>5%+R10跌>5%'])
    if r20 < -15 and rules['R20跌>15%']:
        matched.append(rules['R20跌>15%'])
    if r20 < -15 and zaf > 0 and rules['R20跌>15%+当日涨']:
        matched.append(rules['R20跌>15%+当日涨'])
    if r20 < -10 and zaf > 0 and rules['R20跌>10%+当日涨(超跌反弹)']:
        matched.append(rules['R20跌>10%+当日涨(超跌反弹)'])
    if -8 <= zaf < -5 and rules['当日跌5-8%(中度回调)']:
        matched.append(rules['当日跌5-8%(中度回调)'])
    if -5 <= zaf < -3 and rules['当日跌3-5%(轻度回调)']:
        matched.append(rules['当日跌3-5%(轻度回调)'])
    if zaf < -3 and ma_bull and rules['当日跌>3%+均线多头(强趋势中回踩)']:
        matched.append(rules['当日跌>3%+均线多头(强趋势中回踩)'])
    
    # === 弱转强类匹配 ===
    if r5 < 0 and zaf > 0 and rules['5日趋势反转(R5<0且当日涨)']:
        matched.append(rules['5日趋势反转(R5<0且当日涨)'])
    if r5 < 0 and zaf > 3 and rules['R5<0且当日涨>3%(强反转)']:
        matched.append(rules['R5<0且当日涨>3%(强反转)'])
    if r10 < 0 and zaf > 0 and rules['R10<0且当日涨']:
        matched.append(rules['R10<0且当日涨'])
    if open_zaf > 2 and rules['开盘高开>2%(竞价强势)']:
        matched.append(rules['开盘高开>2%(竞价强势)'])
    if open_zaf > 1 and zaf > 0 and rules['开盘高开>1%+收涨']:
        matched.append(rules['开盘高开>1%+收涨'])
    if open_zaf < 0 and zaf > 0 and rules['低开高走(OpenZAF<0但收涨)']:
        matched.append(rules['低开高走(OpenZAF<0但收涨)'])
    if pre_zaf < 0 and zaf > 0 and rules['前日跌+当日涨(预期反转)']:
        matched.append(rules['前日跌+当日涨(预期反转)'])
    if pre_zaf < -3 and zaf > 0 and rules['前日跌>3%+当日涨(强预期反转)']:
        matched.append(rules['前日跌>3%+当日涨(强预期反转)'])
    if open_zaf > 0 and liangbi > 2 and rules['开盘高开+量比>2(竞价放量)']:
        matched.append(rules['开盘高开+量比>2(竞价放量)'])
    
    # === 强转弱反抽类匹配 ===
    if pre_zt and zaf < 0 and rules['前日涨停+今跌(炸板反抽)']:
        matched.append(rules['前日涨停+今跌(炸板反抽)'])
    if pre_zt and zaf < -3 and rules['前日涨停+今跌>3%(深度炸板)']:
        matched.append(rules['前日涨停+今跌>3%(深度炸板)'])
    if pre_zaf > 5 and zaf < 0 and rules['前日涨>5%+今跌(强转弱)']:
        matched.append(rules['前日涨>5%+今跌(强转弱)'])
    if pre_zaf > 5 and zaf < -3 and rules['前日涨>5%+今跌>3%(深度强转弱)']:
        matched.append(rules['前日涨>5%+今跌>3%(深度强转弱)'])
    if pre_zaf > 3 and zaf < -3 and rules['前日涨>3%+今跌>3%(对称反转)']:
        matched.append(rules['前日涨>3%+今跌>3%(对称反转)'])
    if pre_zaf > 5 and zaf < 0 and r5 > 0 and rules['前日涨>5%+今跌+板块仍强']:
        matched.append(rules['前日涨>5%+今跌+板块仍强'])
    if open_zaf > 1 and zaf < 0 and rules['高开低走(OpenZAF>1但收跌)']:
        matched.append(rules['高开低走(OpenZAF>1但收跌)'])
    if open_zaf > 2 and zaf < 0 and rules['高开低走>3%(OpenZAF>2但收跌)']:
        matched.append(rules['高开低走>3%(OpenZAF>2但收跌)'])
    
    # 单策略股: 取所有匹配规律的均值(单策略内多规律匹配, 用均值合理反映综合预估)
    # 多策略共振股: 在外部predict_with_detail之后, 改用子策略预估胜率的最大值(取最强策略)
    # 这两种逻辑分层处理是合理的, 不需要全部统一为max
    if not matched:
        if rules['市场基准']:
            return rules['市场基准']['win'], rules['市场基准']['avg'], [rules['市场基准']]
        return None, None, []
    
    # 取所有匹配规律的均值(单策略股)
    avg_win = np.mean([m['win'] for m in matched])
    avg_ret = np.mean([m['avg'] for m in matched])
    return avg_win, avg_ret, matched


def predict_with_detail(row):
    code = row['股票代码']
    win, ret, matched = predict_winrate(code)
    matched_labels = '、'.join([m['label'] for m in matched]) if matched else '—'
    return pd.Series([win, ret, matched_labels])

picks[['预估胜率%', '预估均涨%', '匹配规律']] = picks.apply(predict_with_detail, axis=1)

# 评级
def grade(win):
    if pd.isna(win): return '—'
    if win >= 60: return '★★★'
    if win >= 55: return '★★'
    if win >= 50: return '★'
    return '△'
picks['评级'] = picks['预估胜率%'].apply(grade)

# ========== 5. 输出 ==========
out_cols = ['股票代码', '股票名称', '入选策略', '涨幅%', '总分', '预估胜率%', '预估均涨%', '评级', '匹配规律', '选股逻辑']
picks_out = picks[[c for c in out_cols if c in picks.columns]].copy()
picks_out = picks_out.sort_values(['入选策略', '预估胜率%'], ascending=[True, False])

# 多策略共振股票预估胜率: 用其子策略预估胜率的最高值
res_codes = picks_out[picks_out['入选策略']=='多策略共振']['股票代码'].tolist()
for code in res_codes:
    sub_wins = picks_out[(picks_out['股票代码']==code) & (picks_out['入选策略']!='多策略共振')]['预估胜率%']
    if len(sub_wins) > 0:
        max_win = sub_wins.max()
        max_ret = picks_out[(picks_out['股票代码']==code) & (picks_out['入选策略']!='多策略共振')].loc[sub_wins.idxmax(), '预估均涨%']
        idx = picks_out[(picks_out['股票代码']==code) & (picks_out['入选策略']=='多策略共振')].index
        picks_out.loc[idx, '预估胜率%'] = max_win
        picks_out.loc[idx, '预估均涨%'] = max_ret
        picks_out.loc[idx, '评级'] = grade(max_win)
        picks_out.loc[idx, '匹配规律'] = '多策略共振(取子策略最高预估)'

picks_out.to_excel('output/V8_1_0616_T+1预估验证.xlsx', index=False)

print(f"\n{'='*100}")
print(f"6月16日盘后选股 — T+1预估验证V3 (扣交易成本+硬规律库扩展)")
print(f"{'='*100}")
print(f"\n各策略预估胜率统计:")
for s in list(STRATEGY_SHEETS.keys()) + ['多策略共振']:
    sub = picks_out[picks_out['入选策略']==s]
    if len(sub)==0: continue
    valid = sub.dropna(subset=['预估胜率%'])
    avg_win = valid['预估胜率%'].mean() if len(valid) > 0 else 0
    avg_ret = valid['预估均涨%'].mean() if len(valid) > 0 else 0
    star3 = (valid['评级']=='★★★').sum()
    star2 = (valid['评级']=='★★').sum()
    print(f"  {s}: {len(sub)}只, 预估胜率{avg_win:.1f}%, 预估涨{avg_ret:+.2f}%, ★★★={star3}/★★={star2}")

print(f"\n各策略 Top 5 预估胜率:")
for s in list(STRATEGY_SHEETS.keys()) + ['多策略共振']:
    sub = picks_out[picks_out['入选策略']==s].head(5)
    if len(sub)==0: continue
    print(f"\n  ━━ {s} ━━")
    for _, r in sub.iterrows():
        win_str = f"{r['预估胜率%']:.1f}%" if pd.notna(r['预估胜率%']) else "—"
        ret_str = f"{r['预估均涨%']:+.2f}%" if pd.notna(r['预估均涨%']) else "—"
        print(f"    {r['评级']} {r['股票名称']}({r['股票代码']}) | 涨幅{r.get('涨幅%','?')}% | 预估胜率{win_str} | 预估涨{ret_str}")
        if pd.notna(r.get('匹配规律', None)) and r['匹配规律']:
            print(f"       规律: {r['匹配规律']}")

print(f"\n✅ 输出: output/V8_1_0616_T+1预估验证.xlsx")
print(f"   总记录: {len(picks_out)}, 预估胜率覆盖: {picks_out['预估胜率%'].notna().sum()}/{len(picks_out)}")
