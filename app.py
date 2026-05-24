import streamlit as st
import yfinance as yf
import pandas as pd
import requests
import re
import os
import json
from datetime import datetime, timedelta

# --- SAFETY HELPER ---
def safe_float(val):
    try: return float(val)
    except: return None

# ==========================================
# API KEYS & CONFIG
# ==========================================
BZ_KEY = "bz.4DVR2L3LKQD6KU5Z4CHZPPNE5MPV2KLQ"
FMP_KEY = "WMMhcffuHSYVTceXryrt4tHC8GXcsB0g"
MASSIVE_KEY = "TfwImIVSEp2wLzNnXpwysYH9ccvjk6pv"

st.set_page_config(page_title="Confluence Trading Tools", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
<style>
/* Reset and Base App Styling */
.stApp { 
    background: #0a1120; 
    color: #e2e8f0; 
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; 
    font-size: 16px; 
    line-height: 1.6; 
}
header {visibility: hidden;}
footer {visibility: hidden;}

/* ONE BIG CLOUD - Master Container */
.block-container { 
    background: #111827 !important; 
    border-radius: 16px !important; 
    padding: 64px 56px !important; 
    max-width: 1100px !important; 
    margin-top: 40px !important;
    margin-bottom: 40px !important;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5) !important; 
    border: 1px solid rgba(255, 255, 255, 0.05) !important;
}

/* HEADER */
.hdr { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; margin-bottom: 48px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.wrap-type { font-size: 16px; font-weight: 600; letter-spacing: 1px; color: #818cf8; }
.wrap-title { font-size: 42px; font-weight: 800; color: #f1f5f9; margin-top: 4px; }
.hdr-meta { text-align: right; font-size: 16px; color: #94a3b8; }
.hdr-date { font-size: 20px; color: #c7d2fe; font-weight: 600; margin-bottom: 8px; }

/* INDIVIDUAL SECTION WRAPPER */
.section-container {
    border-left: 4px solid #64748b; 
    padding-left: 24px;
}

.section-spacer { height: 56px; width: 100%; display: block; }

/* SECTION TITLE (Clean Title Case) */
.section-title { font-size: 20px; font-weight: 700; color: #e2e8f0; margin-bottom: 24px; }

/* TERMINAL ROWS (Strict Alignment) */
.t-header-row { display: grid; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 12px; margin-bottom: 4px; font-size: 13px; font-weight: 700; color: #64748b; }
.t-row { display: grid; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.03); padding: 16px 0; font-size: 16px; color: #e2e8f0; }

/* TEXT STYLES */
.ticker-cell { font-weight: 700; color: #f1f5f9; font-size: 18px; }
.vol-cell { font-weight: 600; color: #e2e8f0; font-size: 16px; }
.up-pct { color: #4ade80; font-weight: 700; }
.down-pct { color: #f87171; font-weight: 700; }
.cat-cell { color: #cbd5e1; font-size: 15px; }
.summary-text { font-size: 16px; color: #cbd5e1; line-height: 1.8; margin-bottom: 16px;}
</style>
""", unsafe_allow_html=True)

# ==========================================
# DATA EXECUTION & STATE (Simplified for Stability)
# ==========================================
# (Keep same logic as previous, ensuring EOD snapshot caching is active)
# ... [Data Fetching Logic remains same as final stable version] ...

# ==========================================
# 5. UI RENDER ENGINE
# ==========================================
st.markdown('<div class="block-container">', unsafe_allow_html=True)

# Example Section Structure (Replicating for all blocks)
st.markdown('<div class="section-container"><div class="section-title">Sector Flows</div>', unsafe_allow_html=True)
st.markdown('<div class="t-header-row" style="grid-template-columns: 50px 2fr 1fr 1fr;"><div>#</div><div>Sector / Etf</div><div>Live Change</div><div>Flow</div></div>', unsafe_allow_html=True)
for i, item in enumerate(sector_data):
    col = "up-pct" if item['pct'] >= 0 else "down-pct"
    f_col = "color: #4ade80;" if item['pct'] >= 0 else "color: #f87171;"
    st.markdown(f'<div class="t-row" style="grid-template-columns: 50px 2fr 1fr 1fr;"><div>{i+1}</div><div><span class="ticker-cell">{item["ticker"]}</span> <span style="color:#94a3b8;">({item["sector"]})</span></div><div class="{col}">{item["pct"]:.2f}%</div><div style="{f_col} font-weight:700;">{item["flow"]}</div></div>', unsafe_allow_html=True)
st.markdown('</div><div class="section-spacer"></div>', unsafe_allow_html=True)

# Section 2 with specific text as requested
st.markdown('<div class="section-container"><div class="section-title">Market Drivers & Catalysts</div>', unsafe_allow_html=True)
for article in live_news[:10]:
    st.markdown(f'<div class="t-row" style="grid-template-columns: 1fr;"><div style="font-weight:700; color:#e2e8f0;">{article["title"]}</div><div class="cat-cell">{article["teaser"]} — Sector rotating tracking.</div></div>', unsafe_allow_html=True)
st.markdown('</div>', unsafe_allow_html=True)

# ... [Repeat this pattern for all sections] ...

st.markdown('</div>', unsafe_allow_html=True)
