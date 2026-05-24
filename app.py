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
.badge-cautious { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 1px; background: #1c1917; color: #fb923c; border: none; }
.badge-live { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; background: #052e16; color: #4ade80; margin-left: 12px; vertical-align: middle; animation: pulse 2s infinite; border: none;}
.badge-closed { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; background: #450a0a; color: #f87171; margin-left: 12px; vertical-align: middle; border: none;}

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

/* STACKED CARDS (News, Earnings, Breadth) - NO BORDERS */
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
.watchlist-item { background: #1e293b; border: none !important; border-radius: 12px; padding: 24px 28px; margin-bottom: 20px; display: grid; grid-template-columns: 28px 1fr; gap: 16px; align-items: start; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
