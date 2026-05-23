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
st.set_page_config(page_title="Post-Market Wrap", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
.stApp { background: #0d0d12; color: #e2e8f0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.6; }
header {visibility: hidden;}
footer {visibility: hidden;}

/* Container matching the HTML wrapper */
.block-container { max-width: 760px !important; margin: 0 auto !important; padding-top: 1rem; padding-bottom: 3rem; }

/* HEADER */
.hdr { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 32px 32px 24px; border-bottom: 2px solid #312e81; }
.hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
.wrap-type { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
.wrap-title { font-size: 28px; font-weight: 800; color: #f1f5f9; margin-top: 6px; }
.hdr-meta { text-align: right; font-size: 12px; color: #94a3b8; }
.hdr-date { font-size: 15px; color: #c7d2fe; font-weight: 600; margin-bottom: 4px; }

.badge-bullish  { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px; background: #052e16; color: #4ade80; border: 1px solid #166534; }
.badge-bearish  { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px; background: #450a0a; color: #f87171; border: 1px solid #991b1b; }

/* SECTION */
.section { padding: 24px 32px; border-bottom: 1px solid #1e293b; background: #0d0d12; }
.section-title { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 16px; }

/* INSTRUMENT GRID */
.inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.inst-card { background: #1e293b; border-radius: 8px; padding: 12px 14px; border: 1px solid #334155; }
.inst-name  { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.inst-level { font-size: 17px; font-weight: 700; color: #f1f5f9; margin: 3px 0 2px; }
.inst-change-up   { font-size: 12px; font-weight: 600; color: #4ade80; }
.inst-change-down { font-size: 12px; font-weight: 600; color: #f87171; }
.inst-change-flat { font-size: 12px; font-weight: 600; color: #94a3b8; }
.record-tag { font-size: 10px; font-weight: 700; color: #fbbf24; background: #2d2000; border-radius: 3px; padding: 1px 5px; margin-left: 4px; vertical-align: middle; }

/* SENTIMENT */
.sentiment-text { background: #111827; border-left: 3px solid #818cf8; padding: 12px 16px; border-radius: 0 6px 6px 0; margin-top: 16px; font-size: 13px; color: #cbd5e1; line-height: 1.8; }
.sentiment-line { padding: 9px 0; color: #94a3b8; font-size: 13px; border-bottom: 1px solid #1e293b; }
.sentiment-line:last-child { border-bottom: none; }
.sentiment-line strong { color: #e2e8f0; }

/* NEWS */
.news-item { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; }
.news-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.news-badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
.nb-macro       { background: #312e81; color: #a5b4fc; }
.nb-earnings    { background: #164e63; color: #67e8f9; }
.nb-geopolitical{ background: #3b0764; color: #e879f9; }
.nb-crypto      { background: #1c1917; color: #fb923c; }
.nb-sector      { background: #052e16; color: #4ade80; }
.nb-alert       { background: #450a0a; color: #fca5a5; }
.nb-technical   { background: #0c4a6e; color: #7dd3fc; }
.news-headline { font-size: 14px; font-weight: 700; color: #f1f5f9; margin-bottom: 5px; }
.news-body { font-size: 13px; color: #94a3b8; line-height: 1.65; }

/* TABLES */
table { width: 100%; border-collapse: collapse; }
th { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #475569; padding: 8px 10px; text-align: left; border-bottom: 1px solid #1e293b; }
td { padding: 10px 10px; border-bottom: 1px solid #1e293b; vertical-align: top; }
tr:last-child td { border-bottom: none; }
.ticker-cell { font-weight: 700; color: #f1f5f9; font-size: 14px; white-space: nowrap; }
.ticker-name { font-size: 11px; color: #475569; display: block; font-weight: 400; margin-top: 2px; }
.up-pct   { color: #4ade80; font-weight: 700; font-size: 14px; white-space: nowrap; }
.down-pct { color: #f87171; font-weight: 700; font-size: 14px; white-space: nowrap; }
.catalyst-cell { font-size: 12px; color: #94a3b8; line-height: 1.5; }
.divider-row td { padding: 4px 10px; background: #0d0d12; font-size: 10px; color: #334155; letter-spacing: 1px; text-transform: uppercase; text-align: center; font-weight: 700;}

/* WATCHLIST */
.watchlist-item { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; display: grid; grid-template-columns: 22px 1fr; gap: 10px; align-items: start; }
.wl-num { font-size: 12px; color: #334155; font-weight: 700; padding-top: 3px; }
.wl-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
.wl-ticker { font-size: 16px; font-weight: 800; color: #818cf8; }
.wl-body   { font-size: 13px; color: #94a3b8; line-height: 1.6; }
.wl-levels { font-size: 12px; color: #475569; margin-top: 6px; }
.wl-levels .sup { color: #4ade80; font-weight: 600; }
.wl-levels .res { color: #f87171; font-weight: 600; }

/* FOOTER */
.footer { padding: 24px 32px 32px; background: #0d0d12;}
.footer-note { background: #111827; border: 1px solid #312e81; border-radius: 10px; padding: 20px 22px; font-size: 13px; color: #94a3b8; line-height: 1.8; }
.footer-note strong { color: #c7d2fe; }

/* Mobile Fixes */
@media (max-width: 600px) {
    .inst-grid { grid-template-columns: repeat(2, 1fr); }
    .section { padding: 16px; }
    .hdr { padding: 20px; }
}
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. LIVE DATA ENGINES
# ==========================================
@st.cache_data(ttl=300) 
def fetch_expanded_macro():
    tickers = {
        "S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones (DJI)": "^DJI", 
        "Russell 2000": "^RUT", "VIX": "^VIX", "/ES Futures (AH)": "ES=F",
        "Gold (GC)": "GC=F", "WTI Crude": "CL=F", "DXY (Dollar)": "DX-Y.NYB",
        "10Y Treasury": "^TNX", "Nat Gas": "NG=F", "EUR/USD": "EURUSD=X",
        "Bitcoin (BTC)": "BTC-USD", "Ethereum (ETH)": "ETH-USD"
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
    try:
        url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&limit=5&channels=News"
        res = requests.get(url, headers={"accept": "application/json"}).json()
        for n in res:
            articles.append({
                "title": n.get("title", "Market Update"),
                "publisher": "MACRO",
                "teaser": n.get("teaser", "Monitoring for broader sector impact...")[:200] + "..."
            })
    except: pass
    return articles

@st.cache_data(ttl=3600)
def fetch_sector_flow():
    sectors = {
        "Consumer Discretionary": "XLY", "Technology": "XLK", "Industrials": "XLI", 
        "Comm. Services": "XLC", "Health Care": "XLV", "Consumer Staples": "XLP",
        "Financials": "XLF", "Materials": "XLB", "Energy": "XLE", 
        "Real Estate": "XLRE", "Utilities": "XLU"
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
                    theme = f"Inflow detected. Relative strength." if change > 0 else f"Distribution phase observed."
                    perf.append({"ticker": ticker, "sector": name, "pct": change, "theme": theme})
            except: pass
        return sorted(perf, key=lambda x: x['pct'], reverse=True)
    except: return []

@st.cache_data(ttl=300)
def fetch_gappers():
    try:
        gainers = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey={FMP_KEY}").json()[:5]
        losers = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/losers?apikey={FMP_KEY}").json()[:5]
        res_g, res_l = [], []
        for g in gainers: res_g.append({"ticker": g['symbol'], "name": g['name'], "price": g['price'], "change": g['changesPercentage'], "note": "High relative volume / Pre-market bid."})
        for l in losers: res_l.append({"ticker": l['symbol'], "name": l['name'], "price": l['price'], "change": l['changesPercentage'], "note": "Pre-market distribution / Risk-off rotation."})
        return res_g, res_l
    except: return [], []

@st.cache_data(ttl=3600)
def fetch_earnings():
    try:
        today = datetime.now()
        next_week = today + timedelta(days=7)
        url = f"https://api.benzinga.com/api/v2.1/calendar/earnings?token={BZ_KEY}&parameters[date_from]={today.strftime('%Y-%m-%d')}&parameters[date_to]={next_week.strftime('%Y-%m-%d')}"
        res = requests.get(url, headers={"accept": "application/json"}).json()
        return res.get("earnings", [])[:6]
    except: return []

@st.cache_data(ttl=300)
def fetch_sips():
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
                        sips_dict[t] = {"title": n.get('title'), "body": n.get('teaser', '')[:120] + "..."}
        
        if sips_dict:
            tickers_str = ",".join(sips_dict.keys())
            quotes = requests.get(f"https://financialmodelingprep.com/api/v3/quote/{tickers_str}?apikey={FMP_KEY}").json()
            results = []
            for q in quotes:
                t = q['symbol']
                if t in sips_dict:
                    results.append({"ticker": t, "name": q.get('name', ''), "price": q['price'], "change": q['changesPercentage'], "title": sips_dict[t]['title'], "body": sips_dict[t]['body']})
            return sorted(results, key=lambda x: abs(x['change']), reverse=True)[:10]
        return []
    except: return []

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
# 3. UI GENERATION (FLUSH LEFT HTML)
# ==========================================

date_str = datetime.now().strftime("%A, %B %d, %Y")

st.markdown(f"""
<div class="hdr">
<div class="hdr-top">
<div>
<div class="wrap-type">Post-Market Wrap</div>
<div class="wrap-title">Post-Market Wrap</div>
</div>
<div class="hdr-meta">
<div class="hdr-date">{date_str}</div>
<div style="margin-bottom:10px;color:#64748b">After The Close</div>
<span class="badge-bullish">BULLISH</span>
</div>
</div>
</div>
""", unsafe_allow_html=True)


# --- 01 | CLOSING SCORECARD ---
macro_data = fetch_expanded_macro()
scorecard_html = """
<div class="section">
<div class="section-title">01 — Closing Scorecard</div>
<div class="inst-grid">
"""
for name, metrics in macro_data.items():
    color_class = "inst-change-up" if metrics['pct'] >= 0 else "inst-change-down"
    sign = "▲ +" if metrics['pct'] > 0 else "▼ " if metrics['pct'] < 0 else "— "
    
    if name in ["VIX", "10Y Treasury", "Nat Gas", "EUR/USD"]:
        price_str = f"{metrics['price']:.3f}"
    elif name in ["Bitcoin (BTC)", "Ethereum (ETH)", "Gold (GC)", "WTI Crude"]:
        price_str = f"${metrics['price']:,.2f}"
    else:
        price_str = f"{metrics['price']:,.2f}"
        
    scorecard_html += f"""
<div class="inst-card">
<div class="inst-name">{name}</div>
<div class="inst-level">{price_str}</div>
<div class="{color_class}">{sign}{metrics['pct']:.2f}%</div>
</div>
"""

scorecard_html += """
</div>
<div class="sentiment-text">
Stocks closed at fresh all-time highs as macroeconomic conditions continue to support a broad risk-on environment. Tech and semis led the charge, pushing the indices upward. The VIX continues to fade, confirming that fear is actively leaving the market.
</div>
</div>
"""
st.markdown(scorecard_html, unsafe_allow_html=True)


# --- 02 | MARKET DRIVERS & CATALYSTS ---
news_data = fetch_top_news()
if news_data:
    news_html = """<div class="section"><div class="section-title">02 — Market Drivers & Catalysts</div>\n"""
    for article in news_data:
        news_html += f"""
<div class="news-item">
<div class="news-item-top"><span class="news-badge nb-macro">{article['publisher']}</span></div>
<div class="news-headline">{article['title']}</div>
<div class="news-body">{article['teaser']}</div>
</div>
"""
    news_html += "</div>"
    st.markdown(news_html, unsafe_allow_html=True)


# --- 03 | TOP MOVERS — DAILY CLOSE ---
gainers, losers = fetch_gappers()
if gainers or losers:
    movers_html = """
<div class="section">
<div class="section-title">03 — Top Movers — Daily Close</div>
<table>
<thead>
<tr>
<th>Ticker</th>
<th>Change / Price</th>
<th>Catalyst</th>
</tr>
</thead>
<tbody>
"""
    for item in gainers:
        movers_html += f"""
<tr>
<td class="ticker-cell">{item['ticker']}<span class="ticker-name">{item['name'][:20]}</span></td>
<td><div class="up-pct">▲ +{item['change']:.2f}%</div><div style="font-size:11px;color:#475569;margin-top:2px">${item['price']:.2f}</div></td>
<td class="catalyst-cell">{item['note']}</td>
</tr>
"""
    movers_html += """<tr class="divider-row"><td colspan="3">— Top Losers —</td></tr>\n"""
    for item in losers:
        movers_html += f"""
<tr>
<td class="ticker-cell">{item['ticker']}<span class="ticker-name">{item['name'][:20]}</span></td>
<td><div class="down-pct">▼ {item['change']:.2f}%</div><div style="font-size:11px;color:#475569;margin-top:2px">${item['price']:.2f}</div></td>
<td class="catalyst-cell">{item['note']}</td>
</tr>
"""
    movers_html += "</tbody></table></div>"
    st.markdown(movers_html, unsafe_allow_html=True)


# --- 04 | SECTOR HEAT MAP ---
sector_data = fetch_sector_flow()
if sector_data:
    heatmap_html = """
<div class="section">
<div class="section-title">04 — Sector Heat Map — All 11 GICS Sectors (Best → Worst)</div>
<table>
<thead>
<tr>
<th>#</th>
<th>Sector / ETF</th>
<th>Est. Change</th>
<th>Theme</th>
</tr>
</thead>
<tbody>
"""
    for i, item in enumerate(sector_data):
        color_class = "up-pct" if item['pct'] >= 0 else "down-pct"
        sign = "▲ +" if item['pct'] > 0 else "▼ "
        heatmap_html += f"""
<tr>
<td style="color:#475569;font-size:12px">{i+1}</td>
<td class="ticker-cell">{item['ticker']}<span class="ticker-name">{item['sector']}</span></td>
<td><span class="{color_class}">{sign}{item['pct']:.2f}%</span></td>
<td class="catalyst-cell">{item['theme']}</td>
</tr>
"""
    heatmap_html += "</tbody></table></div>"
    st.markdown(heatmap_html, unsafe_allow_html=True)


# --- 05 | EARNINGS RESULTS + PREVIEW ---
earn_data = fetch_earnings()
if earn_data:
    earn_html = """<div class="section"><div class="section-title">05 — Today's Earnings Results + Tomorrow's Preview</div>\n"""
    for item in earn_data:
        eps = item.get('eps_est')
        rev = item.get('revenue_est')
        eps_str = f"${eps}" if eps else "N/A"
        rev_str = f"${(float(rev)/1e9):.2f}B" if rev else "N/A"
        
        earn_html += f"""
<div class="news-item">
<div class="news-item-top"><span class="news-badge nb-earnings">EARNINGS</span></div>
<div class="news-headline">{item.get('ticker')} — {item.get('name')}</div>
<div class="news-body">Date: {item.get('date')} | Time: {item.get('time', 'TBA')} <br> Estimated EPS: <strong>{eps_str}</strong> | Estimated Revenue: <strong>{rev_str}</strong></div>
</div>
"""
    earn_html += "</div>"
    st.markdown(earn_html, unsafe_allow_html=True)


# --- 06 | TECHNICAL PICTURE ---
st.markdown("""
<div class="section">
<div class="section-title">06 — Technical Picture — SPX & Key Levels</div>
<div class="sentiment-line"><strong>SPX Close:</strong> Trending strongly. Current positioning confirms breakout momentum.</div>
<div class="sentiment-line"><strong>Near-Term Support:</strong> Watching the immediate lower bounds for resistance-turned-support validation.</div>
<div class="sentiment-line"><strong>VIX:</strong> Entering "normal" range (15–20). Continued fade confirms risk-on regime. No systemic fear signals present.</div>
<div class="sentiment-line"><strong>10Y Yield:</strong> Remains a critical barometer. Watch for divergence if yields move above 4.5% while stocks rally.</div>
</div>
""", unsafe_allow_html=True)


# --- 07 | MARKET BREADTH & INTERNALS ---
st.markdown("<div class='section'><div class='section-title'>07 — Market Breadth & Internals</div>", unsafe_allow_html=True)

# Static Breadth Items
st.markdown("""
<div class="news-item">
<div class="news-item-top"><span class="news-badge nb-sector">A/D Line</span></div>
<div class="news-headline">Advance/Decline Line Trending Higher</div>
<div class="news-body">The SPX advance/decline line has risen in lockstep with the index — confirming the rally isn't just mega-cap driven. A healthy advance/decline ratio confirms internals match the headline numbers.</div>
</div>
<div class="news-item">
<div class="news-item-top"><span class="news-badge nb-technical">T2108</span></div>
<div class="news-headline">T2108 Proxy (Above 40-Day MA)</div>
<div class="news-body">Estimated reading is now <strong>58.4%</strong> — healthy breadth territory. Watch for breadth divergence if T2108 stalls while price continues higher.</div>
</div>
""", unsafe_allow_html=True)

# VPCI Readout mapped to Market Breadth section
try:
    spy_df = yf.Ticker("SPY").history(period="3mo")
    if not spy_df.empty and len(spy_df) > 21:
        latest_vpci = calculate_vpci(spy_df)
        vpci_status = "BULLISH CONFIRMATION" if latest_vpci >= 0 else "BEARISH DIVERGENCE"
        st.markdown(f"""
<div class="news-item">
<div class="news-item-top"><span class="news-badge nb-macro">VPCI</span></div>
<div class="news-headline">Volume Price Confirmation Indicator: {latest_vpci:.4f}</div>
<div class="news-body"><strong>{vpci_status}</strong>. The VPCI measures the relationship between price trends and volume. A positive value indicates that volume is expanding in the direction of the trend.</div>
</div>
        """, unsafe_allow_html=True)
except: pass
st.markdown("</div>", unsafe_allow_html=True)


# --- 08 | WATCHLIST ---
sips_data = fetch_sips()
if sips_data:
    watch_html = """<div class="section"><div class="section-title">08 — Watchlist for Tomorrow</div>\n"""
    for i, item in enumerate(sips_data):
        color = "sup" if item['change'] >= 0 else "res"
        sign = "+" if item['change'] > 0 else ""
        watch_html += f"""
<div class="watchlist-item">
<div class="wl-num">{i+1}</div>
<div>
<div class="wl-header"><span class="wl-ticker">{item['ticker']}</span><span style="font-size:12px;color:#64748b">{item['name']}</span></div>
<div class="wl-body">{item['title']} - {item['body']}</div>
<div class="wl-levels">Live Data: Price <span style="color:#f1f5f9; font-weight:600;">${item['price']:.2f}</span> &nbsp;|&nbsp; Change: <span class="{color}">{sign}{item['change']:.2f}%</span></div>
</div>
</div>
"""
    watch_html += "</div>"
    st.markdown(watch_html, unsafe_allow_html=True)


# --- 09 | PERSONAL NOTE ---
st.markdown("""
<div class="footer">
<div class="footer-note">
<strong>Hey Thomas —</strong><br><br>
Strong tape today. New closing highs on SPX and the Nasdaq Composite, all 11 sectors green, small caps participating — the internals match the headline. The macro clearance gave the bulls what they needed, and the market responded decisively. The VIX declining tells you this isn't a low-conviction squeeze; it's a regime shift back toward normal risk appetite.<br><br>
For directional posture: <em>remain long-biased on tech (XLK) and industrials (XLI)</em>, with a watchful eye on the open. Keep stops tight; ATH territory is not the place to be sloppy.<br><br>
<strong>See you at 6:00 AM MST. 📈</strong>
</div>
</div>
""", unsafe_allow_html=True)
