import streamlit as st
import yfinance as yf
import pandas as pd
from datetime import datetime

# ==========================================
# 1. PAGE CONFIGURATION & PREMIUM CSS
# ==========================================
st.set_page_config(page_title="CTT Market Briefing", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
<style>
    /* Base App Styling - Dark Theme, Crisp Fonts */
    .stApp { 
        background: #0d0d12; 
        color: #e2e8f0; 
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; 
        font-size: 16px; 
        line-height: 1.6;
        -webkit-font-smoothing: antialiased; 
    }
    header {visibility: hidden;}
    footer {visibility: hidden;}
    
    /* WIDER CONTAINER: 85% width for a larger, breathable layout */
    .block-container { max-width: 1200px !important; margin: 0 auto !important; padding-top: 2rem; padding-bottom: 4rem; }
    
    /* HEADER */
    .hdr { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 36px 40px; border-bottom: 2px solid #312e81; border-radius: 12px; margin-bottom: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);}
    .hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .wrap-type { font-size: 14px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
    .wrap-title { font-size: 38px; font-weight: 800; color: #f1f5f9; margin-top: 8px; }
    .hdr-meta { text-align: right; font-size: 15px; color: #94a3b8; }
    .hdr-date { font-size: 18px; color: #c7d2fe; font-weight: 600; margin-bottom: 6px; }

    .badge-bullish  { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; letter-spacing: 1px; background: #052e16; color: #4ade80; border: 1px solid #166534; }
    .badge-bearish  { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; letter-spacing: 1px; background: #450a0a; color: #f87171; border: 1px solid #991b1b; }
    .badge-mixed    { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; letter-spacing: 1px; background: #2d2000; color: #fbbf24; border: 1px solid #92400e; }

    /* SECTIONS & CLOUDS (CARDS) */
    .section-title { font-size: 15px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 16px; margin-top: 32px; padding-left: 4px;}
    
    /* The "Cloud" Look */
    .card { background: #1e293b; border-radius: 12px; padding: 24px 28px; border: 1px solid #334155; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }

    /* INSTRUMENT GRID */
    .inst-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .inst-card { background: #111827; border-radius: 8px; padding: 18px; border: 1px solid #1e293b; text-align: center; }
    .inst-name  { font-size: 13px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;}
    .inst-level { font-size: 26px; font-weight: 700; color: #f1f5f9; margin: 4px 0; }
    .inst-change-up   { font-size: 15px; font-weight: 600; color: #4ade80; }
    .inst-change-down { font-size: 15px; font-weight: 600; color: #f87171; }
    .inst-change-flat { font-size: 15px; font-weight: 600; color: #94a3b8; }

    /* NEWS & CONTENT LISTS */
    .news-item { background: #111827; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin-bottom: 12px; }
    .news-item-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .news-badge { padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
    .nb-macro       { background: #312e81; color: #a5b4fc; }
    .nb-earnings    { background: #164e63; color: #67e8f9; }
    .nb-sector      { background: #052e16; color: #4ade80; }
    .nb-alert       { background: #450a0a; color: #fca5a5; }
    .news-headline { font-size: 18px; font-weight: 700; color: #f1f5f9; margin-bottom: 6px; }
    .news-body { font-size: 16px; color: #cbd5e1; line-height: 1.6; }

    /* TABLES */
    .custom-table { width: 100%; border-collapse: collapse; font-size: 16px; }
    .custom-table th { font-size: 13px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; padding: 14px 12px; text-align: left; border-bottom: 2px solid #334155; }
    .custom-table td { padding: 16px 12px; border-bottom: 1px solid #334155; vertical-align: middle; color: #e2e8f0; }
    .custom-table tr:last-child td { border-bottom: none; }
    
    .etf-tag { background: #0f172a; color: #60a5fa; padding: 6px 10px; border-radius: 6px; font-family: monospace; font-size: 15px; font-weight: 700; border: 1px solid #1e2b4d;}
    .up-pct   { color: #4ade80; font-weight: 700; font-size: 16px; white-space: nowrap; }
    .down-pct { color: #f87171; font-weight: 700; font-size: 16px; white-space: nowrap; }

    /* BADGES FOR BIAS */
    .badge-long { color: #4ade80; font-size: 14px; font-weight: 800; text-transform: uppercase; background: rgba(74, 222, 128, 0.1); padding: 4px 8px; border-radius: 4px;}
    .badge-short { color: #f87171; font-size: 14px; font-weight: 800; text-transform: uppercase; background: rgba(248, 113, 113, 0.1); padding: 4px 8px; border-radius: 4px;}
    .badge-range { color: #fbbf24; font-size: 14px; font-weight: 800; text-transform: uppercase; background: rgba(251, 191, 36, 0.1); padding: 4px 8px; border-radius: 4px;}

    /* EDITOR'S NOTE */
    .editor-note { background-color: #111827; padding: 28px; border-radius: 12px; border-left: 5px solid #818cf8; font-size: 17px; color: #e2e8f0; line-height: 1.8; border-top: 1px solid #1e293b; border-right: 1px solid #1e293b; border-bottom: 1px solid #1e293b;}
    .editor-note strong { color: #c7d2fe; }

    /* Responsive Adjustments */
    @media (max-width: 900px) {
        .inst-grid { grid-template-columns: repeat(2, 1fr); }
    }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. DATA ENGINES
# ==========================================
@st.cache_data(ttl=300) 
def fetch_expanded_macro():
    tickers = {
        "S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones": "^DJI", 
        "Russell 2000": "^RUT", "VIX": "^VIX", "10Y Treasury": "^TNX", 
        "WTI Crude": "CL=F", "Bitcoin (BTC)": "BTC-USD"
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
        "Technology": "XLK", "Comm. Services": "XLC", "Consumer Disc": "XLY", 
        "Industrials": "XLI", "Financials": "XLF", "Materials": "XLB",
        "Real Estate": "XLRE", "Consumer Staples": "XLP", "Utilities": "XLU", 
        "Energy": "XLE", "Health Care": "XLV"
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
# 3. UI GENERATION
# ==========================================

date_str = datetime.now().strftime("%A, %B %d, %Y")

# --- HEADER ---
st.markdown(f"""
<div class="hdr">
    <div class="hdr-top">
        <div>
            <div class="wrap-type">Market Briefing</div>
            <div class="wrap-title">Confluence Trading Tool Market Briefing</div>
        </div>
        <div class="hdr-meta">
            <div class="hdr-date">{date_str}</div>
            <div style="margin-bottom:10px;color:#94a3b8">Market Posture</div>
            <span class="badge-bullish">BULLISH</span>
        </div>
    </div>
</div>
""", unsafe_allow_html=True)

# --- 01 | FUTURES & MACRO SNAPSHOT ---
macro_data = fetch_expanded_macro()
scorecard_html = """
<div class="section-title">01 | Futures & Macro Snapshot</div>
<div class="card">
  <div class="inst-grid">
"""
for name, metrics in macro_data.items():
    color_class = "inst-change-up" if metrics['pct'] > 0 else "inst-change-down" if metrics['pct'] < 0 else "inst-change-flat"
    sign = "▲ +" if metrics['pct'] > 0 else "▼ " if metrics['pct'] < 0 else "— "
    
    if name in ["VIX", "10Y Treasury"]:
        price_str = f"{metrics['price']:.3f}"
    elif name in ["Bitcoin (BTC)", "WTI Crude"]:
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
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)

# --- 02 | KEY NEWS & CATALYSTS ---
st.markdown("""
<div class="section-title">02 | Key News & Catalysts</div>
<div class="card">
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
    <div class="section-title">03 | Top Sectors & Money Flow</div>
    <div class="card">
      <table class="custom-table">
        <thead>
          <tr>
            <th style="width: 15%;">ETF</th>
            <th style="width: 60%;">SECTOR</th>
            <th style="width: 25%; text-align: right;">FLOW %</th>
          </tr>
        </thead>
        <tbody>
    """
    for item in sector_data:
        color_class = "up-pct" if item['pct'] >= 0 else "down-pct"
        sign = "+" if item['pct'] > 0 else ""
        heatmap_html += f"""
          <tr>
            <td><span class="etf-tag">{item['ticker']}</span></td>
            <td style="font-weight: 600;">{item['sector']}</td>
            <td style="text-align: right;"><span class="{color_class}">{sign}{item['pct']:.2f}%</span></td>
          </tr>
        """
    heatmap_html += "</tbody></table></div>"
    st.markdown(heatmap_html, unsafe_allow_html=True)

# --- 04 | PRE/POST MARKET GAPPERS ---
st.markdown("""
<div class="section-title">04 | Pre/Post Market Gappers</div>
<div class="card">
  <table class="custom-table">
    <thead>
      <tr>
        <th style="width: 15%;">TICKER</th>
        <th style="width: 60%;">CATALYST</th>
        <th style="width: 25%; text-align: right;">GAP %</th>
      </tr>
    </thead>
    <tbody>
      <tr><td><span class="etf-tag">MXL</span></td><td>Post-close analyst upgrade drumbeat</td><td style="text-align: right;"><span class="up-pct">+12.4%</span></td></tr>
      <tr><td><span class="etf-tag">POET</span></td><td>Sympathy read-through on optical orders</td><td style="text-align: right;"><span class="up-pct">+8.1%</span></td></tr>
      <tr><td><span class="etf-tag">INTC</span></td><td>Continuation on margin expansion</td><td style="text-align: right;"><span class="up-pct">+4.1%</span></td></tr>
      <tr><td><span class="etf-tag">MRK</span></td><td>Defensive tactical rotation out of pharma</td><td style="text-align: right;"><span class="down-pct">-2.3%</span></td></tr>
      <tr><td><span class="etf-tag">SNOW</span></td><td>Pre-earnings de-risking by institutional desks</td><td style="text-align: right;"><span class="down-pct">-4.1%</span></td></tr>
    </tbody>
  </table>
</div>
""", unsafe_allow_html=True)

# --- 05 | STOCKS IN PLAY TODAY ---
st.markdown("""
<div class="section-title">05 | Stocks in Play Today</div>
<div class="card">
  <table class="custom-table">
    <thead>
      <tr>
        <th style="width: 15%;">TICKER</th>
        <th style="width: 60%;">KEY LEVEL</th>
        <th style="width: 25%; text-align: right;">BIAS</th>
      </tr>
    </thead>
    <tbody>
      <tr><td><span class="etf-tag">NVDA</span></td><td>$200 / $210</td><td style="text-align: right;"><span class="badge-long">LONG</span></td></tr>
      <tr><td><span class="etf-tag">AAPL</span></td><td>Base $170</td><td style="text-align: right;"><span class="badge-long">LONG</span></td></tr>
      <tr><td><span class="etf-tag">SPY</span></td><td>Hold $510 / fade $520</td><td style="text-align: right;"><span class="badge-range">RANGE</span></td></tr>
      <tr><td><span class="etf-tag">OXY</span></td><td>Fade $65</td><td style="text-align: right;"><span class="badge-short">SHORT</span></td></tr>
      <tr><td><span class="etf-tag">BA</span></td><td>Break $160</td><td style="text-align: right;"><span class="badge-short">SHORT</span></td></tr>
    </tbody>
  </table>
</div>
""", unsafe_allow_html=True)

# --- 06 | SENTIMENT & MARKET BREADTH ---
st.markdown("""
<div class="section-title">06 | Sentiment & Market Breadth</div>
<div class="card">
  <div class="inst-grid" style="grid-template-columns: repeat(3, 1fr);">
    <div class="inst-card">
      <div class="inst-name">T2108 (% Above 40D MA)</div>
      <div class="inst-level">58.4%</div>
      <div class="inst-change-up">Healthy Breadth</div>
    </div>
    <div class="inst-card">
      <div class="inst-name">Put/Call Ratio</div>
      <div class="inst-level">0.82</div>
      <div class="inst-change-up">Bullish Bias</div>
    </div>
    <div class="inst-card">
      <div class="inst-name">SPX > 50D MA</div>
      <div class="inst-level">~72%</div>
      <div class="inst-change-up">Strong Trend</div>
    </div>
  </div>
</div>
""", unsafe_allow_html=True)

# --- 07 | TECHNICAL ANALYSIS & VPCI ---
st.markdown("<div class='section-title'>07 | Technical Analysis & VPCI</div>", unsafe_allow_html=True)
try:
    spy_df = yf.Ticker("SPY").history(period="3mo")
    if not spy_df.empty and len(spy_df) > 21:
        latest_vpci = calculate_vpci(spy_df)
        vpci_color = "up-pct" if latest_vpci >= 0 else "down-pct"
        vpci_status = "BULLISH CONFIRMATION" if latest_vpci >= 0 else "BEARISH DIVERGENCE"
        st.markdown(f"""
        <div class="card">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #334155; padding-bottom: 16px; margin-bottom: 16px;">
            <div>
              <div style="font-size: 14px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Current VPCI Reading (SPY)</div>
              <div style="font-size: 28px; font-weight: 800;"><span class="{vpci_color}">{latest_vpci:.4f}</span></div>
            </div>
            <div style="text-align: right;">
              <span class="{'badge-long' if latest_vpci >= 0 else 'badge-short'}">{vpci_status}</span>
            </div>
          </div>
          <div style="color: #cbd5e1; font-size: 16px; line-height: 1.6;">
            The Volume Price Confirmation Indicator (VPCI) measures the relationship between price trends and volume. A positive value indicates that volume is expanding in the direction of the trend, confirming bullish strength.
          </div>
        </div>
        """, unsafe_allow_html=True)
except:
    st.markdown("<div class='card'>VPCI data syncing...</div>", unsafe_allow_html=True)

# --- 08 | ECONOMIC DATA & CATALYSTS ---
st.markdown("""
<div class="section-title">08 | Economic Data & Catalysts Today</div>
<div class="card">
  <table class="custom-table">
    <thead>
      <tr>
        <th style="width: 20%;">TIME (EST)</th>
        <th style="width: 60%;">RELEASE</th>
        <th style="width: 20%; text-align: right;">IMPACT</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>08:30 AM</td><td>Core PCE Price Index MoM</td><td style="text-align: right;"><span class="down-pct">HIGH</span></td></tr>
      <tr><td>09:45 AM</td><td>Chicago PMI</td><td style="text-align: right; color: #fbbf24; font-weight: 700;">MED</td></tr>
      <tr><td>10:00 AM</td><td>UMich Consumer Sentiment (Final)</td><td style="text-align: right;"><span class="down-pct">HIGH</span></td></tr>
      <tr><td>01:00 PM</td><td>Baker Hughes Rig Count</td><td style="text-align: right; color: #94a3b8; font-weight: 700;">LOW</td></tr>
    </tbody>
  </table>
</div>
""", unsafe_allow_html=True)

# --- 09 | TODAY'S EARNINGS CALENDAR ---
st.markdown("""
<div class="section-title">09 | Today's Earnings Calendar</div>
<div class="card">
  <table class="custom-table">
    <thead>
      <tr>
        <th style="width: 15%;">TICKER</th>
        <th style="width: 60%;">COMPANY</th>
        <th style="width: 25%; text-align: right;">TIME</th>
      </tr>
    </thead>
    <tbody>
      <tr><td><span class="etf-tag">CRM</span></td><td>Salesforce Inc.</td><td style="text-align: right; color: #94a3b8;">After Close</td></tr>
      <tr><td><span class="etf-tag">SNOW</span></td><td>Snowflake Inc.</td><td style="text-align: right; color: #94a3b8;">After Close</td></tr>
      <tr><td><span class="etf-tag">CRWD</span></td><td>CrowdStrike Holdings</td><td style="text-align: right; color: #94a3b8;">After Close</td></tr>
    </tbody>
  </table>
</div>
""", unsafe_allow_html=True)

# --- 10 | EDITOR'S MORNING NOTE ---
st.markdown("""
<div class="section-title">10 | Editor's Morning Note</div>
<div class="editor-note">
  <strong>Market Momentum (MKM)</strong> is synchronized across the hourly timeframe, indicating potential for a midday pivot. 
  <br><br>
  The real test today is the interaction with the 4.2% level on the 10Y Yield. Watch for a rotation out of heavily weighted tech names into defensive posturing if yields spike rapidly. 
  <br><br>
  Keep in mind that <strong>Monday, May 25 is Memorial Day</strong>, so markets will be closed. Plan your weekend risk exposure accordingly.
  <br><br>
  <strong>CLOSING POSTURE:</strong> Tactical long into the weekend with semis & AI-optics; pair-trade the energy/healthcare weakness against tech strength.
</div>
""", unsafe_allow_html=True)
