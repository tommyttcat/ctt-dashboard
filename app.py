import streamlit as st
import yfinance as yf
import pandas as pd
import requests
from datetime import datetime, timedelta

# ==========================================
# API KEYS
# ==========================================
BZ_KEY = "bz.4DVR2L3LKQD6KU5Z4CHZPPNE5MPV2KLQ"
FMP_KEY = "WMMhcffuHSYVTceXryrt4tHC8GXcsB0g"

# ==========================================
# 1. PAGE CONFIGURATION & EXACT HTML/CSS
# ==========================================
st.set_page_config(page_title="Confluence Trading Tools", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
<style>
/* Reset and Base App Styling */
.stApp { 
    background: #0d0d12; 
    color: #e2e8f0; 
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; 
    font-size: 18px; 
    line-height: 1.6; 
}
header {visibility: hidden;}
footer {visibility: hidden;}

/* Wrap constraint */
.block-container { max-width: 1100px !important; margin: 0 auto !important; padding-top: 1rem; padding-bottom: 3rem; }

/* FLOATING CLOUD CARDS */
.cloud-card {
    background: #111827;
    border: none; 
    border-radius: 16px;
    padding: 36px 40px;
    margin-bottom: 40px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
}

/* HEADER CLOUD */
.hdr { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 44px 44px 34px; border: none; border-radius: 16px; margin-bottom: 40px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3); }
.hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
.wrap-type { font-size: 15px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
.wrap-title { font-size: 42px; font-weight: 800; color: #f1f5f9; margin-top: 10px; }
.hdr-meta { text-align: right; font-size: 16px; color: #94a3b8; }
.hdr-date { font-size: 20px; color: #c7d2fe; font-weight: 600; margin-bottom: 8px; }

.badge-bullish  { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #052e16; color: #4ade80; border: 1px solid #166534; }
.badge-bearish  { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #450a0a; color: #f87171; border: 1px solid #991b1b; }
.badge-mixed    { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #2d2000; color: #fbbf24; border: 1px solid #92400e; }
.badge-cautious { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #1c1917; color: #fb923c; border: 1px solid #9a3412; }
.badge-live     { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; background: #991b1b; color: #fca5a5; border: 1px solid #f87171; margin-left: 12px; vertical-align: middle; animation: pulse 2s infinite;}

@keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.6; }
    100% { opacity: 1; }
}

/* SECTION TITLE */
.section-title { font-size: 16px; font-weight: 800; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 24px; border-bottom: 2px solid #1e293b; padding-bottom: 12px;}

/* INSTRUMENT GRID */
.inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.inst-card { background: #1e293b; border-radius: 12px; padding: 24px 26px; border: none; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.inst-name  { font-size: 14px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.inst-level { font-size: 28px; font-weight: 700; color: #f1f5f9; margin: 6px 0 6px; }
.inst-change-up   { font-size: 16px; font-weight: 600; color: #4ade80; }
.inst-change-down { font-size: 16px; font-weight: 600; color: #f87171; }
.inst-change-flat { font-size: 16px; font-weight: 600; color: #94a3b8; }

/* NEWS */
.news-item { background: #1e293b; border: none; border-radius: 12px; padding: 26px 28px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.news-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.news-badge { padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
.nb-macro       { background: #312e81; color: #a5b4fc; }
.news-headline { font-size: 20px; font-weight: 700; color: #f1f5f9; margin-bottom: 8px; }
.news-body { font-size: 16px; color: #cbd5e1; line-height: 1.65; }

/* TABLES */
table { width: 100%; border-collapse: collapse; border: none !important; }
th, td { border-left: none !important; border-right: none !important; }
th { font-size: 14px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #64748b; padding: 16px 12px; text-align: left; border-bottom: 2px solid #1e293b !important; border-top: none !important; }
td { padding: 18px 12px; border-bottom: 1px solid #1e293b !important; vertical-align: top; border-top: none !important; }
tr:last-child td { border-bottom: none !important; }
.ticker-cell { font-weight: 700; color: #f1f5f9; font-size: 20px; white-space: nowrap; }
.catalyst-cell { font-size: 16px; color: #cbd5e1; line-height: 1.6; }

/* Tags */
.etf-tag { background: #0f172a; color: #60a5fa; padding: 6px 12px; border-radius: 6px; font-family: monospace; font-size: 16px; font-weight: 700; border: 1px solid #1e2b4d;}
.up-pct   { color: #4ade80; font-weight: 700; font-size: 18px; white-space: nowrap; }
.down-pct { color: #f87171; font-weight: 700; font-size: 18px; white-space: nowrap; }

/* Mobile Fixes */
@media (max-width: 768px) {
    .inst-grid { grid-template-columns: repeat(2, 1fr); }
    .cloud-card { padding: 24px; }
    .hdr { padding: 28px; }
}
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. LIVE DATA ENGINES
# ==========================================
@st.cache_data(ttl=300) 
def fetch_expanded_macro():
    tickers = {
        "S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones": "^DJI", 
        "Russell 2000": "^RUT", "VIX": "^VIX", "10Y Treasury": "^TNX",
        "Gold (GC)": "GC=F", "WTI Crude": "CL=F", "Bitcoin (BTC)": "BTC-USD", "Ethereum (ETH)": "ETH-USD"
    }
    data = {}
    try:
        for name, ticker in tickers.items():
            tick = yf.Ticker(ticker)
            hist = tick.history(period="2d")
            if len(hist) >= 2:
                prev_close = hist['Close'].iloc[0]
                curr_close = hist['Close'].iloc[1]
                pct_change = ((curr_close - prev_close) / prev_close) * 100
                data[name] = {"price": curr_close, "pct": pct_change}
            else:
                data[name] = {"price": 0.0, "pct": 0.0}
    except:
        for name in tickers.keys(): data[name] = {"price": 0.0, "pct": 0.0}
    return data

@st.cache_data(ttl=600)
def fetch_top_news():
    articles = []
    # 1. Fetch Benzinga Top 5
    try:
        url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&limit=5&channels=News"
        res = requests.get(url, headers={"accept": "application/json"}).json()
        for n in res:
            articles.append({
                "title": n.get("title", "Market Update"),
                "publisher": "BZ WIRE",
                "teaser": n.get("teaser", "Monitoring for broader sector impact...")[:140] + "..."
            })
    except: pass

    # 2. Fetch Yahoo Finance Top 5
    try:
        yf_news = yf.Ticker("SPY").news[:5]
        for n in yf_news:
            articles.append({
                "title": n.get("title", "Market Update"),
                "publisher": n.get("publisher", "Yahoo Finance"),
                "teaser": "Latest coverage and market commentary from " + n.get("publisher", "Yahoo Finance") + "."
            })
    except: pass
    return articles[:10]

@st.cache_data(ttl=3600)
def fetch_sector_flow():
    sectors = {
        "Technology": "XLK", "Consumer Disc": "XLY", "Industrials": "XLI", 
        "Comm. Services": "XLC", "Health Care": "XLV", "Financials": "XLF", 
        "Consumer Staples": "XLP", "Materials": "XLB", "Energy": "XLE", "Real Estate": "XLRE"
    }
    perf = []
    try:
        data = yf.download(list(sectors.values()), period="5d", progress=False)['Close']
        for name, ticker in sectors.items():
            try:
                close_prices = data[ticker].dropna()
                if len(close_prices) >= 2:
                    prev = close_prices.iloc[-2]
                    curr = close_prices.iloc[-1]
                    change = ((curr - prev) / prev) * 100
                    theme = f"Inflow detected. {name} strength." if change > 0 else f"Distribution phase. {name} weakness."
                    perf.append({"ticker": ticker, "sector": name, "pct": change, "theme": theme})
            except: pass
        return sorted(perf, key=lambda x: x['pct'], reverse=True)
    except: return []

@st.cache_data(ttl=300)
def fetch_gappers():
    # Exactly Top 10 (5 Gainers, 5 Losers)
    try:
        gainers = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey={FMP_KEY}").json()[:5]
        losers = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/losers?apikey={FMP_KEY}").json()[:5]
        results = []
        for g in gainers: results.append({"ticker": g['symbol'], "price": g['price'], "change": g['changesPercentage'], "type": "Gainer"})
        for l in losers: results.append({"ticker": l['symbol'], "price": l['price'], "change": l['changesPercentage'], "type": "Loser"})
        return results
    except: return []

@st.cache_data(ttl=300)
def fetch_sips():
    # Stocks in Play: Scan recent news for explicit tickers, cross-reference with FMP for live quotes
    try:
        url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&limit=30"
        res = requests.get(url, headers={"accept": "application/json"}).json()
        sips_dict = {}
        for n in res:
            stocks = n.get('stocks', [])
            if stocks:
                for s in stocks:
                    t = s.get('name')
                    if t and t not in sips_dict and len(sips_dict) < 10:
                        sips_dict[t] = n.get('title')
        
        if sips_dict:
            tickers_str = ",".join(sips_dict.keys())
            quotes = requests.get(f"https://financialmodelingprep.com/api/v3/quote/{tickers_str}?apikey={FMP_KEY}").json()
            results = []
            for q in quotes:
                t = q['symbol']
                if t in sips_dict:
                    results.append({
                        "ticker": t,
                        "price": q['price'],
                        "change": q['changesPercentage'],
                        "catalyst": sips_dict[t]
                    })
            return sorted(results, key=lambda x: abs(x['change']), reverse=True)[:10]
        return []
    except: return []

@st.cache_data(ttl=300)
def fetch_liquidity_basket():
    tickers = ["SPY", "QQQ", "IWM", "NVDA", "AAPL", "AMD", "TSLA", "META", "AMZN", "MSFT"]
    results = []
    try:
        data = yf.download(tickers, period="5d", progress=False)
        for t in tickers:
            current = data['Close'][t].iloc[-1]
            bias = "LONG" if current > data['Close'][t].mean() else "SHORT"
            results.append({"ticker": t, "price": current, "bias": bias, "color": "badge-bullish" if bias == "LONG" else "badge-bearish"})
        return results
    except: return []

@st.cache_data(ttl=3600)
def fetch_calendar_data(cal_type="earnings"):
    try:
        today = datetime.now()
        next_week = today + timedelta(days=7)
        date_from = today.strftime("%Y-%m-%d")
        date_to = next_week.strftime("%Y-%m-%d")
        url = f"https://api.benzinga.com/api/v2.1/calendar/{cal_type}?token={BZ_KEY}&parameters[date_from]={date_from}&parameters[date_to]={date_to}"
        return requests.get(url, headers={"accept": "application/json"}).json()
    except: return {}

def calculate_vpci(df, short_window=5, long_window=21):
    try:
        df['Vol_x_Price'] = df['Close'] * df['Volume']
        v_short = df['Vol_x_Price'].rolling(window=short_window).sum() / df['Volume'].rolling(window=short_window).sum()
        v_long = df['Vol_x_Price'].rolling(window=long_window).sum() / df['Volume'].rolling(window=long_window).sum()
        sma_long = df['Close'].rolling(window=long_window).mean()
        sma_short = df['Close'].rolling(window=short_window).mean()
        return ((v_long - sma_long) * (v_short / sma_short) * (df['Volume'].rolling(window=short_window).mean() / df['Volume'].rolling(window=long_window).mean())).iloc[-1]
    except: return 0.0

# ==========================================
# 3. UI GENERATION
# ==========================================

date_str = datetime.now().strftime("%A, %B %d, %Y")

st.markdown(f"""
<div class="hdr">
<div class="hdr-top">
<div>
<div class="wrap-type">Market Briefing</div>
<div class="wrap-title">Confluence Trading Tools</div>
</div>
<div class="hdr-meta">
<div class="hdr-date">{date_str}</div>
<div style="margin-bottom:10px;color:#64748b">System Status</div>
<span class="badge-bullish">ONLINE</span>
</div>
</div>
</div>
""", unsafe_allow_html=True)


# --- 01 | SCORECARD ---
macro_data = fetch_expanded_macro()
scorecard_html = """<div class="cloud-card"><div class="section-title">01 — Futures & Macro Scorecard <span class="badge-live">● LIVE DATA</span></div><div class="inst-grid">\n"""
for name, metrics in macro_data.items():
    color_class = "inst-change-up" if metrics['pct'] > 0 else "inst-change-down" if metrics['pct'] < 0 else "inst-change-flat"
    sign = "▲ +" if metrics['pct'] > 0 else "▼ " if metrics['pct'] < 0 else "— "
    price_str = f"{metrics['price']:.3f}" if name in ["VIX", "10Y Treasury"] else f"${metrics['price']:,.2f}" if name in ["Bitcoin (BTC)", "Ethereum (ETH)", "WTI Crude"] else f"{metrics['price']:,.2f}"
    scorecard_html += f"""<div class="inst-card"><div class="inst-name">{name}</div><div class="inst-level">{price_str}</div><div class="{color_class}">{sign}{metrics['pct']:.2f}%</div></div>\n"""
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)


# --- 02 | LIVE NEWS ---
news_data = fetch_top_news()
if news_data:
    news_html = """<div class="cloud-card"><div class="section-title">02 — Market Catalysts & Breaking News</div>\n"""
    for article in news_data:
        news_html += f"""<div class="news-item"><div class="news-item-top"><span class="news-badge nb-macro">{article['publisher']}</span></div><div class="news-headline">{article['title']}</div><div class="news-body">{article['teaser']}</div></div>\n"""
    news_html += "</div>"
    st.markdown(news_html, unsafe_allow_html=True)


# --- 03 | SECTORS ---
sector_data = fetch_sector_flow()
if sector_data:
    heatmap_html = """<div class="cloud-card"><div class="section-title">03 — Sector Performance & Themes</div><table><thead><tr><th>#</th><th>Sector / ETF</th><th>Live Change</th><th>Theme</th></tr></thead><tbody>\n"""
    for i, item in enumerate(sector_data):
        color_class = "up-pct" if item['pct'] >= 0 else "down-pct"
        sign = "▲ +" if item['pct'] > 0 else "▼ "
        heatmap_html += f"""<tr><td style="color:#64748b;font-weight:700;">{i+1}</td><td class="ticker-cell">{item['ticker']} <span style="color:#94a3b8; font-weight:400; font-size:16px;">— {item['sector']}</span></td><td><span class="{color_class}">{sign}{item['pct']:.2f}%</span></td><td class="catalyst-cell">{item['theme']}</td></tr>\n"""
    heatmap_html += "</tbody></table></div>"
    st.markdown(heatmap_html, unsafe_allow_html=True)


# --- 04 | PRE/POST MARKET GAPPERS ---
gappers_data = fetch_gappers()
if gappers_data:
    gappers_html = """<div class="cloud-card"><div class="section-title">04 — Pre/Post Market Gappers (Top 10)</div><table><thead><tr><th>Ticker</th><th>Price</th><th>Gap %</th><th>Status</th></tr></thead><tbody>\n"""
    for item in gappers_data:
        color_class = "up-pct" if item['change'] >= 0 else "down-pct"
        sign = "▲ +" if item['change'] > 0 else "▼ "
        bias_badge = "<span class='badge-bullish'>MOMENTUM</span>" if item['change'] > 0 else "<span class='badge-bearish'>RISK-OFF</span>"
        gappers_html += f"""<tr><td class="ticker-cell"><span class="etf-tag">{item['ticker']}</span></td><td class="catalyst-cell" style="color:#f1f5f9;">${item['price']:.2f}</td><td><div class="{color_class}">{sign}{item['change']:.2f}%</div></td><td>{bias_badge}</td></tr>\n"""
    gappers_html += "</tbody></table></div>"
    st.markdown(gappers_html, unsafe_allow_html=True)


# --- 05 | STOCKS IN PLAY (SIPS) ---
sips_data = fetch_sips()
if sips_data:
    sips_html = """<div class="cloud-card"><div class="section-title">05 — Stocks in Play (SIPS) — Catalyst Movers</div><table><thead><tr><th>Ticker</th><th>Live Price</th><th>Change</th><th>News Catalyst</th></tr></thead><tbody>\n"""
    for item in sips_data:
        color_class = "up-pct" if item['change'] >= 0 else "down-pct"
        sign = "▲ +" if item['change'] > 0 else "▼ "
        sips_html += f"""<tr><td class="ticker-cell"><span class="etf-tag">{item['ticker']}</span></td><td class="catalyst-cell" style="color:#f1f5f9;">${item['price']:.2f}</td><td><div class="{color_class}">{sign}{item['change']:.2f}%</div></td><td class="catalyst-cell">{item['catalyst']}</td></tr>\n"""
    sips_html += "</tbody></table></div>"
    st.markdown(sips_html, unsafe_allow_html=True)


# --- 06 | LIQUIDITY BASKET ---
play_data = fetch_liquidity_basket()
if play_data:
    play_html = """<div class="cloud-card"><div class="section-title">06 — Liquidity Basket (Algo Bias vs 5D SMA)</div><table><thead><tr><th>Ticker</th><th>Live Price</th><th>Algo Bias</th></tr></thead><tbody>\n"""
    for item in play_data:
        play_html += f"""<tr><td class="ticker-cell">{item['ticker']}</td><td class="catalyst-cell">${item['price']:.2f}</td><td><span class="{item['color']}">{item['bias']}</span></td></tr>\n"""
    play_html += "</tbody></table></div>"
    st.markdown(play_html, unsafe_allow_html=True)


# --- 07 | BREADTH & VPCI (COMBINED CLOUD) ---
vpci_html = ""
try:
    spy_df = yf.Ticker("SPY").history(period="3mo")
    if not spy_df.empty and len(spy_df) > 21:
        latest_vpci = calculate_vpci(spy_df)
        vpci_color = "up-pct" if latest_vpci >= 0 else "down-pct"
        vpci_status = "BULLISH CONFIRMATION" if latest_vpci >= 0 else "BEARISH DIVERGENCE"
        vpci_html = f"""<div class="news-item" style="border-left: 6px solid #818cf8;"><div style="font-size: 14px; font-weight: 700; color: #818cf8; text-transform: uppercase; margin-bottom: 8px;">Current VPCI Reading (SPY)</div><div style="font-size: 32px; font-weight: 800; margin-bottom: 12px;"><span class="{vpci_color}">{latest_vpci:.4f}</span> | <span style="font-size: 24px; font-weight: 700; color:#f1f5f9;">{vpci_status}</span></div><div style="font-size: 18px; line-height: 1.6; color: #cbd5e1;">The Volume Price Confirmation Indicator (VPCI) measures the relationship between price trends and volume. A positive value indicates that volume is expanding in the direction of the trend, confirming bullish strength.</div></div>"""
except:
    vpci_html = "<div class='news-item'>VPCI data syncing...</div>"

st.markdown(f"""
<div class="cloud-card">
    <div class="section-title">07 — Sentiment, Breadth & Technicals</div>
    <div class="inst-grid" style="margin-bottom: 28px;">
        <div class="inst-card"><div class="inst-name">T2108 (Above 40D MA)</div><div class="inst-level">58.4%</div><div class="inst-change-up">Healthy Breadth</div></div>
        <div class="inst-card"><div class="inst-name">Put/Call Ratio</div><div class="inst-level">0.82</div><div class="inst-change-up">Bullish Bias</div></div>
        <div class="inst-card"><div class="inst-name">SPX > 50D Moving Avg</div><div class="inst-level">~72%</div><div class="inst-change-up">Strong Trend</div></div>
    </div>
    {vpci_html}
</div>
""", unsafe_allow_html=True)


# --- 08 | ECONOMIC DATA (WEEK AHEAD) ---
econ_res = fetch_calendar_data("economics")
econ_data = econ_res.get("economics", [])[:8]
if econ_data:
    econ_html = """<div class="cloud-card"><div class="section-title">08 — Economic Calendar (Week Ahead)</div><table><thead><tr><th>Date & Time</th><th>Release</th><th>Impact</th></tr></thead><tbody>\n"""
    for item in econ_data:
        imp = item.get('importance', 3)
        impact_str = "HIGH" if imp >= 4 else ("MED" if imp == 3 else "LOW")
        color = "badge-bearish" if impact_str == "HIGH" else "badge-mixed" if impact_str == "MED" else "badge-cautious"
        d_str = item.get('date', '')
        t_str = item.get('time', '')
        dt_display = f"{d_str} {t_str}".strip()
        econ_html += f"""<tr><td class="ticker-cell" style="font-size:16px;">{dt_display}</td><td class="catalyst-cell">{item.get('description', 'Data Release')}</td><td><span class="{color}">{impact_str}</span></td></tr>\n"""
    econ_html += "</tbody></table></div>"
    st.markdown(econ_html, unsafe_allow_html=True)


# --- 09 | EARNINGS (WEEK AHEAD) ---
earn_res = fetch_calendar_data("earnings")
earn_data = earn_res.get("earnings", [])[:10]
if earn_data:
    earn_html = """<div class="cloud-card"><div class="section-title">09 — Earnings Calendar (Week Ahead)</div><table><thead><tr><th>Date</th><th>Ticker</th><th>Company</th><th>EPS Est.</th><th>Rev Est.</th></tr></thead><tbody>\n"""
    for item in earn_data:
        eps = item.get('eps_est')
        rev = item.get('revenue_est')
        eps_str = f"${eps}" if eps else "N/A"
        rev_str = f"${(float(rev)/1e9):.2f}B" if rev else "N/A"
        date_raw = item.get('date', '')
        earn_html += f"""<tr><td class="catalyst-cell" style="font-size:16px;">{date_raw}</td><td class="ticker-cell"><span class="etf-tag">{item.get('ticker')}</span></td><td class="catalyst-cell" style="color:#f1f5f9;">{item.get('name')}</td><td class="catalyst-cell">{eps_str}</td><td class="catalyst-cell">{rev_str}</td></tr>\n"""
    earn_html += "</tbody></table></div>"
    st.markdown(earn_html, unsafe_allow_html=True)
else:
    st.markdown("<div class='cloud-card'><div class='section-title'>09 — Earnings Calendar</div><div class='catalyst-cell'>No major earnings scheduled.</div></div>", unsafe_allow_html=True)


# --- 10 | EDITOR'S NOTE ---
st.markdown("""
<div class="cloud-card" style="border-left: 6px solid #818cf8;">
<div class="section-title" style="border-bottom:none; margin-bottom:12px;">10 — Editor's Morning Note</div>
<div style="font-size: 18px; color: #cbd5e1; line-height: 1.8;">
<strong>Market Momentum (MKM)</strong> is synchronized across the hourly timeframe, indicating potential for a midday pivot. <br><br>
The real test today is the interaction with the 4.2% level on the 10Y Yield. Watch for a rotation out of heavily weighted tech names into defensive posturing if yields spike rapidly. <br><br>
Keep in mind that <strong>Monday, May 25 is Memorial Day</strong>, so markets will be closed. Plan your weekend risk exposure accordingly.<br><br>
<strong>CLOSING POSTURE:</strong> <em>Tactical long into the weekend with semis & AI-optics; pair-trade the energy/healthcare weakness against tech strength.</em>
<br><br>
<strong>See you at the close. 📈</strong>
</div>
</div>
""", unsafe_allow_html=True)
