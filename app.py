import streamlit as st
import yfinance as yf
import pandas as pd
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
    
    /* Set width to 70% for a clean, centered desktop reading experience */
    .block-container { max-width: 70% !important; margin: 0 auto !important; padding-top: 2rem; padding-bottom: 4rem; }
    
    /* Typography & Colors */
    .pos { color: #00E676; font-weight: 600;}
    .neg { color: #FF3D00; font-weight: 600;}
    
    /* Section headers updated to subtle gray, smaller font, no borders */
    .section-head { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
        color: #94A3B8; 
        font-size: 20px; 
        font-weight: 600; 
        margin-bottom: 12px; 
        margin-top: 40px; 
        border-bottom: none; 
        padding-bottom: 0px;
    }
    
    /* Clean Cards with completely removed borders */
    .card { background-color: #11151E; border-radius: 12px; padding: 24px; border: none; }
    
    /* Metrics Grid */
    .metric-grid { display: grid; gap: 16px; }
    .metric-box { background-color: #171C28; padding: 16px; border-radius: 10px; text-align: center; border: none;}
    .metric-title { color: #8B949E; font-size: 11px; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;}
    .metric-value { color: #FFFFFF; font-size: 24px; font-weight: 700; margin-bottom: 4px; }
    .metric-change { font-size: 13px; }
    
    /* Premium Borderless Tables */
    .custom-table { width: 100%; border-collapse: separate; border-spacing: 0 8px; font-size: 14px; }
    .custom-table th { text-align: left; color: #8B949E; padding: 0 12px 4px 12px; font-weight: 500; font-size: 11px; text-transform: uppercase; border: none; }
    .custom-table td { padding: 16px 12px; background-color: #171C28; border: none; color: #E6EDF3; }
    .custom-table tr td:first-child { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
    .custom-table tr td:last-child { border-top-right-radius: 8px; border-bottom-right-radius: 8px; }
    
    .etf-tag { background: #212635; color: #58A6FF; padding: 4px 8px; border-radius: 4px; font-family: monospace; font-size: 12px; font-weight: 700;}
    .badge-long { background: rgba(0, 230, 118, 0.1); color: #00E676; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase;}
    .badge-short { background: rgba(255, 61, 0, 0.1); color: #FF3D00; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase;}
    
    /* Editor's Note */
    .editor-note { background: linear-gradient(145deg, #1A173A 0%, #0F1219 100%); padding: 28px; border-radius: 12px; color: #E6EDF3; font-size: 15px; line-height: 1.7; border-left: 4px solid #8A2BE2; }
    .editor-note strong { color: #B388FF; font-weight: 600; }

    /* Responsive Grid Adjustments for Mobile */
    @media (max-width: 768px) {
        .metric-grid { grid-template-columns: repeat(2, 1fr); }
        .block-container { max-width: 95% !important; }
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
st.markdown(f"<h1 style='font-size: 36px; font-weight: 800; margin-bottom: 4px; text-align: center;'>Confluence Trading Tools | Daily Briefing</h1>", unsafe_allow_html=True)
st.markdown(f"<div style='color: #8B949E; font-size: 15px; margin-bottom: 40px; font-weight: 600; text-align: center;'>{date_str}</div>", unsafe_allow_html=True)


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


# --- 2. KEY NEWS & CATALYSTS ---
st.markdown("<div class='section-head'>02 — Key News & Catalysts</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'>
<div style='margin-bottom: 24px;'>
    <div style='color: #FF5252; font-size: 11px; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px;'>MACRO / FED</div>
    <div style='font-size: 15px; color: #E6EDF3;'><strong>Core PCE Print</strong> — Inflation data aligns with consensus, stripping away hawkish tail-risks and steepening the yield curve.</div>
</div>
<div style='margin-bottom: 24px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 24px;'>
    <div style='color: #448AFF; font-size: 11px; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px;'>SECTOR ROTATION</div>
    <div style='font-size: 15px; color: #E6EDF3;'><strong>Semiconductor Strength</strong> — Leading optical/infra names continue their tear on server-demand signal, lifting NDX heavily.</div>
</div>
<div style='border-top: 1px solid rgba(255,255,255,0.05); padding-top: 24px;'>
    <div style='color: #E040FB; font-size: 11px; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px;'>M&A ACTION</div>
    <div style='font-size: 15px; color: #E6EDF3;'><strong>Pharma Bidding War</strong> — Competing private equity offers surface for mid-cap biosciences, juicing the XLV underlying.</div>
</div>
</div>""", unsafe_allow_html=True)


# --- 3. TOP SECTORS & MONEY FLOW ---
st.markdown("<div class='section-head'>03 — Top Sectors & Money Flow</div>", unsafe_allow_html=True)
sector_data = fetch_sector_flow()
table_html = """<div class='card'><table class='custom-table'>
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


# --- 4. PRE/POST MARKET GAPPERS ---
st.markdown("<div class='section-head'>04 — Pre/Post Market Gappers</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'><table class='custom-table'>
<tr><th>TICKER</th><th>GAP %</th><th>CATALYST</th></tr>
<tr><td><span class='etf-tag'>MXL</span></td><td class='pos'>+12.4%</td><td>Post-close PT hike drumbeat</td></tr>
<tr><td><span class='etf-tag'>INTC</span></td><td class='pos'>+4.1%</td><td>Continuation on margin expansion</td></tr>
<tr><td><span class='etf-tag'>MRK</span></td><td class='neg'>-2.3%</td><td>Defensive tactical rotation</td></tr>
<tr><td><span class='etf-tag'>CVX</span></td><td class='neg'>-1.8%</td><td>Profit-taking into prints</td></tr>
</table></div>""", unsafe_allow_html=True)


# --- 5. STOCKS IN PLAY TODAY ---
st.markdown("<div class='section-head'>05 — Stocks in Play Today</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'><table class='custom-table'>
<tr><th>TICKER</th><th>KEY LEVEL</th><th>BIAS</th></tr>
<tr><td><span class='etf-tag'>NVDA</span></td><td>$200 / $210</td><td><span class='badge-long'>LONG</span></td></tr>
<tr><td><span class='etf-tag'>OXY</span></td><td>Fade $65</td><td><span class='badge-short'>SHORT</span></td></tr>
<tr><td><span class='etf-tag'>AAPL</span></td><td>Base $170</td><td><span class='badge-long'>LONG</span></td></tr>
<tr><td><span class='etf-tag'>SPY</span></td><td>Hold $510</td><td><span class='badge-long'>LONG</span></td></tr>
</table></div>""", unsafe_allow_html=True)


# --- 6. SENTIMENT & MARKET BREADTH ---
st.markdown("<div class='section-head'>06 — Sentiment & Market Breadth (T2108)</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'><div class='metric-grid' style='grid-template-columns: repeat(3, 1fr);'>
    <div class='metric-box'><div class='metric-title'>T2108 Proxy (Above 40D SMA)</div><div class='metric-value'>54.2%</div><div class='metric-change pos'>Healthy Breadth</div></div>
    <div class='metric-box'><div class='metric-title'>Put/Call Ratio</div><div class='metric-value'>0.82</div><div class='metric-change pos'>Bullish Bias</div></div>
    <div class='metric-box'><div class='metric-title'>SPX > 50D Moving Avg</div><div class='metric-value'>~72%</div><div class='metric-change pos'>Strong Trend</div></div>
</div></div>""", unsafe_allow_html=True)


# --- 7. TECHNICAL ANALYSIS & VPCI ---
st.markdown("<div class='section-head'>07 — Technical Analysis & VPCI</div>", unsafe_allow_html=True)
try:
    spy_df = yf.Ticker("SPY").history(period="3mo")
    if not spy_df.empty and len(spy_df) > 21:
        spy_df = calculate_vpci(spy_df)
        latest_vpci = spy_df['VPCI'].iloc[-1]
        latest_price = spy_df['Close'].iloc[-1]
        
        vpci_color = "pos" if latest_vpci >= 0 else "neg"
        vpci_status = "BULLISH CONFIRMATION" if latest_vpci >= 0 else "BEARISH DIVERGENCE"
        
        st.markdown(f"""<div class='card'>
        <div style='margin-bottom: 16px;'>
            <div style='color: #8B949E; font-size: 11px; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px;'>CURRENT VPCI READING (SPY)</div>
            <div style='font-size: 24px; font-weight: 700;'><span class='{vpci_color}'>{latest_vpci:.4f}</span> | {vpci_status}</div>
        </div>
        <div style='font-size: 15px; color: #E6EDF3; line-height: 1.6;'>
            The Volume Price Confirmation Indicator (VPCI) measures the relationship between price trends and volume. 
            Currently, the VPCI is reading <strong>{latest_vpci:.4f}</strong> against a closing price of <strong>${latest_price:.2f}</strong>. 
            A positive value indicates that volume is expanding in the direction of the trend, confirming bullish strength. A negative value suggests weakening volume support.
        </div>
        </div>""", unsafe_allow_html=True)
except:
    st.error("VPCI data synchronizing...")


# --- 8. ECONOMIC DATA & CATALYSTS ---
st.markdown("<div class='section-head'>08 — Economic Data & Catalysts Today</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'><table class='custom-table'>
<tr><th>TIME (EST)</th><th>RELEASE</th><th>IMPACT</th></tr>
<tr><td>08:30 AM</td><td style='color:#E6EDF3;'>Core PCE Price Index</td><td class='neg'>HIGH</td></tr>
<tr><td>10:00 AM</td><td style='color:#E6EDF3;'>UMich Sentiment (Final)</td><td style='color:#FFB300; font-weight:600;'>MED</td></tr>
<tr><td>10:00 AM</td><td style='color:#E6EDF3;'>ISM Manufacturing PMI</td><td style='color:#FFB300; font-weight:600;'>MED</td></tr>
</table></div>""", unsafe_allow_html=True)


# --- 9. TODAY'S EARNINGS CALENDAR ---
st.markdown("<div class='section-head'>09 — Today's Earnings Calendar</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'><table class='custom-table'>
<tr><th>TICKER</th><th>COMPANY</th><th>TIME</th></tr>
<tr><td><span class='etf-tag'>CRM</span></td><td style='color:#E6EDF3;'>Salesforce</td><td>After Close</td></tr>
<tr><td><span class='etf-tag'>SNOW</span></td><td style='color:#E6EDF3;'>Snowflake</td><td>After Close</td></tr>
<tr><td><span class='etf-tag'>OKTA</span></td><td style='color:#E6EDF3;'>Okta Inc.</td><td>After Close</td></tr>
</table></div>""", unsafe_allow_html=True)


# --- 10. EDITOR'S MORNING NOTE ---
st.markdown("<div class='section-head'>10 — Editor's Morning Note</div>", unsafe_allow_html=True)
st.markdown("""<div class='editor-note'>
<strong>Market Momentum (MKM)</strong> across the hourly timeframe indicates potential for a midday pivot. 
<br><br>
The real test today is the interaction with the 4.2% level on the 10Y Yield. Watch for a rotation out of heavily weighted tech names into defensive posturing if yields spike rapidly. 
<br><br>
Keep in mind that <strong>Monday, May 25 is Memorial Day</strong>, so markets will be closed. Plan your weekend risk exposure accordingly.
<br><br>
<strong>CLOSING POSTURE:</strong> Tactical long into the weekend with semis & AI-optics; pair-trade the energy/healthcare weakness against tech strength.
</div>""", unsafe_allow_html=True)
