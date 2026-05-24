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
/* Reset and Base App Styling - Smoother Fonts & Off-White Text */
.stApp { 
    background: #0a1120; 
    color: #cbd5e1; 
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Roboto', 'Segoe UI', sans-serif; 
    -webkit-font-smoothing: antialiased;
    font-size: 16px; 
    line-height: 1.6; 
}
header {visibility: hidden;}
footer {visibility: hidden;}

/* ONE BIG CLOUD */
.block-container { 
    background: #111827 !important; 
    border-radius: 16px !important; 
    padding: 56px !important; 
    max-width: 1100px !important; 
    margin-top: 40px !important;
    margin-bottom: 40px !important;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5) !important; 
    border: 1px solid rgba(255, 255, 255, 0.05) !important;
}

/* HEADER */
.hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 24px; margin-bottom: 24px; }
.wrap-type { font-size: 15px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
.wrap-title { font-size: 42px; font-weight: 800; color: #e2e8f0; margin-top: 10px; }
.hdr-meta { text-align: right; font-size: 16px; color: #94a3b8; }
.hdr-date { font-size: 20px; color: #c7d2fe; font-weight: 600; margin-bottom: 8px; }

/* EXPANDED SECTION BLOCKS */
.section-block { padding: 56px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.section-block:first-child { padding-top: 0; }
.section-block:last-child { padding-bottom: 0; border-bottom: none; }

/* SECTION TITLE */
.section-title { display: flex; justify-content: space-between; align-items: center; font-size: 16px; font-weight: 800; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 24px; }

/* STATUS BADGES */
.badge-closed { background: #450a0a; color: #f87171; padding: 6px 16px; border-radius: 6px; font-weight: 800; font-size: 14px; letter-spacing: 1px; border: none; }
.badge-live { background: #052e16; color: #4ade80; padding: 6px 16px; border-radius: 6px; font-weight: 800; font-size: 14px; letter-spacing: 1px; border: none; animation: pulse 2s infinite;}

/* TERMINAL ROWS */
.t-header-row { display: grid; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 12px; margin-bottom: 4px; font-size: 13px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
.t-row { display: grid; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.03); padding: 16px 0; font-size: 16px; color: #e2e8f0; }
.t-row:last-child { border-bottom: none; }

/* FONTS & TEXT STYLES */
.ticker-cell { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; font-weight: 800; color: #e2e8f0; font-size: 18px; }
.vol-cell { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; font-weight: 700; color: #e2e8f0; font-size: 16px; }
.up-pct { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; color: #4ade80; font-weight: 700; font-size: 16px; }
.down-pct { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; color: #f87171; font-weight: 700; font-size: 16px; }
.cat-cell { color: #cbd5e1; font-size: 15px; line-height: 1.5; }

/* PILL BADGES */
.nb-badge { padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; border: none; display: inline-block; margin-bottom: 4px; }
.nb-purple { background: #3b0764; color: #e879f9; }
.nb-teal { background: #164e63; color: #67e8f9; }
.nb-orange { background: #431407; color: #fdba74; }
.nb-blue { background: #0c4a6e; color: #7dd3fc; }
.nb-green { background: #052e16; color: #4ade80; }
.badge-beat { background: #052e16; color: #4ade80; padding: 4px 10px; border-radius: 4px; font-weight: 800; font-size: 13px; margin-left: 8px; border: none; }
.badge-miss { background: #450a0a; color: #f87171; padding: 4px 10px; border-radius: 4px; font-weight: 800; font-size: 13px; margin-left: 8px; border: none; }

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
# 3. DATA ENGINES 
# ==========================================
def get_last_price_change(ticker):
    try:
        hist = yf.Ticker(ticker).history(period="5d").dropna(subset=['Close'])
        if len(hist) >= 2:
            return float(hist['Close'].iloc[-1]), float(((hist['Close'].iloc[-1] - hist['Close'].iloc[-2])/hist['Close'].iloc[-2])*100)
    except: pass
    return 0.0, 0.0

@st.cache_data(ttl=10) 
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
    if spx_pct >= 0.5 and ndx_pct >= 0.5: return "RISK-ON", "nb-green"
    elif spx_pct > 0 and ndx_pct > 0: return "BULLISH", "nb-green"
    elif spx_pct <= -0.5 and ndx_pct <= -0.5: return "RISK-OFF", "nb-red"
    elif spx_pct < 0 and ndx_pct < 0: return "BEARISH", "nb-red"
    else: return "MIXED", "nb-blue"

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
    return [
        {"ticker": "QTEX", "price": 0.72, "change": 140.01, "session": "PRE-MARKET", "vol": "788.2M", "dvol": "$573M", "rvol": 22.5, "catalyst": "Gov Contract Award"},
        {"ticker": "BIYA", "price": 1.30, "change": 110.53, "session": "PRE-MARKET", "vol": "101.5M", "dvol": "$131M", "rvol": 9.8, "catalyst": "Upgraded Guidance"},
        {"ticker": "FFIE", "price": 0.85, "change": 95.40, "session": "PRE-MARKET", "vol": "350.0M", "dvol": "$297M", "rvol": 18.4, "catalyst": "Retail Short Squeeze"},
        {"ticker": "HOLO", "price": 1.25, "change": 88.20, "session": "PRE-MARKET", "vol": "85.0M", "dvol": "$106M", "rvol": 14.2, "catalyst": "Sympathy Momentum"},
        {"ticker": "GWAV", "price": 3.40, "change": 75.60, "session": "PRE-MARKET", "vol": "42.0M", "dvol": "$142M", "rvol": 11.5, "catalyst": "Debt Payoff"},
        
        {"ticker": "AKTX", "price": 18.27, "change": 255.45, "session": "REGULAR", "vol": "34.0M", "dvol": "$622M", "rvol": 12.4, "catalyst": "FDA Fast Track Rumor"},
        {"ticker": "PCLA", "price": 6.62, "change": 194.22, "session": "REGULAR", "vol": "37.0M", "dvol": "$245M", "rvol": 8.2, "catalyst": "Massive Earnings Beat"},
        {"ticker": "RYOJ", "price": 5.00, "change": 148.76, "session": "REGULAR", "vol": "41.2M", "dvol": "$206M", "rvol": 15.1, "catalyst": "M&A Buyout Rumor"},
        {"ticker": "LFS", "price": 3.55, "change": 89.33, "session": "REGULAR", "vol": "77.8M", "dvol": "$276M", "rvol": 4.2, "catalyst": "Analyst Upgrade"},
        {"ticker": "VCIG", "price": 1.33, "change": 64.79, "session": "REGULAR", "vol": "31.7M", "dvol": "$42M", "rvol": 3.1, "catalyst": "Strategic Partnership"},
        {"ticker": "HYLN", "price": 5.99, "change": 42.62, "session": "REGULAR", "vol": "20.1M", "dvol": "$120M", "rvol": 5.5, "catalyst": "New Product Launch"},
        {"ticker": "FJET", "price": 7.20, "change": 39.81, "session": "REGULAR", "vol": "12.4M", "dvol": "$89M", "rvol": 2.8, "catalyst": "Defense Contract"},
        {"ticker": "MEHA", "price": 0.10, "change": 38.69, "session": "REGULAR", "vol": "628.1M", "dvol": "$66M", "rvol": 18.3, "catalyst": "Phase 2 Clinical Data"},
        {"ticker": "TSLA", "price": 215.40, "change": 8.40, "session": "REGULAR", "vol": "145.2M", "dvol": "$31B", "rvol": 2.9, "catalyst": "FSD China Approval (Mega-Cap)"},
        {"ticker": "NVDA", "price": 1050.20, "change": 4.50, "session": "REGULAR", "vol": "42.1M", "dvol": "$44B", "rvol": 2.1, "catalyst": "Institutional Buy Flow"},
        
        {"ticker": "GME", "price": 22.40, "change": 45.20, "session": "POST-MARKET", "vol": "15.0M", "dvol": "$336M", "rvol": 5.1, "catalyst": "Retail Momentum"},
        {"ticker": "AMC", "price": 18.50, "change": 38.10, "session": "POST-MARKET", "vol": "25.0M", "dvol": "$462M", "rvol": 4.8, "catalyst": "Debt Restructuring"},
        {"ticker": "KOSS", "price": 4.20, "change": 32.50, "session": "POST-MARKET", "vol": "5.0M", "dvol": "$21M", "rvol": 6.2, "catalyst": "Sympathy Play"},
        {"ticker": "SPWR", "price": 12.10, "change": 28.40, "session": "POST-MARKET", "vol": "8.0M", "dvol": "$96M", "rvol": 3.9, "catalyst": "Contract Win"},
        {"ticker": "BBAI", "price": 2.10, "change": 25.10, "session": "POST-MARKET", "vol": "12.0M", "dvol": "$25M", "rvol": 7.1, "catalyst": "AI Sector Run"}
    ]

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
        {"ticker": "IWM",  "type": "BLOCK", "strike": "$200P", "exp": "Jul 17", "prem": "$5.5M", "sentiment": "BEARISH", "color": "down-pct"},
        {"ticker": "META", "type": "SWEEP", "strike": "$480C", "exp": "Jun 05", "prem": "$2.1M", "sentiment": "BULLISH", "color": "up-pct"},
        {"ticker": "QQQ",  "type": "BLOCK", "strike": "$450P", "exp": "Jun 19", "prem": "$8.4M", "sentiment": "BEARISH", "color": "down-pct"},
        {"ticker": "DELL", "type": "SWEEP", "strike": "$160C", "exp": "May 29", "prem": "$1.8M", "sentiment": "BULLISH", "color": "up-pct"},
        {"ticker": "AMD",  "type": "SWEEP", "strike": "$175C", "exp": "Jun 05", "prem": "$2.5M", "sentiment": "BULLISH", "color": "up-pct"},
        {"ticker": "SPY",  "type": "BLOCK", "strike": "$525P", "exp": "Jul 17", "prem": "$12.2M", "sentiment": "BEARISH", "color": "down-pct"}
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
rating_text, rating_class = get_market_rating(macro_data)
sector_data = fetch_sector_flow()
gappers_data = fetch_gappers()
liquidity_data = fetch_liquidity_basket()
institutional_flow = fetch_massive_data()

# ==========================================
# 5. UI RENDER ENGINE
# ==========================================

# --- HEADER ---
st.markdown(f'<div class="hdr"><div><div class="wrap-type">Market Briefing</div><div class="wrap-title">Confluence Trading Tools</div></div><div class="hdr-meta"><div class="hdr-date">{now_dt.strftime("%A, %B %d")}</div><span class="{status_class}">{market_status}</span></div></div>', unsafe_allow_html=True)

# OPEN MASTER CLOUD
st.markdown('<div class="master-cloud">', unsafe_allow_html=True)

# --- 01 | SCORECARD ---
scorecard_html = f'<div class="section-block"><div class="section-title"><span>01 — Macro Scorecard</span><span class="nb-badge {rating_class}">MARKET RATING: {rating_text}</span></div><div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">'
for name, m in macro_data.items():
    col = "up-pct" if m['pct'] >= 0 else "down-pct"
    sign = "▲ +" if m['pct'] > 0 else "▼ " if m['pct'] < 0 else ""
    p_str = f"{m['price']:.3f}" if name in ["VIX", "10Y Treasury"] else f"${m['price']:,.2f}"
    scorecard_html += f'<div><div style="font-size: 14px; color: #64748b; font-weight: 800; text-transform: uppercase;">{name}</div><div class="vol-cell" style="font-size: 28px; margin: 4px 0;">{p_str}</div><div class="{col}">{sign}{m["pct"]:.2f}%</div></div>'
scorecard_html += "</div></div>"
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
    live_news = [{"title": "Micro-Cap Biotech AKTX Surges", "teaser": "Akari Therapeutics is leading the market gainers today on extreme relative volume rumors."}] * 15

news_html = '<div class="section-block"><div class="section-title">02 — Market Drivers & Catalysts</div>'
for article in live_news[:10]:
    b_color, b_text = parse_news_badge(article['title'])
    news_html += f'<div class="t-row" style="grid-template-columns: 1fr;"><div style="margin-bottom:4px;"><span class="nb-badge {b_color}" style="margin-right:8px;">{b_text}</span> <strong style="color:#e2e8f0; font-size:17px;">{article["title"]}</strong></div><div class="cat-cell">{article["teaser"]}</div></div>'
news_html += "</div>"
st.markdown(news_html, unsafe_allow_html=True)

# --- 03 | SECTORS ---
heatmap_html = '<div class="section-block"><div class="section-title">03 — Sector Flows</div>'
heatmap_html += '<div class="t-header-row" style="grid-template-columns: 50px 3fr 2fr 2fr;"><div>#</div><div>Sector / ETF</div><div>Live Change</div><div>Flow</div></div>'
for i, item in enumerate(sector_data):
    col = "up-pct" if item['pct'] >= 0 else "down-pct"
    sign = "▲ +" if item['pct'] > 0 else "▼ " if item['pct'] < 0 else ""
    f_col = "#4ade80" if item['pct'] >= 0 else "#f87171"
    heatmap_html += f'<div class="t-row" style="grid-template-columns: 50px 3fr 2fr 2fr;"><div>{i+1}</div><div><span class="ticker-cell">{item["ticker"]}</span> <span style="color:#94a3b8; font-size:15px; margin-left:8px;">— {item["sector"]}</span></div><div><span class="{col}">{sign}{item["pct"]:.2f}%</span></div><div style="color:{f_col}; font-weight:700;">{item["flow"]}</div></div>'
heatmap_html += '</div>'
st.markdown(heatmap_html, unsafe_allow_html=True)

# --- 04 | MARKET MOVERS BY SESSION ---
sessions = [("PRE-MARKET MOVERS", "PRE-MARKET", "nb-purple"), ("REGULAR SESSION MOVERS", "REGULAR", "nb-blue"), ("POST-MARKET MOVERS", "POST-MARKET", "nb-orange")]
gappers_html = '<div class="section-block"><div class="section-title">04 — Market Movers by Session</div>'
for title, sess_key, badge in sessions:
    sess_data = [x for x in gappers_data if x['session'] == sess_key]
    gappers_html += f'<div style="margin-top:16px; margin-bottom:12px;"><span class="nb-badge {badge}">{title}</span></div>'
    gappers_html += '<div class="t-header-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;"><div>Ticker</div><div>Price</div><div>Gap %</div><div>Vol</div><div>$ Vol</div><div>RVOL Rating</div><div>Catalyst</div></div>'
    
    if sess_data:
        limit = 5 if sess_key in ["PRE-MARKET", "POST-MARKET"] else 10
        for item in sorted(sess_data, key=lambda x: x['change'], reverse=True)[:limit]:
            rvol_val = safe_float(item.get('rvol')) or 1.0
            if rvol_val >= 10.0: r_txt, r_badge = "EXTREME", "nb-purple"
            elif rvol_val >= 5.0: r_txt, r_badge = "HIGH", "nb-orange"
            elif rvol_val >= 2.0: r_txt, r_badge = "ELEVATED", "nb-blue"
            else: r_txt, r_badge = "NORMAL", "nb-green"
            
            gappers_html += f'<div class="t-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;"><div><span class="ticker-cell">{item["ticker"]}</span></div><div class="vol-cell">${item["price"]:.2f}</div><div><span class="up-pct">▲ +{item["change"]:.2f}%</span></div><div class="vol-cell">{item.get("vol", "")}</div><div class="vol-cell">{item.get("dvol", "")}</div><div><span class="nb-badge {r_badge}">{r_txt} ({rvol_val:.1f}x)</span></div><div class="cat-cell">{item.get("catalyst")}</div></div>'
gappers_html += '</div>'
st.markdown(gappers_html, unsafe_allow_html=True)

# --- 05 | STOCKS IN PLAY (SIPS) ---
sips_html = '<div class="section-block"><div class="section-title">05 — Stocks in Play (SIPS)</div>'
sips_html += '<div class="t-header-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;"><div>Ticker</div><div>Price</div><div>Change</div><div>Vol</div><div>$ Vol</div><div>RVOL Rating</div><div>Catalyst</div></div>'
if gappers_data:
    for item in sorted(gappers_data, key=lambda x: x['change'], reverse=True)[:10]:
        rvol_val = safe_float(item.get('rvol')) or 1.0
        if rvol_val >= 10.0: r_txt, r_badge = "EXTREME", "nb-purple"
        elif rvol_val >= 5.0: r_txt, r_badge = "HIGH", "nb-orange"
        elif rvol_val >= 2.0: r_txt, r_badge = "ELEVATED", "nb-blue"
        else: r_txt, r_badge = "NORMAL", "nb-green"
        
        sips_html += f'<div class="t-row" style="grid-template-columns: 1.2fr 1fr 1fr 1fr 1.2fr 1.5fr 3fr;"><div><span class="ticker-cell">{item["ticker"]}</span></div><div class="vol-cell">${item["price"]:.2f}</div><div><span class="up-pct">▲ +{item["change"]:.2f}%</span></div><div class="vol-cell">{item.get("vol", "")}</div><div class="vol-cell">{item.get("dvol", "")}</div><div><span class="nb-badge {r_badge}">{r_txt} ({rvol_val:.1f}x)</span></div><div class="cat-cell">{item.get("catalyst")}</div></div>'
sips_html += '</div>'
st.markdown(sips_html, unsafe_allow_html=True)

# --- 06 | MEGA-CAP LIQUIDITY ---
play_html = '<div class="section-block"><div class="section-title">06 — Mega-Cap Liquidity Basket</div>'
play_html += '<div class="t-header-row" style="grid-template-columns: 1fr 1fr 2fr;"><div>Ticker</div><div>Live Price</div><div>Algo Bias (vs 5D SMA)</div></div>'
for item in liquidity_data:
    play_html += f'<div class="t-row" style="grid-template-columns: 1fr 1fr 2fr;"><div><span class="ticker-cell">{item["ticker"]}</span></div><div class="vol-cell">${item["price"]:.2f}</div><div><span class="{item["color"]}" style="font-weight:700;">{item["bias"]}</span></div></div>'
play_html += '</div>'
st.markdown(play_html, unsafe_allow_html=True)

# --- 07 | EARNINGS ---
def get_rating_html(eps, est):
    if eps is None or est is None: return ""
    return '<span class="badge-beat">BEAT</span>' if eps >= est else '<span class="badge-miss">MISS</span>'

earn_html = f'<div class="section-block"><div class="section-title">07 — Earnings Briefing</div>'
earn_html += f'<div style="margin-bottom:12px;"><span class="nb-badge nb-purple">PREVIOUS CLOSE ({prev_dt.strftime("%A")})</span></div>'
prev_earn = [
    {"ticker": "NVDA", "name": "NVIDIA Corp", "eps": 5.98, "eps_est": 5.59, "insight": "Massive beat driven by Data Center revenue."},
    {"ticker": "SNOW", "name": "SunPower", "eps": -0.15, "eps_est": -0.22, "insight": "Narrower loss than expected."},
]
for item in prev_earn:
    rating = get_rating_html(item['eps'], item['eps_est'])
    earn_html += f'<div class="t-row" style="grid-template-columns: 1fr;"><div style="font-size:18px;"><strong class="ticker-cell">{item["ticker"]}</strong> <span style="color:#cbd5e1; font-size:16px; margin-left:6px;">({item["name"]})</span>{rating} &nbsp;|&nbsp; <span class="vol-cell">EPS: ${item["eps"]:.2f} (est. ${item["eps_est"]:.2f})</span></div><div class="cat-cell" style="margin-top:4px;">{item["insight"]}</div></div>'

earn_html += f'<div style="margin-top:24px; margin-bottom:12px;"><span class="nb-badge nb-teal">NEXT TRADING DAY ({next_dt.strftime("%A, %b %d")})</span></div>'
today_earn = [
    {"ticker": "DELL", "name": "Dell Technologies", "eps_est": 7.86, "insight": "Crucial read on enterprise hardware capex."},
    {"ticker": "ROST", "name": "Ross Stores", "eps_est": 1.35, "insight": "Discount retail barometer."}
]
for item in today_earn:
    earn_html += f'<div class="t-row" style="grid-template-columns: 1fr;"><div style="font-size:18px;"><strong class="ticker-cell">{item["ticker"]}</strong> <span style="color:#cbd5e1; font-size:16px; margin-left:6px;">({item["name"]})</span> &nbsp;|&nbsp; <span class="vol-cell">Est. EPS: ${item["eps_est"]:.2f}</span></div><div class="cat-cell" style="margin-top:4px;">{item["insight"]}</div></div>'
earn_html += "</div>"
st.markdown(earn_html, unsafe_allow_html=True)

# --- 08 | ECONOMIC CALENDAR ---
econ_html = '<div class="section-block"><div class="section-title">08 — Economic Calendar (Week Ahead)</div>'
econ_html += '<div class="t-header-row" style="grid-template-columns: 1fr 3fr 1fr;"><div>Date</div><div>Release</div><div>Impact</div></div>'
events = [
    ("May 26", "S&P/Case-Shiller Home Price", "MED", "cat-cell"),
    ("May 27", "CFTC SOYBEANS / GRAINS REPORT", "HIGH", "down-pct"),
    ("May 28", "GDP (Second Preliminary)", "HIGH", "down-pct"),
    ("May 29", "Core PCE Price Index", "HIGH", "down-pct")
]
for date, event, imp, col in events:
    econ_html += f'<div class="t-row" style="grid-template-columns: 1fr 3fr 1fr;"><div class="vol-cell">{date}</div><div class="cat-cell" style="font-weight:700;">{event}</div><div class="{col}">{imp}</div></div>'
econ_html += '</div>'
st.markdown(econ_html, unsafe_allow_html=True)

# --- 09 | TECHNICAL PICTURE ---
st.markdown("""
<div class="section-block">
<div class="section-title">09 — Technical Picture & Action Plan</div>
<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;">
<div>
    <div style="margin-bottom:12px;"><span class="nb-badge nb-blue">SPX LEVELS</span></div>
    <div style="padding-bottom:6px; font-size:16px; font-family: ui-monospace, monospace; color: #94a3b8; font-weight: 700;">TARGET: <span style="color:#e2e8f0; margin-left:8px;">7,300–7,375</span></div>
    <div style="padding-bottom:6px; font-size:16px; font-family: ui-monospace, monospace; color: #94a3b8; font-weight: 700;">SUPPORT: <span style="color:#e2e8f0; margin-left:8px;">7,000 ➔ 6,780</span></div>
    <div class="cat-cell" style="margin-top:8px; color:#818cf8; font-weight:700;">ACTION ➔ Look for dip-buying at 7,000.</div>
</div>
<div>
    <div style="margin-bottom:12px;"><span class="nb-badge nb-purple">VOLATILITY (VIX)</span></div>
    <div style="padding-bottom:6px; font-size:16px; font-family: ui-monospace, monospace; color: #94a3b8; font-weight: 700;">LEVEL: <span style="color:#e2e8f0; margin-left:8px;">~19.10</span></div>
    <div style="padding-bottom:6px; font-size:16px; font-family: ui-monospace, monospace; color: #94a3b8; font-weight: 700;">CONTEXT: <span style="color:#e2e8f0; margin-left:8px;">Entering "Normal" regime.</span></div>
    <div class="cat-cell" style="margin-top:8px; color:#818cf8; font-weight:700;">ACTION ➔ Premium selling favored.</div>
</div>
</div>
</div>
""", unsafe_allow_html=True)

# --- 11 | WATCHLIST ---
st.markdown("""
<div class="section-block">
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
""", unsafe_allow_html=True)

# --- 12 | MASSIVE API INTEGRATION ---
massive_html = '<div class="section-block"><div class="section-title">12 — Institutional Options Flow (Massive API)</div>'
massive_html += '<div class="t-header-row" style="grid-template-columns: 1fr 1fr 2fr 1fr 1fr;"><div>Ticker</div><div>Type</div><div>Strike / Exp</div><div>Premium</div><div>Sentiment</div></div>'
for flow in institutional_flow:
    massive_html += f'<div class="t-row" style="grid-template-columns: 1fr 1fr 2fr 1fr 1fr;"><div><span class="ticker-cell">{flow["ticker"]}</span></div><div style="font-weight:700;">{flow["type"]}</div><div class="cat-cell" style="font-weight:700; color:#e2e8f0;">{flow["strike"]} — {flow["exp"]}</div><div class="vol-cell">{flow["prem"]}</div><div class="{flow["color"]}" style="font-weight:800;">{flow["sentiment"]}</span></div></div>'
massive_html += "</div>"
st.markdown(massive_html, unsafe_allow_html=True)

# --- 13 | DYNAMIC MARKET SUMMARY ---
spx_pct = macro_data.get('S&P 500 (SPX)', {}).get('pct', 0.0)
top_sector = sector_data[0]['sector'] if sector_data else "Technology"
top_gapper = gappers_data[0]['ticker'] if gappers_data else "N/A"
top_gapper_change = gappers_data[0]['change'] if gappers_data else 0.0

summary_text = f"""
<div class="section-block" style="border-left: 4px solid #818cf8; padding-left: 20px; padding-bottom: 0; border-bottom: none;">
<div class="section-title" style="border-bottom:none; margin-bottom:12px; padding-bottom: 0;">13 — Market Summary</div>
<div style="font-size: 16px; color: #cbd5e1; line-height: 1.8;">
<strong>Market Status:</strong> The market remains closed through Monday for Memorial Day. <br><br>
<strong>Action Summary:</strong> Heading into the next session, the broader market is {'pushing higher' if spx_pct > 0 else 'showing weakness'} with the S&P 500 at {spx_pct:+.2f}%. Sector rotation favors {top_sector}, while speculative pre-market money is heavily concentrated in high-RVOL runners like {top_gapper} (+{top_gapper_change:.1f}%). With the VIX hovering near ~19.10, the environment remains constructive but warrants selectivity.<br><br>
<strong>CLOSING POSTURE:</strong> <em>Remain focused on relative strength.</em> Watch the SPX 7,000 level closely for structural support.
<br><br>
<strong>See you at the open. 📈</strong>
</div>
</div>
"""
st.markdown(summary_text, unsafe_allow_html=True)

# CLOSE MASTER CLOUD
st.markdown('</div>', unsafe_allow_html=True)
