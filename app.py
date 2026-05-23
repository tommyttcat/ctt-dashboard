import streamlit as st
import yfinance as yf
import pandas as pd
from datetime import datetime

# ==========================================
# 1. PAGE CONFIGURATION & EXACT HTML/CSS
# ==========================================
st.set_page_config(page_title="CTT Market Briefing", layout="wide", initial_sidebar_state="collapsed")

# Injecting the exact CSS, scaled up and with vertical lines removed
st.markdown("""
<style>
/* Reset and Base App Styling */
.stApp { 
    background: #0d0d12; 
    color: #e2e8f0; 
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; 
    font-size: 16px; 
    line-height: 1.6; 
}
header {visibility: hidden;}
footer {visibility: hidden;}

/* Wrap constraint - Widened for a bigger layout */
.block-container { max-width: 900px !important; margin: 0 auto !important; padding-top: 1rem; padding-bottom: 3rem; }

/* HEADER */
.hdr { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 40px 40px 30px; border-bottom: 2px solid #312e81; border-radius: 8px 8px 0 0; margin-bottom: 24px; }
.hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
.wrap-type { font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
.wrap-title { font-size: 34px; font-weight: 800; color: #f1f5f9; margin-top: 8px; }
.hdr-meta { text-align: right; font-size: 14px; color: #94a3b8; }
.hdr-date { font-size: 18px; color: #c7d2fe; font-weight: 600; margin-bottom: 6px; }

.badge-bullish  { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; letter-spacing: 1px; background: #052e16; color: #4ade80; border: 1px solid #166534; }
.badge-bearish  { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; letter-spacing: 1px; background: #450a0a; color: #f87171; border: 1px solid #991b1b; }
.badge-mixed    { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; letter-spacing: 1px; background: #2d2000; color: #fbbf24; border: 1px solid #92400e; }
.badge-cautious { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; letter-spacing: 1px; background: #1c1917; color: #fb923c; border: 1px solid #9a3412; }

/* SECTION */
.section { padding: 28px 36px; border-bottom: 1px solid #1e293b; background: #0d0d12;}
.section-title { font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 20px; }

/* INSTRUMENT GRID */
.inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.inst-card { background: #1e293b; border-radius: 8px; padding: 16px 18px; border: 1px solid #334155; }
.inst-name  { font-size: 12px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.inst-level { font-size: 20px; font-weight: 700; color: #f1f5f9; margin: 4px 0 4px; }
.inst-change-up   { font-size: 14px; font-weight: 600; color: #4ade80; }
.inst-change-down { font-size: 14px; font-weight: 600; color: #f87171; }
.inst-change-flat { font-size: 14px; font-weight: 600; color: #94a3b8; }

/* SENTIMENT */
.sentiment-text { background: #111827; border-left: 4px solid #818cf8; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-top: 20px; font-size: 15px; color: #cbd5e1; line-height: 1.8; }
.sentiment-line { padding: 12px 0; color: #94a3b8; font-size: 15px; border-bottom: 1px solid #1e293b; }
.sentiment-line:last-child { border-bottom: none; }
.sentiment-line strong { color: #e2e8f0; }

/* NEWS */
.news-item { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 18px 20px; margin-bottom: 12px; }
.news-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.news-badge { padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
.nb-macro       { background: #312e81; color: #a5b4fc; }
.nb-earnings    { background: #164e63; color: #67e8f9; }
.nb-geopolitical{ background: #3b0764; color: #e879f9; }
.nb-crypto      { background: #1c1917; color: #fb923c; }
.nb-sector      { background: #052e16; color: #4ade80; }
.nb-alert       { background: #450a0a; color: #fca5a5; }
.nb-technical   { background: #0c4a6e; color: #7dd3fc; }
.news-headline { font-size: 16px; font-weight: 700; color: #f1f5f9; margin-bottom: 6px; }
.news-body { font-size: 15px; color: #94a3b8; line-height: 1.65; }

/* TABLES (Forcing Vertical Lines Off) */
table { width: 100%; border-collapse: collapse; border: none !important; }
th, td { border-left: none !important; border-right: none !important; }
th { font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #475569; padding: 12px 10px; text-align: left; border-bottom: 1px solid #1e293b !important; border-top: none !important; }
td { padding: 14px 10px; border-bottom: 1px solid #1e293b !important; vertical-align: top; border-top: none !important; }
tr:last-child td { border-bottom: none !important; }
.ticker-cell { font-weight: 700; color: #f1f5f9; font-size: 16px; white-space: nowrap; }
.ticker-name { font-size: 13px; color: #475569; display: block; font-weight: 400; margin-top: 4px; }
.up-pct   { color: #4ade80; font-weight: 700; font-size: 16px; white-space: nowrap; }
.down-pct { color: #f87171; font-weight: 700; font-size: 16px; white-space: nowrap; }
.catalyst-cell { font-size: 14px; color: #94a3b8; line-height: 1.5; }

/* WATCHLIST */
.watchlist-item { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 18px 20px; margin-bottom: 12px; display: grid; grid-template-columns: 24px 1fr; gap: 12px; align-items: start; }
.wl-num { font-size: 14px; color: #334155; font-weight: 700; padding-top: 3px; }
.wl-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.wl-ticker { font-size: 18px; font-weight: 800; color: #818cf8; }
.wl-body   { font-size: 15px; color: #94a3b8; line-height: 1.6; }
.wl-levels { font-size: 14px; color: #475569; margin-top: 8px; }
.wl-levels .sup { color: #4ade80; font-weight: 600; }
.wl-levels .res { color: #f87171; font-weight: 600; }

/* FOOTER */
.footer { padding: 28px 36px 40px; background: #0d0d12;}
.footer-note { background: #111827; border: 1px solid #312e81; border-radius: 10px; padding: 24px 28px; font-size: 15px; color: #94a3b8; line-height: 1.8; }
.footer-note strong { color: #c7d2fe; }
.divider-row td { padding: 6px 12px; background: #0d0d12; font-size: 12px; color: #334155; letter-spacing: 1px; text-transform: uppercase; }

/* Mobile Fixes */
@media (max-width: 600px) {
    .inst-grid { grid-template-columns: repeat(2, 1fr); }
    .section { padding: 20px; }
    .hdr { padding: 24px; }
}
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. DATA ENGINES
# ==========================================
@st.cache_data(ttl=300) 
def fetch_expanded_macro():
    tickers = {
        "S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones (DJI)": "^DJI", 
        "Russell 2000": "^RUT", "VIX": "^VIX", "/ES Futures": "ES=F",
        "Gold (GC)": "GC=F", "WTI Crude": "CL=F", "DXY (Dollar)": "DX-Y.NYB",
        "10Y Treasury": "^TNX", "Bitcoin (BTC)": "BTC-USD", "Ethereum (ETH)": "ETH-USD"
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
                data[name] = {"price": 0.00, "pct": 0.00}
    except:
        for name in tickers.keys(): data[name] = {"price": 0.00, "pct": 0.00}
    return data

@st.cache_data(ttl=3600)
def fetch_sector_flow():
    sectors = {
        "Consumer Disc": "XLY", "Technology": "XLK", "Industrials": "XLI", 
        "Comm. Services": "XLC", "Health Care": "XLV", "Consumer Staples": "XLP",
        "Financials": "XLF", "Materials": "XLB", "Energy": "XLE", 
        "Real Estate": "XLRE", "Utilities": "XLU"
    }
    perf = []
    try:
        for name, ticker in sectors.items():
            tick = yf.Ticker(ticker)
            hist = tick.history(period="2d")
            if len(hist) >= 2:
                change = ((hist['Close'].iloc[1] - hist['Close'].iloc[0]) / hist['Close'].iloc[0]) * 100
                perf.append({"ticker": ticker, "sector": name, "pct": change})
        if perf: return sorted(perf, key=lambda x: x['pct'], reverse=True)
    except: pass
    return []

def calculate_vpci(df, short_window=5, long_window=21):
    try:
        df['Vol_x_Price'] = df['Close'] * df['Volume']
        vwma_short = df['Vol_x_Price'].rolling(window=short_window).sum() / df['Volume'].rolling(window=short_window).sum()
        vwma_long = df['Vol_x_Price'].rolling(window=long_window).sum() / df['Volume'].rolling(window=long_window).sum()
        sma_short = df['Close'].rolling(window=short_window).mean()
        sma_long = df['Close'].rolling(window=long_window).mean()
        vpc = vwma_long - sma_long
        vpr = vwma_short / sma_short
        vm = df['Volume'].rolling(window=short_window).mean() / df['Volume'].rolling(window=long_window).mean()
        df['VPCI'] = vpc * vpr * vm
        return df['VPCI'].iloc[-1]
    except:
        return 0.0

# ==========================================
# 3. UI GENERATION (FLUSH LEFT HTML)
# ==========================================
# NOTE: All HTML is flush-left to prevent Streamlit's Markdown parser from turning it into code blocks.

date_str = datetime.now().strftime("%A, %B %d, %Y")

st.markdown(f"""
<div class="hdr">
<div class="hdr-top">
<div>
<div class="wrap-type">Market Briefing</div>
<div class="wrap-title">Confluence Trading Tool Market Briefing</div>
</div>
<div class="hdr-meta">
<div class="hdr-date">{date_str}</div>
<div style="margin-bottom:10px;color:#64748b">Current Market State</div>
<span class="badge-bullish">BULLISH</span>
</div>
</div>
</div>
""", unsafe_allow_html=True)


# --- 01 | FUTURES & MACRO SNAPSHOT ---
macro_data = fetch_expanded_macro()
scorecard_html = """
<div class="section">
<div class="section-title">01 — Futures & Macro Snapshot</div>
<div class="inst-grid">
"""
for name, metrics in macro_data.items():
    color_class = "inst-change-up" if metrics['pct'] > 0 else "inst-change-down" if metrics['pct'] < 0 else "inst-change-flat"
    sign = "▲ +" if metrics['pct'] > 0 else "▼ " if metrics['pct'] < 0 else "— "
    
    if name in ["VIX", "10Y Treasury"]:
        price_str = f"{metrics['price']:.3f}"
    elif name in ["Bitcoin (BTC)", "Gold (GC)", "WTI Crude"]:
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
</div>
"""
st.markdown(scorecard_html, unsafe_allow_html=True)


# --- 02 | KEY NEWS & CATALYSTS ---
st.markdown("""
<div class="section">
<div class="section-title">02 — Key News & Catalysts</div>
<div class="news-item">
<div class="news-item-top"><span class="news-badge nb-macro">MACRO</span></div>
<div class="news-headline">Indefinite Ceasefire Extension — Key Macro Catalyst</div>
<div class="news-body">The primary driver of today's underlying bid: An indefinite extension of the ceasefire unlocked broad risk appetite. Supply-chain fears eased, oil held stable, and risk assets surged broadly.</div>
</div>
<div class="news-item">
<div class="news-item-top"><span class="news-badge nb-earnings">EARNINGS</span></div>
<div class="news-headline">Semiconductor Leadership Confirmed</div>
<div class="news-body">AI data center power demand is driving massive Electrification order growth. Leading optical and infrastructure names continue their tear on server-demand signals.</div>
</div>
</div>
""", unsafe_allow_html=True)


# --- 03 | TOP SECTORS & MONEY FLOW ---
sector_data = fetch_sector_flow()
if sector_data:
    heatmap_html = """
<div class="section">
<div class="section-title">03 — Top Sectors & Money Flow</div>
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
        rank = i + 1
        color_class = "up-pct" if item['pct'] >= 0 else "down-pct"
        sign = "▲ +" if item['pct'] > 0 else "▼ "
        heatmap_html += f"""
<tr>
<td style="color:#475569;font-size:14px">{rank}</td>
<td class="ticker-cell">{item['ticker']}<span class="ticker-name">{item['sector']}</span></td>
<td><span class="{color_class}">{sign}{item['pct']:.2f}%</span></td>
<td class="catalyst-cell">Data sync complete</td>
</tr>
"""
    heatmap_html += """
</tbody>
</table>
</div>
"""
    st.markdown(heatmap_html, unsafe_allow_html=True)


# --- 04 | PRE/POST MARKET GAPPERS ---
st.markdown("""
<div class="section">
<div class="section-title">04 — Pre/Post Market Gappers</div>
<table>
<thead>
<tr>
<th>Ticker</th>
<th>Change / Price</th>
<th>Catalyst</th>
</tr>
</thead>
<tbody>
<tr>
<td class="ticker-cell">MXL<span class="ticker-name">MaxLinear</span></td>
<td><div class="up-pct">▲ +12.4%</div></td>
<td class="catalyst-cell">Post-close analyst upgrade drumbeat; PT raised.</td>
</tr>
<tr>
<td class="ticker-cell">POET<span class="ticker-name">POET Tech</span></td>
<td><div class="up-pct">▲ +8.1%</div></td>
<td class="catalyst-cell">Sympathy read-through on optical orders.</td>
</tr>
<tr>
<td class="ticker-cell">INTC<span class="ticker-name">Intel Corp</span></td>
<td><div class="up-pct">▲ +4.1%</div></td>
<td class="catalyst-cell">Continuation on margin expansion.</td>
</tr>
<tr class="divider-row">
<td colspan="3">— Top Losers —</td>
</tr>
<tr>
<td class="ticker-cell">MRK<span class="ticker-name">Merck & Co.</span></td>
<td><div class="down-pct">▼ -2.3%</div></td>
<td class="catalyst-cell">Defensive tactical rotation out of pharma.</td>
</tr>
<tr>
<td class="ticker-cell">SNOW<span class="ticker-name">Snowflake</span></td>
<td><div class="down-pct">▼ -4.1%</div></td>
<td class="catalyst-cell">Pre-earnings de-risking by institutional desks.</td>
</tr>
</tbody>
</table>
</div>
""", unsafe_allow_html=True)


# --- 05 | STOCKS IN PLAY TODAY ---
st.markdown("""
<div class="section">
<div class="section-title">05 — Stocks in Play Today</div>
<table>
<thead>
<tr>
<th>Ticker</th>
<th>Key Level</th>
<th>Bias</th>
</tr>
</thead>
<tbody>
<tr>
<td class="ticker-cell">NVDA</td>
<td class="catalyst-cell">$200 / $210</td>
<td><span class="badge-bullish">LONG</span></td>
</tr>
<tr>
<td class="ticker-cell">AAPL</td>
<td class="catalyst-cell">Base $170</td>
<td><span class="badge-bullish">LONG</span></td>
</tr>
<tr>
<td class="ticker-cell">SPY</td>
<td class="catalyst-cell">Hold $510 / fade $520</td>
<td><span class="badge-mixed">RANGE</span></td>
</tr>
<tr>
<td class="ticker-cell">OXY</td>
<td class="catalyst-cell">Fade $65</td>
<td><span class="badge-bearish">SHORT</span></td>
</tr>
</tbody>
</table>
</div>
""", unsafe_allow_html=True)


# --- 06 | SENTIMENT & MARKET BREADTH ---
st.markdown("""
<div class="section">
<div class="section-title">06 — Sentiment & Market Breadth</div>
<div class="news-item">
<div class="news-item-top"><span class="news-badge nb-technical">T2108</span></div>
<div class="news-headline">T2108 Proxy (Above 40-Day MA)</div>
<div class="news-body">Estimated reading is now <strong>58.4%</strong> — healthy breadth territory, confirming the broader trend.</div>
</div>
<div class="news-item">
<div class="news-item-top"><span class="news-badge nb-sector">A/D Line</span></div>
<div class="news-headline">Put/Call Ratio: 0.82</div>
<div class="news-body">Put/call ratios are compressing, showing bullish bias but nearing complacency zones.</div>
</div>
<div class="news-item">
<div class="news-item-top"><span class="news-badge nb-macro">Trend</span></div>
<div class="news-headline">SPX > 50D Moving Avg: ~72%</div>
<div class="news-body">Strong participation confirming indexes at fresh highs.</div>
</div>
</div>
""", unsafe_allow_html=True)


# --- 07 | TECHNICAL ANALYSIS & VPCI ---
st.markdown("<div class='section'><div class='section-title'>07 — Technical Analysis & VPCI</div>", unsafe_allow_html=True)
try:
    spy_df = yf.Ticker("SPY").history(period="3mo")
    if not spy_df.empty and len(spy_df) > 21:
        latest_vpci = calculate_vpci(spy_df)
        vpci_color = "up-pct" if latest_vpci >= 0 else "down-pct"
        vpci_status = "BULLISH CONFIRMATION" if latest_vpci >= 0 else "BEARISH DIVERGENCE"
        st.markdown(f"""
<div class="sentiment-text" style="background:#1e293b; border-color:#60a5fa;">
<div style="font-size: 13px; font-weight: 700; color: #818cf8; text-transform: uppercase; margin-bottom: 6px;">Current VPCI Reading (SPY)</div>
<div style="font-size: 26px; font-weight: 800; margin-bottom: 12px;"><span class="{vpci_color}">{latest_vpci:.4f}</span> | {vpci_status}</div>
The Volume Price Confirmation Indicator (VPCI) measures the relationship between price trends and volume. A positive value indicates that volume is expanding in the direction of the trend, confirming bullish strength.
</div>
        """, unsafe_allow_html=True)
except:
    st.markdown("<div class='sentiment-text'>VPCI data syncing...</div>", unsafe_allow_html=True)
st.markdown("</div>", unsafe_allow_html=True)


# --- 08 | ECONOMIC DATA ---
st.markdown("""
<div class="section">
<div class="section-title">08 — Economic Data & Catalysts Today</div>
<table>
<thead>
<tr>
<th>Time (EST)</th>
<th>Release</th>
<th>Impact</th>
</tr>
</thead>
<tbody>
<tr><td class="ticker-cell" style="font-size:14px;">08:30 AM</td><td class="catalyst-cell">Core PCE Price Index MoM</td><td><span class="badge-bearish">HIGH</span></td></tr>
<tr><td class="ticker-cell" style="font-size:14px;">09:45 AM</td><td class="catalyst-cell">Chicago PMI</td><td><span class="badge-mixed">MED</span></td></tr>
<tr><td class="ticker-cell" style="font-size:14px;">10:00 AM</td><td class="catalyst-cell">UMich Consumer Sentiment (Final)</td><td><span class="badge-bearish">HIGH</span></td></tr>
<tr><td class="ticker-cell" style="font-size:14px;">01:00 PM</td><td class="catalyst-cell">Baker Hughes Rig Count</td><td><span class="badge-cautious" style="background:transparent; border-color:#475569; color:#94a3b8;">LOW</span></td></tr>
</tbody>
</table>
</div>
""", unsafe_allow_html=True)


# --- 09 | EARNINGS CALENDAR ---
st.markdown("""
<div class="section">
<div class="section-title">09 — Today's Earnings Calendar</div>
<table>
<thead>
<tr>
<th>Ticker</th>
<th>Company</th>
<th>Time</th>
</tr>
</thead>
<tbody>
<tr><td class="ticker-cell">CRM</td><td class="catalyst-cell">Salesforce Inc.</td><td class="catalyst-cell" style="color:#f1f5f9;">After Close</td></tr>
<tr><td class="ticker-cell">SNOW</td><td class="catalyst-cell">Snowflake Inc.</td><td class="catalyst-cell" style="color:#f1f5f9;">After Close</td></tr>
<tr><td class="ticker-cell">CRWD</td><td class="catalyst-cell">CrowdStrike Holdings</td><td class="catalyst-cell" style="color:#f1f5f9;">After Close</td></tr>
</tbody>
</table>
</div>
""", unsafe_allow_html=True)


# --- 10 | EDITOR'S NOTE (FOOTER) ---
st.markdown("""
<div class="footer">
<div class="section-title">10 — Editor's Morning Note</div>
<div class="footer-note">
<strong>Hey Thomas —</strong><br><br>
<strong>Market Momentum (MKM)</strong> is synchronized across the hourly timeframe, indicating potential for a midday pivot. <br><br>
The real test today is the interaction with the 4.2% level on the 10Y Yield. Watch for a rotation out of heavily weighted tech names into defensive posturing if yields spike rapidly. <br><br>
Keep in mind that <strong>Monday, May 25 is Memorial Day</strong>, so markets will be closed. Plan your weekend risk exposure accordingly.<br><br>
<strong>CLOSING POSTURE:</strong> <em>Tactical long into the weekend with semis & AI-optics; pair-trade the energy/healthcare weakness against tech strength.</em>
<br><br>
<strong>See you at the close. 📈</strong>
</div>
</div>
""", unsafe_allow_html=True)
