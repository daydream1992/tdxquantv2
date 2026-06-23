"""tqcenter API 字段权威目录（源自《通达信量化平台说明书》）。

本模块是 **数据接口字段配置的唯一事实来源**。所有字段名、API 签名、返回结构
均严格对照 ``docs/tongdaxin-api-docs/通达信量化平台说明书/`` 下的 49 篇 markdown
文档与 ``tongdaxin_query.py`` 字段注册表，**不再凭记忆/经验猜测**。

设计要点：
1. **API_REGISTRY** — 每个 tqcenter API 的元信息（类别 / 签名 / 字段清单 /
   返回结构 / 注意事项），按 说明书 7 大类组织。
2. **V8_SNAPSHOT_FIELDS** — V8 盘后选股模型 91 字段快照与 ``get_more_info`` 的
   字段映射（V8 快照 = 全市场 ``get_more_info(code, field_list=[])`` + 3 个元数据列）。
3. **辅助函数** — ``get_api_fields`` / ``find_field`` / ``validate_field_list`` /
   ``v8_field_list``，供 RealAdapter / 选股引擎 / 前端字段面板调用。

字段来源对照（说明书路径）：
- a行情类信息/获取快照数据.md         → get_market_snapshot (25 字段)
- a行情类信息/获取K线行情.md          → get_market_data (10 字段)
- a行情类信息/批量获取价量.md         → get_pricevol (3 字段)
- a行情类信息/获取股票更多信息.md     → get_more_info (88 字段, V8 快照主源)
- a行情类信息/获取证券基本信息.md     → get_stock_info (52 字段)
- a行情类信息/获取股票所属板块.md     → get_relation (4 字段)
- a行情类信息/获取每天的股本数据.md   → get_gb_info (3 字段)
- a行情类信息/根据时间段获取股本数据.md → get_gb_info_by_date (3 字段)
- a行情类信息/获取新股申购信息.md     → get_ipo_info (7 字段)
- b财务类数据/获取专业财务数据.md     → get_financial_data (FN1-FN584)
- b财务类数据/获取股票的单个财务数据.md → get_gp_one_data (GO1-GO47)
- b财务类数据/获取股票交易数据.md     → get_gpjy_value (GP01-GP46)
- c分类板块/*                        → get_stock_list / get_sector_list / get_stock_list_in_sector
- d客户端操作类/自定义板块管理.md     → 板块管理 6 个 API
- e ETF/可转债/*                     → get_kzz_info / get_trackzs_etf_info
- 通用函数/*                         → get_trading_dates / send_message / send_warn /
                                        refresh_cache / refresh_kline / download_file
"""

from __future__ import annotations

from typing import Any

# ============================================================================
# API 权威注册表
# 每条记录: {
#   "category", "description", "signature", "fields", "returns", "notes"
# }
# fields 为该 API 返回/可筛选的字段名清单（去描述后缀）
# returns 描述返回结构
# ============================================================================

