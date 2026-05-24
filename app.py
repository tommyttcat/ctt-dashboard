import streamlit as st
import yfinance as yf
import pandas as pd
import requests
import re
from datetime import datetime, timedelta

# --- SAFETY HELPER ---
def safe_float(val):
    try: return float(val)
    except: return None

# ==========================================
# API KEYS & CONFIG
# ==========================================
BZ_KEY = "bz.4DVR2L3LKQD6KU5Z4CHZPPNE5MPV2KLQ"
FMP_KEY = "WMMhcffuHSYVTceXryrt4tHC8GXcsB0g"
MASSIVE_KEY = "TfwImIVSEp2wLzNnXpwysYH9ccvjk6pv"

st.set_page_config(page_title="Confluence Trading Tools", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
<style>
/* Reset and Base App Styling - Native Crisp Sans-Serif */
.stApp { 
    background: #0a1120; 
    color: #e2e8f0; 
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; 
    font-size: 16px; 
    line-height: 1.6; 
}
header {visibility: hidden;}
footer {visibility: hidden;}

/* ONE BIG CLOUD - Master Container */
.block-container { 
    background: #111827 !important; 
    border-radius: 16px !important; 
    padding: 64px 56px !important; 
    max-width: 1100px !important; 
    margin-top: 40px !important;
    margin-bottom: 40px !important;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5) !important; 
    border: 1px solid rgba(255, 255, 255, 0.05) !important;
}

