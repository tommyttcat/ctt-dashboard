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
    
    /* Section headers: Smaller, slate gray, no lines */
    .section-head { 
        color: #64748B; 
        font-size: 18px; 
        font-weight: 600; 
        margin-bottom: 12px; 
        margin-top: 40px; 
    }
    
    /* Crisp Parent Cards - NO BORDERS */
    .card { 
        background-color: #0A0D14; /* Matches page background */
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
    .metric-title { color: #64748B; font-size: 11px; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; font-weight: 600;}
    .metric-value { color: #FFFFFF; font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .metric-change { font-size: 12px; }
    
    /* Ultra-Crisp Borderless Tables */
    .custom-table { width: 100%; border-collapse: separate; border-spacing: 0 4px; font-size: 13px; }
    .custom-table th { text-align: left; color: #64748B; padding: 8px 12px; font-weight: 600; font-size: 10px; text-transform: uppercase; border: none; }
    
    /* Table Rows: No Borders, Only Background Color */
    .custom-table td { padding: 12px 12px; background-color: #161D2B; color: #E2E8F0; border: none; }
    
    /* Keep row shapes sharp */
    .custom-table tr td:first-child { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
    .custom-table tr td:last-child { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
    
    .etf-tag { background: #1E293B; color: #38BDF8; padding: 3px 6px; border-radius: 3px; font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700;}
    .badge-long { background: rgba(16, 185, 129, 0.1); color: #10B981; padding: 3px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; text-transform: uppercase;}
    .badge-short { background: rgba(239, 68, 68, 0.1); color: #EF4444; padding: 3px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; text-transform: uppercase;}
    
    /* Editor's Note - Solid, Sharp, No Gradients */
    .editor-note { background-color: #161D2B; padding: 24px; border-radius: 6px; color: #E2E8F0; font-size: 14px; line-height: 1.6; border-left: 4px solid #8B5CF6; border: none;}
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
    sectors =