API_REGISTRY: dict[str, dict[str, Any]] = {
    # ---------------- a 行情类信息 ----------------
    "get_market_snapshot": {
        "category": "行情类",
        "description": "获取快照数据（最新行情）",
        "signature": "get_market_snapshot(stock_code: str, field_list: List = []) -> Dict",
        "fields": [
            "ItemNum", "LastClose", "Open", "Max", "Min", "Now", "Volume", "NowVol",
            "Amount", "Inside", "Outside", "TickDiff", "InOutFlag", "Jjjz",
            "Buyp", "Buyv", "Sellp", "Sellv", "UpHome", "DownHome",
            "Before5MinNow", "Average", "XsFlag", "Zangsu", "ZAFPre3",
        ],
        "returns": "dict[str, Any]（单只证券，Buyp/Buyv/Sellp/Sellv 为 5 元素 list）",
        "notes": "field_list 传空返回全部；InOutFlag: 0 Buy 1 Sell 2 Unknown",
    },
    "get_market_data": {
        "category": "行情类",
        "description": "获取K线行情",
        "signature": "get_market_data(field_list=[], stock_list=[], period='', start_time='', end_time='', count=-1, dividend_type=None, fill_data=True) -> Dict",
        "fields": ["Date", "Time", "Open", "High", "Low", "Close", "Volume", "Amount", "ForwardFactor", "VolInStock"],
        "returns": "dict[field -> pd.DataFrame]（DataFrame index=stock_list, columns=time_list）",
        "notes": "单次最多 24000 条；dividend_type: none/front/back；仅 none 时 ForwardFactor 有效；期货 Amount=0，非期货 VolInStock=0",
    },
    "get_pricevol": {
        "category": "行情类",
        "description": "批量获取价量",
        "signature": "get_pricevol(stock_list: List[str] = []) -> Dict",
        "fields": ["LastClose", "Now", "Volume"],
        "returns": "dict[code -> {LastClose, Now, Volume}]",
        "notes": "适合全市场扫一遍拿前收/现价/量",
    },
    "get_more_info": {
        "category": "行情类",
        "description": "获取股票更多信息（资金流/封板/估值/关键日期）",
        "signature": "get_more_info(stock_code: str = '', field_list: List = []) -> Dict",
        "fields": [
            # 基本与形态
            "MainBusiness", "SafeValue", "ShineValue", "ShapeValue", "TPFlag", "ZTPrice", "DTPrice", "HqDate",
            # 成交量与市值
            "fHSL", "fLianB", "Wtb", "Zsz", "Ltsz", "vzangsu", "Fzhsl", "FzAmo", "FreeLtgb",
            # 涨幅类
            "VOpenZAF", "ZAF", "ZAFYesterday", "ZAFPre2D", "ZAFPre5", "ZAFPre10", "ZAFPre20",
            "ZAFPre30", "ZAFPre60", "ZAFYear", "ZAFPreMyMonth", "ZAFPreOneYear", "ConZAFDateNum",
            # 资金流向
            "Zjl", "Zjl_HB", "TotalBVol", "TotalSVol", "BCancel", "SCancel", "L2TicNum", "L2OrderNum",
            # 涨停封板
            "FCAmo", "FCb", "OpenAmo", "OpenZTBuy", "OpenAmoPre1", "OpenVolPre1",
            "CJJEPre1", "CJJEPre3", "FDEPre1", "FDEPre2", "ZTGPNum", "LastStartZT",
            "LastZTHzNum", "EverZTCount", "YearZTDay",
            # 价格与估值
            "MA5Value", "HisHigh", "HisLow", "IPO_Price", "More_YJL", "BetaValue",
            "DynaPE", "MorePE", "StaticPE_TTM", "DYRatio", "PB_MRQ",
            # 类型标识
            "IsT0Fund", "IsZCZGP", "IsKzz", "Kzz_HSCode", "QHMainYYMM", "Yield",
            # 财务指标
            "KfEarnMoney", "RDInputFee", "CashZJ", "PreReceiveZJ", "OtherQYJzc", "StaffNum",
            # 关键日期
            "RecentGGJYDate", "RecentHGDate", "RecentIncentDate", "NoticeDate_Recent",
            "RecentReleaseDate", "RecentDZDate", "ReportDate", "ZTDate_Recent",
            "DTDate_Recent", "TopDate_Recent", "StopJYDate_Recent",
        ],
        "returns": "dict[str, Any]（单只证券，88 个字段）",
        "notes": "涨停跌停判断: FCAmo>0 涨停, <0 跌停；fLianB=量比, Wtb=委比, fHSL=换手率；V8 快照主数据源",
    },
    "get_stock_info": {
        "category": "行情类",
        "description": "获取证券基本信息（名称/分类/股本/财务摘要）",
        "signature": "get_stock_info(stock_code: str, field_list: List = []) -> Dict",
        "fields": [
            "Name", "Unit", "VolBase", "MinPrice", "XsFlag", "Fz", "DelayMin", "QHVolBaseRate", "HKVolBaseRate",
            "BelongHS300", "BelongHasKQZ", "BelongRZRQ", "BelongHSGT", "IsHKGP", "IsQH", "IsQQ",
            "IsSTGP", "IsQuitGP", "TodayDRFlag", "HSStockKind",
            "ActiveCapital", "J_zgb", "J_bg", "J_hg", "J_zzc", "J_ldzc", "J_gdzc", "J_wxzc",
            "J_ldfz", "J_cqfz", "J_zbgjj", "J_jzc",
            "J_yysy", "J_yycb", "J_yszk", "J_yyly", "J_tzsy", "J_jyxjl", "J_zxjl", "J_ch",
            "J_lyze", "J_shly", "J_jly", "J_wfply",
            "J_jyl", "J_mgwfp", "J_mgsy", "J_mgsy2", "J_mggjj", "J_mgjzc", "J_mgjzc2",
            "J_gdqyb", "J_gdrs", "J_HalfYearFlag",
            "J_start", "tdx_dycode", "tdx_dyname", "rs_hycode_sim", "rs_hyname",
            "blockzscode", "underly_setcode", "underly_code",
        ],
        "returns": "dict[str, Any]（单只证券，52 字段）",
        "notes": "field_list 不能为空；HSStockKind: 0指数/1A股主板/2北证/3创业板/4科创板/5B股/6债券/7基金/8权证/9其它",
    },
    "get_relation": {
        "category": "行情类",
        "description": "获取股票所属板块",
        "signature": "get_relation(stock_code: str = '') -> List",
        "fields": ["BlockCode", "BlockName", "BlockType", "GPNume"],
        "returns": "list[dict]（行业/地区/概念/风格/指数 多类板块）",
        "notes": "无板块代码的板块 BlockCode 返回 '0'",
    },
    "get_gb_info": {
        "category": "行情类",
        "description": "获取每天的股本数据（离散日期）",
        "signature": "get_gb_info(stock_code: str = '', date_list: List[str] = [], count: int = 1) -> List",
        "fields": ["Date", "Zgb", "Ltgb"],
        "returns": "list[dict]",
        "notes": "date_list 须从小到大排序；有效个数须 >= count 且 >= 1",
    },
    "get_gb_info_by_date": {
        "category": "行情类",
        "description": "根据时间段获取股本数据",
        "signature": "get_gb_info_by_date(stock_code: str = '', start_date: str = '', end_date: str = '') -> List",
        "fields": ["Date", "Zgb", "Ltgb"],
        "returns": "list[dict]",
        "notes": "须先下载对应股票日K线数据",
    },
    "get_ipo_info": {
        "category": "行情类",
        "description": "获取新股申购信息",
        "signature": "get_ipo_info(ipo_type: int = 0, ipo_date: int = 0) -> List",
        "fields": ["Code", "Name", "SGDate", "SGPrice", "SGCode", "MaxSG", "PE_Issue"],
        "returns": "list[dict]",
        "notes": "ipo_type: 0新股/1新发债/2新股+新发债；ipo_date: 0仅今日/1今日及以后",
    },
    # ---------------- b 财务类数据 ----------------
    "get_financial_data": {
        "category": "财务类",
        "description": "获取专业财务数据（FN 系列）",
        "signature": "get_financial_data(stock_list=[], field_list=[], start_time='', end_time='', report_type='report_time') -> Dict",
        "fields": "_FN_SERIES",  # FN1-FN584，见 FINANCIAL_FN_FIELDS 常用子集
        "returns": "dict[code -> pd.DataFrame]（列: 请求的 FN 字段 + announce_time + tag_time）",
        "notes": "field_list 不能为空，字段名如 'FN193'（大小写不敏感）；report_type: announce_time/tag_time；须先在客户端下载专业财务数据",
    },
    "get_gp_one_data": {
        "category": "财务类",
        "description": "获取股票的单个财务数据（GO 系列）",
        "signature": "get_gp_one_data(stock_list=[], field_list=[]) -> Dict",
        "fields": [f"GO{n}" for n in range(1, 48)],
        "returns": "dict[code -> {GOx: value}]",
        "notes": "field_list 不能为空；GO1发行价/GO3一致预期目标价/GO29机构家数/GO33总股本/GO34流通A股",
    },
    "get_gpjy_value": {
        "category": "财务类",
        "description": "获取股票交易数据（GP 系列）",
        "signature": "get_gpjy_value(stock_list=[], field_list=[], start_time='', end_time='') -> Dict",
        "fields": [f"GP{n:02d}" for n in range(1, 47)],
        "returns": "dict[code -> {GPxx: [{Date, Value}]}]",
        "notes": "field_list 不能为空；GP01股东人数/GP03融资融券/GP14涨停/GP15涨跌停状态/GP16总市值；须先下载股票数据包",
    },
    # ---------------- c 分类板块 ----------------
    "get_stock_list": {
        "category": "分类板块",
        "description": "获取系统分类成份股",
        "signature": "get_stock_list(market=None, list_type: int = 0) -> List",
        "fields": ["Code", "Name"],
        "returns": "list[str]（list_type=0）或 list[dict]（list_type=1）",
        "notes": "market(list_type值): 0自选/1持仓/5全部A股/10所有板块指数/11行业/12概念/13风格/14地区/23沪深300/31ETF/32可转债/50沪深A股/51创业板/52科创板/53北交所",
    },
    "get_sector_list": {
        "category": "分类板块",
        "description": "获取A股板块代码列表",
        "signature": "get_sector_list(list_type: int = 0) -> List",
        "fields": ["Code", "Name"],
        "returns": "list[str]（list_type=0）或 list[dict]（list_type=1）",
        "notes": "相当于 get_stock_list('10')；注意：无 market 参数",
    },
    "get_stock_list_in_sector": {
        "category": "分类板块",
        "description": "获取板块成份股",
        "signature": "get_stock_list_in_sector(block_code: str, block_type: int = 0, list_type: int = 0) -> List",
        "fields": ["Code", "Name"],
        "returns": "list[str]（list_type=0）或 list[dict]（list_type=1）",
        "notes": "block_type: 0板块指数/1自定义板块(ZXG自选/TJG临时)；参数名是 block_code 不是 code；只支持板块指数或自定义板块，不支持系统全部A股",
    },
    # ---------------- d 客户端操作类（板块管理）----------------
    "get_user_sector": {
        "category": "客户端操作",
        "description": "获取自定义板块列表",
        "signature": "get_user_sector() -> List",
        "fields": ["Code", "Name"],
        "returns": "list[dict]",
        "notes": "无参数；如需查指定板块成份股用 get_stock_list_in_sector(block_code, block_type=1)",
    },
    "create_sector": {
        "category": "客户端操作",
        "description": "创建自定义板块",
        "signature": "create_sector(block_code: str = '', block_name: str = '') -> Dict",
        "fields": ["Error", "ErrorId", "run_id"],
        "returns": "dict",
        "notes": "block_code 为简称",
    },
    "delete_sector": {
        "category": "客户端操作",
        "description": "删除自定义板块",
        "signature": "delete_sector(block_code: str = '') -> Dict",
        "fields": ["Error", "ErrorId", "run_id"],
        "returns": "dict",
    },
    "rename_sector": {
        "category": "客户端操作",
        "description": "重命名自定义板块",
        "signature": "rename_sector(block_code: str = '', block_name: str = '') -> Dict",
        "fields": ["Error", "ErrorId", "run_id"],
        "returns": "dict",
    },
    "clear_sector": {
        "category": "客户端操作",
        "description": "清空自定义板块成份股（直接 API）",
        "signature": "clear_sector(block_code: str = '') -> Dict",
        "fields": ["Error", "ErrorId", "run_id"],
        "returns": "dict",
        "notes": "tqcenter 有独立的 clear_sector API，无需用 send_user_block(code, []) 变通",
    },
    "send_user_block": {
        "category": "客户端操作",
        "description": "添加自定义板块成份股（追加语义）",
        "signature": "send_user_block(block_code: str = '', stocks: List[str] = [], show: bool = False) -> Dict",
        "fields": ["Error", "ErrorId", "run_id"],
        "returns": "dict",
        "notes": "参数名是 stocks 不是 stock_list；空列表=清空该板块；ZXG=自选股；更新板块前必须先 clear_sector",
    },
    # ---------------- e ETF/可转债 ----------------
    "get_kzz_info": {
        "category": "ETF/可转债",
        "description": "获取可转债信息",
        "signature": "get_kzz_info(stock_code: str = '', field_list: List[str] = []) -> Dict",
        "fields": [
            "SetCode", "KZZCode", "HSCode", "ZGPrice", "CurRate", "RestScope", "PutBack",
            "ForceRedeem", "ZGDate", "EndPrice", "EndDate", "ZGRate", "RealValue",
            "ExpireYield", "KZZScore", "HSScore", "RedeemDate", "RedeemPrice",
            "PutDate", "PutPrice", "ZGCode", "AGPrice", "KZZPrice", "KZZYj", "ZGValue",
        ],
        "returns": "dict（单只可转债）",
    },
    "get_trackzs_etf_info": {
        "category": "ETF/可转债",
        "description": "获取跟踪指数的ETF信息",
        "signature": "get_trackzs_etf_info(zs_code: str = '') -> List",
        "fields": ["Code", "Name", "NowPrice", "PreClose", "IOPV", "Zgb", "Sz"],
        "returns": "list[dict]",
        "notes": "参数名是 zs_code 不是 etf_code；zs_code 如 '950162.CSI'",
    },
    # ---------------- 通用函数 ----------------
    "get_trading_dates": {
        "category": "通用函数",
        "description": "获取交易日列表",
        "signature": "get_trading_dates(market: str, start_time: str, end_time: str, count: int = -1) -> List",
        "fields": ["<date_str>"],
        "returns": "list[str]（YYYYMMDD）",
        "notes": "market 暂固定 'SH'；须先下载上证指数(999999)盘后数据；count>0 返回最近 count 个交易日",
    },
    "send_message": {
        "category": "通用函数",
        "description": "发送消息到通达信客户端 TQ 策略界面",
        "signature": "send_message(msg_str: str) -> Dict",
        "fields": ["Error", "ErrorId", "run_id"],
        "returns": "dict",
        "notes": "参数名是 msg_str 不是 msg；用 '|' 分两条，\\n 分行",
    },
    "send_warn": {
        "category": "通用函数",
        "description": "发送预警信号到客户端",
        "signature": "send_warn(stock_list=[], time_list=[], price_list=[], close_list=[], volum_list=[], bs_flag_list=[], warn_type_list=[], reason_list=[], count=1) -> Dict",
        "fields": ["Error", "ErrorId", "run_id"],
        "returns": "dict",
        "notes": "stock_list/time_list 必选且一一对应；bs_flag: 0买1卖2未知；reason 每元素≤25汉字",
    },
    "refresh_cache": {
        "category": "通用函数",
        "description": "刷新行情缓存（snapshot + K线）",
        "signature": "refresh_cache(market: str = 'AG', force: bool = False) -> Dict",
        "fields": ["Error", "ErrorId", "run_id"],
        "returns": "dict",
        "notes": "force=False 时距上次<10分钟不刷新；market: AG/HK/US/QH/QQ/NQ/ZZ/OF/ZS/OJ",
    },
    "refresh_kline": {
        "category": "通用函数",
        "description": "刷新历史K线缓存（定向下载）",
        "signature": "refresh_kline(stock_list: List[str] = [], period: str = '') -> Dict",
        "fields": ["Error", "ErrorId", "run_id"],
        "returns": "dict",
        "notes": "参数是 stock_list（列表）不是 stock_code；period 仅支持 1d/1m/5m",
    },
    "download_file": {
        "category": "通用函数",
        "description": "下载特定数据文件（10大股东/ETF申赎/舆情/综合信息）",
        "signature": "download_file(stock_code: str = '', down_time: str = '', down_type: int = 1) -> Dict",
        "fields": ["ErrorId", "Msg", "run_id"],
        "returns": "dict",
        "notes": "down_type: 1十大股东/2ETF申赎清单/3舆情/4股票综合信息；文件存于 .\\PYPlugins\\data；注意 tqcenter 无 download_data API",
    },
}


