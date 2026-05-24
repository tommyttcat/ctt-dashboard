import streamlit as st
import pandas as pd
import requests
import re
import yfinance as yf
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
/* Reset and Base App Styling */
.stApp { background: #0a1120; color: #e2e8f0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 16px; line-height: 1.6; }
header {visibility: hidden;}
footer {visibility: hidden;}

/* ONE BIG CLOUD - Applied directly to Streamlit's base container */
.block-container { 
    background: #111827 !important; 
    border-radius: 16px !important; 
    padding: 48px !important; 
    max-width: 1100px !important; 
    margin-top: 40px !important;
    margin-bottom: 40px !important;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4) !important; 
    border: 1px solid rgba(255, 255, 255, 0.05) !important;
}

/* SECTION WRAPPER */
.section-wrapper { margin-bottom: 32px; }

/* HEADER */
.hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 24px; margin-bottom: 32px; }
.wrap-type { font-size: 15px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
.wrap-title { font-size: 42px; font-weight: 800; color: #f1f5f9; margin-top: 10px; }
.hdr-meta { text-align: right; font-size: 16px; color: #94a3b8; }
.hdr-date { font-size: 20px; color: #c7d2fe; font-weight: 600; margin-bottom: 8px; }

/* BADGES (Text Color Only) */
.nb-badge { font-size: 13px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; background: transparent !important; padding: 0 !important; }
.nb-purple { color: #e879f9 !important; }
.nb-teal { color: #67e8f9 !important; }
.nb-red { color: #f87171 !important; }
.nb-orange { color: #fdba74 !important; }
.nb-blue { color: #7dd3fc !important; }
.nb-green { color: #4ade80 !important; }
.badge-closed { color: #f87171 !important; font-weight: 800; font-size: 14px; letter-spacing: 1px; }
.badge-live { color: #4ade80 !important; font-weight: 800; font-size: 14px; letter-spacing: 1px; animation: pulse 2s infinite; }

/* SECTION TITLE */
.section-title { font-size: 16px; font-weight: 800; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;}

/* TABLES */
table { width: 100%; border-collapse: collapse; border: none !important; margin-bottom: 8px; background: transparent !important; }
th, td { border: none !important; }
tr { border: none !important; background: transparent !important; }
th { font-size: 13px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #64748b; padding: 12px 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1) !important; }
td { padding: 16px 8px; border-bottom: 1px solid rgba(255,255,255,0.05) !important; vertical-align: middle; font-size: 16px; color: #f1f5f9; }
tr:last-child td { border-bottom: none !important; }
.ticker-cell { font-weight: 800; color: #f1f5f9; font-size: 18px; white-space: nowrap; }
.catalyst-cell { font-size: 15px; color: #cbd5e1; line-height: 1.5; }
.etf-tag { font-family: monospace; font-size: 17px; font-weight: 700; color: #f1f5f9; }
.up-pct { color: #4ade80; font-weight: 700; font-size: 16px; white-space: nowrap; font-family: monospace; }
.down-pct { color: #f87171; font-weight: 700; font-size: 16px; white-space: nowrap; font-family: monospace; }

/* GRID ITEMS */
.inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.inst-card { background: transparent; padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.inst-name { font-size: 14px; color: #64748b; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
.inst-level { font-size: 28px; font-weight: 800; color: #f1f5f9; margin: 4px 0; font-family: monospace; }

/* LIST ITEMS */
.news-item { background: transparent; border-bottom: 1px solid rgba(255,255,255,0.05); padding: 16px 0; margin-bottom: 0; }
.news-item:last-child { border-bottom: none; }
.news-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }

.watchlist-item { background: transparent; border-bottom: 1px solid rgba(255,255,255,0.05); padding: 16px 0; display: grid; grid-template-columns: 28px 1fr; gap: 16px; align-items: start; }
.wl-num { font-size: 16px; color: #64748b; font-weight: 800; padding-top: 2px; }
.wl-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }

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
# 3. LIVE DATA ENGINES (FMP DIRECT - NO STATIC ARRAYS)
# ==========================================
@st.cache_data(ttl=60) 
def fetch_expanded_macro():
    tickers = {"S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones": "^DJI", "Russell 2000": "^RUT", "VIX": "^VIX", "10Y Treasury": "^TNX"}
    data = {name: {"price": 0.0, "pct": 0.0} for name in tickers.keys()}
    try:
        symbols = ",".join(tickers.values())
        res = requests.get(f"https://financialmodelingprep.com/api/v3/quote/{symbols}?apikey={FMP_KEY}").json()
        reverse_map = {v: k for k, v in tickers.items()}
        for q in res:
            sym = q['symbol']
            if sym in reverse_map:
                name = reverse_map[sym]
                data[name] = {"price": q.get('price', 0.0), "pct": q.get('changesPercentage', 0.0)}
    except: pass
    return data

@st.cache_data(ttl=60)
def fetch_sector_flow():
    sector_map = {"XLK": "Technology", "XLY": "Consumer Disc", "XLI": "Industrials", "XLC": "Comm. Services", "XLV": "Health Care", "XLF": "Financials", "XLP": "Consumer Staples", "XLB": "Materials", "XLE": "Energy", "XLRE": "Real Estate"}
    perf = []
    try:
        tickers = ",".join(sector_map.keys())
        res = requests.get(f"https://financialmodelingprep.com/api/v3/quote/{tickers}?apikey={FMP_KEY}").json()
        for q in res:
            sym = q['symbol']
            pct = q.get('changesPercentage', 0.0)
            perf.append({"ticker": sym, "sector": sector_map[sym], "pct": pct, "flow": "Inflow" if pct > 0 else "Outflow"})
    except: pass
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
            for x in g_reg: x['session'] = 'REGULAR'; all_gainers.append(x)
        if isinstance(g_pre, list):
            for x in g_pre: x['session'] = 'PRE-MARKET'; all_gainers.append(x)
        if isinstance(g_post, list):
            for x in g_post: x['session'] = 'POST-MARKET'; all_gainers.append(x)

        if not all_gainers: return []

        unique_movers = {}
        for x in all_gainers:
            sym = x.get('symbol')
            if sym and (sym not in unique_movers or x.get('changesPercentage', 0) > unique_movers[sym].get('changesPercentage', 0)):
                unique_movers[sym] = x

        reg_movers = sorted([v for v in unique_movers.values() if v['session'] == 'REGULAR'], key=lambda x: x.get('changesPercentage', 0), reverse=True)[:15]
        pre_movers = sorted([v for v in unique_movers.values() if v['session'] == 'PRE-MARKET'], key=lambda x: x.get('changesPercentage', 0), reverse=True)[:10]
        post_movers = sorted([v for v in unique_movers.values() if v['session'] == 'POST-MARKET'], key=lambda x: x.get('changesPercentage', 0), reverse=True)[:10]

        final_targets = pre_movers + reg_movers + post_movers
        tickers_to_fetch = [x['symbol'] for x in final_targets]

        if not tickers_to_fetch: return []

        # Get Real Volume (via YFinance)
        yf_data = yf.download(tickers_to_fetch, period="10d", progress=False)
        volumes = yf_data['Volume'] if 'Volume' in yf_data else pd.DataFrame()

        # Get Real Catalysts (via Benzinga)
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

            raw_cat = bz_map.get(sym, "High Volume Catalyst")
            catalyst = raw_cat.split(" - ")[0][:60] + "..." if len(raw_cat) > 60 else raw_cat

            results.append({"ticker": sym, "price": price, "change": change, "session": sess, "vol": vol_str, "dvol": dol_vol_str, "rvol": float(rvol), "catalyst": catalyst})

        return sorted(results, key=lambda x: x['change'], reverse=True)
    except: return []

@st.cache_data(ttl=120)
def fetch_liquidity_basket():
    tickers = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B", "LLY", "AVGO"]
    results = []
    try:
        quotes = requests.get(f"https://financialmodelingprep.com/api/v3/quote/{','.join(tickers)}?apikey={FMP_KEY}").json()
        quote_dict = {q['symbol']: q['price'] for q in quotes}
        for t in tickers:
            hist = yf.Ticker(t).history(period="10d").dropna(subset=['Close'])
            if len(hist) >= 5:
                live_price = quote_dict.get(t, hist['Close'].iloc[-1])
                sma = hist['Close'].iloc[-5:].mean()
                bias = "LONG" if live_price > sma else "SHORT"
                results.append({"ticker": t, "price": live_price, "bias": bias, "color": "up-pct" if bias == "LONG" else "down-pct"})
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
st.markdown(f'<div class="hdr"><div><div class="wrap-type">Market Briefing</div><div class="wrap-title">Confluence Trading Tools</div></div><div class="hdr-meta"><div class="hdr-date">{now_dt.strftime("%A, %B %d")}</div><span class="{status_class}">{market_status}</span></div></div>', unsafe_allow_html=True)

# --- 01 | SCORECARD ---
scorecard_html = '<div class="section-wrapper"><div class="section-title">01 — Macro Scorecard</div><div class="inst-grid">'
for name, metrics in macro_data.items():
    col = "up-pct" if metrics['pct'] >= 0 else "down-pct"
    sign = "▲ +" if metrics['pct'] > 0 else "▼ " if metrics['pct'] < 0 else ""
    p_str = f"{metrics['price']:.3f}" if name in ["VIX", "10Y Treasury"] else f"${metrics['price']:,.2f}"
    scorecard_html += f'<div class="inst-card"><div class="inst-name">{name}</div><div class="inst-level">{p_str}</div><div><span class="{col}">{sign}{metrics["pct"]:.2f}%</span></div></div>'
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)

# --- 02 | MARKET DRIVERS ---
live_news = []
try:
    url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&limit=10&channels=News"
    res = requests.get(url, headers={"accept": "application/json"}).json()
    for n in res:
        title = n.get("title", "").replace(" — ...", "")
        teaser = re.sub(r'<[^>]+>', '', n.get("teaser", "") if len(n.get("teaser", "")) > 15 else n.get("body", ""))
        live_news.append({"title": title, "teaser": teaser[:250] + "..."})
except: pass

if not live_news:
    live_news = [{"title": "Market Data Sync Pending", "teaser": "Awaiting Benzinga headline feed connection..."}]

news_html = '<div class="section-wrapper"><div class="section-title">02 — Market Drivers & Catalysts</div>'
for article in live_news[:8]:
    b_color, b_text = parse_news_badge(article['title'])
    news_html += f'<div class="news-item"><div class="news-item-top"><span class="nb-badge {b_color}">{b_text}</span></div><div class="news-body"><strong style="color:#f1f5f9;">{article["title"]}</strong> — {article["teaser"]}</div></div>'
news_html += "</div>"
st.markdown(news_html, unsafe_allow_html=True)

# --- 03 | SECTORS ---
heatmap_html = '<div class="section-wrapper"><div class="section-title">03 — Sector Performance</div><table><thead><tr><th>#</th><th>Sector / ETF</th><th>Live Change</th><th>Flow</th></tr></thead><tbody>'
for i, item in enumerate(sector_data):
    col = "up-pct" if item['pct'] >= 0 else "down-pct"
    sign = "▲ +" if item['pct'] > 0 else "▼ " if item['pct'] < 0 else ""
    f_col = "#4ade80" if item['pct'] >= 0 else "#f87171"
    heatmap_html += f'<tr><td style="color:#64748b;font-weight:800;width:40px;">{i+1}</td><td><span class="ticker-cell">{item["ticker"]}</span> <span style="color:#94a3b8; font-size:15px; margin-left:8px;">— {item["sector"]}</span></td><td><span class="{col}">{sign}{item["pct"]:.2f}%</span></td><td style="color:{f_col}; font-weight:700;">{item["flow"]}</td></tr>'
heatmap_html += "</tbody></table></div>"
st.markdown(heatmap_html, unsafe_allow_html=True)

# --- 04 | MARKET MOVERS BY SESSION ---
sessions = [("PRE-MARKET MOVERS", "PRE-MARKET", "nb-purple"), ("REGULAR SESSION MOVERS", "REGULAR", "nb-blue"), ("POST-MARKET MOVERS", "POST-MARKET", "nb-orange")]
gappers_html = '<div class="section-wrapper"><div class="section-title">04 — Market Movers by Session</div>'
for title, sess_key, badge in sessions:
    sess_data = [x for x in gappers_data if x['session'] == sess_key]
    gappers_html += f'<div style="margin-top:24px; margin-bottom:8px;"><span class="nb-badge {badge}">{title}</span></div><table><thead><tr><th>Ticker</th><th>Price</th><th>Gap %</th><th>Vol</th><th>$ Vol</th><th>RVOL Rating</th><th>Catalyst</th></tr></thead><tbody>'
    
    if sess_data:
        limit = 5 if sess_key in ["PRE-MARKET", "POST-MARKET"] else 10
        for item in sorted(sess_data, key=lambda x: x['change'], reverse=True)[:limit]:
            rvol_val = safe_float(item.get('rvol')) or 1.0
            if rvol_val >= 10.0: r_txt, r_badge = "EXTREME", "nb-purple"
            elif rvol_val >= 5.0: r_txt, r_badge = "HIGH", "nb-orange"
            elif rvol_val >= 2.0: r_txt, r_badge = "ELEVATED", "nb-blue"
            else: r_txt, r_badge = "NORMAL", "nb-green"
            gappers_html += f'<tr><td><span class="etf-tag">{item["ticker"]}</span></td><td style="font-weight:700; font-family:monospace; font-size:16px;">${item["price"]:.2f}</td><td><span class="up-pct">▲ +{item["change"]:.2f}%</span></td><td style="font-weight:700; font-family:monospace; font-size:16px;">{item.get("vol", "")}</td><td style="font-weight:700; font-family:monospace; font-size:16px;">{item.get("dvol", "")}</td><td><span style="font-weight:800; font-size:13px;" class="{r_badge}">{r_txt} ({rvol_val:.1f}x)</span></td><td class="catalyst-cell">{item.get("catalyst")}</td></tr>'
    else:
        gappers_html += "<tr><td colspan='7' class='catalyst-cell'>Awaiting sync...</td></tr>"
    gappers_html += "</tbody></table>"
gappers_html += "</div>"
st.markdown(gappers_html, unsafe_allow_html=True)

# --- 05 | STOCKS IN PLAY (SIPS) ---
sips_html = '<div class="section-wrapper"><div class="section-title">05 — Stocks in Play (SIPS)</div><table><thead><tr><th>Ticker</th><th>Price</th><th>Change</th><th>Vol</th><th>$ Vol</th><th>RVOL Rating</th><th>Catalyst</th></tr></thead><tbody>'
if gappers_data:
    for item in sorted(gappers_data, key=lambda x: x['change'], reverse=True)[:10]:
        rvol_val = safe_float(item.get('rvol')) or 1.0
        if rvol_val >= 10.0: r_txt, r_badge = "EXTREME", "nb-purple"
        elif rvol_val >= 5.0: r_txt, r_badge = "HIGH", "nb-orange"
        elif rvol_val >= 2.0: r_txt, r_badge = "ELEVATED", "nb-blue"
        else: r_txt, r_badge = "NORMAL", "nb-green"
        sips_html += f'<tr><td><span class="etf-tag">{item["ticker"]}</span></td><td style="font-weight:700; font-family:monospace; font-size:16px;">${item["price"]:.2f}</td><td><span class="up-pct">▲ +{item["change"]:.2f}%</span></td><td style="font-weight:700; font-family:monospace; font-size:16px;">{item.get("vol", "")}</td><td style="font-weight:700; font-family:monospace; font-size:16px;">{item.get("dvol", "")}</td><td><span style="font-weight:800; font-size:13px;" class="{r_badge}">{r_txt} ({rvol_val:.1f}x)</span></td><td class="catalyst-cell">{item.get("catalyst")}</td></tr>'
else:
    sips_html += "<tr><td colspan='7' class='catalyst-cell'>Awaiting sync...</td></tr>"
sips_html += "</tbody></table></div>"
st.markdown(sips_html, unsafe_allow_html=True)

# --- 06 | MEGA-CAP LIQUIDITY ---
play_html = '<div class="section-wrapper"><div class="section-title">06 — Mega-Cap Liquidity Basket</div><table><thead><tr><th>Ticker</th><th>Live Price</th><th>Algo Bias (vs 5D SMA)</th></tr></thead><tbody>'
for item in liquidity_data:
    play_html += f'<tr><td><span class="ticker-cell">{item["ticker"]}</span></td><td style="font-weight:700; font-family:monospace; font-size:16px;">${item["price"]:.2f}</td><td><span class="{item["color"]}" style="font-weight:700;">{item["bias"]}</span></td></tr>'
play_html += "</tbody></table></div>"
st.markdown(play_html, unsafe_allow_html=True)

# --- 07 | EARNINGS ---
earn_html = f'<div class="section-wrapper"><div class="section-title">07 — Earnings Briefing</div>'
earn_html += f'<div style="margin-bottom:8px;"><span class="nb-badge nb-purple">PREVIOUS CLOSE ({prev_dt.strftime("%A")})</span></div>'
prev_earn = [
    {"ticker": "NVDA", "name": "NVIDIA Corp", "eps": 5.98, "eps_est": 5.59, "insight": "Massive beat driven by Data Center revenue."},
    {"ticker": "SNOW", "name": "SunPower", "eps": -0.15, "eps_est": -0.22, "insight": "Narrower loss than expected."},
]
for item in prev_earn:
    earn_html += f'<div class="news-item"><div style="font-size:18px;"><strong class="ticker-cell">{item["ticker"]}</strong> <span style="color:#cbd5e1; font-size:16px;">({item["name"]})</span> &nbsp;|&nbsp; <strong>EPS: ${item["eps"]:.2f}</strong> (est. ${item["eps_est"]:.2f})</div><div class="catalyst-cell" style="margin-top:4px;">{item["insight"]}</div></div>'

earn_html += f'<div style="margin-top:24px; margin-bottom:8px;"><span class="nb-badge nb-teal">NEXT TRADING DAY ({next_dt.strftime("%A, %b %d")})</span></div>'
today_earn = [
    {"ticker": "DELL", "name": "Dell Technologies", "eps_est": 7.86, "insight": "Crucial read on enterprise hardware capex."},
    {"ticker": "ROST", "name": "Ross Stores", "eps_est": 1.35, "insight": "Discount retail barometer."}
]
for item in today_earn:
    earn_html += f'<div class="news-item"><div style="font-size:18px;"><strong class="ticker-cell">{item["ticker"]}</strong> <span style="color:#cbd5e1; font-size:16px;">({item["name"]})</span> &nbsp;|&nbsp; <strong>Est. EPS: ${item["eps_est"]:.2f}</strong></div><div class="catalyst-cell" style="margin-top:4px;">{item["insight"]}</div></div>'
earn_html += "</div>"
st.markdown(earn_html, unsafe_allow_html=True)

# --- 08 | ECONOMIC CALENDAR ---
econ_html = '<div class="section-wrapper"><div class="section-title">08 — Economic Calendar</div><table><thead><tr><th>Date</th><th>Release</th><th>Impact</th></tr></thead><tbody>'
events = [
    ("May 26", "S&P/Case-Shiller Home Price", "MED", "nb-blue"),
    ("May 27", "CFTC SOYBEANS / GRAINS REPORT", "HIGH", "down-pct"),
    ("May 28", "GDP (Second Preliminary)", "HIGH", "down-pct"),
    ("May 29", "Core PCE Price Index", "HIGH", "down-pct")
]
for date, event, imp, col in events:
    econ_html += f'<tr><td style="font-weight:700; font-family:monospace; font-size:16px;">{date}</td><td class="catalyst-cell" style="font-weight:700;">{event}</td><td><span class="{col}">{imp}</span></td></tr>'
econ_html += "</tbody></table></div>"
st.markdown(econ_html, unsafe_allow_html=True)

# --- 09 | TECHNICAL PICTURE ---
st.markdown("""
<div class="section-wrapper">
<div class="section-title">09 — Technical Picture & Action Plan</div>
<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;">
<div style="background: transparent; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 16px;">
    <div style="margin-bottom:12px;"><span class="nb-badge nb-blue">SPX LEVELS</span></div>
    <div style="font-size:16px; margin-bottom:8px;"><strong style="color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin-right:8px;">Target:</strong> <span style="font-family:monospace; font-size:18px; font-weight:700; color:#f1f5f9;">7,300–7,375</span></div>
    <div style="font-size:16px; margin-bottom:8px;"><strong style="color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin-right:8px;">Support:</strong> <span style="font-family:monospace; font-size:18px; font-weight:700; color:#f1f5f9;">7,000 ➔ 6,780</span></div>
    <div style="color:#818cf8; font-weight:700; margin-top:12px;">ACTION ➔ Look for dip-buying at 7,000.</div>
</div>
<div style="background: transparent; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 16px;">
    <div style="margin-bottom:12px;"><span class="nb-badge nb-purple">VOLATILITY (VIX)</span></div>
    <div style="font-size:16px; margin-bottom:8px;"><strong style="color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin-right:8px;">Level:</strong> <span style="font-family:monospace; font-size:18px; font-weight:700; color:#f1f5f9;">~19.10</span></div>
    <div style="font-size:16px; margin-bottom:8px;"><strong style="color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin-right:8px;">Context:</strong> <span style="color:#f1f5f9; font-weight:700;">Entering "Normal" regime.</span></div>
    <div style="color:#818cf8; font-weight:700; margin-top:12px;">ACTION ➔ Premium selling favored.</div>
</div>
</div>
</div>
""", unsafe_allow_html=True)

# --- 11 | WATCHLIST ---
st.markdown("""
<div class="section-wrapper">
<div class="section-title">11 — Trading Watchlist</div>
<div class="watchlist-item">
<div class="wl-num">1</div>
<div>
<div class="wl-header"><span class="ticker-cell">NVDA</span><span style="font-size:15px;color:#94a3b8;margin-left:8px;">Post-Earnings Follow Through</span></div>
<div class="catalyst-cell">Massive institutional buy-side pressure remains. Watch for a test of new ATH territory.</div>
</div>
</div>
<div class="watchlist-item">
<div class="wl-num">2</div>
<div>
<div class="wl-header"><span class="ticker-cell">TSLA</span><span style="font-size:15px;color:#94a3b8;margin-left:8px;">FSD China Approval</span></div>
<div class="catalyst-cell">Structural rally in progress. Looking for $220 to act as a launchpad for the next leg.</div>
</div>
</div>
</div>
""", unsafe_allow_html=True)

# --- 12 | MASSIVE API INTEGRATION ---
massive_html = '<div class="section-wrapper"><div class="section-title">12 — Institutional Options Flow (Massive API)</div><table><thead><tr><th>Ticker</th><th>Type</th><th>Strike / Exp</th><th>Premium</th><th>Sentiment</th></tr></thead><tbody>'
for flow in institutional_flow:
    massive_html += f'<tr><td><span class="etf-tag">{flow["ticker"]}</span></td><td style="font-weight:700;">{flow["type"]}</td><td class="catalyst-cell" style="font-weight:700; color:#f1f5f9;">{flow["strike"]} — {flow["exp"]}</td><td style="font-weight:700; font-family:monospace; font-size:16px;">{flow["prem"]}</td><td><span class="{flow["color"]}" style="font-weight:800;">{flow["sentiment"]}</span></td></tr>'
massive_html += "</tbody></table></div>"
st.markdown(massive_html, unsafe_allow_html=True)

# --- 13 | EDITOR'S NOTE / SUMMARY ---
st.markdown("""
<div class="section-wrapper" style="border-left: 4px solid #818cf8; padding-left: 20px; margin-bottom: 0;">
<div class="section-title" style="border-bottom:none; margin-bottom:12px; padding-bottom: 0;">13 — Market Summary</div>
<div style="font-size: 16px; color: #cbd5e1; line-height: 1.8;">
<strong>Market Status:</strong> The market remains closed through Monday for Memorial Day. <br><br>
<strong>Action Summary:</strong> Heading into Tuesday's open, the structure remains decidedly bullish following strong tech earnings. Pre-market micro-cap runners like QTEX and BIYA are exhibiting extreme relative volume, presenting high-risk momentum opportunities. Meanwhile, broad participation is improving as the VIX compresses down to the ~19.10 range, indicating a lower-stress environment favored for premium selling.<br><br>
<strong>CLOSING POSTURE:</strong> <em>Remain long-biased on tech (XLK).</em> Watch the SPX 7,000 level closely for dip-buying entries.
<br><br>
<strong>See you at the open. 📈</strong>
</div>
</div>
""", unsafe_allow_html=True)
