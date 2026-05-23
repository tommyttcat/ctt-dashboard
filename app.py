import streamlit as st
import yfinance as yf
import pandas as pd
from datetime import datetime

# ==========================================
# 1. PAGE CONFIGURATION & CUSTOM CSS
# ==========================================
st.set_page_config(page_title="CTT Post-Market Wrap", layout="centered", initial_sidebar_state="collapsed")

# Injecting raw CSS to perfectly mimic the mobile app screenshots
st.markdown("""
<style>
    /* Base App Styling */
    .stApp { background-color: #0B0E14; color: #FAFAFA; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    header {visibility: hidden;}
    footer {visibility: hidden;}
    
    /* Remove default Streamlit padding */
    .block-container { padding-top: 1rem; padding-bottom: 1rem; max-width: 600px; }
    
    /* Typography & Colors */
    .pos { color: #00FFAA; font-weight: 500;}
    .neg { color: #FF4444; font-weight: 500;}
    .section-head { font-family: 'Courier New', Courier, monospace; color: #6B7280; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; margin-top: 24px; }
    
    /* Card Containers */
    .card { background-color: #161A25; border: 1px solid #2A2E39; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    
    /* Metrics Grid */
    .metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 10px; }
    .metric-box { background-color: #1E2330; padding: 10px; border-radius: 8px; text-align: center; }
    .metric-title { color: #9CA3AF; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; }
    .metric-value { color: #FFFFFF; font-size: 15px; font-weight: 600; margin-bottom: 2px; }
    .metric-change { font-size: 11px; }
    
    /* Table Styling */
    .custom-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .custom-table th { text-align: left; color: #6B7280; padding-bottom: 8px; font-weight: 400; border-bottom: 1px solid #2A2E39; font-size: 10px; text-transform: uppercase; }
    .custom-table td { padding: 10px 0; border-bottom: 1px solid #1F2430; color: #D1D5DB; }
    .etf-tag { background: #1C243B; color: #60A5FA; padding: 3px 6px; border-radius: 4px; font-family: monospace; font-size: 10px; font-weight: bold;}
    
    /* Editor's Note */
    .editor-note { border: 1px solid #4C1D95; background-color: #1E1B4B; padding: 16px; border-radius: 10px; color: #E5E7EB; font-size: 13px; line-height: 1.6; }
    .editor-note strong { color: #A855F7; }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. DATA FETCHING LOGIC (WITH SAFETY NETS)
# ==========================================
@st.cache_data(ttl=300) 
def fetch_macro_snapshot():
    tickers = {"SPX": "^GSPC", "NDX": "^NDX", "VIX": "^VIX", "US 10Y": "^TNX"}
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
    except Exception:
        for name in tickers.keys():
            data[name] = {"price": 0.00, "pct": 0.00}
    return data

@st.cache_data(ttl=3600)
def fetch_sector_flow():
    sectors = {
        "Technology": "XLK", "Financials": "XLF", "Energy": "XLE", 
        "Health Care": "XLV", "Discretionary": "XLY"
    }
    perf = []
    try:
        for name, ticker in sectors.items():
            tick = yf.Ticker(ticker)
            hist = tick.history(period="2d")
            if len(hist) >= 2:
                change = ((hist['Close'].iloc[1] - hist['Close'].iloc[0]) / hist['Close'].iloc[0]) * 100
                perf.append({"ticker": ticker, "sector": name, "pct": change})
        if perf:
            return sorted(perf, key=lambda x: x['pct'], reverse=True)
    except Exception:
        pass
    return []

# ==========================================
# 3. UI GENERATION
# ==========================================

# Header
date_str = datetime.now().strftime("%A — %B %d, %Y")
st.markdown(f"<h2>Post-Market Wrap</h2>", unsafe_allow_html=True)
st.markdown(f"<div style='color: #9CA3AF; font-size: 14px; margin-bottom: 20px; font-weight: bold;'>{date_str}</div>", unsafe_allow_html=True)

# Fetch Data
macro_data = fetch_macro_snapshot()
sector_data = fetch_sector_flow()

# --- SECTION 01: CLOSING SCORECARD ---
st.markdown("<div class='section-head'>01 — CLOSING SCORECARD</div>", unsafe_allow_html=True)

scorecard_html = "<div class='card'><div class='metric-grid'>"
for name, metrics in macro_data.items():
    color_class = "pos" if metrics['pct'] >= 0 else "neg"
    sign = "+" if metrics['pct'] > 0 else ""
    # Format specific to VIX and Yield which don't usually show thousands commas
    price_str = f"{metrics['price']:,.2f}" if name not in ["VIX", "US 10Y"] else f"{metrics['price']:.2f}"
    
    scorecard_html += f"""
    <div class='metric-box'>
        <div class='metric-title'>{name}</div>
        <div class='metric-value'>{price_str}</div>
        <div class='metric-change {color_class}'>{sign}{metrics['pct']:.2f}%</div>
    </div>
    """
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)

# --- SECTION 03: SECTOR PERFORMANCE ---
st.markdown("<div class='section-head'>03 — SECTOR PERFORMANCE (SPDRs)</div>", unsafe_allow_html=True)

if sector_data:
    table_html = """
    <div class='card'>
        <table class='custom-table'>
            <tr>
                <th>ETF</th>
                <th>SECTOR</th>
                <th style='text-align: right;'>%</th>
            </tr>
    """
    for item in sector_data:
        color_class = "pos" if item['pct'] >= 0 else "neg"
        sign = "+" if item['pct'] > 0 else ""
        table_html += f"""
            <tr>
                <td><span class='etf-tag'>{item['ticker']}</span></td>
                <td style='font-weight: 500; color: #FAFAFA;'>{item['sector']}</td>
                <td style='text-align: right;' class='{color_class}'>{sign}{item['pct']:.1f}%</td>
            </tr>
        """
    table_html += "</table></div>"
    st.markdown(table_html, unsafe_allow_html=True)
else:
    st.markdown("<div class='card' style='color: #9CA3AF; text-align: center;'>Sector data syncing...</div>", unsafe_allow_html=True)

# --- SECTION 05: NEWS DRIVERS & CATALYSTS ---
st.markdown("<div class='section-head'>05 — NEWS DRIVERS & CATALYSTS</div>", unsafe_allow_html=True)
news_html = """
<div class='card'>
    <div style='margin-bottom: 16px;'>
        <div style='color: #F87171; font-size: 10px; font-weight: bold; letter-spacing: 1px; margin-bottom: 4px;'>MACRO</div>
        <div style='font-size: 13px; color: #FAFAFA;'><strong>PCE Inflation Data</strong> — Comes in line with expectations, easing rate hike fears across the broader market.</div>
    </div>
    <div style='margin-bottom: 16px; border-top: 1px solid #1F2430; padding-top: 16px;'>
        <div style='color: #60A5FA; font-size: 10px; font-weight: bold; letter-spacing: 1px; margin-bottom: 4px;'>EARNINGS</div>
        <div style='font-size: 13px; color: #FAFAFA;'><strong>NVDA Blowout</strong> — Announces next-generation server architecture; price target raised by 3 analysts.</div>
    </div>
    <div style='border-top: 1px solid #1F2430; padding-top: 16px;'>
        <div style='color: #A78BFA; font-size: 10px; font-weight: bold; letter-spacing: 1px; margin-bottom: 4px;'>POLICY</div>
        <div style='font-size: 13px; color: #FAFAFA;'><strong>Algorithmic Liquidity</strong> — Equities are testing key liquidity zones this morning. Watch the 10Y Yield closely.</div>
    </div>
</div>
"""
st.markdown(news_html, unsafe_allow_html=True)

# --- SECTION 10: EDITOR'S NOTE ---
st.markdown("<div class='section-head'>10 — EDITOR'S NOTE</div>", unsafe_allow_html=True)
editor_html = """
<div class='editor-note'>
    <strong>Market Momentum (MKM)</strong> across the hourly timeframe indicates potential for a midday pivot. 
    <br><br>
    The real test is the interaction with the 4.2% level on the 10Y. Watch for a rotation out of heavily weighted tech names into defensive posturing if yields spike. Keep in mind that Monday, May 25 is Memorial Day, so markets will be closed.
    <br><br>
    <strong>CLOSING POSTURE:</strong> Tactical long into Monday with semis; pair-trade energy weakness against tech strength.
</div>
"""
st.markdown(editor_html, unsafe_allow_html=True)