# ============================================================================
# FN 系列常用字段子集（get_financial_data）
# 完整 FN1-FN584 见 docs/tongdaxin-api-docs/.../获取专业财务数据.md
# ============================================================================
FINANCIAL_FN_FIELDS: list[str] = [
    "FN1", "FN2", "FN3", "FN4", "FN5", "FN6", "FN7",           # 每股指标
    "FN8", "FN11", "FN17", "FN21", "FN27", "FN33", "FN35", "FN40",  # 资产
    "FN41", "FN44", "FN45", "FN54", "FN55", "FN63",            # 负债
    "FN64", "FN68", "FN69", "FN72",                            # 权益
    "FN107", "FN119", "FN128",                                 # 现金流
    "FN159", "FN160", "FN161", "FN183", "FN184", "FN185",      # 财务指标/增长
    "FN193", "FN194", "FN197", "FN199", "FN200",               # 利润率/ROE
    "FN206", "FN207", "FN208", "FN210",                        # 扣非/EBIT/EBITDA/资产负债率
    "FN230", "FN231", "FN232", "FN233", "FN234",               # 营收/利润
    "FN238", "FN239", "FN242", "FN266",                        # 股本/股东/自由流通
    "FN304", "FN308", "FN309", "FN320",                        # 研发费用/近一年归母/扣非/员工
    "FN329", "FN362",                                          # ROIC/财务总评分
]


