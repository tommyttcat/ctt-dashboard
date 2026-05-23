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
AV_KEY = "JDYOYHLL40FDFOUK"

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

/* FLOATING CLOUD CARDS - NO BORDERS */
.cloud-card {
background: #111827;
border: none !important; 
border-radius: 16px;
padding: 36px 40px;
margin-bottom: 40px;
box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
}

/* HEADER CLOUD */
.hdr { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 44px 44px 34px; border: none !important; border-radius: 16px; margin-bottom: 40px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3); }
.hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
.wrap-type { font-size: 15px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
.wrap-title { font-size: 42px; font-weight: 800; color: #f1f5f9; margin-top: 10px; }
.hdr-meta { text-align: right; font-size: 16px; color: #94a3b8; }
.hdr-date { font-size: 20px; color: #c7d2fe; font-weight: 600; margin-bottom: 8px; }

/* STATUS BADGES */
.badge-bullish { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #052e16; color: #4ade80; border: none; }
.badge-bearish { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #450a0a; color: #f87171; border: none; }
.badge-mixed { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #2d2000; color: #fbbf24; border: none; }
.badge-live { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; background: #991b1b; color: #fca5a5; margin-left: 12px; vertical-align: middle; animation: pulse 2s infinite; border: none;}

@keyframes pulse {
0% { opacity: 1; }
50% { opacity: 0.6; }
100% { opacity: 1; }
}

/* SECTION TITLE */
.section-title { font-size: 16px; font-weight: 800; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 24px; border-bottom: 2px solid rgba(255,255,255,0.05); padding-bottom: 12px;}

/* INSTRUMENT GRID - NO BORDERS */
.inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.inst-card { background: #1e293b; border-radius: 12px; padding: 24px 26px; border: none !important; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.inst-name { font-size: 14px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.inst-level { font-size: 28px; font-weight: 700; color: #f1f5f9; margin: 6px 0 6px; }
.inst-change-up { font-size: 16px; font-weight: 600; color: #4ade80; }
.inst-change-down { font-size: 16px; font-weight: 600; color: #f87171; }
.inst-change-flat { font-size: 16px; font-weight: 600; color: #94a3b8; }

/* STACKED CARDS - NO BORDERS */
.news-item { background: #1e293b; border: none !important; border-radius: 12px; padding: 26px 28px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.news-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.news-headline { font-size: 20px; font-weight: 700; color: #f1f5f9; margin-bottom: 8px; }
.news-body { font-size: 16px; color: #cbd5e1; line-height: 1.65; }

/* MULTI-COLOR PILL BADGES */
.nb-badge { padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }
.nb-purple { background: #3b0764; color: #e879f9; }
.nb-teal { background: #164e63; color: #67e8f9; }
.nb-red { background: #450a0a; color: #fca5a5; }
.nb-orange { background: #431407; color: #fdba74; }
.nb-blue { background: #0c4a6e; color: #7dd3fc; }
.nb-green { background: #052e16; color: #4ade80; }
.nb-macro { background: #312e81; color: #a5b4fc; }

/* SENTIMENT & TECHNICALS */
.sentiment-line { padding: 14px 0; color: #cbd5e1; font-size: 18px; border-bottom: 1px solid rgba(255,255,255,0.05); line-height: 1.7; }
.sentiment-line:last-child { border-bottom: none; }
.sentiment-line strong { color: #f1f5f9; }

/* WATCHLIST (Nested Cloud Cards) - NO BORDERS */
.watchlist-item { background: #1e293b; border: none !important; border-radius: 12px; padding: 24px 28px; margin-bottom: 20px; display: grid; grid-template-columns: 28px 1fr; gap: 16px; align-items: start; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.wl-num { font-size: 18px; color: #64748b; font-weight: 800; padding-top: 3px; }
.wl-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
.wl-ticker { font-size: 22px; font-weight: 800; color: #818cf8; }
.wl-body   { font-size: 16px; color: #cbd5e1; line-height: 1.6; }
.wl-levels { font-size: 14px; color: #94a3b8; margin-top: 10px; }
.wl-levels .sup { color: #4ade80; font-weight: 600; }
.wl-levels .res { color: #f87171; font-weight: 600; }

/* TABLES (For Scanner & Sector flow) */
table { width: 100%; border-collapse: collapse; border: none !important; }
th, td { border-left: none !important; border-right: none !important; }
th { font-size: 14px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #64748b; padding: 16px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05) !important; border-top: none !important; }
td { padding: 18px 12px; border-bottom: 1px solid rgba(255,255,255,0.05) !important; vertical-align: top; border-top: none !important; }
tr:last-child td { border-bottom: none !important; }
.ticker-cell { font-weight: 700; color: #f1f5f9; font-size: 20px; white-space: nowrap; }
.ticker-name { font-size: 15px; color: #64748b; display: block; font-weight: 400; margin-top: 4px; }
.catalyst-cell { font-size: 16px; color: #cbd5e1; line-height: 1.6; }
.etf-tag { background: #0f172a; color: #60a5fa; padding: 6px 12px; border-radius: 6px; font-family: monospace; font-size: 16px; font-weight: 700; border: none;}
.up-pct { color: #4ade80; font-weight: 700; font-size: 18px; white-space: nowrap; }
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
        "Nat Gas": "NG=F", "EUR/USD": "EURUSD=X", "Gold (GC)": "GC=F", 
        "WTI Crude": "CL=F", "Bitcoin (BTC)": "BTC-USD", "Ethereum (ETH)": "ETH-USD"
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
                    results.append({"ticker": t, "price": q['price'], "change": q['changesPercentage'], "catalyst": sips_dict[t]})
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
def fetch_calendar_data(cal_type="economics"):
    try:
        today = datetime.now()
        next_week = today + timedelta(days=7)
        url = f"https://api.benzinga.com/api/v2.1/calendar/{cal_type}?token={BZ_KEY}&parameters[date_from]={today.strftime('%Y-%m-%d')}&parameters[date_to]={next_week.strftime('%Y-%m-%d')}"
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
<span class="badge-live">● LIVE DATA</span>
</div>
</div>
</div>
""", unsafe_allow_html=True)


# --- 01 | SCORECARD ---
macro_data = fetch_expanded_macro()
scorecard_html = """
<div class="cloud-card">
<div class="section-title">01 — Scorecard</div>
<div class="inst-grid">
"""
for name, metrics in macro_data.items():
    color_class = "inst-change-up" if metrics['pct'] >= 0 else "inst-change-down"
    sign = "▲ +" if metrics['pct'] > 0 else "▼ " if metrics['pct'] < 0 else "— "
    price_str = f"{metrics['price']:.3f}" if name in ["VIX", "10Y Treasury", "Nat Gas", "EUR/USD"] else f"${metrics['price']:,.2f}" if name in ["Bitcoin (BTC)", "Ethereum (ETH)", "Gold (GC)", "WTI Crude"] else f"{metrics['price']:,.2f}"
    scorecard_html += f"""
<div class="inst-card">
<div class="inst-name">{name}</div>
<div class="inst-level">{price_str}</div>
<div class="{color_class}">{sign}{metrics['pct']:.2f}%</div>
</div>
"""
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)


# --- 02 | MARKET DRIVERS & CATALYSTS (STATIC CONTENT TO MATCH SCREENSHOT) ---
st.markdown("""
<div class="cloud-card">
<div class="section-title">02 — Market Drivers & Catalysts</div>

<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-purple">GEOPOLITICAL</span></div>
<div class="news-headline">Trump Extends US-Iran Ceasefire Indefinitely — Key Macro Catalyst</div>
<div class="news-body">The primary driver of today's rally: President Trump announced an indefinite extension of the two-week US-Iran ceasefire. Supply-chain fears eased, oil held stable near $86, and risk assets surged broadly. Semiconductor stocks — which had priced in supply-disruption risk — were among the biggest beneficiaries. The Investopedia daily newsletter confirmed: <em>"Indexes End Sharply Higher as Trump Extends Ceasefire; S&P 500, Nasdaq Close at Records."</em></div>
</div>

<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-teal">EARNINGS BEAT</span></div>
<div class="news-headline">GE Vernova (GEV) & Boeing (BA) — Pre-Market Double Beat</div>
<div class="news-body">GEV posted Q1 EPS of <strong>$1.98 vs. $1.90 est.</strong>, revenue $9.34B (beat), and raised 2026 guidance to $44.5–$45.5B — stock soared to new all-time highs. AI data center power demand driving massive Electrification order growth. Boeing reported losses of just <strong>–$0.20/share vs. –$0.80 est.</strong>, revenue $22.22B vs. $21.78B est. BA jumped 3.5%; CEO reaffirmed $1–3B FCF target for 2026.</div>
</div>

<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-red">AH VOLATILE</span></div>
<div class="news-headline">Tesla (TSLA) — EPS Beat, Revenue Miss — AH Reversal on Capex Shock</div>
<div class="news-body">TSLA Q1: EPS <strong>$0.41 (est. $0.37)</strong> ✓ | Revenue <strong>$22.39B (est. $22.64B)</strong> ✗ (+16% YoY). Shares initially spiked +4% AH, then reversed to flat/down after management guided capex to <strong>$25B for 2026 — $5B above prior guidance</strong>. Energy segment revenue fell 12% YoY to $2.41B. Dan Ives: "Tesla is now more an AI company than a car company."</div>
</div>

<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-red">AH DROPS</span></div>
<div class="news-headline">IBM –6% & Southwest (LUV) –4% After Hours</div>
<div class="news-body">IBM beat Q1 profit on AI software demand but sold off 6% AH — likely a "sell the news" reaction in a high-expectations AI environment. Southwest (LUV) guided Q2 EPS to $0.35–$0.65 vs. $0.73 Street consensus; jet fuel costs remain a persistent $0.22/share headwind. Both names face pressure at Thursday's open.</div>
</div>

<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-orange">CRYPTO</span></div>
<div class="news-headline">Bitcoin Approaches $80K Psychological Level</div>
<div class="news-body">BTC climbed 2.2% to $77,541 on peace-deal optimism and soft dollar. Experts are flagging $80,000 as the next major psychological resistance. ETH added 0.7% to $2,390. Crypto has tracked risk assets closely since the late-March Iran selloff low.</div>
</div>

<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-macro">MACRO</span></div>
<div class="news-headline">Iran War Inflation May Take Years to Fade — Investopedia</div>
<div class="news-body">Even with the ceasefire extended, economists are warning that inflationary pressures from the Iran conflict (energy, shipping, supply chains) could take years to fully normalize. This is a long-tail risk for Fed policy. Watch Thursday's bond market reaction; today's 10Y yield rise (+0.99%) alongside equities signals a risk-on tone, not a stagflation bid — for now.</div>
</div>

</div>
""", unsafe_allow_html=True)


# --- 03 | SECTORS ---
sector_data = fetch_sector_flow()
if sector_data:
    heatmap_html = """
<div class="cloud-card">
<div class="section-title">03 — Sector Performance & Themes</div>
<table>
<thead><tr><th>#</th><th>Sector / ETF</th><th>Live Change</th><th>Theme</th></tr></thead>
<tbody>
"""
    for i, item in enumerate(sector_data):
        color_class = "up-pct" if item['pct'] >= 0 else "down-pct"
        sign = "▲ +" if item['pct'] > 0 else "▼ "
        heatmap_html += f"""
<tr>
<td style="color:#64748b;font-weight:700;">{i+1}</td>
<td class="ticker-cell">{item['ticker']} <span style="color:#94a3b8; font-weight:400; font-size:16px;">— {item['sector']}</span></td>
<td><span class="{color_class}">{sign}{item['pct']:.2f}%</span></td>
<td class="catalyst-cell">{item['theme']}</td>
</tr>
"""
    heatmap_html += "</tbody></table></div>"
    st.markdown(heatmap_html, unsafe_allow_html=True)


# --- 04 | PRE/POST MARKET GAPPERS ---
gappers_data = fetch_gappers()
if gappers_data:
    gappers_html = """
<div class="cloud-card">
<div class="section-title">04 — Pre/Post Market Gappers (Top 10)</div>
<table>
<thead><tr><th>Ticker</th><th>Price</th><th>Gap %</th><th>Scanner Notes</th></tr></thead>
<tbody>
"""
    gainers = [g for g in gappers_data if g['type'] == 'Gainer']
    losers = [l for l in gappers_data if l['type'] == 'Loser']
    
    for item in gainers:
        gappers_html += f"""
<tr>
<td class="ticker-cell"><span class="etf-tag">{item['ticker']}</span></td>
<td class="catalyst-cell" style="color:#f1f5f9;">${item['price']:.2f}</td>
<td><div class="up-pct">▲ +{item['change']:.2f}%</div></td>
<td class="catalyst-cell">High relative volume / Pre-market bid.</td>
</tr>
"""
    gappers_html += """<tr class="divider-row"><td colspan="4">— Top Losers —</td></tr>\n"""
    for item in losers:
        gappers_html += f"""
<tr>
<td class="ticker-cell">
