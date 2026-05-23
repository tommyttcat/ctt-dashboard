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
    .stApp { background: #0d0d12; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
    header {visibility: hidden;}
    footer {visibility: hidden;}
    
    /* Layout: 70% width as requested */
    .block-container { max-width: 70% !important; margin: 0 auto !important; padding-top: 1rem; padding-bottom: 3rem; }
    
    /* HEADER */
    .hdr { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 36px 36px 28px; border-bottom: 2px solid #312e81; border-radius: 8px 8px 0 0; margin-bottom: 24px;}
    .hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .wrap-type { font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
    .wrap-title { font-size: 34px; font-weight: 800; color: #f1f5f9; margin-top: 8px; }
    .hdr-meta { text-align: right; font-size: 14px; color: #94a3b8; }
    .hdr-date { font-size: 18px; color: #c7d2fe; font-weight: 600; margin-bottom: 4px; }
    .badge-bullish { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; background: #052e16; color: #4ade80; border: 1px solid #166534; }

    /* SECTION */
    .section { padding: 0px 0px 28px 0px; margin-bottom: 28px; border-bottom: 1px solid #1e293b; }
    .section-title { font-size: 14px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 20px; }

    /* INSTRUMENT GRID */
    .inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .inst-card { background: #1e293b; border-radius: 8px; padding: 16px 18px; border: 1px solid #334155; }
    .inst-name { font-size: 13px; color: #64748b; font-weight: 700; text-transform: uppercase; }
    .inst-level { font-size: 22px; font-weight: 700; color: #f1f5f9; margin: 4px 0; }
    .inst-change-up { font-size: 15px; font-weight: 600; color: #4ade80; }

    /* NEWS & TABLE */
    .news-item { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 18px 20px; margin-bottom: 12px; }
    .news-badge { padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; background: #312e81; color: #a5b4fc; }
    .custom-table { width: 100%; border-collapse: collapse; font-size: 16px; }
    .custom-table th { font-size: 12px; font-weight: 700; color: #475569; padding: 12px; border-bottom: 1px solid #1e293b; }
    .custom-table td { padding: 14px 12px; border-bottom: 1px solid #1e293b; }
    .etf-tag { background: #1E293B; color: #58A6FF; padding: 4px 8px; border-radius: 4px; font-family: monospace; font-size: 14px; font-weight: 700;}

    /* EDITOR'S NOTE */
    .editor-note { background-color: #111827; padding: 24px; border-radius: 8px; border-left: 4px solid #8B5CF6; font-size: 16px; color: #e2e8f0; line-height: 1.8; }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. DATA ENGINES
# ==========================================
@st.cache_data(ttl=300) 
def fetch_data():
    tickers = {"SPX": "^GSPC", "NDX": "^IXIC", "DJI": "^DJI", "RUT": "^RUT", "VIX": "^VIX", "10Y": "^TNX"}
    data = {}
    for n, t in tickers.items():
        tick = yf.Ticker(t).history(period="2d")
        if len(tick) >= 2:
            data[n] = {"price": tick['Close'].iloc[1], "pct": ((tick['Close'].iloc[1]-tick['Close'].iloc[0])/tick['Close'].iloc[0])*100}
    return data

# ==========================================
# 3. UI GENERATION
# ==========================================
st.markdown(f"""<div class="hdr"><div class="hdr-top">
<div><div class="wrap-type">Market Briefing</div><div class="wrap-title">Confluence Trading Tool Market Briefing</div></div>
<div class="hdr-meta"><div class="hdr-date">{datetime.now().strftime("%A, %B %d, %Y")}</div><span class="badge-bullish">BULLISH</span></div>
</div></div>""", unsafe_allow_html=True)

# 01 | SCORECARD
st.markdown("<div class='section'><div class='section-title'>Market Scorecard</div><div class='inst-grid'>", unsafe_allow_html=True)
for name, m in fetch_data().items():
    st.markdown(f"<div class='inst-card'><div class='inst-name'>{name}</div><div class='inst-level'>{m['price']:,.2f}</div><div class='inst-change-up'>{m['pct']:.2f}%</div></div>", unsafe_allow_html=True)
st.markdown("</div></div>", unsafe_allow_html=True)

# 02 | NEWS
st.markdown("<div class='section'><div class='section-title'>Key News & Catalysts</div>", unsafe_allow_html=True)
st.markdown("<div class='news-item'><span class='news-badge'>MACRO</span><div class='news-headline'>Core PCE Print</div><div class='news-body'>Inflation aligns with consensus, easing hawkish tail-risks.</div></div>", unsafe_allow_html=True)
st.markdown("</div>", unsafe_allow_html=True)

# 03 | SECTORS
st.markdown("<div class='section'><div class='section-title'>Top Sectors</div><table class='custom-table'><tr><th>ETF</th><th>SECTOR</th><th>FLOW %</th></tr><tr><td><span class='etf-tag'>XLK</span></td><td>Technology</td><td class='pos'>+2.1%</td></tr></table></div>", unsafe_allow_html=True)

# 04, 05 | GAPPERS / STOCKS IN PLAY (Stacked for mobile, looks wide on desktop)
st.markdown("<div class='section'><div class='section-title'>Pre-Market Gappers</div><table class='custom-table'><tr><th>TICKER</th><th>GAP</th><th>CATALYST</th></tr><tr><td><span class='etf-tag'>MXL</span></td><td class='pos'>+12%</td><td>PT Hikes</td></tr></table></div>", unsafe_allow_html=True)
st.markdown("<div class='section'><div class='section-title'>Stocks In Play</div><table class='custom-table'><tr><th>TICKER</th><th>LEVEL</th><th>BIAS</th></tr><tr><td><span class='etf-tag'>NVDA</span></td><td>$200</td><td class='pos'>LONG</td></tr></table></div>", unsafe_allow_html=True)

# 06, 07, 08, 09, 10
st.markdown("<div class='section'><div class='section-title'>Market Breadth & Technicals</div><div class='card'>VPCI Trend: Bullish Confirmation</div></div>", unsafe_allow_html=True)
st.markdown("<div class='section'><div class='section-title'>Editor's Morning Note</div><div class='editor-note'><strong>Market Momentum (MKM)</strong>: Focus on 10Y Yield interaction with 4.2% level. Tactical long into Monday.</div></div>", unsafe_allow_html=True)