# ============================================================================
# V8 盘后选股模型快照字段映射（91 列）
# V8 快照 = get_more_info(code, field_list=[]) 全字段 + 3 个脚本元数据列
# 数据源: data/v8-samples/data/全市场L2快照_20260616.csv
# ============================================================================
V8_SNAPSHOT_FIELDS: list[str] = [
    # —— 以下 88 个来自 get_more_info ——
    "MainBusiness", "SafeValue", "ShineValue", "ShapeValue", "TPFlag", "ZTPrice", "DTPrice", "HqDate",
    "fHSL", "fLianB", "Wtb", "Zsz", "Ltsz", "vzangsu", "Fzhsl", "FzAmo",
    "VOpenZAF", "ZAF", "ZAFYesterday", "ZAFPre2D", "ZAFPre5", "ZAFPre10", "ZAFPre20",
    "ZAFPre30", "ZAFPre60", "ZAFYear", "ZAFPreMyMonth", "ZAFPreOneYear",
    "Zjl", "Zjl_HB", "TotalBVol", "TotalSVol", "BCancel", "SCancel", "L2TicNum", "L2OrderNum",
    "FCAmo", "FCb", "OpenZAF", "OpenAmo", "OpenZTBuy", "OpenAmoPre1", "OpenVolPre1",
    "CJJEPre1", "CJJEPre3", "FDEPre1", "FDEPre2", "ZTGPNum", "LastStartZT", "LastZTHzNum",
    "EverZTCount", "ConZAFDateNum", "YearZTDay",
    "MA5Value", "HisHigh", "HisLow", "IPO_Price", "More_YJL", "BetaValue", "DynaPE", "MorePE",
    "StaticPE_TTM", "DYRatio", "PB_MRQ",
    "IsT0Fund", "IsZCZGP", "IsKzz", "Kzz_HSCode", "QHMainYYMM", "FreeLtgb", "Yield",
    "KfEarnMoney", "RDInputFee", "CashZJ", "PreReceiveZJ", "OtherQYJzc", "StaffNum",
    "RecentGGJYDate", "RecentHGDate", "RecentIncentDate", "NoticeDate_Recent",
    "RecentReleaseDate", "RecentDZDate", "ReportDate", "ZTDate_Recent", "DTDate_Recent",
    "TopDate_Recent", "StopJYDate_Recent",
    # —— 以下 3 个为脚本元数据列（非 API 字段）——
    "code", "类型", "查询时间",
]