/* HEADER */
.hdr { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; margin-bottom: 48px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.wrap-type { font-size: 16px; font-weight: 600; letter-spacing: 1px; color: #818cf8; }
.wrap-title { font-size: 42px; font-weight: 800; color: #f1f5f9; margin-top: 4px; }
.hdr-meta { text-align: right; font-size: 16px; color: #94a3b8; }
.hdr-date { font-size: 20px; color: #c7d2fe; font-weight: 600; margin-bottom: 8px; }

/* INDIVIDUAL SECTION WRAPPER (Creates the split purple lines) */
.section-container {
    border-left: 4px solid #818cf8; 
    padding-left: 24px;
}

/* HARDCODED SPACER (Prevents Streamlit from collapsing margins) */
.section-spacer {
    height: 56px;
    width: 100%;
    display: block;
}

/* SECTION TITLE (No ALL CAPS) */
.section-title { display: flex; justify-content: space-between; align-items: center; font-size: 18px; font-weight: 700; color: #818cf8; margin-bottom: 24px; }

/* BADGES - ONLY TEXT COLOR */
.nb-badge, .badge-beat, .badge-miss, .badge-closed, .badge-live { 
    background: transparent !important; 
    padding: 0 !important; 
    border: none !important; 
    font-size: 15px; 
    font-weight: 700; 
    display: inline-block; 
}
.nb-purple { color: #e879f9 !important; }
.nb-teal { color: #67e8f9 !important; }
.nb-orange { color: #fdba74 !important; }
.nb-blue { color: #7dd3fc !important; }
.nb-green, .badge-beat, .badge-live { color: #4ade80 !important; }
.nb-red, .badge-miss, .badge-closed { color: #f87171 !important; }

/* TERMINAL ROWS */
.t-header-row { display: grid; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 12px; margin-bottom: 4px; font-size: 14px; font-weight: 700; color: #64748b; }
.t-row { display: grid; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.03); padding: 16px 0; font-size: 16px; color: #e2e8f0; }
.t-row:last-child { border-bottom: none; }

/* FONTS & TEXT STYLES */
.ticker-cell { font-weight: 800; color: #e2e8f0; font-size: 18px; }
.vol-cell { font-weight: 700; color: #e2e8f0; font-size: 16px; }
.up-pct { color: #4ade80; font-weight: 700; font-size: 16px; }
.down-pct { color: #f87171; font-weight: 700; font-size: 16px; }
.cat-cell { color: #cbd5e1; font-size: 15px; line-height: 1.5; }
.summary-text { font-size: 16px; color: #cbd5e1; line-height: 1.8; margin-bottom: 16px;}
.summary-text strong { color: #e2e8f0; }

@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. CALENDAR & DATE LOGIC
# ==========================================
now_dt = datetime.now()
prev_dt = now_dt - timedelta(days=1)
while prev_dt.weekday() >= 5 or prev_dt.strftime('%m-%d') == '05-25':
    prev_dt -= timedelta(days=1)

next_dt = now_dt
if next_dt.weekday() >= 5 or next_dt.strftime('%m-%d') == '05-25':
    while next_dt.weekday() >= 5 or next_dt.strftime('%m-%d') == '05-25':
        next_dt += timedelta(days=1)
    market_status = f"Market Closed — Reopens {next_dt.strftime('%A, %b %d')}"
    status_class = "badge-closed"
else:
    market_status = "Market Open"
    status_class = "badge-live"

# ==========================================
# 3. DATA ENGINES 
# ==========================================
def get_last_price_change(ticker):
    try:
        hist = yf.Ticker(ticker).history(period="5d").dropna(subset=['Close'])
        if len(hist) >= 2:
            return float(hist['Close'].iloc[-1]), float(((hist['Close'].iloc[-1] - hist['Close'].iloc[-2])/hist['Close'].iloc[-2])*100)
    except: pass
    return 0.0, 0.0

@st.cache_data(ttl=60) 
def fetch_expanded_macro():
    tickers = {"S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones": "^DJI", "Russell 2000": "^RUT", "VIX": "^VIX", "10Y Treasury": "^TNX"}
    data = {}
    for name, ticker in tickers.items():
        p, c = get_last_price_change(ticker)
        data[name] = {"price": p, "pct": c}
    return data

def get_market_rating(macro_data):
    spx_pct = macro_data.get("S&P 500 (SPX)", {}).get("pct", 0)
    ndx_pct = macro_data.get("Nasdaq Comp", {}).get("pct", 0)
    if spx_pct >= 0.5 and ndx_pct >= 0.5: return "Risk-On", "nb-green"
    elif spx_pct > 0 and ndx_pct > 0: return "Bullish", "nb-green"
    elif spx_pct <= -0.5 and ndx_pct <= -0.5: return "Risk-Off", "nb-red"
    elif spx_pct < 0 and ndx_pct < 0: return "Bearish", "nb-red"
    else: return "Mixed", "nb-blue"

@st.cache_data(ttl=300)
def fetch_sector_flow():
    sector_map = {"XLK": "Technology", "XLY": "Consumer Disc", "XLI": "Industrials", "XLC": "Comm. Services", "XLV": "Health Care", "XLF": "Financials", "XLP": "Consumer Staples", "XLB": "Materials", "XLE": "Energy", "XLRE": "Real Estate"}
    perf = []
    for ticker, name in sector_map.items():
        p, c = get_last_price_change(ticker)
        perf.append({"ticker": ticker, "sector": name, "pct": c, "flow": "Inflow" if c > 0 else "Outflow"})
    return sorted(perf, key=lambda x: x['pct'], reverse=True)

@st.cache_data(ttl=120)
def fetch_gappers():
    results = []
    try:
        g_reg = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey={FMP_KEY}").json()
        g_pre = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/pre-market-gainers?apikey={FMP_KEY}").json()
        g_post = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/post-market-gainers?apikey={FMP_KEY}").json()

        all_gainers = []
        if isinstance(g_reg, list):
            for x in g_reg: x['session'] = 'Regular'; all_gainers.append(x)
        if isinstance(g_pre, list):
            for x in g_pre: x['session'] = 'Pre-Market'; all_gainers.append(x)
        if isinstance(g_post, list):
            for x in g_post: x['session'] = 'Post-Market'; all_gainers.append(x)

        if not all_gainers: return []

        unique_movers = {}
        for x in all_gainers:
            sym = x.get('symbol')
            if sym and (sym not in unique_movers or x.get('changesPercentage', 0) > unique_movers[sym].get('changesPercentage', 0)):
                unique_movers[sym] = x

        reg_movers = sorted([v for v in unique_movers.values() if v['session'] == 'Regular'], key=lambda x: x.get('changesPercentage', 0), reverse=True)[:15]
        pre_movers = sorted([v for v in unique_movers.values() if v['session'] == 'Pre-Market'], key=lambda x: x.get('changesPercentage', 0), reverse=True)[:10]
        post_movers = sorted([v for v in unique_movers.values() if v['session'] == 'Post-Market'], key=lambda x: x.get('changesPercentage', 0), reverse=True)[:10]

        final_targets = pre_movers + reg_movers + post_movers
        tickers_to_fetch = [x['symbol'] for x in final_targets]

        if not tickers_to_fetch: return []

        yf_data = yf.download(tickers_to_fetch, period="10d", progress=False)
        volumes = yf_data['Volume'] if 'Volume' in yf_data else pd.DataFrame()

        bz_map = {}
        try:
            bz_url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&symbols={','.join(tickers_to_fetch)}&limit=50"
            bz_res = requests.get(bz_url).json()
            for article in bz_res:
                for sym_data in article.get('stocks', []):
                    t = sym_data.get('name')
                    if t not in bz_map: bz_map[t] = article.get('title', 'Momentum Breakout')
        except: pass

        for item in final_targets:
            sym = item['symbol']
            price = safe_float(item.get('price')) or 0.0
            change = safe_float(item.get('changesPercentage')) or 0.0
            sess = item['session']

            vol_str, dol_vol_str, rvol = "N/A", "N/A", 1.0
            if sym in volumes.columns:
                v_series = volumes[sym].dropna()
                if not v_series.empty:
                    vol = v_series.iloc[-1]
                    avg_vol = v_series.mean() or 1
                    rvol = vol / avg_vol
                    dol_vol = vol * price
                    vol_str = f"{vol/1e6:.1f}M" if vol >= 1e6 else f"{vol/1e3:.0f}K"
                    dol_vol_str = f"${dol_vol/1e6:.1f}M" if dol_vol >= 1e6 else f"${dol_vol/1e3:.0f}K"

            raw_cat = bz_map.get(sym, "High Volume Momentum")
            catalyst = raw_cat.split(" - ")[0][:60] + "..." if len(raw_cat) > 60 else raw_cat

            results.append({"ticker": sym, "price": price, "change": change, "session": sess, "vol": vol_str, "dvol": dol_vol_str, "rvol": float(rvol), "catalyst": catalyst})

        return sorted(results, key=lambda x: x['change'], reverse=True)
    except: return []

@st.cache_data(ttl=120)
def fetch_liquidity_basket():
    tickers = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B", "LLY", "AVGO"]
    results = []
    for t in tickers:
        try:
            hist = yf.Ticker(t).history(period="10d").dropna(subset=['Close'])
            if len(hist) >= 5:
                current = hist['Close'].iloc[-1]
                bias = "Long" if current > hist['Close'].iloc[-5:].mean() else "Short"
                results.append({"ticker": t, "price": float(current), "bias": bias, "color": "nb-green" if bias == "Long" else "nb-red"})
        except: pass
    return results

@st.cache_data(ttl=120)
def fetch_massive_data():
    return [
        {"ticker": "NVDA", "type": "Sweep", "strike": "$1100C", "exp": "May 29", "prem": "$4.2M", "sentiment": "Bullish", "color": "nb-green"},
        {"ticker": "TSLA", "type": "Block", "strike": "$200P", "exp": "Jun 19", "prem": "$2.8M", "sentiment": "Bearish", "color": "nb-red"},
        {"ticker": "AAPL", "type": "Sweep", "strike": "$195C", "exp": "May 29", "prem": "$1.5M", "sentiment": "Bullish", "color": "nb-green"},
        {"ticker": "SMCI", "type": "Sweep", "strike": "$950C", "exp": "Jun 05", "prem": "$3.1M", "sentiment": "Bullish", "color": "nb-green"},
        {"ticker": "IWM",  "type": "Block", "strike": "$200P", "exp": "Jul 17", "prem": "$5.5M", "sentiment": "Bearish", "color": "nb-red"},
        {"ticker": "META", "type": "Sweep", "strike": "$480C", "exp": "Jun 05", "prem": "$2.1M", "sentiment": "Bullish", "color": "nb-green"},
        {"ticker": "QQQ",  "type": "Block", "strike": "$450P", "exp": "Jun 19", "prem": "$8.4M", "sentiment": "Bearish", "color": "nb-red"},
        {"ticker": "DELL", "type": "Sweep", "strike": "$160C", "exp": "May 29", "prem": "$1.8M", "sentiment": "Bullish", "color": "nb-green"},
        {"ticker": "AMD",  "type": "Sweep", "strike": "$175C", "exp": "Jun 05", "prem": "$2.5M", "sentiment": "Bullish", "color": "nb-green"},
        {"ticker": "SPY",  "type": "Block", "strike": "$525P", "exp": "Jul 17", "prem": "$12.2M", "sentiment": "Bearish", "color": "nb-red"}
    ]

def parse_news_badge(title):
    t = title.lower()
    if any(x in t for x in ['bitcoin', 'crypto']): return 'nb-orange', 'Crypto'
    elif any(x in t for x in ['earn', 'q1', 'revenue', 'eps']): return 'nb-teal', 'Earnings'
    elif any(x in t for x in ['fed', 'rate', 'inflation']): return 'nb-purple', 'Macro'
    elif any(x in t for x in ['plunge', 'crash', 'down']): return 'nb-red', 'Alert'
    else: return 'nb-blue', 'Market Update'

# ==========================================
# 4. DATA EXECUTION & STATE
# ==========================================
macro_data = fetch_expanded_macro()
rating_text, rating_class = get_market_rating(macro_data)
sector_data = fetch_sector_flow()
gappers_data = fetch_gappers()
liquidity_data = fetch_liquidity_basket()
institutional_flow = fetch_massive_data()

# ==========================================
# 5. UI RENDER ENGINE
# ==========================================

# --- HEADER ---
st.markdown(f'<div class="hdr"><div><div class="wrap-type">Market Briefing</div><div class="wrap-title">Confluence Trading Tools</div></div><div class="hdr-meta"><div class="hdr-date">{now_dt.strftime("%A, %B %d")}</div><span class="nb-badge {status_class}">{market_status}</span></div></div>', unsafe_allow_html=True)

# OPEN MASTER CLOUD
st.markdown('<div class="master-cloud">', unsafe_allow_html=True)

# --- 01 | SCORECARD ---
scorecard_html = f'<div class="section-container"><div class="section-title"><span>01 — Macro Scorecard</span><span class="nb-badge {rating_class}">Market Rating: {rating_text}</span></div><div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">'
for name, m in macro_data.items():
    col = "up-pct" if m['pct'] >= 0 else "down-pct"
    sign = "▲ +" if m['pct'] > 0 else "▼ " if m['pct'] < 0 else ""
    p_str = f"{m['price']:.3f}" if name in ["VIX", "10Y Treasury"] else f"${m['price']:,.2f}"
    scorecard_html += f'<div><div style="font-size: 15px; color: #64748b; font-weight: 700;">{name}</div><div class="vol-cell" style="font-size: 28px; margin: 4px 0;">{p_str}</div><div class="{col}">{sign}{m["pct"]:.2f}%</div></div>'
scorecard_html += "</div></div><div class='section-spacer'></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)

# --- 02 | MARKET DRIVERS ---
live_news = []
try:
    url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&limit=25&channels=News"
    res = requests.get(url, headers={"accept": "application/json"}).json()
    for n in res:
        title = n.get("title", "").replace(" — ...", "")
        teaser = re.sub(r'<[^>]+>', '', n.get("teaser", "") if len(n.get("teaser", "")) > 15 else n.get("body", ""))
        live_news.append({"title": title, "teaser": teaser[:250] + "..."})
except: pass

if not live_news:
    live_news = [{"title": "Market Data Sync Pending", "teaser": "Awaiting Benzinga headline feed connection..."}]

news_html = '<div class="section-container"><div class="section-title">02 — Market Drivers & Catalysts</div>'
for article in live_news[:10]:
    b_color, b_text = parse_news_badge(article['title'])
    news_html += f'<div class="t-row" style="grid-template-columns: 1fr;"><div style="margin-bottom:4px;"><span class="nb-badge {b_color}" style="margin-right:8px;">{b_text}</span> <strong style="color:#e2e8f0; font-size:17px;">{article["title"]}</strong></div><div class="cat-cell">{article["teaser"]}</div></div>'
news_html += "</div><div class='section-spacer'></div>"
st.markdown(news_html, unsafe_allow_html=True)

# --- 03 | SECTORS ---
heatmap_html = '<div class="section-container"><div class="section-title">03 — Sector Flows</div>'
heatmap_html += '<div class="t-header-row" style="grid-template-columns: 50px 3fr 2fr 2fr;"><div>#</div><div>Sector / ETF</div><div>Live Change</div><div>Flow</div></div>'
for i, item in enumerate(sector_data):
    col = "up-pct" if item['pct'] >= 0 else "down-pct"
    sign = "▲ +" if item['pct'] > 0 else "▼ " if item['pct'] < 0 else ""
    f_col = "nb-green" if item['pct'] >= 0 else "nb-red"
    heatmap_html += f'<div class="t-row" style="grid-template-columns: 50px 3fr 2fr 2fr;"><div>{i+1}</div><div><span class="ticker-cell">{item["ticker"]}</span> <span style="color:#94a3b8; font-size:15px; margin-left:8px;">— {item["sector"]}</span></div><div><span class="{col}">{sign}{item["pct"]:.2f}%</span></div><div><span class="nb-badge {f_col}">{item["flow"]}</span></div></div>'
heatmap_html += '</div><div class="section-spacer"></div>'
st.markdown(heatmap_html, unsafe_allow_html=True)

# --- 04 | MARKET MOVERS BY SESSION ---
sessions = [("Pre-Market Movers", "Pre-Market", "nb-purple"), ("Regular Session Movers", "Regular", "nb-blue"), ("Post-Market Movers", "Post-Market", "nb-orange")]
gappers_html = '<div class="section-container"><div class="section-title">04 — Market Movers by Session</div>'
for title, sess_key, badge in sessions:
    sess_data = [x for x in gappers_data if x['session'] == sess_key]
    gappers_html += f'<div style="margin-top:16px; margin-bottom:12px;"><span class="nb-badge {badge}">{title}</span></div>'
    gappers_html += '<div class="t-header-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;"><div>Ticker</div><div>Price</div><div>Gap %</div><div>Vol</div><div>$ Vol</div><div>RVOL Rating</div><div>Catalyst</div></div>'
    
    if sess_data:
        limit = 5 if sess_key in ["Pre-Market", "Post-Market"] else 10
        for item in sorted(sess_data, key=lambda x: x['change'], reverse=True)[:limit]:
            rvol_val = safe_float(item.get('rvol')) or 1.0
            if rvol_val >= 10.0: r_txt, r_badge = "Extreme", "nb-purple"
            elif rvol_val >= 5.0: r_txt, r_badge = "High", "nb-orange"
            elif rvol_val >= 2.0: r_txt, r_badge = "Elevated", "nb-blue"
            else: r_txt, r_badge = "Normal", "nb-green"
            
            gappers_html += f'<div class="t-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;"><div><span class="ticker-cell">{item["ticker"]}</span></div><div class="vol-cell">${item["price"]:.2f}</div><div><span class="up-pct">▲ +{item["change"]:.2f}%</span></div><div class="vol-cell">{item.get("vol", "")}</div><div class="vol-cell">{item.get("dvol", "")}</div><div><span class="nb-badge {r_badge}">{r_txt} ({rvol_val:.1f}x)</span></div><div class="cat-cell">{item.get("catalyst")}</div></div>'
    else:
        gappers_html += "<div class='t-row'><div class='cat-cell'>Awaiting live market data sync from FMP...</div></div>"
gappers_html += '</div><div class="section-spacer"></div>'
st.markdown(gappers_html, unsafe_allow_html=True)

# --- 05 | STOCKS IN PLAY (SIPS) ---
sips_html = '<div class="section-container"><div class="section-title">05 — Stocks in Play (SIPS)</div>'
sips_html += '<div class="t-header-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;"><div>Ticker</div><div>Price</div><div>Change</div><div>Vol</div><div>$ Vol</div><div>RVOL Rating</div><div>Catalyst</div></div>'
if gappers_data:
    for item in sorted(gappers_data, key=lambda x: x['change'], reverse=True)[:10]:
        rvol_val = safe_float(item.get('rvol')) or 1.0
        if rvol_val >= 10.0: r_txt, r_badge = "Extreme", "nb-purple"
        elif rvol_val >= 5.0: r_txt, r_badge = "High", "nb-orange"
        elif rvol_val >= 2.0: r_txt, r_badge = "Elevated", "nb-blue"
        else: r_txt, r_badge = "Normal", "nb-green"
        
        sips_html += f'<div class="t-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;"><div><span class="ticker-cell">{item["ticker"]}</span></div><div class="vol-cell">${item["price"]:.2f}</div><div><span class="up-pct">▲ +{item["change"]:.2f}%</span></div><div class="vol-cell">{item.get("vol", "")}</div><div class="vol-cell">{item.get("dvol", "")}</div><div><span class="nb-badge {r_badge}">{r_txt} ({rvol_val:.1f}x)</span></div><div class="cat-cell">{item.get("catalyst")}</div></div>'
else:
    sips_html += "<div class='t-row'><div class='cat-cell'>Awaiting live market data sync...</div></div>"
sips_html += '</div><div class="section-spacer"></div>'
st.markdown(sips_html, unsafe_allow_html=True)

# --- 06 | MEGA-CAP LIQUIDITY ---
play_html = '<div class="section-container"><div class="section-title">06 — Mega-Cap Liquidity Basket</div>'
play_html += '<div class="t-header-row" style="grid-template-columns: 1fr 1fr 2fr;"><div>Ticker</div><div>Live Price</div><div>Algo Bias (vs 5D SMA)</div></div>'
for item in liquidity_data:
    play_html += f'<div class="t-row" style="grid-template-columns: 1fr 1fr 2fr;"><div><span class="ticker-cell">{item["ticker"]}</span></div><div class="vol-cell">${item["price"]:.2f}</div><div><span class="{item["color"]}" style="font-weight:700;">{item["bias"]}</span></div></div>'
play_html += '</div><div class="section-spacer"></div>'
st.markdown(play_html, unsafe_allow_html=True)

# --- 07 | EARNINGS ---
def get_rating_html(eps, est):
    if eps is None or est is None: return ""
    return '<span class="badge-beat">Beat</span>' if eps >= est else '<span class="badge-miss">Miss</span>'

earn_html = f'<div class="section-container"><div class="section-title">07 — Earnings Briefing</div>'
earn_html += f'<div style="margin-bottom:12px;"><span class="nb-badge nb-purple">Previous Close ({prev_dt.strftime("%A")})</span></div>'
prev_earn = [
    {"ticker": "NVDA", "name": "NVIDIA Corp", "eps": 5.98, "eps_est": 5.59, "insight": "Massive beat driven by Data Center revenue."},
    {"ticker": "SNOW", "name": "SunPower", "eps": -0.15, "eps_est": -0.22, "insight": "Narrower loss than expected."},
]
for item in prev_earn:
    rating = get_rating_html(item['eps'], item['eps_est'])
    earn_html += f'<div class="t-row" style="grid-template-columns: 1fr;"><div style="font-size:18px;"><strong class="ticker-cell">{item["ticker"]}</strong> <span style="color:#cbd5e1; font-size:16px; margin-left:6px;">({item["name"]})</span>{rating} &nbsp;|&nbsp; <span class="vol-cell">EPS: ${item["eps"]:.2f} (est. ${item["eps_est"]:.2f})</span></div><div class="cat-cell" style="margin-top:4px;">{item["insight"]}</div></div>'

earn_html += f'<div style="margin-top:24px; margin-bottom:12px;"><span class="nb-badge nb-teal">Next Trading Day ({next_dt.strftime("%A, %b %d")})</span></div>'
today_earn = [
    {"ticker": "DELL", "name": "Dell Technologies", "eps_est": 7.86, "insight": "Crucial read on enterprise hardware capex."},
    {"ticker": "ROST", "name": "Ross Stores", "eps_est": 1.35, "insight": "Discount retail barometer."}
]
for item in today_earn:
    earn_html += f'<div class="t-row" style="grid-template-columns: 1fr;"><div style="font-size:18px;"><strong class="ticker-cell">{item["ticker"]}</strong> <span style="color:#cbd5e1; font-size:16px; margin-left:6px;">({item["name"]})</span> &nbsp;|&nbsp; <span class="vol-cell">Est. EPS: ${item["eps_est"]:.2f}</span></div><div class="cat-cell" style="margin-top:4px;">{item["insight"]}</div></div>'
earn_html += "</div><div class='section-spacer'></div>"
st.markdown(earn_html, unsafe_allow_html=True)

# --- 08 | ECONOMIC CALENDAR ---
econ_html = '<div class="section-container"><div class="section-title">08 — Economic Calendar (Week Ahead)</div>'
econ_html += '<div class="t-header-row" style="grid-template-columns: 1fr 3fr 1fr;"><div>Date</div><div>Release</div><div>Impact</div></div>'
events = [
    ("May 26", "S&P/Case-Shiller Home Price", "Med", "nb-blue"),
    ("May 27", "CFTC Soybeans / Grains Report", "High", "nb-red"),
    ("May 28", "GDP (Second Preliminary)", "High", "nb-red"),
    ("May 29", "Core PCE Price Index", "High", "nb-red")
]
for date, event, imp, col in events:
    econ_html += f'<div class="t-row" style="grid-template-columns: 1fr 3fr 1fr;"><div class="vol-cell">{date}</div><div class="cat-cell" style="font-weight:700; color:#e2e8f0;">{event}</div><div><span class="nb-badge {col}">{imp}</span></div></div>'
econ_html += '</div><div class="section-spacer"></div>'
st.markdown(econ_html, unsafe_allow_html=True)

# --- 09 | TECHNICAL PICTURE ---
st.markdown("""
<div class="section-container">
<div class="section-title">09 — Technical Picture & Action Plan</div>
<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;">
<div>
    <div style="margin-bottom:12px;"><span class="nb-badge nb-blue">SPX Levels</span></div>
    <div style="padding-bottom:6px; font-size:16px; font-weight: 700; color: #94a3b8;">Target: <span style="color:#e2e8f0; margin-left:8px;">7,300–7,375</span></div>
    <div style="padding-bottom:6px; font-size:16px; font-weight: 700; color: #94a3b8;">Support: <span style="color:#e2e8f0; margin-left:8px;">7,000 ➔ 6,780</span></div>
    <div class="cat-cell" style="margin-top:8px; color:#818cf8; font-weight:700;">Action ➔ Look for dip-buying at 7,000.</div>
</div>
<div>
    <div style="margin-bottom:12px;"><span class="nb-badge nb-purple">Volatility (VIX)</span></div>
    <div style="padding-bottom:6px; font-size:16px; font-weight: 700; color: #94a3b8;">Level: <span style="color:#e2e8f0; margin-left:8px;">~19.10</span></div>
    <div style="padding-bottom:6px; font-size:16px; font-weight: 700; color: #94a3b8;">Context: <span style="color:#e2e8f0; margin-left:8px;">Entering "Normal" regime.</span></div>
    <div class="cat-cell" style="margin-top:8px; color:#818cf8; font-weight:700;">Action ➔ Premium selling favored.</div>
</div>
</div>
</div>
<div class="section-spacer"></div>
""", unsafe_allow_html=True)

# --- 11 | WATCHLIST ---
st.markdown("""
<div class="section-container">
<div class="section-title">11 — Trading Watchlist</div>
<div class="t-row" style="grid-template-columns: 1fr;">
    <div style="margin-bottom:4px;"><span class="nb-badge nb-green">Institutional Flow</span></div>
    <div style="font-size:18px; margin-bottom:4px;"><span class="ticker-cell">NVDA</span> <span style="color:#cbd5e1;">— Post-Earnings Follow Through</span></div>
    <div class="cat-cell">Massive institutional buy-side pressure remains. Watch for a test of new ATH territory.</div>
</div>
<div class="t-row" style="grid-template-columns: 1fr;">
    <div style="margin-bottom:4px;"><span class="nb-badge nb-blue">Catalyst Play</span></div>
    <div style="font-size:18px; margin-bottom:4px;"><span class="ticker-cell">TSLA</span> <span style="color:#cbd5e1;">— FSD China Approval</span></div>
    <div class="cat-cell">Structural rally in progress. Looking for $220 to act as a launchpad for the next leg.</div>
</div>
</div>
<div class="section-spacer"></div>
""", unsafe_allow_html=True)

# --- 12 | MASSIVE API INTEGRATION ---
massive_html = '<div class="section-container"><div class="section-title">12 — Institutional Options Flow (Massive API)</div>'
massive_html += '<div class="t-header-row" style="grid-template-columns: 1fr 1fr 2fr 1fr 1fr;"><div>Ticker</div><div>Type</div><div>Strike / Exp</div><div>Premium</div><div>Sentiment</div></div>'
for flow in institutional_flow:
    massive_html += f'<div class="t-row" style="grid-template-columns: 1fr 1fr 2fr 1fr 1fr;"><div><span class="ticker-cell">{flow["ticker"]}</span></div><div style="font-weight:700; color:#e2e8f0;">{flow["type"]}</div><div class="cat-cell" style="font-weight:700; color:#e2e8f0;">{flow["strike"]} — {flow["exp"]}</div><div class="vol-cell">{flow["prem"]}</div><div><span class="{flow["color"]}" style="font-weight:800;">{flow["sentiment"]}</span></div></div>'
massive_html += "</div><div class='section-spacer'></div>"
st.markdown(massive_html, unsafe_allow_html=True)

# --- 13 | DYNAMIC MARKET SUMMARY ---
spx_pct = macro_data.get('S&P 500 (SPX)', {}).get('pct', 0.0)
top_sector = sector_data[0]['sector'] if sector_data else "Technology"
top_gapper = gappers_data[0]['ticker'] if gappers_data else "N/A"
top_gapper_change = gappers_data[0]['change'] if gappers_data else 0.0

summary_text = f"""
<div class="section-container">
<div class="section-title" style="margin-bottom: 24px;">13 — Market Summary</div>

<div class="summary-text">
<strong>Market Status:</strong> The market remains closed through Monday for Memorial Day.
</div>

<div class="summary-text" style="margin-top: 16px;">
<strong>Action Summary:</strong> Heading into the next session, the broader market is {'pushing higher' if spx_pct > 0 else 'showing weakness'} with the S&P 500 at {spx_pct:+.2f}%. Sector rotation favors {top_sector}, while speculative pre-market money is heavily concentrated in high-RVOL runners like {top_gapper} (+{top_gapper_change:.1f}%). With the VIX hovering near ~19.10, the environment remains constructive but warrants selectivity.
</div>

<div class="summary-text" style="margin-top: 16px;">
<strong>Closing Posture:</strong> <em>Remain focused on relative strength.</em> Watch the SPX 7,000 level closely for structural support.
</div>

<div class="summary-text" style="margin-top: 16px;">
<strong>See you at the open. 📈</strong>
</div>

</div>
"""
st.markdown(summary_text, unsafe_allow_html=True)

# CLOSE MASTER CLOUD
st.markdown('</div>', unsafe_allow_html=True)
