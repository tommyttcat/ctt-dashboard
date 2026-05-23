import streamlit as st
import yfinance as yf
import pandas as pd
import plotly.graph_objects as go
from datetime import datetime

# ==========================================
# 1. PAGE CONFIGURATION & PREMIUM CSS
# ==========================================
st.set_page_config(page_title="CTT Daily Briefing", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
<style>
    /* Base App Styling */
    .stApp { background-color: #090B10; color: #FAFAFA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    header {visibility: hidden;}
    footer {visibility: hidden;}
    
    /* Remove confined web limits - stretch to screen */
    .block-container { padding-top: 2rem; padding-bottom: 2rem; max-width: 98% !important; }
    
    /* Typography & Colors */
    .pos { color: #00E676; font-weight: 600;}
    .neg { color: #FF3D00; font-weight: 600;}
    .section-head { font-family: 'Courier New', Courier, monospace; color: #78909C; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 16px; margin-top: 32px; border-bottom: 1px solid #1E293B; padding-bottom: 8px;}
    
    /* Elevated Cards without Borders */
    .card { background-color: #11151E; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.02); }
    
    /* Metrics Grid */
    .metric-grid { display: grid; gap: 16px; margin-bottom: 10px; }
    .metric-box { background-color: #171C28; padding: 16px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.03);}
    .metric-title { color: #8B949E; font-size: 11px; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;}
    .metric-value { color: #FFFFFF; font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .metric-change { font-size: 13px; }
    
    /* Premium Borderless Tables (Floating Pill Rows) */
    .custom-table { width: 100%; border-collapse: separate; border-spacing: 0 8px; font-size: 13px; }
    .custom-table th { text-align: left; color: #8B949E; padding: 0 12px 4px 12px; font-weight: 500; font-size: 10px; text-transform: uppercase; border: none; }
    .custom-table td { padding: 14px 12px; background-color: #171C28; border: none; color: #E6EDF3; }
    /* Rounded corners for the first and last cells of each row to create a pill effect */
    .custom-table tr td:first-child { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
    .custom-table tr td:last-child { border-top-right-radius: 8px; border-bottom-right-radius: 8px; }
    
    .etf-tag { background: #212635; color: #58A6FF; padding: 4px 8px; border-radius: 4px; font-family: monospace; font-size: 12px; font-weight: 700;}
    .badge-long { background: rgba(0, 230, 118, 0.1); color: #00E676; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase;}
    .badge-short { background: rgba(255, 61, 0, 0.1); color: #FF3D00; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase;}
    
    /* Editor's Note */
    .editor-note { background: linear-gradient(145deg, #1A173A 0%, #0F1219 100%); padding: 24px; border-radius: 12px; color: #E6EDF3; font-size: 15px; line-height: 1.7; border-left: 4px solid #8A2BE2; }
    .editor-note strong { color: #B388FF; font-weight: 600; }

    /* Responsive Grid Adjustments */
    @media (max-width: 768px) {
        .metric-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (min-width: 769px) {
        .metric-grid { grid-template-columns: repeat(4, 1fr); }
    }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. DATA ENGINES
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
    except:
        for name in tickers.keys(): data[name] = {"price": 0.00, "pct": 0.00}
    return data

@st.cache_data(ttl=3600)
def fetch_sector_flow():
    sectors = {"Technology": "XLK", "Financials": "XLF", "Energy": "XLE", "Health Care": "XLV"}
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
    return [{"ticker": "N/A", "sector": "Syncing", "pct": 0.0}]

def calculate_vpci(df, short_window=5, long_window=21):
    df['Vol_x_Price'] = df['Close'] * df['Volume']
    vwma_short = df['Vol_x_Price'].rolling(window=short_window).sum() / df['Volume'].rolling(window=short_window).sum()
    vwma_long = df['Vol_x_Price'].rolling(window=long_window).sum() / df['Volume'].rolling(window=long_window).sum()
    sma_short = df['Close'].rolling(window=short_window).mean()
    sma_long = df['Close'].rolling(window=long_window).mean()
    vpc = vwma_long - sma_long
    vpr = vwma_short / sma_short
    vm = df['Volume'].rolling(window=short_window).mean() / df['Volume'].rolling(window=long_window).mean()
    df['VPCI'] = vpc * vpr * vm
    return df

# ==========================================
# 3. UI GENERATION
# ==========================================

# HEADER
date_str = datetime.now().strftime("%A — %B %d, %Y")
st.markdown(f"<h1 style='font-size: 28px; font-weight: 800; margin-bottom: 4px;'>Confluence Trading Tools | Daily Briefing</h1>", unsafe_allow_html=True)
st.markdown(f"<div style='color: #8B949E; font-size: 14px; margin-bottom: 24px; font-weight: 600;'>{date_str}</div>", unsafe_allow_html=True)

# --- 1. FUTURES & MACRO SNAPSHOT ---
st.markdown("<div class='section-head'>01 — Futures & Macro Snapshot</div>", unsafe_allow_html=True)
macro_data = fetch_macro_snapshot()
scorecard_html = "<div class='card'><div class='metric-grid'>\n"
for name, metrics in macro_data.items():
    color_class = "pos" if metrics['pct'] >= 0 else "neg"
    sign = "+" if metrics['pct'] > 0 else ""
    price_str = f"{metrics['price']:,.2f}" if name not in ["VIX", "US 10Y"] else f"{metrics['price']:.2f}"
    scorecard_html += f"""<div class='metric-box'>
<div class='metric-title'>{name}</div>
<div class='metric-value'>{price_str}</div>
<div class='metric-change {color_class}'>{sign}{metrics['pct']:.2f}%</div>
</div>\n"""
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)

# ROW 2: News & Sectors
col1, col2 = st.columns([1.2, 1])

with col1:
    # --- 2. KEY NEWS & CATALYSTS ---
    st.markdown("<div class='section-head'>02 — Key News & Catalysts</div>", unsafe_allow_html=True)
    st.markdown("""<div class='card'>
    <div style='margin-bottom: 20px;'>
        <div style='color: #FF5252; font-size: 11px; font-weight: 700; letter-spacing: 1px; margin-bottom: 6px;'>MACRO / FED</div>
        <div style='font-size: 14px; color: #E6EDF3;'><strong>Core PCE Print</strong> — Inflation data aligns with consensus, stripping away hawkish tail-risks and steepening the yield curve.</div>
    </div>
    <div style='margin-bottom: 20px;'>
        <div style='color: #448AFF; font-size: 11px; font-weight: 700; letter-spacing: 1px; margin-bottom: 6px;'>SECTOR ROTATION</div>
        <div style='font-size: 14px; color: #E6EDF3;'><strong>Semiconductor Strength</strong> — Leading optical/infra names continue their tear on server-demand signal, lifting NDX heavily.</div>
    </div>
    <div>
        <div style='color: #E040FB; font-size: 11px; font-weight: 700; letter-spacing: 1px; margin-bottom: 6px;'>M&A ACTION</div>
        <div style='font-size: 14px; color: #E6EDF3;'><strong>Pharma Bidding War</strong> — Competing private equity offers surface for mid-cap biosciences, juicing the XLV underlying.</div>
    </div>
    </div>""", unsafe_allow_html=True)

with col2:
    # --- 3. TOP SECTORS & MONEY FLOW ---
    st.markdown("<div class='section-head'>03 — Top Sectors & Money Flow</div>", unsafe_allow_html=True)
    sector_data = fetch_sector_flow()
    table_html = """<div class='card' style='padding: 12px 24px;'><table class='custom-table'>
    <tr><th>ETF</th><th>SECTOR</th><th style='text-align: right;'>FLOW %</th></tr>\n"""
    for item in sector_data:
        color_class = "pos" if item['pct'] >= 0 else "neg"
        sign = "+" if item['pct'] > 0 else ""
        table_html += f"""<tr>
        <td><span class='etf-tag'>{item['ticker']}</span></td>
        <td style='font-weight: 600;'>{item['sector']}</td>
        <td style='text-align: right;' class='{color_class}'>{sign}{item['pct']:.1f}%</td>
        </tr>\n"""
    table_html += "</table></div>"
    st.markdown(table_html, unsafe_allow_html=True)

# ROW 3: G