# V8 快照中来自 get_more_info 的字段（去掉 3 个元数据列）
V8_MORE_INFO_FIELDS: list[str] = [f for f in V8_SNAPSHOT_FIELDS if f not in ("code", "类型", "查询时间")]

# V8 快照中说明书未明确记录的字段（OpenZAF 在 get_more_info 文档字段表里没有，
# 但 V8 CSV 有；可能是 API 实际返回但未写入文档的字段，或脚本派生）
V8_UNDOCUMENTED_FIELDS: list[str] = ["OpenZAF"]


# ============================================================================
# 辅助函数
# ============================================================================

def get_api_fields(api_name: str) -> list[str] | None:
    """查询某 API 返回/可筛选的字段清单。

    Args:
        api_name: tqcenter API 名，如 ``"get_more_info"``。

    Returns:
        字段名列表；FN 系列返回 ``FINANCIAL_FN_FIELDS`` 常用子集；未知 API 返回 ``None``。
    """
    info = API_REGISTRY.get(api_name)
    if info is None:
        return None
    fields = info.get("fields")
    if fields == "_FN_SERIES":
        return FINANCIAL_FN_FIELDS
    return list(fields) if isinstance(fields, list) else []


def get_api_info(api_name: str) -> dict[str, Any] | None:
    """查询 API 完整元信息（category/description/signature/fields/returns/notes）。"""
    return API_REGISTRY.get(api_name)


