import streamlit as st
import yfinance as yf
import pandas as pd
from datetime import datetime

# ==========================================
# 1. PAGE CONFIGURATION & ULTRA-CRISP CSS
# ==========================================
st.set_page_config(page_title="CTT Daily Briefing", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
<style>
    /* Force Crisp Font Rendering */
    .stApp { 
        background-color: #0A0D14; 
        color: #F8FAFC; 
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
        -webkit-font-smoothing: antialiased; 
        -moz-osx-font-smoothing: grayscale;
    }
    header {visibility: hidden;}
    footer {visibility: hidden;}
    
    /* Center at 70% width */
    .block-container { max-width: 70% !important; margin: 0 auto !important; padding-top: 2rem; padding-bottom: 4rem; }
    
    /* Typography & Colors */
    .pos { color: #10B981; font-weight: 600;} /* Sharper Green */
    .neg { color: #EF4444; font-weight: 600;} /* Sharper Red */
    
    /* Section headers: Slate gray, no lines, scaled up */
    .section-head { 
        color: #64748B; 
        font-size: 20px; 
        font-weight: 600; 
        margin-bottom: 12px; 
        margin-top: 40px; 
    }
    
    /* Crisp Parent Cards - NO BORDERS */
    .card { 
        background-color: #0A0D14; 
        padding: 0px; 
        border: none; 
    }
    
    /* Nested Sub-Cards (News List) */
    .sub-card { 
        background-color: #161D2B; 
        border-radius: 4px; 
        padding: 16px; 
        margin-bottom: 4px; 
        border: none;
    }
    .sub-card:last-child { margin-bottom: 0px; }
    
    /* Metrics Grid */
    .metric-grid { display: grid; gap: 16px; }
    .metric-box { background-color: #161D2B; padding: 16px; border-radius: 6px; text-align: center; border: none;}
    .metric-title { color: #64748B; font-size: 13px; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; font-weight: 600;}
    .metric-value { color: #FFFFFF; font-size: 26px; font-weight: 700; margin-bottom: 4px; }
    .metric-change { font-size: 14px; }
    
    /* Ultra-Crisp Borderless Tables with Fixed Layout - SCALED UP */
    .custom-table { width: 100%; border-collapse: separate; border-spacing: 0 4px; font-size: 15px; table-layout: fixed; }
    .custom-table th { text-align: left; color: #64748B; padding: 8px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; border: none; }
    
    /* Table Rows: No Borders, Only Background Color */
    .custom-table td { padding: 14px 12px; background-color: #161D2B; color: #E2E8F0; border: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    
    /* Keep row shapes sharp */
    .custom-table tr td:first-child { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
    .custom-table tr td:last-child { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
    
    .etf-tag { background: #1E293B; color: #38BDF8; padding: 4px 8px; border-radius: 3px; font-family: 'Courier New', monospace; font-size: 13px; font-weight: 700;}
    .badge-long { background: rgba(16, 185, 129, 0.1); color: #10B981; padding: 4px 8px; border-radius: 3px; font-size: 12px; font-weight: 700; text-transform: uppercase;}
    .badge-short { background: rgba(239, 68, 68, 0.1); color: #EF4444; padding: 4px 8px; border-radius: 3px; font-size: 12px; font-weight: 700; text-transform: uppercase;}
    
    /* Editor's Note */
    .editor-note { background-color: #161D2B; padding: 24px; border-radius: 6px; color: #E2E8F0; font-size: 16px; line-height: 1.6; border-left: 4px solid #8B5CF6; border: none;}
    .editor-note strong { color: #A78BFA; font-weight: 600; }

    /* Responsive Grid Adjustments */
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
    sectors = {
        "Technology": "XLK", "Financials": "XLF", "Energy": "XLE", 
        "Health Care": "XLV", "Discretionary": "XLY", "Staples": "XLP",
        "Industrials": "XLI", "Materials": "XLB", "Utilities": "XLU", "Real Estate": "XLRE"
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
st.markdown(f"<div style='color: #64748B; font-size: 16px; margin-bottom: 40px; font-weight: 600; text-align: center;'>{date_str}</div>", unsafe_allow_html=True)


# --- 01 | FUTURES & MACRO SNAPSHOT ---
st.markdown("<div class='section-head'>01 | Futures & Macro Snapshot</div>", unsafe_allow_html=True)
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


# --- 02 | KEY NEWS & CATALYSTS ---
st.markdown("<div class='section-head'>02 | Key News & Catalysts</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'>
    <div class='sub-card'>
        <div style='color: #EF4444; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;'>MACRO / FED</div>
        <div style='font-size: 16px; color: #E2E8F0;'><strong>Core PCE Print</strong> — Inflation data aligns with consensus, stripping away hawkish tail-risks and steepening the yield curve.</div>
    </div>
    <div class='sub-card'>
        <div style='color: #38BDF8; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;'>SECTOR ROTATION</div>
        <div style='font-size: 16px; color: #E2E8F0;'><strong>Semiconductor Strength</strong> — Leading optical/infra names continue their tear on server-demand signal, lifting NDX heavily.</div>
    </div>
    <div class='sub-card'>
        <div style='color: #A78BFA; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;'>M&A ACTION</div>
        <div style='font-size: 16px; color: #E2E8F0;'><strong>Pharma Bidding War</strong> — Competing private equity offers surface for mid-cap biosciences, juicing the XLV underlying.</div>
    </div>
    <div class='sub-card'>
        <div style='color: #10B981; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;'>GLOBAL SUPPLY CHAIN</div>
        <div style='font-size: 16px; color: #E2E8F0;'><strong>EV Output Pause</strong> — Major Shanghai manufacturing hub briefly halts production due to localized logistics bottlenecks.</div>
    </div>
    <div class='sub-card'>
        <div style='color: #F59E0B; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;'>BIG TECH</div>
        <div style='font-size: 16px; color: #E2E8F0;'><strong>Hardware Base Building</strong> — Consumer tech giants consolidate near 50-DMA ahead of major developer conference announcements.</div>
    </div>
    <div class='sub-card'>
        <div style='color: #3B82F6; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;'>COMMODITIES</div>
        <div style='font-size: 16px; color: #E2E8F0;'><strong>Crude Oil Geopolitics</strong> — WTI futures climb past $94 on renewed strategic reserve replenishment talks and tight physical markets.</div>
    </div>
    <div class='sub-card'>
        <div style='color: #EF4444; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;'>CONSUMER SPENDING</div>
        <div style='font-size: 16px; color: #E2E8F0;'><strong>Retail Sales Divergence</strong> — Discretionary spending shows cracks in lower-income brackets while luxury holds firm.</div>
    </div>
    <div class='sub-card'>
        <div style='color: #38BDF8; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;'>SOFTWARE & CLOUD</div>
        <div style='font-size: 16px; color: #E2E8F0;'><strong>Margin Expansion Focus</strong> — Enterprise SaaS names catch upgrades as cost-cutting measures begin heavily impacting bottom lines.</div>
    </div>
    <div class='sub-card'>
        <div style='color: #A78BFA; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;'>REGULATORY RISK</div>
        <div style='font-size: 16px; color: #E2E8F0;'><strong>Digital Asset Framework</strong> — New legislative proposals aimed at stablecoins introduce temporary volatility across crypto proxies.</div>
    </div>
    <div class='sub-card'>
        <div style='color: #F59E0B; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;'>TRANSPORTATION</div>
        <div style='font-size: 16px; color: #E2E8F0;'><strong>Airline Capacity Adjustments</strong> — Legacy carriers quietly trim Q3 seat capacity guidance citing domestic demand normalization.</div>
    </div>
</div>""", unsafe_allow_html=True)


# --- 03 | TOP SECTORS & MONEY FLOW ---
st.markdown("<div class='section-head'>03 | Top Sectors & Money Flow</div>", unsafe_allow_html=True)
sector_data = fetch_sector_flow()
table_html = """<div class='card'><table class='custom-table'>
<tr><th style='width: 20%;'>ETF</th><th style='width: 60%;'>SECTOR</th><th style='width: 20%; text-align: right;'>FLOW %</th></tr>\n"""
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


# --- 04 | PRE/POST MARKET GAPPERS ---
st.markdown("<div class='section-head'>04 | Pre/Post Market Gappers</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'><table class='custom-table'>
<tr><th style='width: 20%;'>TICKER</th><th style='width: 60%;'>CATALYST</th><th style='width: 20%; text-align: right;'>GAP %</th></tr>
<tr><td><span class='etf-tag'>MXL</span></td><td>Post-close PT hike drumbeat</td><td class='pos' style='text-align: right;'>+12.4%</td></tr>
<tr><td><span class='etf-tag'>POET</span></td><td>Sympathy read-through on optical orders</td><td class='pos' style='text-align: right;'>+8.1%</td></tr>
<tr><td><span class='etf-tag'>INTC</span></td><td>Continuation on margin expansion</td><td class='pos' style='text-align: right;'>+4.1%</td></tr>
<tr><td><span class='etf-tag'>DGN</span></td><td>Acquisition rumor confirmed by WSJ</td><td class='pos' style='text-align: right;'>+3.2%</td></tr>
<tr><td><span class='etf-tag'>AAOI</span></td><td>Guidance raised for Q2 deliveries</td><td class='pos' style='text-align: right;'>+2.9%</td></tr>
<tr><td><span class='etf-tag'>MRK</span></td><td>Defensive tactical rotation out of pharma</td><td class='neg' style='text-align: right;'>-2.3%</td></tr>
<tr><td><span class='etf-tag'>CVX</span></td><td>Profit-taking into impending prints</td><td class='neg' style='text-align: right;'>-1.8%</td></tr>
<tr><td><span class='etf-tag'>XOM</span></td><td>Sympathy drag with broader energy major fade</td><td class='neg' style='text-align: right;'>-1.5%</td></tr>
<tr><td><span class='etf-tag'>LULU</span></td><td>Inventory concerns raised in analyst note</td><td class='neg' style='text-align: right;'>-3.4%</td></tr>
<tr><td><span class='etf-tag'>SNOW</span></td><td>Pre-earnings de-risking by institutional desks</td><td class='neg' style='text-align: right;'>-4.1%</td></tr>
</table></div>""", unsafe_allow_html=True)


# --- 05 | STOCKS IN PLAY TODAY ---
st.markdown("<div class='section-head'>05 | Stocks in Play Today</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'><table class='custom-table'>
<tr><th style='width: 20%;'>TICKER</th><th style='width: 60%;'>KEY LEVEL</th><th style='width: 20%; text-align: right;'>BIAS</th></tr>
<tr><td><span class='etf-tag'>NVDA</span></td><td>$200 / $210</td><td style='text-align: right;'><span class='badge-long'>LONG</span></td></tr>
<tr><td><span class='etf-tag'>AMD</span></td><td>Breakout $275</td><td style='text-align: right;'><span class='badge-long'>LONG</span></td></tr>
<tr><td><span class='etf-tag'>AAPL</span></td><td>Base $170</td><td style='text-align: right;'><span class='badge-long'>LONG</span></td></tr>
<tr><td><span class='etf-tag'>META</span></td><td>Hold $480</td><td style='text-align: right;'><span class='badge-long'>LONG</span></td></tr>
<tr><td><span class='etf-tag'>SPY</span></td><td>Hold $510</td><td style='text-align: right;'><span class='badge-long'>LONG</span></td></tr>
<tr><td><span class='etf-tag'>OXY</span></td><td>Fade $65</td><td style='text-align: right;'><span class='badge-short'>SHORT</span></td></tr>
<tr><td><span class='etf-tag'>TSLA</span></td><td>Reject $190</td><td style='text-align: right;'><span class='badge-short'>SHORT</span></td></tr>
<tr><td><span class='etf-tag'>BA</span></td><td>Break $160</td><td style='text-align: right;'><span class='badge-short'>SHORT</span></td></tr>
<tr><td><span class='etf-tag'>UNH</span></td><td>Range $450-$465</td><td style='text-align: right;'><span class='badge-short'>RANGE</span></td></tr>
<tr><td><span class='etf-tag'>JPM</span></td><td>Range $185-$192</td><td style='text-align: right;'><span class='badge-short'>RANGE</span></td></tr>
</table></div>""", unsafe_allow_html=True)


# --- 06 | SENTIMENT & MARKET BREADTH ---
st.markdown("<div class='section-head'>06 | Sentiment & Market Breadth (T2108)</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'><div class='metric-grid' style='grid-template-columns: repeat(3, 1fr);'>
    <div class='metric-box'><div class='metric-title'>T2108 Proxy (Above 40D SMA)</div><div class='metric-value'>54.2%</div><div class='metric-change pos'>Healthy Breadth</div></div>
    <div class='metric-box'><div class='metric-title'>Put/Call Ratio</div><div class='metric-value'>0.82</div><div class='metric-change pos'>Bullish Bias</div></div>
    <div class='metric-box'><div class='metric-title'>SPX > 50D Moving Avg</div><div class='metric-value'>~72%</div><div class='metric-change pos'>Strong Trend</div></div>
</div></div>""", unsafe_allow_html=True)


# --- 07 | TECHNICAL ANALYSIS & VPCI ---
st.markdown("<div class='section-head'>07 | Technical Analysis & VPCI</div>", unsafe_allow_html=True)
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
            <div style='color: #64748B; font-size: 13px; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px;'>CURRENT VPCI READING (SPY)</div>
            <div style='font-size: 26px; font-weight: 700;'><span class='{vpci_color}'>{latest_vpci:.4f}</span> | {vpci_status}</div>
        </div>
        <div style='font-size: 16px; color: #E2E8F0; line-height: 1.6;'>
            The Volume Price Confirmation Indicator (VPCI) measures the relationship between price trends and volume. 
            Currently, the VPCI is reading <strong>{latest_vpci:.4f}</strong> against a closing price of <strong>${latest_price:.2f}</strong>. 
            A positive value indicates that volume is expanding in the direction of the trend, confirming bullish strength. A negative value suggests weakening volume support.
        </div>
        </div>""", unsafe_allow_html=True)
except:
    st.error("VPCI data synchronizing...")


# --- 08 | ECONOMIC DATA & CATALYSTS ---
st.markdown("<div class='section-head'>08 | Economic Data & Catalysts Today</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'><table class='custom-table'>
<tr><th style='width: 20%;'>TIME (EST)</th><th style='width: 60%;'>RELEASE</th><th style='width: 20%; text-align: right;'>IMPACT</th></tr>
<tr><td>08:30 AM</td><td style='color:#E2E8F0;'>Core PCE Price Index MoM</td><td class='neg' style='text-align: right;'>HIGH</td></tr>
<tr><td>08:30 AM</td><td style='color:#E2E8F0;'>Core PCE Price Index YoY</td><td class='neg' style='text-align: right;'>HIGH</td></tr>
<tr><td>08:30 AM</td><td style='color:#E2E8F0;'>Personal Income & Spending</td><td style='color:#F59E0B; font-weight:600; text-align: right;'>MED</td></tr>
<tr><td>09:45 AM</td><td style='color:#E2E8F0;'>Chicago PMI</td><td style='color:#F59E0B; font-weight:600; text-align: right;'>MED</td></tr>
<tr><td>10:00 AM</td><td style='color:#E2E8F0;'>UMich Consumer Sentiment (Final)</td><td class='neg' style='text-align: right;'>HIGH</td></tr>
<tr><td>10:00 AM</td><td style='color:#E2E8F0;'>UMich 1-Yr Inflation Exp</td><td class='neg' style='text-align: right;'>HIGH</td></tr>
<tr><td>10:00 AM</td><td style='color:#E2E8F0;'>UMich 5-Yr Inflation Exp</td><td style='color:#F59E0B; font-weight:600; text-align: right;'>MED</td></tr>
<tr><td>10:00 AM</td><td style='color:#E2E8F0;'>ISM Manufacturing PMI</td><td class='neg' style='text-align: right;'>HIGH</td></tr>
<tr><td>10:00 AM</td><td style='color:#E2E8F0;'>Pending Home Sales</td><td style='color:#F59E0B; font-weight:600; text-align: right;'>MED</td></tr>
<tr><td>01:00 PM</td><td style='color:#E2E8F0;'>Baker Hughes Rig Count</td><td style='color:#64748B; font-weight:600; text-align: right;'>LOW</td></tr>
</table></div>""", unsafe_allow_html=True)


# --- 09 | TODAY'S EARNINGS CALENDAR ---
st.markdown("<div class='section-head'>09 | Today's Earnings Calendar</div>", unsafe_allow_html=True)
st.markdown("""<div class='card'><table class='custom-table'>
<tr><th style='width: 20%;'>TICKER</th><th style='width: 60%;'>COMPANY</th><th style='width: 20%; text-align: right;'>TIME</th></tr>
<tr><td><span class='etf-tag'>CRM</span></td><td style='color:#E2E8F0;'>Salesforce Inc.</td><td style='text-align: right;'>After Close</td></tr>
<tr><td><span class='etf-tag'>SNOW</span></td><td style='color:#E2E8F0;'>Snowflake Inc.</td><td style='text-align: right;'>After Close</td></tr>
<tr><td><span class='etf-tag'>OKTA</span></td><td style='color:#E2E8F0;'>Okta Inc.</td><td style='text-align: right;'>After Close</td></tr>
<tr><td><span class='etf-tag'>CRWD</span></td><td style='color:#E2E8F0;'>CrowdStrike Holdings</td><td style='text-align: right;'>After Close</td></tr>
<tr><td><span class='etf-tag'>VEEV</span></td><td style='color:#E2E8F0;'>Veeva Systems</td><td style='text-align: right;'>After Close</td></tr>
<tr><td><span class='etf-tag'>MDB</span></td><td style='color:#E2E8F0;'>MongoDB Inc.</td><td style='text-align: right;'>After Close</td></tr>
<tr><td><span class='etf-tag'>HPE</span></td><td style='color:#E2E8F0;'>Hewlett Packard Ent.</td><td style='text-align: right;'>After Close</td></tr>
<tr><td><span class='etf-tag'>CHWY</span></td><td style='color:#E2E8F0;'>Chewy Inc.</td><td style='text-align: right;'>After Close</td></tr>
<tr><td><span class='etf-tag'>FIVE</span></td><td style='color:#E2E8F0;'>Five Below</td><td style='text-align: right;'>After Close</td></tr>
<tr><td><span class='etf-tag'>PSTG</span></td><td style='color:#E2E8F0;'>Pure Storage</td><td style='text-align: right;'>After Close</td></tr>
</table></div>""", unsafe_allow_html=True)


# --- 10 | EDITOR'S MORNING NOTE ---
st.markdown("<div class='section-head'>10 | Editor's Morning Note</div>", unsafe_allow_html=True)
st.markdown("""<div class='editor-note'>
<strong>Market Momentum (MKM)</strong> across the hourly timeframe indicates potential for a midday pivot. 
<br><br>
The real test today is the interaction with the 4.2% level on the 10Y Yield. Watch for a rotation out of heavily weighted tech names into defensive posturing if yields spike rapidly. 
<br><br>
Keep in mind that <strong>Monday, May 25 is Memorial Day</strong>, so markets will be closed. Plan your weekend risk exposure accordingly.
<br><br>
<strong>CLOSING POSTURE:</strong> Tactical long into the weekend with semis & AI-optics; pair-trade the energy/healthcare weakness against tech strength.
</div>""", unsafe_allow_html=True)
