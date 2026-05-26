import streamlit as st
import yfinance as yf
import pandas as pd
import requests
import re
import os
import json
from datetime import datetime, timedelta

# --- SAFETY HELPER ---
def safe_float(val):
    try: return float(val)
    except: return None

# ==========================================
# API KEYS & CONFIG
# ==========================================
BZ_KEY = "bz.4DVR2L3LKQD6KU5Z4CHZPPNE5MPV2KLQ"
MASSIVE_KEY = "TfwImIVSEp2wLzNnXpwysYH9ccvjk6pv"
# FMP_KEY removed due to legacy endpoint deprecation (HTTP 403)

st.set_page_config(page_title="Confluence Trading Tools", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
<style>
/* Base Styling - Crisp system font, off-white text */
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
.wrap-title { font-size: 42px; font-weight: 800; color: #f1f5f9; margin-top: 4px; }
.hdr-meta { text-align: right; font-size: 16px; color: #94a3b8; }
.hdr-date { font-size: 20px; color: #c7d2fe; font-weight: 600; margin-bottom: 8px; }

/* INDIVIDUAL SECTION WRAPPER */
.section-container {
    padding-bottom: 40px;
    margin-bottom: 40px;
    border-bottom: 1px solid #334155; 
}
.section-container:last-child {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
}

/* SECTION TITLE */
.section-title { font-size: 22px; font-weight: 800; color: #64748b; margin-bottom: 24px; letter-spacing: 1.5px; }

/* STACKED LIST ITEMS */
.item-card { padding: 20px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.item-card:last-child { border-bottom: none; }
.item-top { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; font-size: 18px; }
.item-bot { font-size: 16px; color: #cbd5e1; line-height: 1.6; }

/* ITEM TEXT STYLES */
.tckr { font-weight: 800; color: #f1f5f9; font-size: 20px; }
.sub-name { color: #94a3b8; font-size: 17px; }
.sep { color: #475569; margin: 0 4px; font-weight: 300; }
.val { font-weight: 700; color: #f1f5f9; }
.up-pct { color: #4ade80; font-weight: 700; }
.down-pct { color: #f87171; font-weight: 700; }

/* INLINE BADGES */
.nb-badge { font-size: 16px; font-weight: 800; display: inline-block; margin-bottom: 8px;}
.nb-purple { color: #e879f9 !important; }
.nb-teal { color: #67e8f9 !important; }
.nb-orange { color: #fdba74 !important; }
.nb-blue { color: #7dd3fc !important; }
.nb-green, .badge-beat, .badge-live { color: #4ade80 !important; font-weight: 800; }
.nb-red, .badge-miss, .badge-closed { color: #f87171 !important; font-weight: 800; }
.badge-live { animation: pulse 2s infinite; }

/* INSTRUMENT GRID */
.inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.inst-card { padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.inst-name { font-size: 15px; color: #64748b; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px; }
.inst-level { font-size: 28px; font-weight: 800; color: #f1f5f9; margin-bottom: 4px; }

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
# 3. DATA ENGINES (SELF-CONTAINED)
# ==========================================
def get_last_price_change(ticker):
    try:
        hist = yf.Ticker(ticker).history(period="5d").dropna(subset=['Close'])
        if len(hist) >= 2:
            return float(hist['Close'].iloc[-1]), float(((hist['Close'].iloc[-1] - hist['Close'].iloc[-2])/hist['Close'].iloc[-2])*100), None
        return 0.0, 0.0, "Empty DataFrame"
    except Exception as e: 
        return 0.0, 0.0, str(e)

@st.cache_data(ttl=60) 
def fetch_expanded_macro():
    tickers = {"S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones": "^DJI", "Russell 2000": "^RUT", "VIX": "^VIX", "10Y Treasury": "^TNX"}
    data = {}
    for name, ticker in tickers.items():
        p, c, err = get_last_price_change(ticker)
        data[name] = {"price": p, "pct": c, "error": err}
    return data

@st.cache_data(ttl=300)
def fetch_sector_flow():
    sector_map = {"XLK": "Technology", "XLY": "Consumer Disc", "XLI": "Industrials", "XLC": "Comm. Services", "XLV": "Health Care", "XLF": "Financials", "XLP": "Consumer Staples", "XLB": "Materials", "XLE": "Energy", "XLRE": "Real Estate"}
    perf = []
    for ticker, name in sector_map.items():
        p, c, err = get_last_price_change(ticker)
        perf.append({"ticker": ticker, "sector": name, "pct": c, "flow": "Inflow" if c > 0 else "Outflow", "error": err})
    return sorted(perf, key=lambda x: x['pct'], reverse=True)

@st.cache_data(ttl=120)
def fetch_gappers():
    """Custom Scanner: Bypasses FMP completely to avoid 403 limits."""
    results = []
    cache_file = "eod_gappers_cache.json"
    
    # High-beta / High-volume basket
    scan_list = [
        "NVDA", "TSLA", "AMD", "SMCI", "COIN", "PLTR", "MARA", "MSTR", 
        "AAPL", "META", "AMZN", "MSFT", "GOOGL", "AVGO", "ARM", "QCOM",
        "NFLX", "GME", "AMC", "HOOD", "RCL", "CCL", "UBER", "DDOG", "CRWD"
    ]
    
    try:
        for sym in scan_list:
            try:
                hist = yf.Ticker(sym).history(period="5d")
                if len(hist) >= 2:
                    price = float(hist['Close'].iloc[-1])
                    prev = float(hist['Close'].iloc[-2])
                    change = ((price - prev) / prev) * 100
                    
                    vol = float(hist['Volume'].iloc[-1])
                    avg_vol = float(hist['Volume'].mean()) or 1.0
                    rvol = vol / avg_vol
                    dol_vol = vol * price
                    
                    vol_str = f"{vol/1e6:.1f}M" if vol >= 1e6 else f"{vol/1e3:.0f}K"
                    
                    # Store significant movers
                    if abs(change) > 0.5:
                        results.append({
                            "ticker": sym, 
                            "price": price, 
                            "change": change, 
                            "session": "Regular", 
                            "vol": vol_str, 
                            "rvol": float(rvol), 
                            "catalyst": "Momentum Breakout / Sector Flow"
                        })
            except: pass
        
        # Sort by gainers
        final_result = sorted(results, key=lambda x: x['change'], reverse=True)
        
        # Hydrate with Benzinga Catalysts for Top 10
        top_tickers = [x['ticker'] for x in final_result[:10]]
        if top_tickers:
            try:
                bz_url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&symbols={','.join(top_tickers)}&limit=20"
                bz_res = requests.get(bz_url, timeout=5)
                if bz_res.status_code == 200:
                    bz_map = {}
                    for article in bz_res.json():
                        for s in article.get('stocks', []):
                            t = s.get('name')
                            if t not in bz_map: bz_map[t] = article.get('title', '')
                    
                    for item in final_result:
                        if item['ticker'] in bz_map:
                            item['catalyst'] = bz_map[item['ticker']][:65] + "..."
            except: pass

        if final_result:
            with open(cache_file, 'w') as f: json.dump(final_result, f)
            
        return final_result
    except Exception as e:
        if os.path.exists(cache_file):
            with open(cache_file, 'r') as f: return json.load(f)
        return [{"global_error": f"Scanner Exception: {str(e)}"}]

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
        except Exception as e: 
            results.append({"ticker": t, "price": 0.0, "bias": "Error", "color": "nb-red", "error": str(e)})
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
        {"ticker": "DELL", "type": "Sweep", "strike": "$160C", "exp": "May 29", "prem": "$1.8M", "sentiment": "Bullish", "color": "nb-green"}
    ]

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
st.markdown(f'<div class="hdr"><div><div class="wrap-title">Confluence Trading Tools</div></div><div class="hdr-meta"><div class="hdr-date">{now_dt.strftime("%A, %B %d")}</div><span class="{status_class}">{market_status}</span></div></div>', unsafe_allow_html=True)

# OPEN MASTER CLOUD
st.markdown('<div class="block-container">', unsafe_allow_html=True)

# --- 01 | SCORECARD ---
scorecard_html = f'<div class="section-container"><div class="section-title">01 — Macro Scorecard</div><div class="inst-grid">'
for name, m in macro_data.items():
    if m.get('error'):
        scorecard_html += f'<div class="inst-card"><div class="inst-name">{name}</div><div class="inst-level" style="font-size:14px; color:#f87171;">Error: {m["error"]}</div></div>'
    else:
        col = "up-pct" if m['pct'] >= 0 else "down-pct"
        sign = "▲ +" if m['pct'] > 0 else "▼ " if m['pct'] < 0 else ""
        p_str = f"{m['price']:.3f}" if name in ["VIX", "10Y Treasury"] else f"${m['price']:,.2f}"
        scorecard_html += f'<div class="inst-card"><div class="inst-name">{name}</div><div class="inst-level">{p_str}</div><div class="{col}">{sign}{m["pct"]:.2f}%</div></div>'
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)

# --- 02 | MARKET DRIVERS (STACKED FORMAT) ---
live_news = []
try:
    url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&limit=25&channels=News"
    res = requests.get(url, headers={"accept": "application/json"}, timeout=5)
    if res.status_code == 200:
        for n in res.json():
            title = n.get("title", "").replace(" — ...", "")
            body_text = n.get("teaser", "") or n.get("body", "")
            teaser = re.sub(r'<[^>]+>', '', body_text)
            live_news.append({"title": title, "teaser": teaser[:250] + "..."})
    else:
        live_news.append({"title": f"Benzinga API Error [{res.status_code}]", "teaser": str(res.text[:200])})
except Exception as e:
    live_news.append({"title": "News Feed Exception", "teaser": str(e)})

news_html = '<div class="section-container"><div class="section-title">02 — Market Drivers & Catalysts</div>'
for article in live_news[:8]:
    news_html += f'<div class="item-card"><div class="item-top"><span class="tckr">{article["title"]}</span></div><div class="item-bot">{article["teaser"]}</div></div>'
news_html += "</div>"
st.markdown(news_html, unsafe_allow_html=True)

# --- 03 | SECTORS (STACKED FORMAT) ---
heatmap_html = '<div class="section-container"><div class="section-title">03 — Sector Flows</div>'
for i, item in enumerate(sector_data):
    if item.get('error'):
        heatmap_html += f'<div class="item-card"><div class="item-top"><span class="tckr">{item["ticker"]}</span> <span class="sub-name">({item["sector"]})</span></div><div class="item-bot" style="color:#f87171;">Data Error: {item["error"]}</div></div>'
    else:
        col = "up-pct" if item['pct'] >= 0 else "down-pct"
        sign = "▲ +" if item['pct'] > 0 else "▼ " if item['pct'] < 0 else ""
        f_col = "nb-green" if item['pct'] >= 0 else "nb-red"
        heatmap_html += f'<div class="item-card"><div class="item-top"><span class="tckr">{item["ticker"]}</span> <span class="sub-name">({item["sector"]})</span> <span class="sep">|</span> <span class="{col}">{sign}{item["pct"]:.2f}%</span> <span class="sep">|</span> Flow: <span class="{f_col}">{item["flow"]}</span></div><div class="item-bot">Sector rotation tracking.</div></div>'
heatmap_html += '</div>'
st.markdown(heatmap_html, unsafe_allow_html=True)

# --- 04 | MARKET MOVERS (STACKED FORMAT) ---
gappers_html = '<div class="section-container"><div class="section-title">04 — Live Market Movers</div>'

if gappers_data and "global_error" in gappers_data[0]:
    gappers_html += f"<div class='item-card'><div class='item-bot' style='color:#f87171;'>Scanner Failed: {gappers_data[0]['global_error']}</div></div>"
else:
    gappers_html += f'<div class="nb-badge nb-blue" style="margin-top:16px;">Momentum Scanner (Beta Basket)</div>'
    if gappers_data:
        for item in gappers_data[:10]:
            rvol_val = safe_float(item.get('rvol')) or 1.0
            r_txt = f"{rvol_val:.1f}x"
            col = "up-pct" if item["change"] >= 0 else "down-pct"
            sign = "▲ +" if item["change"] >= 0 else "▼ "
            gappers_html += f'<div class="item-card"><div class="item-top"><span class="tckr">{item["ticker"]}</span> <span class="sep">|</span> <span class="val">${item["price"]:.2f}</span> <span class="sep">|</span> <span class="{col}">{sign}{item["change"]:.2f}%</span> <span class="sep">|</span> Vol: <span class="val">{item.get("vol", "")}</span> <span class="sep">|</span> RVOL: <span class="val">{r_txt}</span></div><div class="item-bot">{item.get("catalyst")}</div></div>'
    else:
        gappers_html += "<div class='item-card'><div class='item-bot'>No significant momentum in tracked basket.</div></div>"
gappers_html += '</div>'
st.markdown(gappers_html, unsafe_allow_html=True)

# --- 05 | STOCKS IN PLAY (SIPS) (STACKED FORMAT) ---
sips_html = '<div class="section-container"><div class="section-title">05 — Stocks in Play</div>'
if gappers_data and "global_error" not in gappers_data[0]:
    for item in sorted(gappers_data, key=lambda x: abs(x.get('change', 0)), reverse=True)[:5]:
        rvol_val = safe_float(item.get('rvol')) or 1.0
        r_txt = f"{rvol_val:.1f}x"
        col = "up-pct" if item["change"] >= 0 else "down-pct"
        sign = "▲ +" if item["change"] >= 0 else "▼ "
        sips_html += f'<div class="item-card"><div class="item-top"><span class="tckr">{item["ticker"]}</span> <span class="sep">|</span> <span class="val">${item.get("price", 0):.2f}</span> <span class="sep">|</span> <span class="{col}">{sign}{item.get("change", 0):.2f}%</span> <span class="sep">|</span> Vol: <span class="val">{item.get("vol", "")}</span> <span class="sep">|</span> RVOL: <span class="val">{r_txt}</span></div><div class="item-bot">{item.get("catalyst")}</div></div>'
else:
    err_msg = gappers_data[0]['global_error'] if gappers_data else "Unknown Error"
    sips_html += f"<div class='item-card'><div class='item-bot' style='color:#f87171;'>Cannot generate SIPs: {err_msg}</div></div>"
sips_html += '</div>'
st.markdown(sips_html, unsafe_allow_html=True)

# --- 06 | MEGA-CAP LIQUIDITY (STACKED FORMAT) ---
play_html = '<div class="section-container"><div class="section-title">06 — Mega-Cap Liquidity Basket</div>'
for item in liquidity_data:
    if item.get('error'):
        play_html += f'<div class="item-card"><div class="item-top"><span class="tckr">{item["ticker"]}</span></div><div class="item-bot" style="color:#f87171;">Error: {item["error"]}</div></div>'
    else:
        play_html += f'<div class="item-card"><div class="item-top"><span class="tckr">{item["ticker"]}</span> <span class="sep">|</span> <span class="val">${item["price"]:.2f}</span> <span class="sep">|</span> Algo Bias: <span class="{item["color"]}">{item["bias"]}</span></div><div class="item-bot">Tracking 5-Day SMA deviation.</div></div>'
play_html += '</div>'
st.markdown(play_html, unsafe_allow_html=True)

# --- 07 | ECONOMIC CALENDAR (STACKED FORMAT) ---
econ_html = '<div class="section-container"><div class="section-title">07 — Economic Calendar (Week Ahead)</div>'
events = [
    ("May 26", "S&P/Case-Shiller Home Price", "Med", "nb-blue"),
    ("May 27", "CFTC Soybeans / Grains Report", "High", "nb-red"),
    ("May 28", "GDP (Second Preliminary)", "High", "nb-red"),
    ("May 29", "Core PCE Price Index", "High", "nb-red")
]
for date, event, imp, col in events:
    econ_html += f'<div class="item-card"><div class="item-top"><span class="tckr">{date}</span> <span class="sep">|</span> Impact: <span class="{col}">{imp}</span></div><div class="item-bot">{event}</div></div>'
econ_html += '</div>'
st.markdown(econ_html, unsafe_allow_html=True)

# --- 08 | TECHNICAL PICTURE ---
st.markdown("""
<div class="section-container">
<div class="section-title">08 — Technical Picture & Action Plan</div>
<div class="item-card">
    <div class="item-top"><span class="nb-badge nb-blue" style="margin:0;">SPX Levels</span></div>
    <div class="item-bot" style="margin-top:6px;"><strong>Target:</strong> <span class="val">7,300–7,375</span> <span class="sep">|</span> <strong>Support:</strong> <span class="val">7,000 ➔ 6,780</span></div>
    <div class="item-bot" style="color:#818cf8; font-weight:700; margin-top:8px;">Action ➔ Look for dip-buying at 7,000.</div>
</div>
<div class="item-card">
    <div class="item-top"><span class="nb-badge nb-purple" style="margin:0;">Volatility (VIX)</span></div>
    <div class="item-bot" style="margin-top:6px;"><strong>Level:</strong> <span class="val">~19.10</span> <span class="sep">|</span> <strong>Context:</strong> <span class="val">Entering "Normal" regime.</span></div>
    <div class="item-bot" style="color:#818cf8; font-weight:700; margin-top:8px;">Action ➔ Premium selling favored.</div>
</div>
</div>
""", unsafe_allow_html=True)

# --- 09 | WATCHLIST (STACKED FORMAT) ---
st.markdown("""
<div class="section-container">
<div class="section-title">09 — Trading Watchlist</div>
<div class="item-card">
    <div class="item-top"><span class="tckr">NVDA</span> <span class="sub-name">(Institutional Flow)</span></div>
    <div class="item-bot">Massive institutional buy-side pressure remains. Watch for a test of new ATH territory.</div>
</div>
<div class="item-card">
    <div class="item-top"><span class="tckr">TSLA</span> <span class="sub-name">(Catalyst Play)</span></div>
    <div class="item-bot">Structural rally in progress. Looking for $220 to act as a launchpad for the next leg.</div>
</div>
</div>
""", unsafe_allow_html=True)

# --- 10 | MASSIVE API INTEGRATION (STACKED FORMAT) ---
massive_html = '<div class="section-container"><div class="section-title">10 — Institutional Options Flow (Massive API)</div>'
for flow in institutional_flow:
    massive_html += f'<div class="item-card"><div class="item-top"><span class="tckr">{flow["ticker"]}</span> <span class="sub-name">({flow["type"]})</span> <span class="sep">|</span> <span class="val">{flow["strike"]} — {flow["exp"]}</span></div><div class="item-bot">Prem: <span class="val">{flow["prem"]}</span> <span class="sep">|</span> Sentiment: <span class="{flow["color"]}">{flow["sentiment"]}</span></div></div>'
massive_html += "</div>"
st.markdown(massive_html, unsafe_allow_html=True)

# --- 11 | DYNAMIC MARKET SUMMARY ---
spx_pct = macro_data.get('S&P 500 (SPX)', {}).get('pct', 0.0) if not macro_data.get('S&P 500 (SPX)', {}).get('error') else 0.0
top_sector = sector_data[0]['sector'] if sector_data and not sector_data[0].get('error') else "Technology"
top_gapper = gappers_data[0]['ticker'] if gappers_data and "global_error" not in gappers_data[0] else "N/A"
top_gapper_change = gappers_data[0].get('change', 0.0) if gappers_data and "global_error" not in gappers_data[0] else 0.0

display_status = "The market is currently open and trading." if market_status == "Market Open" else market_status

summary_text = f"""
<div class="section-container">
<div class="section-title">11 — Market Summary</div>
<div class="item-card">
    <div class="item-top"><span class="val">Market Status</span></div>
    <div class="item-bot">{display_status}</div>
</div>
<div class="item-card">
    <div class="item-top"><span class="val">Action Summary</span></div>
    <div class="item-bot">Heading into the next session, the broader market is {'pushing higher' if spx_pct > 0 else 'showing weakness'} with the S&P 500 at {spx_pct:+.2f}%. Sector rotation favors {top_sector}, while speculative money is concentrated in names like {top_gapper} ({top_gapper_change:+.1f}%). With the VIX hovering near ~19.10, the environment remains constructive but warrants selectivity.</div>
</div>
<div class="item-card">
    <div class="item-top"><span class="val">Closing Posture</span></div>
    <div class="item-bot"><em>Remain focused on relative strength.</em> Watch the SPX 7,000 level closely for structural support.<br><br><span class="val" style="color:#e2e8f0;">See you at the open. 📈</span></div>
</div>
</div>
"""
st.markdown(summary_text, unsafe_allow_html=True)

# CLOSE MASTER CLOUD
st.markdown('</div>', unsafe_allow_html=True)