def find_field(field_name: str) -> list[dict[str, str]]:
    """反查某字段出现在哪些 API 中。

    Args:
        field_name: 字段名，如 ``"ZAF"`` / ``"FN193"`` / ``"GP01"``。

    Returns:
        ``[{api, category, description}]`` 列表（FN/GP/GO 前缀字段会匹配对应系列 API）。
    """
    fn = field_name.strip()
    results: list[dict[str, str]] = []
    for api_name, info in API_REGISTRY.items():
        fields = info.get("fields")
        if fields == "_FN_SERIES":
            if fn.upper().startswith("FN"):
                results.append({"api": api_name, "category": info["category"], "description": info["description"]})
            continue
        if isinstance(fields, list):
            check = [f.split(":")[0] if isinstance(f, str) and ":" in f else f for f in fields]
            if fn in check:
                results.append({"api": api_name, "category": info["category"], "description": info["description"]})
    return results


def validate_field_list(api_name: str, field_list: list[str]) -> tuple[bool, list[str]]:
    """校验 field_list 是否全部属于该 API 的合法字段。

    Args:
        api_name: API 名。
        field_list: 待校验字段列表。

    Returns:
        ``(ok, unknown)``：ok=True 全部合法；unknown 为不认识的字段名列表。
        FN/GP/GO 系列只校验前缀，不逐个核对编号。
    """
    if not field_list:
        return True, []
    valid = get_api_fields(api_name)
    if valid is None:
        return True, []  # 未知 API 不校验
    info = API_REGISTRY[api_name]
    fields_meta = info.get("fields")
    # FN/GP/GO 系列：只校验前缀
    if fields_meta == "_FN_SERIES":
        unknown = [f for f in field_list if not f.upper().startswith("FN")]
        return (len(unknown) == 0), unknown
    if api_name == "get_gp_one_data":
        unknown = [f for f in field_list if not f.upper().startswith("GO")]
        return (len(unknown) == 0), unknown
    if api_name == "get_gpjy_value":
        unknown = [f for f in field_list if not f.upper().startswith("GP")]
        return (len(unknown) == 0), unknown
    # 普通字段：精确匹配
    valid_set = set(valid)
    unknown = [f for f in field_list if f not in valid_set]
    return (len(unknown) == 0), unknown


