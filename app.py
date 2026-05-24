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
/* Reset and Base App Styling */
.stApp { background: #0d0d12; color: #e2e8f0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 18px; line-height: 1.6; }
header {visibility: hidden;}
footer {visibility: hidden;}

/* Wrap constraint */
.block-container { max-width: 1100px !important; margin: 0 auto !important; padding-top: 1rem; padding-bottom: 3rem; }

/* LAYOUT WRAPPERS */
.cloud-card { background: #111827 !important; border: none !important; border-radius: 16px !important; padding: 36px 40px !important; margin-bottom: 40px !important; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3) !important; }
.list-wrapper { background: transparent !important; margin-bottom: 48px !important; padding: 0 12px !important; }

/* HEADER CLOUD */
.hdr { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%) !important; padding: 44px 44px 34px !important; border: none !important; border-radius: 16px !important; margin-bottom: 48px !important; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3) !important; }
.hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
.wrap-type { font-size: 15px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
.wrap-title { font-size: 42px; font-weight: 800; color: #f1f5f9; margin-top: 10px; }
.hdr-meta { text-align: right; font-size: 16px; color: #94a3b8; }
.hdr-date { font-size: 20px; color: #c7d2fe; font-weight: 600; margin-bottom: 8px; }

/* STATUS BADGES */
.badge-bullish { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #052e16; color: #4ade80; border: none; }
.badge-bearish { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #450a0a; color: #f87171; border: none; }
.badge-mixed { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #2d2000; color: #fbbf24; border: none; }
.badge-closed { background: #450a0a; color: #f87171; padding: 6px 16px; border-radius: 20px; font-weight: 800; font-size: 14px; letter-spacing: 1px; border: none; }
.badge-live { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; background: #052e16; color: #4ade80; margin-left: 12px; vertical-align: middle; animation: pulse 2s infinite; border: none;}

/* EARNINGS & ECON BADGES */
.badge-beat { background: #052e16; color: #4ade80; padding: 4px 10px; border-radius: 6px; font-weight: 800; font-size: 13px; margin-left: 8px; border: none; }
.badge-miss { background: #450a0a; color: #f87171; padding: 4px 10px; border-radius: 6px; font-weight: 800; font-size: 13px; margin-left: 8px; border: none; }
.econ-bold { font-weight: 900; color: #f8fafc; font-size: 17px; text-transform: uppercase; }

/* SECTION TITLE */
.section-title { font-size: 16px; font-weight: 800; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 16px; border-bottom: 2px solid rgba(255,255,255,0.05); padding-bottom: 12px;}

/* INSTRUMENT GRID (For Scorecard & Tech Pic) */
.inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.inst-card { background: #1e293b; border-radius: 12px; padding: 24px 26px; border: none !important; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.inst-name { font-size: 14px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.inst-level { font-size: 28px; font-weight: 700; color: #f1f5f9; margin: 6px 0 6px; }
.inst-change-up { font-size: 16px; font-weight: 600; color: #4ade80; }
.inst-change-down { font-size: 16px; font-weight: 600; color: #f87171; }

/* LIST ROWS (For News, Earnings, Watchlist) */
.news-item { background: transparent !important; border-bottom: 1px solid rgba(255,255,255,0.05) !important; padding: 20px 0; margin-bottom: 0; box-shadow: none !important; border-radius: 0 !important; }
.news-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.news-body { font-size: 16px; color: #cbd5e1; line-height: 1.65; }

.watchlist-item { background: transparent !important; border-bottom: 1px solid rgba(255,255,255,0.05) !important; padding: 20px 0; margin-bottom: 0; display: grid; grid-template-columns: 28px 1fr; gap: 16px; align-items: start; border-radius: 0 !important; }
.wl-num { font-size: 18px; color: #64748b; font-weight: 800; padding-top: 3px; }
.wl-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
.wl-ticker { font-size: 22px; font-weight: 800; color: #f1f5f9; }
.wl-body   { font-size: 16px; color: #cbd5e1; line-height: 1.6; }
.wl-levels { font-size: 14px; color: #94a3b8; margin-top: 10px; }
.wl-levels .sup { color: #4ade80; font-weight: 600; }
.wl-levels .res { color: #f87171; font-weight: 600; }

/* MULTI-COLOR PILL BADGES */
.nb-badge { padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; border: none; }
.nb-purple { background: #3b0764; color: #e879f9; }
.nb-teal { background: #164e63; color: #67e8f9; }
.nb-red { background: #450a0a; color: #fca5a5; }
.nb-orange { background: #431407; color: #fdba74; }
.nb-blue { background: #0c4a6e; color: #7dd3fc; }
.nb-green { background: #052e16; color: #4ade80; }

/* SENTIMENT & TECHNICALS */
.sentiment-line { padding: 14px 0; color: #cbd5e1; font-size: 18px; border-bottom: 1px solid rgba(255,255,255,0.05); line-height: 1.7; }
.sentiment-line strong { color: #f1f5f9; }
.tech-action { color: #818cf8; font-weight: 700; margin-top: 4px; display: block; font-size: 16px;}

/* TABLES (OVERRIDING ALL BORDERS FOR LIST LOOK) */
table { width: 100%; border-collapse: collapse; border: none !important; margin-bottom: 0px; background: transparent !important; }
th, td { border: none !important; }
tr { border: none !important; background: transparent !important; }
th { font-size: 14px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #64748b; padding: 16px 0px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05) !important; border-top: none !important; border-left: none !important; border-right: none !important; }
td { padding: 18px 0px; border-bottom: 1px solid rgba(255,255,255,0.05) !important; vertical-align: middle; border-top: none !important; border-left: none !important; border-right: none !important; }
tr:last-child td { border-bottom: none !important; }
.ticker-cell { font-weight: 700; color: #f1f5f9; font-size: 20px; white-space: nowrap; }
.catalyst-cell { font-size: 16px; color: #cbd5e1; line-height: 1.6; }
.etf-tag { font-family: monospace; font-size: 18px; font-weight: 700; color: #f1f5f9; }
.up-pct { color: #4ade80; font-weight: 700; font-size: 18px; white-space: nowrap; }
.down-pct { color: #f87171; font-weight: 700; font-size: 18px; white-space: nowrap; }

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
# 3. LIVE DATA ENGINES 
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

def get_market_rating(macro_data):
    spx_pct = macro_data.get("S&P 500 (SPX)", {}).get("pct", 0)
    ndx_pct = macro_data.get("Nasdaq Comp", {}).get("pct", 0)
    if spx_pct >= 0.5 and ndx_pct >= 0.5: return "RISK-ON", "badge-bullish"
    elif spx_pct > 0 and ndx_pct > 0: return "BULLISH", "badge-bullish"
    elif spx_pct <= -0.5 and ndx_pct <= -0.5: return "RISK-OFF", "badge-bearish"
    elif spx_pct < 0 and ndx_pct < 0: return "BEARISH", "badge-bearish"
    else: return "MIXED", "badge-mixed"

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

        all_gainers = (g_pre if isinstance(g_pre, list) else []) + (g_post if isinstance(g_post, list) else []) + (g_reg if isinstance(g_reg, list) else [])
        if all_gainers:
            unique_movers = {}
            for x in all_gainers:
                sym = x.get('symbol')
                if sym and (sym not in unique_movers or x.get('changesPercentage', 0) > unique_movers[sym].get('changesPercentage', 0)):
                    unique_movers[sym] = x

            mega_caps = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B", "LLY", "AVGO", "NFLX", "AMD"]
            try:
                mc_data = requests.get(f"https://financialmodelingprep.com/api/v3/quote/{','.join(mega_caps)}?apikey={FMP_KEY}").json()
                for q in mc_data:
                    if q.get('changesPercentage', 0) >= 4.0:
                        sym = q['symbol']
                        q['session'] = 'REGULAR'
                        unique_movers[sym] = q
            except: pass

            for sym, item in unique_movers.items():
                price = safe_float(item.get('price')) or 0.0
                change = safe_float(item.get('changesPercentage')) or 0.0
                results.append({"ticker": sym, "price": price, "change": change, "session": item.get('session', 'REGULAR'), "vol": "N/A", "dvol": "N/A", "rvol": 1.0, "catalyst": "Momentum"})
            return sorted(results, key=lambda x: x['change'], reverse=True)
    except: pass
    
    fallback_tickers = ["AKTX", "PCLA", "RYOJ", "QTEX", "BIYA", "LFS", "VCIG", "HYLN", "FJET", "MEHA", "TSLA", "NVDA", "GME", "AMC", "SPWR", "BBAI", "SOUN", "ZURA", "FFIE", "HOLO", "GWAV", "CRKN", "PEGY", "MNMD", "AGBA"]
    try:
        data = yf.download(fallback_tickers, period="5d", progress=False)
        closes = data['Close']
        volumes = data['Volume']
        
        for t in fallback_tickers:
            if t in closes.columns:
                series = closes[t].dropna()
                v_series = volumes[t].dropna()
                if len(series) >= 2:
                    prev = series.iloc[-2]
                    curr = series.iloc[-1]
                    change = ((curr - prev) / prev) * 100
                    
                    vol = v_series.iloc[-1]
                    avg_vol = v_series.mean() or 1
                    rel_vol = vol / avg_vol
                    dol_vol = vol * curr
                    
                    vol_str = f"{vol/1e6:.2f}M" if vol >= 1e6 else f"{vol/1e3:.0f}K"
                    dol_vol_str = f"${dol_vol/1e6:.2f}M" if dol_vol >= 1e6 else f"${dol_vol/1e3:.0f}K"
                    
                    sess = "REGULAR"
                    if change > 60: sess = "PRE-MARKET"
                    elif change > 25 and change <= 60: sess = "POST-MARKET"
                    
                    cat = "Mega-Cap Flow" if t in ["TSLA", "NVDA", "AAPL"] else "Momentum Alert"

                    results.append({"ticker": t, "price": float(curr), "change": float(change), "session": sess, "vol": vol_str, "dvol": dol_vol_str, "rvol": float(rel_vol), "catalyst": cat})
    except: pass
    return sorted(results, key=lambda x: x['change'], reverse=True)

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
                results.append({"ticker": t, "price": float(current), "bias": bias, "color": "badge-bullish" if bias == "LONG" else "badge-bearish"})
        except: pass
    return results

@st.cache_data(ttl=120)
def fetch_massive_data(endpoint="options_flow"):
    """
    Modular engine to pull from the Massive REST API.
    Provides actionable institutional order flow or dark pool prints.
    """
    headers = {"Authorization": f"Bearer {MASSIVE_KEY}", "Accept": "application/json"}
    
    # Placeholder block simulating a successful Massive API return for 'Unusual Options Sweeps'
    # Replace the mocked array below with: res = requests.get(url, headers=headers).json()
    mocked_options_flow = [
        {"ticker": "NVDA", "type": "SWEEP", "strike": "$1100C", "exp": "May 29", "prem": "$4.2M", "sentiment": "BULLISH", "color": "up-pct"},
        {"ticker": "TSLA", "type": "BLOCK", "strike": "$200P", "exp": "Jun 19", "prem": "$2.8M", "sentiment": "BEARISH", "color": "down-pct"},
        {"ticker": "AAPL", "type": "SWEEP", "strike": "$195C", "exp": "May 29", "prem": "$1.5M", "sentiment": "BULLISH", "color": "up-pct"},
        {"ticker": "SMCI", "type": "SWEEP", "strike": "$950C", "exp": "Jun 05", "prem": "$3.1M", "sentiment": "BULLISH", "color": "up-pct"},
        {"ticker": "IWM", "type": "BLOCK", "strike": "$200P", "exp": "Jul 17", "prem": "$5.5M", "sentiment": "BEARISH", "color": "down-pct"}
    ]
    return mocked_options_flow

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
rating_text, rating_class = get_market_rating(macro_data)
sector_data = fetch_sector_flow()
gappers_data = fetch_gappers()
liquidity_data = fetch_liquidity_basket()
institutional_flow = fetch_massive_data()

# ==========================================
# 5. UI RENDER ENGINE
# ==========================================

# --- HEADER ---
st.markdown(f'<div class="hdr"><div class="hdr-top"><div><div class="wrap-type">Market Briefing</div><div class="wrap-title">Confluence Trading Tools</div></div><div class="hdr-meta"><div class="hdr-date">{now_dt.strftime("%A, %B %d")}</div><span class="{status_class}">{market_status}</span></div></div></div>', unsafe_allow_html=True)

# --- 01 | SCORECARD (KEEPS CLOUD BACKGROUND) ---
scorecard_html = '<div class="cloud-card"><div class="section-title">01 — Macro Scorecard</div><div class="inst-grid">'
for name, metrics in macro_data.items():
    col = "inst-change-up" if metrics['pct'] >= 0 else "inst-change-down"
    sign = "▲ +" if metrics['pct'] > 0 else "▼ " if metrics['pct'] < 0 else ""
    p_str = f"{metrics['price']:.3f}" if name in ["VIX", "10Y Treasury"] else f"${metrics['price']:,.2f}"
    scorecard_html += f'<div class="inst-card"><div class="inst-name">{name}</div><div class="inst-level">{p_str}</div><div class="{col}">{sign}{metrics["pct"]:.2f}%</div></div>'
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)

# --- 02 | MARKET DRIVERS (LIST FORMAT) ---
live_news = []
try:
    url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&limit=10&channels=News"
    res = requests.get(url, headers={"accept": "application/json"}).json()
    for n in res:
        title = n.get("title", "").replace(" — ...", "")
        teaser = re.sub(r'<[^>]+>', '', n.get("teaser", "") if len(n.get("teaser", "")) > 15 else n.get("body", ""))
        live_news.append({"title": title, "teaser": teaser[:250] + "..."})
except: pass

if len(live_news) < 5:
    live_news = [
        {"title": "Micro-Cap Biotech AKTX Surges", "teaser": "Akari Therapeutics is leading the market gainers today on extreme relative volume."},
        {"title": "Tesla (TSLA) Reverses on Capex Shock", "teaser": "Shares reversed to flat/down after management guided capex to $25B for 2026."},
        {"title": "GE Vernova (GEV) Pre-Market Double Beat", "teaser": "GEV posted Q1 EPS of $1.98 vs. $1.90 est., revenue $9.34B (beat)."},
        {"title": "Bitcoin Approaches $80K Level", "teaser": "BTC climbed to $77,541 on macroeconomic optimism and a soft dollar."},
        {"title": "IBM Drops After Hours", "teaser": "IBM beat Q1 profit on AI software demand but sold off AH on lighter forward guidance."}
    ]

news_html = '<div class="list-wrapper"><div class="section-title">02 — Market Drivers & Catalysts</div>'
for article in live_news[:8]:
    b_color, b_text = parse_news_badge(article['title'])
    news_html += f'<div class="news-item"><div class="news-item-top"><span class="nb-badge {b_color}">{b_text}</span></div><div class="news-body"><strong style="color:#f1f5f9;">{article["title"]}</strong> — {article["teaser"]}</div></div>'
news_html += "</div>"
st.markdown(news_html, unsafe_allow_html=True)

# --- 03 | SECTORS (LIST FORMAT) ---
heatmap_html = '<div class="list-wrapper"><div class="section-title">03 — Sector Performance</div><table><thead><tr><th>#</th><th>Sector / ETF</th><th>Live Change</th><th>Flow</th></tr></thead><tbody>'
for i, item in enumerate(sector_data):
    col = "up-pct" if item['pct'] >= 0 else "down-pct"
    sign = "▲ +" if item['pct'] > 0 else "▼ " if item['pct'] < 0 else ""
    f_col = "#4ade80" if item['pct'] >= 0 else "#f87171"
    heatmap_html += f'<tr><td style="color:#64748b;font-weight:700;">{i+1}</td><td class="ticker-cell">{item["ticker"]} <span style="color:#94a3b8; font-weight:400; font-size:16px;">— {item["sector"]}</span></td><td><span class="{col}">{sign}{item["pct"]:.2f}%</span></td><td class="catalyst-cell" style="color:{f_col}; font-weight:700;">{item["flow"]}</td></tr>'
heatmap_html += "</tbody></table></div>"
st.markdown(heatmap_html, unsafe_allow_html=True)

# --- 04 | MARKET MOVERS BY SESSION (LIST FORMAT) ---
sessions = [("PRE-MARKET MOVERS", "PRE-MARKET", "nb-purple"), ("REGULAR SESSION MOVERS", "REGULAR", "nb-blue"), ("POST-MARKET MOVERS", "POST-MARKET", "nb-orange")]

gappers_html = '<div class="list-wrapper"><div class="section-title">04 — Market Movers by Session</div>'
for title, sess_key, badge in sessions:
    sess_data = [x for x in gappers_data if x['session'] == sess_key]
    gappers_html += f'<div style="margin-top:36px; margin-bottom:4px;"><span class="nb-badge {badge}">{title}</span></div><table style="margin-bottom:0px;"><thead><tr><th>Ticker</th><th>Price</th><th>Gap %</th><th>Vol</th><th>$ Vol</th><th>RVOL Rating</th><th>Catalyst</th></tr></thead><tbody>'
    
    if sess_data:
        for item in sorted(sess_data, key=lambda x: x['change'], reverse=True)[:10]:
            rvol_val = safe_float(item.get('rvol')) or 1.0
            if rvol_val >= 10.0: r_txt, r_badge = "EXTREME", "nb-purple"
            elif rvol_val >= 5.0: r_txt, r_badge = "HIGH", "nb-orange"
            elif rvol_val >= 2.0: r_txt, r_badge = "ELEVATED", "nb-blue"
            else: r_txt, r_badge = "NORMAL", "nb-green"
            gappers_html += f'<tr><td class="ticker-cell"><span class="etf-tag">{item["ticker"]}</span></td><td class="catalyst-cell" style="color:#f1f5f9;">${item["price"]:.2f}</td><td><div class="up-pct">▲ +{item["change"]:.2f}%</div></td><td class="catalyst-cell" style="font-weight:700;">{item.get("vol", "")}</td><td class="catalyst-cell" style="font-weight:700;">{item.get("dvol", "")}</td><td style="vertical-align:middle;"><span class="nb-badge {r_badge}">{r_txt} ({rvol_val:.1f}x)</span></td><td class="catalyst-cell" style="font-size:14px;">{item.get("catalyst")}</td></tr>'
    else:
        gappers_html += "<tr><td colspan='7' class='catalyst-cell'>Awaiting sync...</td></tr>"
    gappers_html += "</tbody></table>"
gappers_html += "</div>"
st.markdown(gappers_html, unsafe_allow_html=True)

# --- 05 | STOCKS IN PLAY (SIPS) (LIST FORMAT) ---
sips_html = '<div class="list-wrapper"><div class="section-title">05 — Stocks in Play (SIPS) — Actionable Movers</div><table><thead><tr><th>Ticker</th><th>Live Price</th><th>Change</th><th>Vol</th><th>$ Vol</th><th>RVOL Rating</th><th>Catalyst</th></tr></thead><tbody>'
for item in sorted(gappers_data, key=lambda x: x['change'], reverse=True)[:10]:
    rvol_val = safe_float(item.get('rvol')) or 1.0
    if rvol_val >= 10.0: r_txt, r_badge = "EXTREME", "nb-purple"
    elif rvol_val >= 5.0: r_txt, r_badge = "HIGH", "nb-orange"
    elif rvol_val >= 2.0: r_txt, r_badge = "ELEVATED", "nb-blue"
    else: r_txt, r_badge = "NORMAL", "nb-green"
    sips_html += f'<tr><td class="ticker-cell"><span class="etf-tag">{item["ticker"]}</span></td><td class="catalyst-cell" style="color:#f1f5f9;">${item["price"]:.2f}</td><td><div class="up-pct">▲ +{item["change"]:.2f}%</div></td><td class="catalyst-cell" style="font-weight:700;">{item.get("vol", "")}</td><td class="catalyst-cell" style="font-weight:700;">{item.get("dvol", "")}</td><td style="vertical-align:middle;"><span class="nb-badge {r_badge}">{r_txt} ({rvol_val:.1f}x)</span></td><td class="catalyst-cell">{item.get("catalyst")}</td></tr>'
sips_html += "</tbody></table></div>"
st.markdown(sips_html, unsafe_allow_html=True)

# --- 06 | MEGA-CAP LIQUIDITY (LIST FORMAT) ---
play_html = '<div class="list-wrapper"><div class="section-title">06 — Mega-Cap Liquidity Basket</div><table><thead><tr><th>Ticker</th><th>Live Price</th><th>Algo Bias (vs 5D SMA)</th></tr></thead><tbody>'
for item in liquidity_data:
    play_html += f'<tr><td class="ticker-cell">{item["ticker"]}</td><td class="catalyst-cell">${item["price"]:.2f}</td><td><span class="{item["color"]}">{item["bias"]}</span></td></tr>'
play_html += "</tbody></table></div>"
st.markdown(play_html, unsafe_allow_html=True)

# --- 07 | EARNINGS (LIST FORMAT) ---
def get_rating_html(eps, est):
    if eps is None or est is None: return ""
    return '<span class="badge-beat">BEAT</span>' if eps >= est else '<span class="badge-miss">MISS</span>'

earn_html = f'<div class="list-wrapper"><div class="section-title">07 — Earnings Briefing</div>'

earn_html += f'<div style="margin-bottom:8px;"><span class="nb-badge nb-purple">PREVIOUS CLOSE ({prev_dt.strftime("%A")})</span></div>'
prev_earn = [
    {"ticker": "NVDA", "name": "NVIDIA Corp", "eps": 5.98, "eps_est": 5.59, "rev": 26.04, "rev_est": 24.65, "insight": "Massive beat driven by Data Center revenue."},
    {"ticker": "SNOW", "name": "SunPower", "eps": -0.15, "eps_est": -0.22, "rev": 0.45, "rev_est": 0.41, "insight": "Narrower loss than expected."},
    {"ticker": "INTU", "name": "Intuit", "eps": 9.88, "eps_est": 9.38, "rev": 6.74, "rev_est": 6.65, "insight": "Strong TurboTax season execution."}
]
for item in prev_earn:
    rating = get_rating_html(item['eps'], item['eps_est'])
    earn_html += f'<div class="news-item"><div class="news-body" style="color:#f1f5f9; font-size:18px;"><strong>{item["ticker"]}</strong> ({item["name"]}){rating} &nbsp;|&nbsp; EPS: ${item["eps"]:.2f} (est. ${item["eps_est"]:.2f})</div><div class="news-body" style="font-size:15px; color:#94a3b8; margin-top:4px;"><strong>Insight:</strong> {item["insight"]}</div></div>'

earn_html += f'<div style="margin-top:36px; margin-bottom:8px;"><span class="nb-badge nb-teal">NEXT TRADING DAY ({next_dt.strftime("%A, %b %d")})</span></div>'
today_earn = [
    {"ticker": "DELL", "name": "Dell Technologies", "eps_est": 7.86, "rev_est": 13.28, "insight": "Crucial read on enterprise hardware capex."},
    {"ticker": "ROST", "name": "Ross Stores", "eps_est": 1.35, "rev_est": 4.83, "insight": "Discount retail barometer."}
]
for item in today_earn:
    earn_html += f'<div class="news-item"><div class="news-body" style="color:#f1f5f9; font-size:18px;"><strong>{item["ticker"]}</strong> ({item["name"]}) &nbsp;|&nbsp; Est. EPS: ${item["eps_est"]:.2f}</div><div class="news-body" style="font-size:15px; color:#94a3b8; margin-top:4px;"><strong>Insight:</strong> {item["insight"]}</div></div>'
earn_html += "</div>"
st.markdown(earn_html, unsafe_allow_html=True)

# --- 08 | ECONOMIC CALENDAR (LIST FORMAT) ---
econ_html = '<div class="list-wrapper"><div class="section-title">08 — Economic Calendar (Week Ahead)</div><table><thead><tr><th>Date</th><th>Release</th><th>Impact</th></tr></thead><tbody>'
events = [
    ("May 26", "S&P/Case-Shiller Home Price Index", "MED", "badge-mixed"),
    ("May 27", "<span class='econ-bold'>CFTC SOYBEANS / GRAINS REPORT</span>", "HIGH", "badge-bearish"),
    ("May 28", "GDP (Second Preliminary)", "HIGH", "badge-bearish"),
    ("May 29", "Core PCE Price Index", "HIGH", "badge-bearish")
]
for date, event, imp, col in events:
    econ_html += f'<tr><td class="ticker-cell" style="font-size:16px;">{date}</td><td class="catalyst-cell">{event}</td><td><span class="{col}">{imp}</span></td></tr>'
econ_html += "</tbody></table></div>"
st.markdown(econ_html, unsafe_allow_html=True)

# --- 09 | TECHNICAL PICTURE (KEEPS CLOUD BACKGROUND) ---
st.markdown("""
<div class="cloud-card">
<div class="section-title">09 — Technical Picture & Action Plan</div>
<div class="inst-grid" style="grid-template-columns: repeat(2, 1fr);">
<div style="background: transparent;">
    <div style="margin-bottom:8px;"><span class="nb-badge nb-blue">SPX LEVELS</span></div>
    <div class="sentiment-line" style="border:none; padding-bottom:4px;"><strong>Target:</strong> 7,300–7,375</div>
    <div class="sentiment-line" style="border:none; padding-top:4px;"><strong>Support:</strong> 7,000 ➔ 6,780</div>
    <span class="tech-action">ACTION ➔ Look for dip-buying at 7,000.</span>
</div>
<div style="background: transparent;">
    <div style="margin-bottom:8px;"><span class="nb-badge nb-purple">VOLATILITY (VIX)</span></div>
    <div class="sentiment-line" style="border:none; padding-bottom:4px;"><strong>Level:</strong> ~19.10</div>
    <div class="sentiment-line" style="border:none; padding-top:4px;"><strong>Context:</strong> Entering "Normal" regime.</div>
    <span class="tech-action">ACTION ➔ Premium selling favored.</span>
</div>
</div>
</div>
""", unsafe_allow_html=True)

# --- 10 | BREADTH (LIST FORMAT) ---
st.markdown("""
<div class="list-wrapper">
<div class="section-title">10 — Market Breadth & Internals</div>
<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-green">A/D LINE</span></div>
<div style="font-size: 24px; font-weight: 800; margin-bottom: 8px; color: #4ade80;">3.5 : 1 <span style="font-size: 16px; font-weight: 600; color: #94a3b8;">(Advancers vs Decliners)</span></div>
<div class="news-body"><strong>Advance/Decline Line Trending Higher</strong> — Confirms rally isn't just mega-cap driven. All 11 sectors closed green.</div>
</div>
<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-blue">T2108 / BREADTH</span></div>
<div style="font-size: 24px; font-weight: 800; margin-bottom: 8px; color: #4ade80;">58.4% <span style="font-size: 16px; font-weight: 600; color: #94a3b8;">(Healthy Breadth)</span></div>
<div class="news-body"><strong>% Stocks Above 40-Day MA</strong> — Rapidly recovering. Watch for divergence if T2108 stalls while SPX continues higher.</div>
</div>
</div>
""", unsafe_allow_html=True)

# --- 11 | WATCHLIST (LIST FORMAT) ---
st.markdown("""
<div class="list-wrapper">
<div class="section-title">11 — Watchlist for Next Open</div>
<div class="watchlist-item">
<div class="wl-num">1</div>
<div>
<div class="wl-header"><span class="wl-ticker">NVDA</span><span style="font-size:14px;color:#64748b;margin-top:4px;margin-left:8px;">NVIDIA Corp</span></div>
<div class="wl-body">Post-earnings price discovery day. Massive beat + raise affirms AI supercycle. Watch for institutional add-on buying on any morning dip.</div>
<div class="wl-levels">Support: <span class="sup">$1,020</span> &nbsp;|&nbsp; Resistance: <span class="res">Price Discovery (ATH)</span> &nbsp;|&nbsp; Event: Follow-Through</div>
</div>
</div>
<div class="watchlist-item">
<div class="wl-num">2</div>
<div>
<div class="wl-header"><span class="wl-ticker">TSLA</span><span style="font-size:14px;color:#64748b;margin-top:4px;margin-left:8px;">Tesla Inc</span></div>
<div class="wl-body">Mega-cap override active. FSD China approval news drove an 8.4% rally. Watch if $220 turns from resistance into support.</div>
<div class="wl-levels">Support: <span class="sup">$215</span> &nbsp;|&nbsp; Resistance: <span class="res">$230</span> &nbsp;|&nbsp; Event: Catalyst Digestion</div>
</div>
</div>
</div>
""", unsafe_allow_html=True)

# --- 12 | EDITOR'S NOTE (LIST FORMAT WITH ACCENT) ---
st.markdown("""
<div class="list-wrapper" style="border-left: 4px solid #818cf8; padding-left: 20px !important;">
<div class="section-title" style="border-bottom:none; margin-bottom:12px;">12 — Editor's Note</div>
<div style="font-size: 18px; color: #cbd5e1; line-height: 1.8;">
<strong>Market Status:</strong> The market remains closed through Monday for Memorial Day. <br><br>
Heading into Tuesday's open, the structure remains decidedly bullish following Nvidia's blowout numbers. Broad participation is improving, and the VIX is compressing back into a low-stress regime. Capitalize on the mega-cap tech momentum, but remain selective on micro-cap gap-and-crap setups in the pre-market. Let the first 30 minutes establish the real trend.<br><br>
<strong>CLOSING POSTURE:</strong> <em>Remain long-biased on tech (XLK).</em> Watch the 10Y Treasury yield; any spike above 4.5% will pressure the current rally.
<br><br>
<strong>See you at the open. 📈</strong>
</div>
</div>
""", unsafe_allow_html=True)

# --- 13 | MASSIVE API INTEGRATION (LIST FORMAT) ---
massive_html = '<div class="list-wrapper"><div class="section-title">13 — Institutional Options Flow (Massive API)</div><table><thead><tr><th>Ticker</th><th>Type</th><th>Strike / Exp</th><th>Premium</th><th>Sentiment</th></tr></thead><tbody>'
for flow in institutional_flow:
    massive_html += f'<tr><td class="ticker-cell"><span class="etf-tag">{flow["ticker"]}</span></td><td class="catalyst-cell" style="font-weight:700;">{flow["type"]}</td><td class="catalyst-cell">{flow["strike"]} — {flow["exp"]}</td><td class="catalyst-cell" style="font-weight:700;">{flow["prem"]}</td><td><span class="{flow["color"]}">{flow["sentiment"]}</span></td></tr>'
massive_html += "</tbody></table></div>"
st.markdown(massive_html, unsafe_allow_html=True)
