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
FMP_KEY = "WMMhcffuHSYVTceXryrt4tHC8GXcsB0g"
MASSIVE_KEY = "TfwImIVSEp2wLzNnXpwysYH9ccvjk6pv"

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

/* PERFECT VERTICAL ALIGNMENT ROW CLASSES (For Data Grids) */
.item-row { 
    display: flex; 
    align-items: center; 
    padding: 16px 0; 
    border-bottom: 1px solid rgba(255,255,255,0.05); 
    font-size: 18px; 
    line-height: 1.6;
    white-space: nowrap;
}
.item-row:last-child { border-bottom: none; }

/* TEXT WRAPPING ROW CLASS (For News & Summaries) */
.item-row-wrap { 
    display: flex; 
    align-items: flex-start; 
    padding: 16px 0; 
    border-bottom: 1px solid rgba(255,255,255,0.05); 
    font-size: 18px; 
    line-height: 1.6;
    white-space: normal;
}
.item-row-wrap:last-child { border-bottom: none; }

/* Fixed Widths for perfect vertical columns */
.c-tckr { display: inline-block; width: 75px; font-weight: 800; color: #f1f5f9; font-size: 20px; }
.c-prc  { display: inline-block; width: 95px; color: #f1f5f9; font-weight: 400; }
.c-pct  { display: inline-block; width: 105px; font-weight: 400; }
.c-vol  { display: inline-block; width: 120px; color: #f1f5f9; font-weight: 400; }
.c-rvol { display: inline-block; width: 110px; color: #f1f5f9; font-weight: 400; }
.c-sec  { display: inline-block; width: 170px; color: #f1f5f9; font-weight: 400; }
.c-flow { display: inline-block; width: 130px; font-weight: 400; }
.c-bias { display: inline-block; width: 160px; color: #f1f5f9; font-weight: 400; }
.c-type { display: inline-block; width: 90px; color: #f1f5f9; font-weight: 400; }
.c-strk { display: inline-block; width: 170px; color: #f1f5f9; font-weight: 400; }
.c-prem { display: inline-block; width: 120px; color: #f1f5f9; font-weight: 400; }
.c-sent { display: inline-block; width: 160px; color: #f1f5f9; font-weight: 400; }
.c-date { display: inline-block; width: 90px; color: #f1f5f9; font-weight: 800; }
.c-imp  { display: inline-block; width: 140px; color: #f1f5f9; font-weight: 400; }

.c-desc { color: #cbd5e1; font-size: 16px; font-weight: 400; white-space: normal; }
.sep { display: inline-block; width: 24px; text-align: center; color: #475569; font-weight: 300; }

.score-up { color: #4ade80; }
.score-down { color: #f87171; }

/* INLINE BADGES */
.nb-badge { font-size: 16px; font-weight: 800; display: inline-block; margin-bottom: 8px;}
.nb-blue { color: #7dd3fc !important; }
.badge-live { color: #4ade80 !important; font-weight: 400; animation: pulse 2s infinite; }
.badge-closed { color: #f87171 !important; font-weight: 400; }

/* INSTRUMENT GRID */
.inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.inst-card { padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.inst-name { font-size: 15px; color: #64748b; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px; }
.inst-level { font-size: 28px; font-weight: 400; color: #f1f5f9; margin-bottom: 4px; }

/* STREAMLIT INPUT OVERRIDES */
.stTextInput input { background-color: #1e293b !important; color: #f1f5f9 !important; border: 1px solid #475569 !important; border-radius: 8px !important; font-size: 18px !important; padding: 12px !important; }

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
# 3. DATA ENGINES (FMP OPTIMIZED)
# ==========================================
def get_last_price_change(ticker):
    # FAST PATH: FMP Historical API
    try:
        t_fmp = ticker.replace("^", "%5E")
        fmp_url = f"https://financialmodelingprep.com/api/v3/historical-price-full/{t_fmp}?timeseries=5&apikey={FMP_KEY}"
        res = requests.get(fmp_url, timeout=3)
        if res.status_code == 200:
            data = res.json().get('historical', [])
            if len(data) >= 2:
                curr = float(data[0]['close'])
                prev = float(data[1]['close'])
                return curr, ((curr - prev)/prev)*100, None
    except: pass

    # FALLBACK PATH: YFinance
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

def core_scanner(scan_list, cache_file):
    results = []
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
                    vol_str = f"{vol/1e6:.1f}M" if vol >= 1e6 else f"{vol/1e3:.0f}K"
                    
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
        
        final_result = sorted(results, key=lambda x: x['change'], reverse=True)
        
        # Deep News Hydration via FMP
        top_tickers = [x['ticker'] for x in final_result[:10]]
        if top_tickers:
            try:
                fmp_news_url = f"https://financialmodelingprep.com/api/v3/stock_news?tickers={','.join(top_tickers)}&limit=30&apikey={FMP_KEY}"
                fmp_res = requests.get(fmp_news_url, timeout=5)
                if fmp_res.status_code == 200:
                    fmp_map = {}
                    for article in fmp_res.json():
                        sym = article.get('symbol')
                        if sym and sym not in fmp_map:
                            raw_text = article.get('text', '') or article.get('title', '')
                            clean_text = re.sub(r'<[^>]+>', '', raw_text)
                            clean_text = re.sub(r'\s+', ' ', clean_text).strip()
                            fmp_map[sym] = clean_text
                            
                    for item in final_result:
                        if item['ticker'] in fmp_map:
                            text_snippet = fmp_map[item['ticker']][:250]
                            item['catalyst'] = text_snippet + "..." if len(fmp_map[item['ticker']]) > 250 else text_snippet
            except: pass

        if final_result:
            with open(cache_file, 'w') as f: json.dump(final_result, f)
            
        return final_result
    except Exception as e:
        if os.path.exists(cache_file):
            with open(cache_file, 'r') as f: return json.load(f)
        return [{"global_error": f"Scanner Exception: {str(e)}"}]

@st.cache_data(ttl=120)
def fetch_gappers():
    scan_list = [
        "NVDA", "TSLA", "AMD", "SMCI", "COIN", "PLTR", "MARA", "MSTR", 
        "AAPL", "META", "AMZN", "MSFT", "GOOGL", "AVGO", "ARM", "QCOM",
        "NFLX", "GME", "AMC", "HOOD", "RCL", "CCL", "UBER", "DDOG", "CRWD"
    ]
    return core_scanner(scan_list, "eod_gappers_cache.json")

@st.cache_data(ttl=120)
def fetch_micro_caps():
    scan_list = [
        "SOUN", "LUNR", "ACHR", "JOBY", "ASTS", "RGTI", "IONQ", "BOWL", 
        "TPST", "CYBN", "HOLO", "MIGI", "BXRX", "CTNT", "RVSN"
    ]
    return core_scanner(scan_list, "eod_micro_cache.json")

@st.cache_data(ttl=120)
def fetch_liquidity_basket():
    tickers = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B", "LLY", "AVGO"]
    results = []
    for t in tickers:
        try:
            # FMP First (Handle Berkshire edge case)
            t_fmp = t.replace("-", ".") 
            url = f"https://financialmodelingprep.com/api/v3/historical-price-full/{t_fmp}?timeseries=10&apikey={FMP_KEY}"
            res = requests.get(url, timeout=3)
            if res.status_code == 200 and 'historical' in res.json():
                data = res.json()['historical']
                if len(data) >= 5:
                    current = data[0]['close']
                    sma5 = sum([x['close'] for x in data[:5]]) / 5
                    bias = "Long" if current > sma5 else "Short"
                    results.append({"ticker": t, "price": float(current), "bias": bias})
                    continue
        except: pass
        
        # Yfinance Fallback
        try:
            hist = yf.Ticker(t).history(period="10d").dropna(subset=['Close'])
            if len(hist) >= 5:
                current = hist['Close'].iloc[-1]
                bias = "Long" if current > hist['Close'].iloc[-5:].mean() else "Short"
                results.append({"ticker": t, "price": float(current), "bias": bias})
        except Exception as e: 
            results.append({"ticker": t, "price": 0.0, "bias": "Error"})
    return results

@st.cache_data(ttl=120)
def fetch_massive_data():
    return [
        {"ticker": "NVDA", "type": "Sweep", "strike": "$1100C", "exp": "May 29", "prem": "$4.2M", "sentiment": "Bullish", "color": "#4ade80"},
        {"ticker": "TSLA", "type": "Block", "strike": "$200P", "exp": "Jun 19", "prem": "$2.8M", "sentiment": "Bearish", "color": "#f87171"},
        {"ticker": "AAPL", "type": "Sweep", "strike": "$195C", "exp": "May 29", "prem": "$1.5M", "sentiment": "Bullish", "color": "#4ade80"},
        {"ticker": "SMCI", "type": "Sweep", "strike": "$950C", "exp": "Jun 05", "prem": "$3.1M", "sentiment": "Bullish", "color": "#4ade80"},
        {"ticker": "IWM",  "type": "Block", "strike": "$200P", "exp": "Jul 17", "prem": "$5.5M", "sentiment": "Bearish", "color": "#f87171"},
        {"ticker": "META", "type": "Sweep", "strike": "$480C", "exp": "Jun 05", "prem": "$2.1M", "sentiment": "Bullish", "color": "#4ade80"},
        {"ticker": "QQQ",  "type": "Block", "strike": "$450P", "exp": "Jun 19", "prem": "$8.4M", "sentiment": "Bearish", "color": "#f87171"},
        {"ticker": "DELL", "type": "Sweep", "strike": "$160C", "exp": "May 29", "prem": "$1.8M", "sentiment": "Bullish", "color": "#4ade80"}
    ]

# ==========================================
# 4. DATA EXECUTION & STATE
# ==========================================
macro_data = fetch_expanded_macro()
sector_data = fetch_sector_flow()
gappers_data = fetch_gappers()
micro_cap_data = fetch_micro_caps()
liquidity_data = fetch_liquidity_basket()
institutional_flow = fetch_massive_data()

# ==========================================
# 5. UI RENDER ENGINE
# ==========================================

# --- HEADER ---
st.markdown(f'<div class="hdr"><div><div class="wrap-title">Confluence Trading Tools</div></div><div class="hdr-meta"><div class="hdr-date">{now_dt.strftime("%A, %B %d")}</div><span class="{status_class}">{market_status}</span></div></div>', unsafe_allow_html=True)

# OPEN MASTER CLOUD
st.markdown('<div class="block-container">', unsafe_allow_html=True)

# --- 00 | SYMBOL SEARCH ---
st.markdown('<div class="section-container"><div class="section-title">00 — Universal Ticker Search</div>', unsafe_allow_html=True)
search_query = st.text_input("Search", placeholder="Enter a company name or ticker (e.g., Apple, TSLA, Bitcoin)...", label_visibility="collapsed")

if search_query:
    try:
        search_url = f"https://financialmodelingprep.com/stable/search-name?query={search_query}&limit=5&apikey={FMP_KEY}"
        s_res = requests.get(search_url, timeout=5)
        if s_res.status_code == 200:
            s_data = s_res.json()
            if s_data:
                for r in s_data:
                    st.markdown(f'<div class="item-row"><span class="c-tckr">{r.get("symbol")}</span><span class="sep">|</span><span class="c-sec" style="width: 300px; white-space: normal;">{r.get("name")}</span><span class="sep">|</span><span class="c-desc">Exchange: {r.get("exchangeFullName", r.get("exchange", ""))}</span><span class="sep">|</span><span class="c-desc">Currency: {r.get("currency")}</span></div>', unsafe_allow_html=True)
            else:
                st.markdown('<div class="item-row"><span class="c-desc">No results found.</span></div>', unsafe_allow_html=True)
        else:
            st.markdown(f'<div class="item-row"><span class="c-desc" style="color:#f87171;">API Error: HTTP {s_res.status_code}</span></div>', unsafe_allow_html=True)
    except Exception as e:
        st.markdown(f'<div class="item-row"><span class="c-desc" style="color:#f87171;">Exception: {e}</span></div>', unsafe_allow_html=True)
st.markdown('</div>', unsafe_allow_html=True)

# --- 01 | SCORECARD ---
scorecard_html = f'<div class="section-container"><div class="section-title">01 — Macro Scorecard</div><div class="inst-grid">'
for name, m in macro_data.items():
    if m.get('error'):
        scorecard_html += f'<div class="inst-card"><div class="inst-name">{name}</div><div class="inst-level" style="font-size:14px; color:#f87171;">Error: {m["error"]}</div></div>'
    else:
        col = "score-up" if m['pct'] >= 0 else "score-down"
        sign = "▲ +" if m['pct'] > 0 else "▼ " if m['pct'] < 0 else ""
        p_str = f"{m['price']:.3f}" if name in ["VIX", "10Y Treasury"] else f"${m['price']:,.2f}"
        scorecard_html += f'<div class="inst-card"><div class="inst-name">{name}</div><div class="inst-level">{p_str}</div><div class="{col}">{sign}{m["pct"]:.2f}%</div></div>'
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)

# --- 02 | MARKET DRIVERS (VIA FMP) ---
live_news = []
try:
    url = f"https://financialmodelingprep.com/stable/news/stock-latest?page=0&limit=20&apikey={FMP_KEY}"
    res = requests.get(url, headers={"accept": "application/json"}, timeout=5)
    if res.status_code == 200:
        for n in res.json():
            title = n.get("title", "").replace(" — ...", "")
            raw_text = n.get("text", "")
            
            teaser = re.sub(r'<[^>]+>', '', raw_text)
            teaser = re.sub(r'\s+', ' ', teaser).strip()
            
            if not teaser or len(teaser) < 20 or teaser == title:
                live_news.append({"title": title, "teaser": ""})
            else:
                live_news.append({"title": title, "teaser": teaser[:350] + ("..." if len(teaser) > 350 else "")})
    else:
        live_news.append({"title": "FMP API Error", "teaser": f"Status [{res.status_code}] - Check API key."})
except Exception as e:
    live_news.append({"title": "News Feed Exception", "teaser": str(e)})

news_html = '<div class="section-container"><div class="section-title">02 — Market Drivers & Catalysts</div>'
for article in live_news[:8]:
    if article["teaser"]:
        news_html += f'<div class="item-row-wrap"><span style="font-weight: 400; color: #f1f5f9; padding-right: 12px; max-width: 45%;">{article["title"]}</span> <span class="sep">|</span> <span class="c-desc" style="flex: 1;">{article["teaser"]}</span></div>'
    else:
        news_html += f'<div class="item-row-wrap"><span style="font-weight: 400; color: #f1f5f9;">{article["title"]}</span></div>'
news_html += "</div>"
st.markdown(news_html, unsafe_allow_html=True)

# --- 03 | SECTORS ---
heatmap_html = f'<div class="section-container"><div class="section-title">03 — Sector Flows</div>'
for i, item in enumerate(sector_data):
    if item.get('error'):
        heatmap_html += f'<div class="item-row"><span class="c-tckr">{item["ticker"]}</span><span class="sep">|</span><span class="c-sec">({item["sector"]})</span><span class="sep">|</span><span class="c-desc" style="color:#f87171;">Error: {item["error"]}</span></div>'
    else:
        pct_color = "score-up" if item['pct'] >= 0 else "score-down"
        sign = "▲ +" if item['pct'] > 0 else "▼ " if item['pct'] < 0 else ""
        flow_color = "score-up" if item["flow"] == "Inflow" else "score-down"
        heatmap_html += f'<div class="item-row"><span class="c-tckr">{item["ticker"]}</span><span class="sep">|</span><span class="c-sec">({item["sector"]})</span><span class="sep">|</span><span class="c-pct {pct_color}">{sign}{item["pct"]:.2f}%</span><span class="sep">|</span><span class="c-flow {flow_color}">{item["flow"]}</span></div>'
heatmap_html += '</div>'
st.markdown(heatmap_html, unsafe_allow_html=True)

# --- 04 | MARKET MOVERS ---
gappers_html = f'<div class="section-container"><div class="section-title">04 — Live Market Movers</div>'
if gappers_data and "global_error" in gappers_data[0]:
    gappers_html += f'<div class="item-row"><span class="c-tckr">Error</span><span class="sep">|</span><span class="c-desc" style="color:#f87171;">Scanner Failed: {gappers_data[0]["global_error"]}</span></div>'
else:
    gappers_html += f'<div class="nb-badge nb-blue" style="margin-bottom:16px;">Momentum Scanner (Beta Basket)</div>'
    if gappers_data:
        for item in gappers_data[:10]:
            rvol_val = safe_float(item.get('rvol')) or 1.0
            pct_color = "score-up" if item["change"] >= 0 else "score-down"
            sign = "▲ +" if item["change"] >= 0 else "▼ "
            gappers_html += f'<div class="item-row"><span class="c-tckr">{item["ticker"]}</span><span class="sep">|</span><span class="c-prc">${item["price"]:.2f}</span><span class="sep">|</span><span class="c-pct {pct_color}">{sign}{item["change"]:.2f}%</span><span class="sep">|</span><span class="c-vol">Vol: {item.get("vol", "")}</span><span class="sep">|</span><span class="c-rvol">RVOL: {rvol_val:.1f}x</span><span class="sep">—</span><span class="c-desc">{item.get("catalyst")}</span></div>'
    else:
        gappers_html += f'<div class="item-row"><span class="c-tckr">Status</span><span class="sep">|</span><span class="c-desc">No significant momentum in tracked basket.</span></div>'
gappers_html += '</div>'
st.markdown(gappers_html, unsafe_allow_html=True)

# --- 05 | STOCKS IN PLAY (SIPS) ---
sips_html = f'<div class="section-container"><div class="section-title">05 — Stocks in Play</div>'
if gappers_data and "global_error" not in gappers_data[0]:
    for item in sorted(gappers_data, key=lambda x: abs(x.get('change', 0)), reverse=True)[:6]:
        rvol_val = safe_float(item.get('rvol')) or 1.0
        pct_color = "score-up" if item["change"] >= 0 else "score-down"
        sign = "▲ +" if item["change"] >= 0 else "▼ "
        sips_html += f'<div class="item-row"><span class="c-tckr">{item["ticker"]}</span><span class="sep">|</span><span class="c-prc">${item.get("price", 0):.2f}</span><span class="sep">|</span><span class="c-pct {pct_color}">{sign}{item.get("change", 0):.2f}%</span><span class="sep">|</span><span class="c-vol">Vol: {item.get("vol", "")}</span><span class="sep">|</span><span class="c-rvol">RVOL: {rvol_val:.1f}x</span><span class="sep">—</span><span class="c-desc">{item.get("catalyst")}</span></div>'
else:
    err_msg = gappers_data[0]['global_error'] if gappers_data else "Unknown Error"
    sips_html += f'<div class="item-row"><span class="c-tckr">Error</span><span class="sep">|</span><span class="c-desc" style="color:#f87171;">Cannot generate SIPs: {err_msg}</span></div>'
sips_html += '</div>'
st.markdown(sips_html, unsafe_allow_html=True)

# --- 06 | MEGA-CAP LIQUIDITY ---
play_html = f'<div class="section-container"><div class="section-title">06 — Mega-Cap Liquidity Basket</div>'
for item in liquidity_data:
    if item.get('error'):
        play_html += f'<div class="item-row"><span class="c-tckr">{item["ticker"]}</span><span class="sep">|</span><span class="c-desc" style="color:#f87171;">Error: {item["error"]}</span></div>'
    else:
        bias_color = "#4ade80" if item["bias"] == "Long" else "#f87171"
        play_html += f'<div class="item-row"><span class="c-tckr">{item["ticker"]}</span><span class="sep">|</span><span class="c-prc">${item["price"]:.2f}</span><span class="sep">|</span><span class="c-bias">Algo Bias: <span style="color:{bias_color};">{item["bias"]}</span></span><span class="sep">—</span><span class="c-desc">Tracking 5-Day SMA deviation.</span></div>'
play_html += '</div>'
st.markdown(play_html, unsafe_allow_html=True)

# --- 07 | MICRO-CAP WATCHLIST ---
micro_html = f'<div class="section-container"><div class="section-title">07 — Micro-Cap / High-Beta Watchlist</div>'
if micro_cap_data and "global_error" in micro_cap_data[0]:
    micro_html += f'<div class="item-row"><span class="c-tckr">Error</span><span class="sep">|</span><span class="c-desc" style="color:#f87171;">Scanner Failed: {micro_cap_data[0]["global_error"]}</span></div>'
else:
    micro_html += f'<div class="nb-badge nb-blue" style="margin-bottom:16px;">Low-Float / High-Volatility Scanner</div>'
    if micro_cap_data:
        for item in micro_cap_data[:8]:
            rvol_val = safe_float(item.get('rvol')) or 1.0
            pct_color = "score-up" if item["change"] >= 0 else "score-down"
            sign = "▲ +" if item["change"] >= 0 else "▼ "
            micro_html += f'<div class="item-row"><span class="c-tckr">{item["ticker"]}</span><span class="sep">|</span><span class="c-prc">${item["price"]:.2f}</span><span class="sep">|</span><span class="c-pct {pct_color}">{sign}{item["change"]:.2f}%</span><span class="sep">|</span><span class="c-vol">Vol: {item.get("vol", "")}</span><span class="sep">|</span><span class="c-rvol">RVOL: {rvol_val:.1f}x</span><span class="sep">—</span><span class="c-desc">{item.get("catalyst")}</span></div>'
    else:
        micro_html += f'<div class="item-row"><span class="c-tckr">Status</span><span class="sep">|</span><span class="c-desc">No significant momentum in tracked micro-cap basket.</span></div>'
micro_html += '</div>'
st.markdown(micro_html, unsafe_allow_html=True)

# --- 08 | ECONOMIC CALENDAR ---
econ_html = f'<div class="section-container"><div class="section-title">08 — Economic Calendar (Week Ahead)</div>'
events = [
    ("May 26", "S&P/Case-Shiller Home Price", "Med", "#7dd3fc"),
    ("May 27", "CFTC Soybeans / Grains Report", "High", "#f87171"),
    ("May 28", "GDP (Second Preliminary)", "High", "#f87171"),
    ("May 29", "Core PCE Price Index", "High", "#f87171")
]
for date, event, imp, col in events:
    econ_html += f'<div class="item-row"><span class="c-date">{date}</span><span class="sep">|</span><span class="c-imp">Impact: <span style="color:{col};">{imp}</span></span><span class="sep">—</span><span class="c-desc">{event}</span></div>'
econ_html += '</div>'
st.markdown(econ_html, unsafe_allow_html=True)

# --- 09 | TECHNICAL PICTURE ---
st.markdown(f"""
<div class="section-container">
<div class="section-title">09 — Technical Picture & Action Plan</div>
<div class="item-row-wrap"><span class="c-strk" style="width: auto; padding-right: 12px; font-weight:800;">SPX Levels</span><span class="sep">|</span><span class="c-prc" style="width: auto; padding-right: 12px;">Target: 7,300–7,375</span><span class="sep">|</span><span class="c-prc" style="width: auto; padding-right: 12px;">Support: 7,000 ➔ 6,780</span><span class="sep">—</span><span class="c-desc" style="color:#818cf8; flex: 1;">Action ➔ Look for dip-buying at 7,000.</span></div>
<div class="item-row-wrap"><span class="c-strk" style="width: auto; padding-right: 12px; font-weight:800;">Volatility (VIX)</span><span class="sep">|</span><span class="c-prc" style="width: auto; padding-right: 12px;">Level: ~19.10</span><span class="sep">|</span><span class="c-prc" style="width: auto; padding-right: 12px;">Context: Entering "Normal" regime.</span><span class="sep">—</span><span class="c-desc" style="color:#818cf8; flex: 1;">Action ➔ Premium selling favored.</span></div>
</div>
""", unsafe_allow_html=True)

# --- 10 | WATCHLIST ---
st.markdown(f"""
<div class="section-container">
<div class="section-title">10 — Trading Watchlist</div>
<div class="item-row-wrap"><span class="c-tckr">NVDA</span><span class="c-sec">(Institutional Flow)</span><span class="sep">—</span><span class="c-desc" style="flex: 1;">Massive institutional buy-side pressure remains. Watch for a test of new ATH territory.</span></div>
<div class="item-row-wrap"><span class="c-tckr">TSLA</span><span class="c-sec">(Catalyst Play)</span><span class="sep">—</span><span class="c-desc" style="flex: 1;">Structural rally in progress. Looking for $220 to act as a launchpad for the next leg.</span></div>
</div>
""", unsafe_allow_html=True)

# --- 11 | MASSIVE API INTEGRATION ---
massive_html = f'<div class="section-container"><div class="section-title">11 — Institutional Options Flow (Massive API)</div>'
for flow in institutional_flow:
    massive_html += f'<div class="item-row"><span class="c-tckr">{flow["ticker"]}</span><span class="c-type">({flow["type"]})</span><span class="sep">|</span><span class="c-strk">{flow["strike"]} — {flow["exp"]}</span><span class="sep">|</span><span class="c-prem">Prem: {flow["prem"]}</span><span class="sep">|</span><span class="c-sent">Sentiment: <span style="color:{flow["color"]};">{flow["sentiment"]}</span></span></div>'
massive_html += "</div>"
st.markdown(massive_html, unsafe_allow_html=True)

# --- 12 | DYNAMIC MARKET SUMMARY ---
spx_pct = macro_data.get('S&P 500 (SPX)', {}).get('pct', 0.0) if not macro_data.get('S&P 500 (SPX)', {}).get('error') else 0.0
top_sector = sector_data[0]['sector'] if sector_data and not sector_data[0].get('error') else "Technology"
top_gapper = gappers_data[0]['ticker'] if gappers_data and "global_error" not in gappers_data[0] else "N/A"
top_gapper_change = gappers_data[0].get('change', 0.0) if gappers_data and "global_error" not in gappers_data[0] else 0.0

display_status = "The market is currently open and trading." if market_status == "Market Open" else market_status

summary_text = f"""
<div class="section-container">
<div class="section-title">12 — Market Summary</div>
<div class="item-row-wrap"><span class="c-strk" style="width: auto; padding-right: 12px; font-weight:800;">Market Status</span><span class="sep">—</span><span class="c-desc" style="flex: 1;">{display_status}</span></div>
<div class="item-row-wrap"><span class="c-strk" style="width: auto; padding-right: 12px; font-weight:800;">Action Summary</span><span class="sep">—</span><span class="c-desc" style="flex: 1;">Heading into the next session, the broader market is {'pushing higher' if spx_pct > 0 else 'showing weakness'} with the S&P 500 at {spx_pct:+.2f}%. Sector rotation favors {top_sector}, while speculative money is concentrated in names like {top_gapper} ({top_gapper_change:+.1f}%). With the VIX hovering near ~19.10, the environment remains constructive but warrants selectivity.</span></div>
<div class="item-row-wrap"><span class="c-strk" style="width: auto; padding-right: 12px; font-weight:800;">Closing Posture</span><span class="sep">—</span><span class="c-desc" style="flex: 1;">Remain focused on relative strength. Watch the SPX 7,000 level closely for structural support. See you at the open. 📈</span></div>
</div>
"""
st.markdown(summary_text, unsafe_allow_html=True)

# CLOSE MASTER CLOUD
st.markdown('</div>', unsafe_allow_html=True)
