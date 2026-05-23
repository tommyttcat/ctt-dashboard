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
.watchlist-item { background: #1e293b; border: none !important; border-radius: 12px; padding: 24px 28px; margin-bottom: 20px; display: grid; grid-template-columns: 28px 1fr; gap: 16px; align-items: start; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.wl-num { font-size: 18px; color: #64748b; font-weight: 800; padding-top: 3px; }
.wl-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
.wl-ticker { font-size: 22px; font-weight: 800; color: #818cf8; }
.wl-body   { font-size: 16px; color: #cbd5e1; line-height: 1.6; }
.wl-levels { font-size: 14px; color: #94a3b8; margin-top: 10px; }
.wl-levels .sup { color: #4ade80; font-weight: 600; }
.wl-levels .res { color: #f87171; font-weight: 600; }

/* TABLES (For Scanner & Sector flow) */
table { width: 100%; border-collapse: collapse; border: none !important; margin-bottom: 24px; }
th, td { border-left: none !important; border-right: none !important; }
th { font-size: 14px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #64748b; padding: 16px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05) !important; border-top: none !important; }
td { padding: 18px 12px; border-bottom: 1px solid rgba(255,255,255,0.05) !important; vertical-align: middle; border-top: none !important; }
tr:last-child td { border-bottom: none !important; }
.ticker-cell { font-weight: 700; color: #f1f5f9; font-size: 20px; white-space: nowrap; }
.ticker-name { font-size: 15px; color: #64748b; display: block; font-weight: 400; margin-top: 4px; }
.catalyst-cell { font-size: 16px; color: #cbd5e1; line-height: 1.6; }
.etf-tag { background: #0f172a; color: #60a5fa; padding: 6px 12px; border-radius: 6px; font-family: monospace; font-size: 16px; font-weight: 700; border: none;}
.up-pct { color: #4ade80; font-weight: 700; font-size: 18px; white-space: nowrap; }
.down-pct { color: #f87171; font-weight: 700; font-size: 18px; white-space: nowrap; }

/* Mobile Fixes */
@media (max-width: 768px) {
.inst-grid { grid-template-columns: repeat(2, 1fr); }
.cloud-card { padding: 24px; }
.hdr { padding: 28px; }
}
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. LIVE DATA ENGINES (WITH FALLBACKS)
# ==========================================

def safe_float(val):
    try:
        return float(val)
    except:
        return None

def get_last_price_change(ticker):
    try:
        hist = yf.Ticker(ticker).history(period="5d").dropna(subset=['Close'])
        if len(hist) >= 2:
            prev = hist['Close'].iloc[-2]
            curr = hist['Close'].iloc[-1]
            return float(curr), float(((curr - prev)/prev)*100)
    except: pass
    return 0.0, 0.0

def get_market_rating(macro_data):
    spx_pct = macro_data.get("S&P 500 (SPX)", {}).get("pct", 0)
    ndx_pct = macro_data.get("Nasdaq Comp", {}).get("pct", 0)
    
    if spx_pct >= 0.5 and ndx_pct >= 0.5: return "RISK-ON", "badge-bullish"
    elif spx_pct > 0 and ndx_pct > 0: return "BULLISH", "badge-bullish"
    elif spx_pct <= -0.5 and ndx_pct <= -0.5: return "RISK-OFF", "badge-bearish"
    elif spx_pct < 0 and ndx_pct < 0: return "BEARISH", "badge-bearish"
    else: return "MIXED", "badge-mixed"

def get_market_status():
    try:
        res = requests.get(f"https://financialmodelingprep.com/api/v3/is-the-market-open?apikey={FMP_KEY}").json()
        if res and res.get("isTheStockMarketOpen"):
            return "MARKET OPEN", "badge-live"
        else:
            return "MARKET CLOSED", "badge-closed"
    except:
        return "LIVE DATA", "badge-live"

@st.cache_data(ttl=10) 
def fetch_expanded_macro():
    tickers = {
        "S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones": "^DJI", 
        "Russell 2000": "^RUT", "VIX": "^VIX", "10Y Treasury": "^TNX",
        "Nat Gas": "NG=F", "EUR/USD": "EURUSD=X", "Gold (GC)": "GC=F", 
        "WTI Crude": "CL=F", "Bitcoin (BTC)": "BTC-USD", "Ethereum (ETH)": "ETH-USD"
    }
    data = {}
    for name, ticker in tickers.items():
        p, c = get_last_price_change(ticker)
        data[name] = {"price": p, "pct": c}
    return data

@st.cache_data(ttl=60)
def fetch_pcr():
    p, _ = get_last_price_change("^PCR")
    return p if p > 0 else 0.82

@st.cache_data(ttl=300)
def fetch_sector_flow():
    sector_map = {
        "XLK": "Technology", "XLY": "Consumer Disc", "XLI": "Industrials", 
        "XLC": "Comm. Services", "XLV": "Health Care", "XLF": "Financials", 
        "XLP": "Consumer Staples", "XLB": "Materials", "XLE": "Energy", "XLRE": "Real Estate"
    }
    perf = []
    for ticker, name in sector_map.items():
        p, c = get_last_price_change(ticker)
        theme = f"Inflow detected. {name} strength." if c > 0 else f"Distribution phase. {name} weakness."
        flow = "Inflow" if c > 0 else "Outflow"
        perf.append({"ticker": ticker, "sector": name, "pct": c, "theme": theme, "flow": flow})
    return sorted(perf, key=lambda x: x['pct'], reverse=True)

@st.cache_data(ttl=120)
def fetch_gappers():
    results = []
    try:
        g_reg = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey={FMP_KEY}").json()
        g_pre = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/pre-market-gainers?apikey={FMP_KEY}").json()
        g_post = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/post-market-gainers?apikey={FMP_KEY}").json()
        
        l_reg = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/losers?apikey={FMP_KEY}").json()
        l_pre = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/pre-market-losers?apikey={FMP_KEY}").json()
        l_post = requests.get(f"https://financialmodelingprep.com/api/v3/stock_market/post-market-losers?apikey={FMP_KEY}").json()

        g_reg = g_reg if isinstance(g_reg, list) else []
        g_pre = g_pre if isinstance(g_pre, list) else []
        g_post = g_post if isinstance(g_post, list) else []
        l_reg = l_reg if isinstance(l_reg, list) else []
        l_pre = l_pre if isinstance(l_pre, list) else []
        l_post = l_post if isinstance(l_post, list) else []

        for x in g_reg: x['session'] = 'REGULAR'
        for x in g_pre: x['session'] = 'PRE-MARKET'
        for x in g_post: x['session'] = 'POST-MARKET'
        
        for x in l_reg: x['session'] = 'REGULAR'
        for x in l_pre: x['session'] = 'PRE-MARKET'
        for x in l_post: x['session'] = 'POST-MARKET'

        all_movers = g_pre + g_post + g_reg + l_pre + l_post + l_reg
        unique_movers = {}
        for x in all_movers:
            sym = x.get('symbol')
            if sym:
                if sym not in unique_movers or abs(x.get('changesPercentage', 0)) > abs(unique_movers[sym].get('changesPercentage', 0)):
                    unique_movers[sym] = x

        tickers = list(unique_movers.keys())
        quote_map = {}
        
        chunk_size = 50
        for i in range(0, len(tickers), chunk_size):
            ticker_chunk = tickers[i:i + chunk_size]
            ticker_str = ",".join(ticker_chunk)
            try:
                q_data = requests.get(f"https://financialmodelingprep.com/api/v3/quote/{ticker_str}?apikey={FMP_KEY}").json()
                for q in q_data:
                    quote_map[q['symbol']] = q
            except: pass

        for sym, item in unique_movers.items():
            price = safe_float(item.get('price')) or 0.0
            change = safe_float(item.get('changesPercentage')) or 0.0
            session = item.get('session', 'REGULAR')
            
            vol = quote_map.get(sym, {}).get('volume', 0)
            avg_vol = quote_map.get(sym, {}).get('avgVolume', 1) or 1
            
            rel_vol = vol / avg_vol if avg_vol else 1
            dol_vol = vol * price
            
            vol_str = f"{vol/1e6:.2f}M" if vol >= 1e6 else f"{vol/1e3:.0f}K"
            dol_vol_str = f"${dol_vol/1e6:.2f}M" if dol_