def v8_field_list() -> list[str]:
    """返回 V8 快照所需的 get_more_info 字段清单（用于 ``field_list=[]`` 时全量拉取）。

    说明书注明 ``get_more_info`` 传空 field_list 返回全部字段，因此 V8 快照
    构建器直接调 ``get_more_info(code, field_list=[])`` 即可；本函数返回的是
    V8 CSV 列顺序，用于结果 DataFrame 列对齐。
    """
    return list(V8_MORE_INFO_FIELDS)


def list_apis(category: str | None = None) -> list[str]:
    """列出全部 API 名，或按类别筛选。

    Args:
        category: 类别名（行情类/财务类/分类板块/客户端操作/ETF/可转债/通用函数）。

    Returns:
        API 名列表。
    """
    if category is None:
        return list(API_REGISTRY.keys())
    return [name for name, info in API_REGISTRY.items() if info["category"] == category]


__all__ = [
    "API_REGISTRY",
    "FINANCIAL_FN_FIELDS",
    "V8_SNAPSHOT_FIELDS",
    "V8_MORE_INFO_FIELDS",
    "V8_UNDOCUMENTED_FIELDS",
    "get_api_fields",
    "get_api_info",
    "find_field",
    "validate_field_list",
    "v8_field_list",
    "list_apis",
]
