import streamlit as st
import yfinance as yf
import pandas as pd
from datetime import datetime

# ==========================================
# 1. PAGE CONFIGURATION & NEWSLETTER CSS
# ==========================================
st.set_page_config(page_title="CTT Post-Market Wrap", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
<style>
    /* Force Newsletter Aesthetic */
    .stApp { 
        background: #0d0d12; 
        color: #e2e8f0; 
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; 
        font-size: 14px; 
        line-height: 1.6;
        -webkit-font-smoothing: antialiased; 
    }
    header {visibility: hidden;}
    footer {visibility: hidden;}
    
    /* Strict Width Constraint to match the HTML wrapper */
    .block-container { max-width: 760px !important; margin: 0 auto !important; padding-top: 1rem; padding-bottom: 3rem; }
    
    /* HEADER */
    .hdr { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 32px 32px 24px; border-bottom: 2px solid #312e81; border-radius: 8px 8px 0 0; margin-bottom: 24px;}
    .hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .wrap-type { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
    .wrap-title { font-size: 28px; font-weight: 800; color: #f1f5f9; margin-top: 6px; }
    .hdr-meta { text-align: right; font-size: 12px; color: #94a3b8; }
    .hdr-date { font-size: 15px; color: #c7d2fe; font-weight: 600; margin-bottom: 4px; }

    .badge-bullish  { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px; background: #052e16; color: #4ade80; border: 1px solid #166534; }
    .badge-bearish  { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px; background: #450a0a; color: #f87171; border: 1px solid #991b1b; }
    .badge-mixed    { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px; background: #2d2000; color: #fbbf24; border: 1px solid #92400e; }

    /* SECTION */
    .section { padding: 0px 0px 24px 0px; margin-bottom: 24px; border-bottom: 1px solid #1e293b; }
    .section-title { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 16px; }

    /* INSTRUMENT GRID */
    .inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .inst-card { background: #1e293b; border-radius: 8px; padding: 12px 14px; border: 1px solid #334155; }
    .inst-name  { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .inst-level { font-size: 17px; font-weight: 700; color: #f1f5f9; margin: 3px 0 2px; }
    .inst-change-up   { font-size: 12px; font-weight: 600; color: #4ade80; }
    .inst-change-down { font-size: 12px; font-weight: 600; color: #f87171; }
    .inst-change-flat { font-size: 12px; font-weight: 600; color: #94a3b8; }

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
    .custom-table { width: 100%; border-collapse: collapse; }
    .custom-table th { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #475569; padding: 8px 10px; text-align: left; border-bottom: 1px solid #1e293b; }
    .custom-table td { padding: 10px 10px; border-bottom: 1px solid #1e293b; vertical-align: top; }
    .custom-table tr:last-child td { border-bottom: none; }
    
    .ticker-cell { font-weight: 700; color: #f1f5f9; font-size: 14px; white-space: nowrap; }
    .ticker-name { font-size: 11px; color: #475569; display: block; font-weight: 400; margin-top: 2px; }
    .up-pct   { color: #4ade80; font-weight: 700; font-size: 14px; white-space: nowrap; }
    .down-pct { color: #f87171; font-weight: 700; font-size: 14px; white-space: nowrap; }
    .catalyst-cell { font-size: 12px; color: #94a3b8; line-height: 1.5; }

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
    .footer-note { background: #111827; border: 1px solid #312e81; border-radius: 10px; padding: 20px 22px; font-size: 13px; color: #94a3b8; line-height: 1.8; }
    .footer-note strong { color: #c7d2fe; }
    .divider-row td { padding: 4px 10px; background: #0d0d12; font-size: 10px; color: #334155; letter-spacing: 1px; text-transform: uppercase; }

    /* Responsive Grid Adjustments */
    @media (max-width: 600px) {
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
        "S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones (DJI)": "^DJI", 
        "Russell 2000": "^RUT", "VIX": "^VIX", "10Y Treasury": "^TNX", 
        "Gold (GC)": "GC=F", "WTI Crude": "CL=F", "DXY (Dollar)": "DX-Y.NYB",
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

# ==========================================
# 3. UI GENERATION
# ==========================================

date_str = datetime.now().strftime("%A, %B %d, %Y")

# --- HEADER ---
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

# --- SCORECARD ---
macro_data = fetch_expanded_macro()
scorecard_html = """
<div class="section">
  <div class="section-title">Closing Scorecard</div>
  <div class="inst-grid">
"""
for name, metrics in macro_data.items():
    color_class = "inst-change-up" if metrics['pct'] > 0 else "inst-change-down" if metrics['pct'] < 0 else "inst-change-flat"
    sign = "▲ +" if metrics['pct'] > 0 else "▼ " if metrics['pct'] < 0 else "— "
    
    # Formatting nuances for different assets
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
  <div class="sentiment-text">
    Stocks closed dynamically today as tech and semis led the charge, pushing the broader market higher. The VIX continues to bleed out premium, confirming that fear has decisively faded. Keep a close eye on the 10Y Yield as it interacts with key liquidity zones. 
  </div>
</div>
"""
st.markdown(scorecard_html, unsafe_allow_html=True)

# --- NEWS & CATALYSTS ---
st.markdown("""
<div class="section">
  <div class="section-title">Market Drivers &amp; Catalysts</div>

  <div class="news-item">
    <div class="news-item-top"><span class="news-badge nb-geopolitical">Geopolitical</span></div>
    <div class="news-headline">Indefinite Ceasefire Extension — Key Macro Catalyst</div>
    <div class="news-body">The primary driver of today's underlying bid: An indefinite extension of the ceasefire unlocked broad risk appetite. Supply-chain fears eased, oil held stable, and risk assets surged broadly. Semiconductor stocks — which had priced in supply-disruption risk — were among the biggest beneficiaries.</div>
  </div>

  <div class="news-item">
    <div class="news-item-top"><span class="news-badge nb-earnings">Earnings Beat</span></div>
    <div class="news-headline">GE Vernova (GEV) &amp; Boeing (BA) — Pre-Market Double Beat</div>
    <div class="news-body">GEV posted Q1 EPS of <strong>$1.98 vs. $1.90 est.</strong>, revenue $9.34B (beat), and raised 2026 guidance to $44.5–$45.5B — stock soared to new all-time highs. AI data center power demand driving massive Electrification order growth. Boeing reported losses of just <strong>–$0.20/share vs. –$0.80 est.</strong></div>
  </div>

  <div class="news-item">
    <div class="news-item-top"><span class="news-badge nb-alert">AH Volatile</span></div>
    <div class="news-headline">Tesla (TSLA) — EPS Beat, Revenue Miss — AH Reversal on Capex Shock</div>
    <div class="news-body">TSLA Q1: EPS <strong>$0.41 (est. $0.37)</strong> ✓ | Revenue <strong>$22.39B (est. $22.64B)</strong> ✗ (+16% YoY). Shares initially spiked +4% AH, then reversed to flat/down after management guided capex to <strong>$25B for 2026 — $5B above prior guidance</strong>. Energy segment revenue fell 12% YoY to $2.41B.</div>
  </div>
</div>
""", unsafe_allow_html=True)

# --- SECTOR HEAT MAP ---
sector_data = fetch_sector_flow()
if sector_data:
    heatmap_html = """
    <div class="section">
      <div class="section-title">Sector Heat Map — All 11 GICS Sectors (Best → Worst)</div>
      <table class="custom-table">
        <thead>
          <tr>
            <th style="width: 5%;">#</th>
            <th style="width: 45%;">Sector / ETF</th>
            <th style="width: 25%;">Est. Change</th>
            <th style="width: 25%;">Theme</th>
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
            <td style="color:#475569;font-size:12px">{rank}</td>
            <td class="ticker-cell">{item['ticker']}<span class="ticker-name">{item['sector']}</span></td>
            <td><span class="{color_class}">{sign}{item['pct']:.2f}%</span></td>
            <td class="catalyst-cell">Data sync complete</td>
          </tr>
        """
    heatmap_html += "</tbody></table></div>"
    st.markdown(heatmap_html, unsafe_allow_html=True)

# --- BREADTH & TECHNICALS ---
st.markdown("""
<div class="section">
  <div class="section-title">Market Breadth & Internals</div>

  <div class="news-item">
    <div class="news-item-top"><span class="news-badge nb-sector">A/D Line</span></div>
    <div class="news-headline">Advance/Decline Line Trending Higher — Broad Participation Confirmed</div>
    <div class="news-body">Since the recent selloff bottomed, the SPX advance/decline line has risen in lockstep with the index — confirming the rally isn't just mega-cap driven. A healthy advance/decline ratio confirms internals match the headline numbers.</div>
  </div>

  <div class="news-item">
    <div class="news-item-top"><span class="news-badge nb-technical">T2108</span></div>
    <div class="news-headline">T2108 (% Stocks Above 40-Day MA) — Recovering Toward Overbought</div>
    <div class="news-body">T2108 has been recovering rapidly with the index. Estimated reading is now <strong>55–65%</strong> — healthy breadth territory, but approaching levels where short-term caution begins. Watch for breadth divergence if T2108 stalls while price continues higher.</div>
  </div>
</div>
""", unsafe_allow_html=True)

# --- WATCHLIST ---
st.markdown("""
<div class="section">
  <div class="section-title">Tomorrow's Watchlist</div>

  <div class="watchlist-item">
    <div class="wl-num">1</div>
    <div>
      <div class="wl-header"><span class="wl-ticker">INTC</span><span style="font-size:12px;color:#64748b">Intel Corp</span></div>
      <div class="wl-body">Reports before the open. AI PC traction and foundry customer updates are key reads. Stock historically moves 8–12% on print. Watch: any revenue beat + guidance raise would signal PC refresh cycle re-acceleration.</div>
      <div class="wl-levels">Support: <span class="sup">$21.00</span> &nbsp;|&nbsp; Resistance: <span class="res">$27.00</span></div>
    </div>
  </div>

  <div class="watchlist-item">
    <div class="wl-num">2</div>
    <div>
      <div class="wl-header"><span class="wl-ticker">TSLA</span><span style="font-size:12px;color:#64748b">Tesla Inc</span></div>
      <div class="wl-body">Post-earnings price discovery day. AH reversal on $25B capex shock leaves the open uncertain. If it holds $245+, institutional buyers may use the AH dip as an entry into the AI/robotaxi thesis. High-volume open expected.</div>
      <div class="wl-levels">Support: <span class="sup">$235</span> &nbsp;|&nbsp; Resistance: <span class="res">$265</span></div>
    </div>
  </div>

  <div class="watchlist-item">
    <div class="wl-num">3</div>
    <div>
      <div class="wl-header"><span class="wl-ticker">GEV</span><span style="font-size:12px;color:#64748b">GE Vernova</span></div>
      <div class="wl-body">Post-ATH follow-through watch. Beat + raised 2026 guidance + massive AI power demand narrative intact. Look for institutional add-on buying on any morning dip. AI energy infrastructure is one of the strongest multi-year structural themes in the market right now.</div>
      <div class="wl-levels">Support: <span class="sup">$355</span> &nbsp;|&nbsp; Resistance: <span class="res">ATH</span></div>
    </div>
  </div>
</div>
""", unsafe_allow_html=True)

# --- FOOTER ---
st.markdown("""
<div class="footer-note" style="margin-bottom: 20px;">
  <strong>Hey Thomas —</strong><br><br>
  Strong tape today. New closing highs on SPX and the Nasdaq Composite, sectors are green, small caps participating — the internals match the headline. The VIX declining tells you this isn't a low-conviction squeeze; it's a regime shift back toward normal risk appetite.
  <br><br>
  Two names on the CTT engine worth flagging tomorrow: <strong>GEV</strong> is showing a textbook post-earnings breakout into ATH territory with fundamental backing (raised guide, AI power demand). Institutional follow-through on the open would confirm. <strong>INBX</strong> had a monster BLA-driven move; watch the first 30 minutes.
  <br><br>
  For directional posture: <em>remain long-biased on tech (XLK) and industrials (XLI)</em>, with a watchful eye on the TSLA open. Keep stops tight; ATH territory is not the place to be sloppy.
  <br><br>
  <strong>See you at 6:00 AM MST. 📈</strong>
</div>
""", unsafe_allow_html=True)
