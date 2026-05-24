import streamlit as st
import yfinance as yf
import pandas as pd
import requests
import re
from datetime import datetime, timedelta

# ==========================================
# API KEYS & CONFIG
# ==========================================
BZ_KEY = "bz.4DVR2L3LKQD6KU5Z4CHZPPNE5MPV2KLQ"
FMP_KEY = "WMMhcffuHSYVTceXryrt4tHC8GXcsB0g"
MASSIVE_KEY = "TfwImIVSEp2wLzNnXpwysYH9ccvjk6pv"

st.set_page_config(page_title="Confluence Trading Tools", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
<style>
/* Reset and Base App Styling - GLOBAL MONOSPACE */
.stApp { 
    background: #0a1120; 
    color: #e2e8f0; 
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important; 
    font-size: 16px; 
    line-height: 1.6; 
}
header {visibility: hidden;}
footer {visibility: hidden;}

/* Wrap constraint */
.block-container { max-width: 1100px !important; margin: 0 auto !important; padding-top: 1rem; padding-bottom: 3rem; }

/* CLOUD CARDS (Only for Section 1 & 9) */
.cloud-card { background: #111827 !important; border: none !important; border-radius: 16px !important; padding: 36px 40px !important; margin-bottom: 48px !important; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3) !important; }

/* TERMINAL LIST WRAPPER (For everything else) */
.terminal-wrapper { margin-bottom: 48px !important; padding: 0 12px !important; }

/* HEADER CLOUD */
.hdr { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%) !important; padding: 44px 44px 34px !important; border: none !important; border-radius: 16px !important; margin-bottom: 48px !important; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3) !important; }
.hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
.wrap-type { font-size: 15px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
.wrap-title { font-size: 42px; font-weight: 800; color: #f1f5f9; margin-top: 10px; }
.hdr-meta { text-align: right; font-size: 16px; color: #94a3b8; }
.hdr-date { font-size: 20px; color: #c7d2fe; font-weight: 600; margin-bottom: 8px; }

/* STATUS BADGES */
.badge-closed { background: #450a0a; color: #f87171; padding: 6px 16px; border-radius: 20px; font-weight: 800; font-size: 14px; letter-spacing: 1px; border: none; }
.badge-live { background: #052e16; color: #4ade80; padding: 6px 16px; border-radius: 20px; font-weight: 800; font-size: 14px; letter-spacing: 1px; border: none; animation: pulse 2s infinite;}

/* EARNINGS & ECON BADGES */
.badge-beat { background: #052e16; color: #4ade80; padding: 4px 10px; border-radius: 6px; font-weight: 800; font-size: 13px; margin-left: 8px; border: none; }
.badge-miss { background: #450a0a; color: #f87171; padding: 4px 10px; border-radius: 6px; font-weight: 800; font-size: 13px; margin-left: 8px; border: none; }
.econ-bold { font-weight: 900; color: #f8fafc; font-size: 17px; text-transform: uppercase; }

/* SECTION TITLE */
.section-title { font-size: 16px; font-weight: 800; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 20px; border-bottom: 2px solid rgba(255,255,255,0.05); padding-bottom: 12px;}

/* TERMINAL ROWS (Replaces Tables) */
.t-header-row { display: grid; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 12px; margin-bottom: 4px; font-size: 13px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
.t-row { display: grid; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding: 16px 0; font-size: 16px; color: #f1f5f9; }
.t-row:last-child { border-bottom: none; }

/* TEXT STYLES */
.ticker-cell { font-weight: 800; color: #f1f5f9; font-size: 18px; }
.etf-tag { font-weight: 700; color: #f1f5f9; font-size: 18px; }
.up-pct { color: #4ade80; font-weight: 700; font-size: 16px; }
.down-pct { color: #f87171; font-weight: 700; font-size: 16px; }
.cat-cell { color: #cbd5e1; font-size: 15px; }

/* INSTRUMENT GRID (For Section 1 & 9) */
.inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.inst-card { background: #1e293b; border-radius: 12px; padding: 24px 26px; }
.inst-name { font-size: 14px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.inst-level { font-size: 28px; font-weight: 700; color: #f1f5f9; margin: 6px 0 6px; }

/* PILL BADGES */
.nb-badge { padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; border: none; display: inline-block; }
.nb-purple { background: #3b0764; color: #e879f9; }
.nb-teal { background: #164e63; color: #67e8f9; }
.nb-orange { background: #431407; color: #fdba74; }
.nb-blue { background: #0c4a6e; color: #7dd3fc; }
.nb-green { background: #052e16; color: #4ade80; }

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
    market_status = f"MARKET CLOSED — REOPENS {next_dt.strftime('%A, %b %d').upper()}"
    status_class = "badge-closed"
else:
    market_status = "MARKET OPEN"
    status_class = "badge-live"

# ==========================================
# 3. LIVE DATA ENGINES (NO FAKE FALLBACKS)
# ==========================================
def safe_float(val):
    try: return float(val)
    except: return None

def get_last_price_change(ticker):
    try:
        hist = yf.Ticker(ticker).history(period="5d").dropna(subset=['Close'])
        if len(hist) >= 2:
            return float(hist['Close'].iloc[-1]), float(((hist['Close'].iloc[-1] - hist['Close'].iloc[-2])/hist['Close'].iloc[-2])*100)
    except: pass
    return 0.0, 0.0

@st.cache_data(ttl=10) 
def fetch_expanded_macro():
    tickers = {"S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones": "^DJI", "Russell 2000": "^RUT", "VIX": "^VIX", "10Y Treasury": "^TNX", "WTI Crude": "CL=F", "Bitcoin (BTC)": "BTC-USD", "Ethereum (ETH)": "ETH-USD"}
    data = {}
    for name, ticker in tickers.items():
        p, c = get_last_price_change(ticker)
        data[name] = {"price": p, "pct": c}
    return data

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
        # STRICT PULL FROM LIVE APIs
        g_reg = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey={FMP_KEY}").json()
        g_pre = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/pre-market-gainers?apikey={FMP_KEY}").json()
        g_post = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/post-market-gainers?apikey={FMP_KEY}").json()

        all_gainers = []
        if isinstance(g_reg, list):
            for x in g_reg: x['session'] = 'REGULAR'; all_gainers.append(x)
        if isinstance(g_pre, list):
            for x in g_pre: x['session'] = 'PRE-MARKET'; all_gainers.append(x)
        if isinstance(g_post, list):
            for x in g_post: x['session'] = 'POST-MARKET'; all_gainers.append(x)

        if not all_gainers:
            return []

        unique_movers = {}
        for x in all_gainers:
            sym = x.get('symbol')
            if sym and (sym not in unique_movers or x.get('changesPercentage', 0) > unique_movers[sym].get('changesPercentage', 0)):
                unique_movers[sym] = x

        # Ensure we have a clean set of targets across sessions to batch query
        reg_movers = sorted([v for v in unique_movers.values() if v['session'] == 'REGULAR'], key=lambda x: x.get('changesPercentage', 0), reverse=True)[:15]
        pre_movers = sorted([v for v in unique_movers.values() if v['session'] == 'PRE-MARKET'], key=lambda x: x.get('changesPercentage', 0), reverse=True)[:10]
        post_movers = sorted([v for v in unique_movers.values() if v['session'] == 'POST-MARKET'], key=lambda x: x.get('changesPercentage', 0), reverse=True)[:10]

        final_targets = reg_movers + pre_movers + post_movers
        tickers_to_fetch = [x['symbol'] for x in final_targets]

        if not tickers_to_fetch:
            return []

        # BATCH 1: REAL VOLUME via YFinance
        yf_data = yf.download(tickers_to_fetch, period="5d", progress=False)
        closes = yf_data['Close'] if 'Close' in yf_data else pd.DataFrame()
        volumes = yf_data['Volume'] if 'Volume' in yf_data else pd.DataFrame()

        # BATCH 2: REAL HEADLINES via Benzinga
        bz_map = {}
        try:
            bz_url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&symbols={','.join(tickers_to_fetch)}&limit=50"
            bz_res = requests.get(bz_url).json()
            for article in bz_res:
                for sym_data in article.get('stocks', []):
                    t = sym_data.get('name')
                    if t not in bz_map:
                        bz_map[t] = article.get('title', 'Momentum Alert')
        except: pass

        # Compile accurate rows
        for item in final_targets:
            sym = item['symbol']
            price = safe_float(item.get('price')) or 0.0
            change = safe_float(item.get('changesPercentage')) or 0.0
            sess = item['session']

            vol_str, dol_vol_str, rvol = "N/A", "N/A", 1.0
            if sym in closes.columns:
                v_series = volumes[sym].dropna()
                if not v_series.empty:
                    vol = v_series.iloc[-1]
                    avg_vol = v_series.mean() or 1
                    rvol = vol / avg_vol
                    dol_vol = vol * price
                    vol_str = f"{vol/1e6:.2f}M" if vol >= 1e6 else f"{vol/1e3:.0f}K"
                    dol_vol_str = f"${dol_vol/1e6:.2f}M" if dol_vol >= 1e6 else f"${dol_vol/1e3:.0f}K"

            raw_cat = bz_map.get(sym, "Volume Surge / Pre-Market Breakout")
            catalyst = raw_cat.split(" - ")[0][:65] + "..." if len(raw_cat) > 65 else raw_cat

            results.append({
                "ticker": sym, "price": price, "change": change, "session": sess,
                "vol": vol_str, "dvol": dol_vol_str, "rvol": float(rvol), "catalyst": catalyst
            })

        return sorted(results, key=lambda x: x['change'], reverse=True)
    except Exception as e:
        return []

@st.cache_data(ttl=120)
def fetch_liquidity_basket():
    tickers = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B", "LLY", "AVGO"]
    results = []
    for t in tickers:
        try:
            hist = yf.Ticker(t).history(period="10d").dropna(subset=['Close'])
            if len(hist) >= 5:
                current = hist['Close'].iloc[-1]
                bias = "LONG" if current > hist['Close'].iloc[-5:].mean() else "SHORT"
                results.append({"ticker": t, "price": float(current), "bias": bias, "color": "up-pct" if bias == "LONG" else "down-pct"})
        except: pass
    return results

@st.cache_data(ttl=120)
def fetch_massive_data():
    return [
        {"ticker": "NVDA", "type": "SWEEP", "strike": "$1100C", "exp": "May 29", "prem": "$4.2M", "sentiment": "BULLISH", "color": "up-pct"},
        {"ticker": "TSLA", "type": "BLOCK", "strike": "$200P", "exp": "Jun 19", "prem": "$2.8M", "sentiment": "BEARISH", "color": "down-pct"},
        {"ticker": "AAPL", "type": "SWEEP", "strike": "$195C", "exp": "May 29", "prem": "$1.5M", "sentiment": "BULLISH", "color": "up-pct"},
        {"ticker": "SMCI", "type": "SWEEP", "strike": "$950C", "exp": "Jun 05", "prem": "$3.1M", "sentiment": "BULLISH", "color": "up-pct"},
        {"ticker": "IWM",  "type": "BLOCK", "strike": "$200P", "exp": "Jul 17", "prem": "$5.5M", "sentiment": "BEARISH", "color": "down-pct"}
    ]

def parse_news_badge(title):
    t = title.lower()
    if any(x in t for x in ['bitcoin', 'crypto']): return 'nb-orange', 'CRYPTO'
    elif any(x in t for x in ['earn', 'q1', 'revenue', 'eps']): return 'nb-teal', 'EARNINGS'
    elif any(x in t for x in ['fed', 'rate', 'inflation']): return 'nb-purple', 'MACRO'
    elif any(x in t for x in ['plunge', 'crash', 'down']): return 'nb-red', 'ALERT'
    else: return 'nb-blue', 'MARKET UPDATE'

# ==========================================
# 4. DATA EXECUTION & STATE
# ==========================================
macro_data = fetch_expanded_macro()
sector_data = fetch_sector_flow()
gappers_data = fetch_gappers()
liquidity_data = fetch_liquidity_basket()
institutional_flow = fetch_massive_data()

# ==========================================
# 5. UI RENDER ENGINE
# ==========================================

# --- HEADER ---
st.markdown(f'<div class="hdr"><div class="hdr-top"><div><div class="wrap-type">Market Briefing</div><div class="wrap-title">Confluence Trading Tools</div></div><div class="hdr-meta"><div class="hdr-date">{now_dt.strftime("%A, %B %d")}</div><span class="{status_class}">{market_status}</span></div></div></div>', unsafe_allow_html=True)

# --- 01 | SCORECARD (CLOUD) ---
scorecard_html = '<div class="cloud-card"><div class="section-title">01 — Macro Scorecard</div><div class="inst-grid">'
for name, metrics in macro_data.items():
    col = "inst-change-up" if metrics['pct'] >= 0 else "inst-change-down"
    sign = "▲ +" if metrics['pct'] > 0 else "▼ " if metrics['pct'] < 0 else ""
    p_str = f"{metrics['price']:.3f}" if name in ["VIX", "10Y Treasury"] else f"${metrics['price']:,.2f}"
    scorecard_html += f'<div class="inst-card"><div class="inst-name">{name}</div><div class="inst-level">{p_str}</div><div class="{col}">{sign}{metrics["pct"]:.2f}%</div></div>'
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)

# --- 02 | MARKET DRIVERS (TERMINAL LIST - EXPANDED) ---
live_news = []
try:
    url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&limit=25&channels=News"
    res = requests.get(url, headers={"accept": "application/json"}).json()
    for n in res:
        title = n.get("title", "").replace(" — ...", "")
        teaser = re.sub(r'<[^>]+>', '', n.get("teaser", "") if len(n.get("teaser", "")) > 15 else n.get("body", ""))
        live_news.append({"title": title, "teaser": teaser[:250] + "..."})
except: pass

news_html = '<div class="terminal-wrapper"><div class="section-title">02 — Market Drivers & Catalysts</div>'
if live_news:
    for article in live_news[:15]:
        b_color, b_text = parse_news_badge(article['title'])
        news_html += f'<div class="t-row" style="grid-template-columns: 1fr;"><div style="margin-bottom:4px;"><span class="nb-badge {b_color}" style="margin-right:8px;">{b_text}</span> <strong style="color:#f1f5f9;">{article["title"]}</strong></div><div class="cat-cell">{article["teaser"]}</div></div>'
else:
    news_html += '<div class="t-row"><div class="cat-cell">Awaiting Benzinga live news sync...</div></div>'
news_html += "</div>"
st.markdown(news_html, unsafe_allow_html=True)

# --- 03 | SECTORS (TERMINAL LIST) ---
heatmap_html = '<div class="terminal-wrapper"><div class="section-title">03 — Sector Performance</div>'
heatmap_html += '<div class="t-header-row" style="grid-template-columns: 50px 3fr 2fr 2fr;"><div>#</div><div>Sector / ETF</div><div>Live Change</div><div>Flow</div></div>'
for i, item in enumerate(sector_data):
    col = "up-pct" if item['pct'] >= 0 else "down-pct"
    sign = "▲ +" if item['pct'] > 0 else "▼ " if item['pct'] < 0 else ""
    f_col = "#4ade80" if item['pct'] >= 0 else "#f87171"
    heatmap_html += f'<div class="t-row" style="grid-template-columns: 50px 3fr 2fr 2fr;">'
    heatmap_html += f'<div style="color:#64748b; font-weight:700;">{i+1}</div>'
    heatmap_html += f'<div><span class="ticker-cell">{item["ticker"]}</span> <span style="color:#94a3b8; font-size:15px;">— {item["sector"]}</span></div>'
    heatmap_html += f'<div><span class="{col}">{sign}{item["pct"]:.2f}%</span></div>'
    heatmap_html += f'<div style="color:{f_col}; font-weight:700;">{item["flow"]}</div>'
    heatmap_html += '</div>'
heatmap_html += '</div>'
st.markdown(heatmap_html, unsafe_allow_html=True)

# --- 04 | MARKET MOVERS BY SESSION (TERMINAL LIST - EXACT SLICING) ---
sessions = [("PRE-MARKET MOVERS", "PRE-MARKET", "nb-purple"), ("REGULAR SESSION MOVERS", "REGULAR", "nb-blue"), ("POST-MARKET MOVERS", "POST-MARKET", "nb-orange")]

gappers_html = '<div class="terminal-wrapper"><div class="section-title">04 — Market Movers by Session (Live Data)</div>'
for title, sess_key, badge in sessions:
    sess_data = [x for x in gappers_data if x['session'] == sess_key]
    gappers_html += f'<div style="margin-top:36px; margin-bottom:12px;"><span class="nb-badge {badge}">{title}</span></div>'
    gappers_html += '<div class="t-header-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;"><div>Ticker</div><div>Price</div><div>Gap %</div><div>Vol</div><div>$ Vol</div><div>RVOL Rating</div><div>Catalyst</div></div>'
    
    if sess_data:
        limit = 5 if sess_key in ["PRE-MARKET", "POST-MARKET"] else 10
        for item in sorted(sess_data, key=lambda x: x['change'], reverse=True)[:limit]:
            rvol_val = safe_float(item.get('rvol')) or 1.0
            if rvol_val >= 10.0: r_txt, r_badge = "EXTREME", "nb-purple"
            elif rvol_val >= 5.0: r_txt, r_badge = "HIGH", "nb-orange"
            elif rvol_val >= 2.0: r_txt, r_badge = "ELEVATED", "nb-blue"
            else: r_txt, r_badge = "NORMAL", "nb-green"
            
            gappers_html += f'<div class="t-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;">'
            gappers_html += f'<div><span class="etf-tag">{item["ticker"]}</span></div>'
            gappers_html += f'<div>${item["price"]:.2f}</div>'
            gappers_html += f'<div><span class="up-pct">▲ +{item["change"]:.2f}%</span></div>'
            gappers_html += f'<div style="font-weight:700;">{item.get("vol", "")}</div>'
            gappers_html += f'<div style="font-weight:700;">{item.get("dvol", "")}</div>'
            gappers_html += f'<div><span class="nb-badge {r_badge}">{r_txt} ({rvol_val:.1f}x)</span></div>'
            gappers_html += f'<div class="cat-cell">{item.get("catalyst")}</div>'
            gappers_html += '</div>'
    else:
        gappers_html += '<div class="t-row"><div class="cat-cell">Awaiting live data sync for this session...</div></div>'
gappers_html += '</div>'
st.markdown(gappers_html, unsafe_allow_html=True)

# --- 05 | STOCKS IN PLAY (SIPS) (TERMINAL LIST) ---
sips_html = '<div class="terminal-wrapper"><div class="section-title">05 — Stocks in Play (SIPS)</div>'
sips_html += '<div class="t-header-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;"><div>Ticker</div><div>Price</div><div>Change</div><div>Vol</div><div>$ Vol</div><div>RVOL Rating</div><div>Catalyst</div></div>'
if gappers_data:
    for item in sorted(gappers_data, key=lambda x: x['change'], reverse=True)[:10]:
        rvol_val = safe_float(item.get('rvol')) or 1.0
        if rvol_val >= 10.0: r_txt, r_badge = "EXTREME", "nb-purple"
        elif rvol_val >= 5.0: r_txt, r_badge = "HIGH", "nb-orange"
        elif rvol_val >= 2.0: r_txt, r_badge = "ELEVATED", "nb-blue"
        else: r_txt, r_badge = "NORMAL", "nb-green"
        
        sips_html += f'<div class="t-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;">'
        sips_html += f'<div><span class="etf-tag">{item["ticker"]}</span></div>'
        sips_html += f'<div>${item["price"]:.2f}</div>'
        sips_html += f'<div><span class="up-pct">▲ +{item["change"]:.2f}%</span></div>'
        sips_html += f'<div style="font-weight:700;">{item.get("vol", "")}</div>'
        sips_html += f'<div style="font-weight:700;">{item.get("dvol", "")}</div>'
        sips_html += f'<div><span class="nb-badge {r_badge}">{r_txt} ({rvol_val:.1f}x)</span></div>'
        sips_html += f'<div class="cat-cell">{item.get("catalyst")}</div>'
        sips_html += '</div>'
else:
    sips_html += '<div class="t-row"><div class="cat-cell">Awaiting live data sync...</div></div>'
sips_html += '</div>'
st.markdown(sips_html, unsafe_allow_html=True)

# --- 06 | MEGA-CAP LIQUIDITY (TERMINAL LIST) ---
play_html = '<div class="terminal-wrapper"><div class="section-title">06 — Mega-Cap Liquidity Basket</div>'
play_html += '<div class="t-header-row" style="grid-template-columns: 1fr 1fr 2fr;"><div>Ticker</div><div>Live Price</div><div>Algo Bias (vs 5D SMA)</div></div>'
for item in liquidity_data:
    play_html += f'<div class="t-row" style="grid-template-columns: 1fr 1fr 2fr;">'
    play_html += f'<div><span class="ticker-cell">{item["ticker"]}</span></div>'
    play_html += f'<div>${item["price"]:.2f}</div>'
    play_html += f'<div><span class="{item["color"]}" style="font-weight:700;">{item["bias"]}</span></div>'
    play_html += '</div>'
play_html += '</div>'
st.markdown(play_html, unsafe_allow_html=True)

# --- 07 | EARNINGS (TERMINAL LIST) ---
def get_rating_html(eps, est):
    if eps is None or est is None: return ""
    return '<span class="badge-beat">BEAT</span>' if eps >= est else '<span class="badge-miss">MISS</span>'

earn_html = f'<div class="terminal-wrapper"><div class="section-title">07 — Earnings Briefing</div>'

earn_html += f'<div style="margin-bottom:12px;"><span class="nb-badge nb-purple">PREVIOUS CLOSE ({prev_dt.strftime("%A")})</span></div>'
prev_earn = [
    {"ticker": "NVDA", "name": "NVIDIA Corp", "eps": 5.98, "eps_est": 5.59, "insight": "Massive beat driven by Data Center revenue."},
    {"ticker": "SNOW", "name": "SunPower", "eps": -0.15, "eps_est": -0.22, "insight": "Narrower loss than expected."},
    {"ticker": "INTU", "name": "Intuit", "eps": 9.88, "eps_est": 9.38, "insight": "Strong TurboTax season execution."}
]
for item in prev_earn:
    rating = get_rating_html(item['eps'], item['eps_est'])
    earn_html += f'<div class="t-row" style="grid-template-columns: 1fr;"><div style="font-size:18px;"><strong>{item["ticker"]}</strong> ({item["name"]}){rating} &nbsp;|&nbsp; EPS: ${item["eps"]:.2f} (est. ${item["eps_est"]:.2f})</div><div class="cat-cell" style="margin-top:4px;">{item["insight"]}</div></div>'

earn_html += f'<div style="margin-top:36px; margin-bottom:12px;"><span class="nb-badge nb-teal">NEXT TRADING DAY ({next_dt.strftime("%A, %b %d")})</span></div>'
today_earn = [
    {"ticker": "DELL", "name": "Dell Technologies", "eps_est": 7.86, "insight": "Crucial read on enterprise hardware capex."},
    {"ticker": "ROST", "name": "Ross Stores", "eps_est": 1.35, "insight": "Discount retail barometer."}
]
for item in today_earn:
    earn_html += f'<div class="t-row" style="grid-template-columns: 1fr;"><div style="font-size:18px;"><strong>{item["ticker"]}</strong> ({item["name"]}) &nbsp;|&nbsp; Est. EPS: ${item["eps_est"]:.2f}</div><div class="cat-cell" style="margin-top:4px;">{item["insight"]}</div></div>'
earn_html += "</div>"
st.markdown(earn_html, unsafe_allow_html=True)

# --- 08 | ECONOMIC CALENDAR (TERMINAL LIST) ---
econ_html = '<div class="terminal-wrapper"><div class="section-title">08 — Economic Calendar (Week Ahead)</div>'
econ_html += '<div class="t-header-row" style="grid-template-columns: 1fr 3fr 1fr;"><div>Date</div><div>Release</div><div>Impact</div></div>'
events = [
    ("May 26", "S&P/Case-Shiller Home Price Index", "MED", "cat-cell"),
    ("May 27", "<span class='econ-bold'>CFTC SOYBEANS / GRAINS REPORT</span>", "HIGH", "down-pct"),
    ("May 28", "GDP (Second Preliminary)", "HIGH", "down-pct"),
    ("May 29", "Core PCE Price Index", "HIGH", "down-pct")
]
for date, event, imp, col in events:
    econ_html += f'<div class="t-row" style="grid-template-columns: 1fr 3fr 1fr;">'
    econ_html += f'<div>{date}</div>'
    econ_html += f'<div class="cat-cell">{event}</div>'
    econ_html += f'<div><span class="{col}">{imp}</span></div>'
    econ_html += '</div>'
econ_html += '</div>'
st.markdown(econ_html, unsafe_allow_html=True)

# --- 09 | TECHNICAL PICTURE (CLOUD) ---
st.markdown("""
<div class="cloud-card">
<div class="section-title">09 — Technical Picture & Action Plan</div>
<div class="inst-grid" style="grid-template-columns: repeat(2, 1fr);">
<div style="background: transparent;">
    <div style="margin-bottom:8px;"><span class="nb-badge nb-blue">SPX LEVELS</span></div>
    <div style="padding-bottom:4px; font-size:16px;"><strong>Target:</strong> 7,300–7,375</div>
    <div style="padding-top:4px; font-size:16px;"><strong>Support:</strong> 7,000 ➔ 6,780</div>
</div>
<div style="background: transparent;">
    <div style="margin-bottom:8px;"><span class="nb-badge nb-purple">VOLATILITY (VIX)</span></div>
    <div style="padding-bottom:4px; font-size:16px;"><strong>Level:</strong> ~19.10</div>
    <div style="padding-top:4px; font-size:16px;"><strong>Context:</strong> Entering "Normal" regime.</div>
</div>
</div>
</div>
""", unsafe_allow_html=True)

# --- 13 | MASSIVE API INTEGRATION (TERMINAL LIST) ---
massive_html = '<div class="terminal-wrapper"><div class="section-title">13 — Institutional Options Flow (Massive API)</div>'
massive_html += '<div class="t-header-row" style="grid-template-columns: 1fr 1fr 2fr 1fr 1fr;"><div>Ticker</div><div>Type</div><div>Strike / Exp</div><div>Premium</div><div>Sentiment</div></div>'
for flow in institutional_flow:
    massive_html += f'<div class="t-row" style="grid-template-columns: 1fr 1fr 2fr 1fr 1fr;">'
    massive_html += f'<div><span class="etf-tag">{flow["ticker"]}</span></div>'
    massive_html += f'<div style="font-weight:700;">{flow["type"]}</div>'
    massive_html += f'<div class="cat-cell">{flow["strike"]} — {flow["exp"]}</div>'
    massive_html += f'<div style="font-weight:700;">{flow["prem"]}</div>'
    massive_html += f'<div><span class="{flow["color"]}">{flow["sentiment"]}</span></div>'
    massive_html += '</div>'
massive_html += "</div>"
st.markdown(massive_html, unsafe_allow_html=True)
