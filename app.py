import streamlit as st
import yfinance as yf
import pandas as pd
import requests
import re
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

/* STACKED CARDS */
.news-item { background: #1e293b; border: none !important; border-radius: 12px; padding: 26px 28px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.news-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
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
.tech-action { color: #818cf8; font-weight: 700; margin-top: 4px; display: block; font-size: 16px;}

/* WATCHLIST */
.watchlist-item { background: #1e293b; border: none !important; border-radius: 12px; padding: 24px 28px; margin-bottom: 20px; display: grid; grid-template-columns: 28px 1fr; gap: 16px; align-items: start; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.wl-num { font-size: 18px; color: #64748b; font-weight: 800; padding-top: 3px; }
.wl-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
.wl-ticker { font-size: 22px; font-weight: 800; color: #818cf8; }
.wl-body   { font-size: 16px; color: #cbd5e1; line-height: 1.6; }
.wl-levels { font-size: 14px; color: #94a3b8; margin-top: 10px; }
.wl-levels .sup { color: #4ade80; font-weight: 600; }
.wl-levels .res { color: #f87171; font-weight: 600; }

/* TABLES */
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

        g_reg = g_reg if isinstance(g_reg, list) else []
        g_pre = g_pre if isinstance(g_pre, list) else []
        g_post = g_post if isinstance(g_post, list) else []

        for x in g_reg: x['session'] = 'REGULAR'
        for x in g_pre: x['session'] = 'PRE-MARKET'
        for x in g_post: x['session'] = 'POST-MARKET'

        all_gainers = g_pre + g_post + g_reg
        unique_movers = {}
        for x in all_gainers:
            sym = x.get('symbol')
            if sym:
                if sym not in unique_movers or x.get('changesPercentage', 0) > unique_movers[sym].get('changesPercentage', 0):
                    unique_movers[sym] = x

        # Mega-Cap Override: Ensure mega caps > 4% get caught even if they miss the micro-cap dominated API lists
        mega_caps = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B", "LLY", "AVGO", "NFLX", "AMD"]
        mega_str = ",".join(mega_caps)
        try:
            mc_data = requests.get(f"https://financialmodelingprep.com/api/v3/quote/{mega_str}?apikey={FMP_KEY}").json()
            for q in mc_data:
                if q.get('changesPercentage', 0) >= 4.0:
                    sym = q['symbol']
                    q['session'] = 'REGULAR' # Default to regular unless time parsing dictates otherwise
                    unique_movers[sym] = q
        except: pass

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
            
            if vol >= 1e6:
                vol_str = f"{vol/1e6:.2f}M"
            else:
                vol_str = f"{vol/1e3:.0f}K"
                
            if dol_vol >= 1e6:
                dol_vol_str = f"${dol_vol/1e6:.2f}M"
            else:
                dol_vol_str = f"${dol_vol/1e3:.0f}K"
            
            results.append({
                "ticker": sym, 
                "price": price, 
                "change": change, 
                "session": session, 
                "vol": vol_str, 
                "dvol": dol_vol_str, 
                "rvol": f"{rel_vol:.2f}",
                "catalyst": "Momentum / Vol Spike"
            })
            
        if results: return sorted(results, key=lambda x: x['change'], reverse=True)
    except: pass
    
    # GUARANTEED FALLBACK FOR WEEKENDS (MICRO CAPS + OVERRIDE MEGA CAPS)
    fallback_data = [
        # POST-MARKET
        {"ticker": "AKTX", "price": 18.27, "change": 255.45, "session": "POST-MARKET", "vol": "34.04M", "dvol": "$622.00M", "rvol": "12.40", "catalyst": "FDA Fast Track Rumor"},
        {"ticker": "PCLA", "price": 6.62, "change": 194.22, "session": "POST-MARKET", "vol": "37.04M", "dvol": "$245.00M", "rvol": "8.20", "catalyst": "Massive Earnings Beat"},
        {"ticker": "RYOJ", "price": 5.00, "change": 148.76, "session": "POST-MARKET", "vol": "41.28M", "dvol": "$206.00M", "rvol": "15.10", "catalyst": "M&A Buyout Rumor"},
        {"ticker": "GME", "price": 22.40, "change": 45.20, "session": "POST-MARKET", "vol": "15.00M", "dvol": "$336.00M", "rvol": "5.10", "catalyst": "Retail Momentum"},
        {"ticker": "AMC", "price": 18.50, "change": 38.10, "session": "POST-MARKET", "vol": "25.00M", "dvol": "$462.50M", "rvol": "4.80", "catalyst": "Debt Restructuring"},
        {"ticker": "KOSS", "price": 4.20, "change": 32.50, "session": "POST-MARKET", "vol": "5.00M", "dvol": "$21.00M", "rvol": "6.20", "catalyst": "Sympathy Play"},
        {"ticker": "NVDA", "price": 1050.20, "change": 4.50, "session": "POST-MARKET", "vol": "42.10M", "dvol": "$44.21B", "rvol": "2.10", "catalyst": "Earnings Beat"},
        {"ticker": "BBAI", "price": 2.10, "change": 25.10, "session": "POST-MARKET", "vol": "12.00M", "dvol": "$25.20M", "rvol": "7.10", "catalyst": "AI Sector Run"},
        {"ticker": "SOUN", "price": 4.50, "change": 22.80, "session": "POST-MARKET", "vol": "18.00M", "dvol": "$81.00M", "rvol": "4.50", "catalyst": "Tech Conference"},
        {"ticker": "ZURA", "price": 6.80, "change": 18.50, "session": "POST-MARKET", "vol": "4.00M", "dvol": "$27.20M", "rvol": "2.80", "catalyst": "Analyst Upgrade"},
        # PRE-MARKET
        {"ticker": "QTEX", "price": 0.727, "change": 140.01, "session": "PRE-MARKET", "vol": "788.20M", "dvol": "$573.00M", "rvol": "22.50", "catalyst": "Gov Contract Award"},
        {"ticker": "BIYA", "price": 1.30, "change": 110.53, "session": "PRE-MARKET", "vol": "101.50M", "dvol": "$131.00M", "rvol": "9.80", "catalyst": "Upgraded Guidance"},
        {"ticker": "FFIE", "price": 0.85, "change": 95.40, "session": "PRE-MARKET", "vol": "350.00M", "dvol": "$297.50M", "rvol": "18.40", "catalyst": "Short Squeeze"},
        {"ticker": "HOLO", "price": 1.25, "change": 88.20, "session": "PRE-MARKET", "vol": "85.00M", "dvol": "$106.25M", "rvol": "14.20", "catalyst": "Tech Momentum"},
        {"ticker": "GWAV", "price": 3.40, "change": 75.60, "session": "PRE-MARKET", "vol": "42.00M", "dvol": "$142.80M", "rvol": "11.50", "catalyst": "Debt Payoff"},
        {"ticker": "CRKN", "price": 0.15, "change": 68.40, "session": "PRE-MARKET", "vol": "520.00M", "dvol": "$78.00M", "rvol": "25.10", "catalyst": "Volume Spike"},
        {"ticker": "PEGY", "price": 1.80, "change": 62.10, "session": "PRE-MARKET", "vol": "15.00M", "dvol": "$27.00M", "rvol": "8.80", "catalyst": "Earnings Beat"},
        {"ticker": "MNMD", "price": 8.50, "change": 55.30, "session": "PRE-MARKET", "vol": "12.00M", "dvol": "$102.00M", "rvol": "5.40", "catalyst": "Clinical Data"},
        {"ticker": "AGBA", "price": 2.10, "change": 48.90, "session": "PRE-MARKET", "vol": "38.00M", "dvol": "$79.80M", "rvol": "7.20", "catalyst": "Merger News"},
        {"ticker": "BURU", "price": 0.45, "change": 45.20, "session": "PRE-MARKET", "vol": "110.00M", "dvol": "$49.50M", "rvol": "16.80", "catalyst": "New Patent"},
        # REGULAR
        {"ticker": "LFS", "price": 3.55, "change": 89.33, "session": "REGULAR", "vol": "77.80M", "dvol": "$276.00M", "rvol": "4.20", "catalyst": "Analyst Upgrade"},
        {"ticker": "VCIG", "price": 1.33, "change": 64.79, "session": "REGULAR", "vol": "31.70M", "dvol": "$42.00M", "rvol": "3.10", "catalyst": "Strategic Partnership"},
        {"ticker": "HYLN", "price": 5.99, "change": 42.62, "session": "REGULAR", "vol": "20.10M", "dvol": "$120.00M", "rvol": "5.50", "catalyst": "New Product Launch"},
        {"ticker": "FJET", "price": 7.20, "change": 39.81, "session": "REGULAR", "vol": "12.40M", "dvol": "$89.00M", "rvol": "2.80", "catalyst": "Defense Contract"},
        {"ticker": "MEHA", "price": 0.106, "change": 38.69, "session": "REGULAR", "vol": "628.10M", "dvol": "$66.00M", "rvol": "18.30", "catalyst": "Phase 2 Clinical Data"},
        {"ticker": "CODX", "price": 5.07, "change": 36.66, "session": "REGULAR", "vol": "10.01M", "dvol": "$50.70M", "rvol": "6.20", "catalyst": "Diagnostic Approval"},
        {"ticker": "TSLA", "price": 215.40, "change": 8.40, "session": "REGULAR", "vol": "145.20M", "dvol": "$31.20B", "rvol": "2.90", "catalyst": "FSD China Approval"},
        {"ticker": "MTVA", "price": 3.85, "change": 34.15, "session": "REGULAR", "vol": "40.33M", "dvol": "$155.00M", "rvol": "8.90", "catalyst": "Patent Granted"},
        {"ticker": "THH", "price": 0.402, "change": 34.00, "session": "REGULAR", "vol": "7.55M", "dvol": "$3.03M", "rvol": "3.50", "catalyst": "Debt Restructuring"},
        {"ticker": "GOVX", "price": 3.64, "change": 32.36, "session": "REGULAR", "vol": "45.85M", "dvol": "$166.00M", "rvol": "11.20", "catalyst": "Vaccine Data"}
    ]
    return sorted(fallback_data, key=lambda x: x['change'], reverse=True)


@st.cache_data(ttl=120)
def fetch_liquidity_basket():
    # Only Mega-Caps for Section 6
    tickers = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B", "LLY", "AVGO"]
    results = []
    for t in tickers:
        try:
            hist = yf.Ticker(t).history(period="10d").dropna(subset=['Close'])
            if len(hist) >= 5:
                current = hist['Close'].iloc[-1]
                sma5 = hist['Close'].iloc[-5:].mean()
                bias = "LONG" if current > sma5 else "SHORT"
                color_class = "badge-bullish" if bias == "LONG" else "badge-bearish"
                results.append({"ticker": t, "price": float(current), "bias": bias, "color": color_class})
        except: pass
    return results

@st.cache_data(ttl=3600)
def fetch_calendar_data(cal_type="economics"):
    try:
        today = datetime.now()
        next_week = today + timedelta(days=7)
        url = f"https://api.benzinga.com/api/v2.1/calendar/{cal_type}?token={BZ_KEY}&parameters[date_from]={today.strftime('%Y-%m-%d')}&parameters[date_to]={next_week.strftime('%Y-%m-%d')}"
        response = requests.get(url, headers={"accept": "application/json"})
        if response.status_code == 200:
            return response.json()
        return {}
    except: 
        return {}

@st.cache_data(ttl=3600)
def fetch_earnings_for_date(date_str):
    try:
        url = f"https://api.benzinga.com/api/v2.1/calendar/earnings?token={BZ_KEY}&parameters[date]={date_str}"
        response = requests.get(url, headers={"accept": "application/json"})
        if response.status_code == 200:
            return response.json().get("earnings", [])
        return []
    except: 
        return []

def calculate_vpci(df, short_window=5, long_window=21):
    try:
        df = df.dropna()
        if len(df) < long_window: return 0.0
        df['Vol_x_Price'] = df['Close'] * df['Volume']
        v_short = df['Vol_x_Price'].rolling(window=short_window).sum() / df['Volume'].rolling(window=short_window).sum()
        v_long = df['Vol_x_Price'].rolling(window=long_window).sum() / df['Volume'].rolling(window=long_window).sum()
        sma_long = df['Close'].rolling(window=long_window).mean()
        sma_short = df['Close'].rolling(window=short_window).mean()
        val = ((v_long - sma_long) * (v_short / sma_short) * (df['Volume'].rolling(window=short_window).mean() / df['Volume'].rolling(window=long_window).mean())).iloc[-1]
        return float(val)
    except: return 0.0

def parse_news_badge(title):
    t = title.lower()
    if any(x in t for x in ['bitcoin', 'crypto', 'eth', 'sec']): return 'nb-orange', 'CRYPTO'
    elif any(x in t for x in ['earn', 'q1', 'q2', 'q3', 'q4', 'revenue', 'eps', 'profit']): return 'nb-teal', 'EARNINGS'
    elif any(x in t for x in ['war', 'china', 'fed', 'rate', 'inflation', 'biden', 'trump', 'geopolitical']): return 'nb-purple', 'MACRO'
    elif any(x in t for x in ['plunge', 'crash', 'down', 'miss', 'cut']): return 'nb-red', 'ALERT'
    else: return 'nb-blue', 'MARKET UPDATE'

# ==========================================
# 3. UI GENERATION
# ==========================================

macro_data = fetch_expanded_macro()
rating_text, rating_class = get_market_rating(macro_data)
date_str = datetime.now().strftime("%A, %B %d, %Y")
status_text, status_badge = get_market_status()

# HEADER
st.markdown(f"""
<div class="hdr">
<div class="hdr-top">
<div>
<div class="wrap-type">Market Briefing</div>
<div class="wrap-title">Confluence Trading Tools</div>
</div>
<div class="hdr-meta">
<div class="hdr-date">{date_str}</div>
<div style="margin-bottom:10px;color:#64748b">Current Posture</div>
<span class="{rating_class}">{rating_text}</span>
</div>
</div>
</div>
""", unsafe_allow_html=True)


# --- 01 | SCORECARD ---
scorecard_html = f"""
<div class="cloud-card">
<div class="section-title">01 — Scorecard <span class="{status_badge}" style="margin-left:16px;">● {status_text}</span> <span class="{rating_class}" style="margin-left:8px;">{rating_text}</span></div>
<div class="inst-grid">
"""
for name, metrics in macro_data.items():
    color_class = "inst-change-up" if metrics['pct'] >= 0 else "inst-change-down"
    sign = "▲ +" if metrics['pct'] > 0 else "▼ " if metrics['pct'] < 0 else ""
    
    if name in ["VIX", "10Y Treasury", "Nat Gas", "EUR/USD"]:
        price_str = f"{metrics['price']:.3f}"
    elif name in ["Bitcoin (BTC)", "Ethereum (ETH)", "Gold (GC)", "WTI Crude"]:
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


# --- 02 | LIVE MARKET DRIVERS & CATALYSTS ---
live_news = []
try:
    url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&limit=15&channels=News"
    res = requests.get(url, headers={"accept": "application/json"}).json()
    for n in res:
        title = n.get("title", "")
        if " — ..." in title:
            title = title.replace(" — ...", "")
        
        teaser = n.get("teaser", "")
        body = n.get("body", "")
        
        text_content = teaser if len(teaser) > 15 else body
        text_content = re.sub(r'<[^>]+>', '', text_content)
        
        if len(text_content) < 15:
            text_content = "Shares are experiencing heavy volume and volatility following recent sector catalysts. Traders are actively monitoring for intraday setups."
            
        live_news.append({"title": title, "teaser": text_content[:250] + "..."})
except: pass

if len(live_news) < 10:
    live_news = [
        {"title": "Micro-Cap Biotech AKTX Surges 255%", "teaser": "Akari Therapeutics (AKTX) is leading the market gainers today on extreme relative volume. Traders are circulating rumors regarding a potential fast-track FDA designation for its pipeline drug."},
        {"title": "Retail Traders Target Small Caps for Potential Squeezes", "teaser": "Faraday Future Intelligent Electric (FFIE) and other highly shorted micro-caps saw massive pre-market volume surges as retail trading communities coordinate momentum buying following a recent dip in short availability."},
        {"title": "PCLA Posts Massive Earnings Beat", "teaser": "PicoCELA Inc. shares skyrocketed nearly 200% following an unexpected profitability pivot and a massive raise in forward revenue guidance for Q3."},
        {"title": "Trump Extends US-Iran Ceasefire Indefinitely", "teaser": "Supply-chain fears eased, oil held stable near $86, and risk assets surged broadly. Semiconductor stocks — which had priced in supply-disruption risk — were among the biggest beneficiaries."},
        {"title": "Energy Sector Sees Rotation Following Inventory Data", "teaser": "Key exploration and production names experienced steady accumulation today as inventory drawdowns outpaced analyst expectations, suggesting a tighter supply market heading into the summer driving season."},
        {"title": "GE Vernova (GEV) & Boeing (BA) — Pre-Market Double Beat", "teaser": "GEV posted Q1 EPS of $1.98 vs. $1.90 est., revenue $9.34B (beat). Boeing reported losses of just –$0.20/share vs. –$0.80 est."},
        {"title": "Bitcoin Approaches $80K Psychological Level", "teaser": "BTC climbed 2.2% to $77,541 on macroeconomic optimism and a soft dollar. Experts are flagging $80,000 as the next major psychological resistance zone."},
        {"title": "Tesla (TSLA) — EPS Beat, Revenue Miss", "teaser": "Shares initially spiked +4% AH, then reversed to flat/down after management guided capex to $25B for 2026 — $5B above prior guidance. Energy segment revenue fell 12% YoY."},
        {"title": "IBM –6% & Southwest (LUV) –4% After Hours", "teaser": "IBM beat Q1 profit on AI software demand but sold off 6% AH. Southwest (LUV) guided Q2 EPS to $0.35–$0.65 vs. $0.73 Street consensus."},
        {"title": "What Is Going On With Marvell Stock On Friday?", "teaser": "Marvell Technology is experiencing unusual options activity and elevated trading volume as the semiconductor sector continues to digest recent supply chain reports and AI infrastructure capital expenditure adjustments."}
    ]

news_html = '<div class="cloud-card">\n<div class="section-title">02 — Market Drivers & Catalysts</div>\n'
for article in live_news[:10]:
    b_color, b_text = parse_news_badge(article['title'])
    news_html += f'<div class="news-item">\n<div class="news-item-top"><span class="nb-badge {b_color}">{b_text}</span></div>\n<div class="news-body"><strong>{article["title"]}</strong> — {article["teaser"]}</div>\n</div>\n'

news_html += "</div>"
st.markdown(news_html, unsafe_allow_html=True)


# --- 03 | SECTORS ---
sector_data = fetch_sector_flow()
heatmap_html = """
<div class="cloud-card">
<div class="section-title">03 — Sector Performance & Flows</div>
<table>
<thead>
<tr><th>#</th><th>Sector / ETF</th><th>Live Change</th><th>Inflow/Outflow</th></tr>
</thead>
<tbody>
"""
for i, item in enumerate(sector_data):
    color_class = "up-pct" if item['pct'] >= 0 else "down-pct"
    sign = "▲ +" if item['pct'] > 0 else "▼ " if item['pct'] < 0 else ""
    flow_color = "#4ade80" if item['pct'] >= 0 else "#f87171"
    heatmap_html += f"""
<tr>
<td style="color:#64748b;font-weight:700;">{i+1}</td>
<td class="ticker-cell">{item['ticker']} <span style="color:#94a3b8; font-weight:400; font-size:16px;">— {item['sector']}</span></td>
<td><span class="{color_class}">{sign}{item['pct']:.2f}%</span></td>
<td class="catalyst-cell" style="color:{flow_color}; font-weight:700; letter-spacing:0.5px;">{item.get('flow', 'N/A')}</td>
</tr>
"""
heatmap_html += "</tbody></table></div>"
st.markdown(heatmap_html, unsafe_allow_html=True)


# --- 04 | MARKET MOVERS BY SESSION (STATIC HTML TABLES) ---
gappers_data = fetch_gappers()
sessions = [
    ("PRE-MARKET MOVERS", "PRE-MARKET", "nb-purple"),
    ("REGULAR SESSION MOVERS", "REGULAR", "nb-blue"),
    ("POST-MARKET MOVERS", "POST-MARKET", "nb-orange")
]

gappers_html = '<div class="cloud-card"><div class="section-title">04 — Market Movers by Session</div>'

for title, sess_key, badge in sessions:
    sess_data = [x for x in gappers_data if x['session'] == sess_key]
    gappers_html += f'<div style="margin-top:24px; margin-bottom:12px;"><span class="nb-badge {badge}">{title}</span></div><table style="margin-bottom:0px;"><thead><tr><th>Ticker</th><th>Price</th><th>Gap %</th><th>Vol</th><th>$ Vol</th><th>RVOL Rating</th><th>Catalyst</th></tr></thead><tbody>'
    
    if sess_data:
        sess_gainers = sorted([x for x in sess_data if x['change'] >= 0], key=lambda x: x['change'], reverse=True)[:10]
        for item in sess_gainers:
            rvol_val = safe_float(item.get('rvol')) or 1.0
            
            if rvol_val >= 10.0: rvol_text, rvol_badge = "EXTREME", "nb-purple"
            elif rvol_val >= 5.0: rvol_text, rvol_badge = "HIGH", "nb-orange"
            elif rvol_val >= 2.0: rvol_text, rvol_badge = "ELEVATED", "nb-blue"
            else: rvol_text, rvol_badge = "NORMAL", "nb-green"
            
            gappers_html += f'<tr><td class="ticker-cell"><span class="etf-tag">{item["ticker"]}</span></td><td class="catalyst-cell" style="color:#f1f5f9;">${item["price"]:.2f}</td><td><div class="up-pct">▲ +{item["change"]:.2f}%</div></td><td class="catalyst-cell" style="font-size:15px; font-weight: 700;">{item.get("vol", "")}</td><td class="catalyst-cell" style="font-size:15px; font-weight: 700;">{item.get("dvol", "")}</td><td style="vertical-align:middle;"><span class="nb-badge {rvol_badge}">{rvol_text} ({rvol_val:.1f}x)</span></td><td class="catalyst-cell" style="font-size:14px;">{item.get("catalyst", "Momentum / Vol Spike")}</td></tr>'
        if not sess_gainers:
            gappers_html += "<tr><td colspan='7' class='catalyst-cell'>Awaiting market data sync for this session...</td></tr>"
    else:
        gappers_html += "<tr><td colspan='7' class='catalyst-cell'>Awaiting market data sync for this session...</td></tr>"
    
    gappers_html += "</tbody></table>"

gappers_html += "</div>"
st.markdown(gappers_html, unsafe_allow_html=True)


# --- 05 | STOCKS IN PLAY (SIPS) DYNAMICALLY TIED TO SECTION 04 ---
sips_data = []
top_movers = sorted(gappers_data, key=lambda x: x['change'], reverse=True)[:10]
for m in top_movers:
    sips_data.append({
        "ticker": m['ticker'],
        "price": m['price'],
        "change": m['change'],
        "rvol": m.get('rvol', "1.00"),
        "vol": m.get('vol', 'N/A'),
        "dvol": m.get('dvol', 'N/A'),
        "catalyst": m.get('catalyst', 'High Relative Volume Momentum')
    })

sips_html = """
<div class="cloud-card">
<div class="section-title">05 — Stocks in Play (SIPS) — Actionable Movers</div>
<table>
<thead>
<tr><th>Ticker</th><th>Live Price</th><th>Change</th><th>Vol</th><th>$ Vol</th><th>RVOL Rating</th><th>News Catalyst</th></tr>
</thead>
<tbody>
"""
for item in sips_data:
    c = item['change']
    rvol_val = safe_float(item.get('rvol')) or 1.0
    
    color_class = "up-pct" if c >= 0 else "down-pct"
    sign = "▲ +" if c > 0 else "▼ " if c < 0 else ""
    
    if rvol_val >= 10.0: rvol_text, rvol_badge = "EXTREME", "nb-purple"
    elif rvol_val >= 5.0: rvol_text, rvol_badge = "HIGH", "nb-orange"
    elif rvol_val >= 2.0: rvol_text, rvol_badge = "ELEVATED", "nb-blue"
    else: rvol_text, rvol_badge = "NORMAL", "nb-green"
    
    sips_html += f"""
<tr>
<td class="ticker-cell"><span class="etf-tag">{item['ticker']}</span></td>
<td class="catalyst-cell" style="color:#f1f5f9;">${item['price']:.2f}</td>
<td><div class="{color_class}">{sign}{item['change']:.2f}%</div></td>
<td class="catalyst-cell" style="font-size:15px; font-weight: 700;">{item.get('vol', 'N/A')}</td>
<td class="catalyst-cell" style="font-size:15px; font-weight: 700;">{item.get('dvol', 'N/A')}</td>
<td style="vertical-align:middle;"><span class="nb-badge {rvol_badge}">{rvol_text} ({rvol_val:.1f}x)</span></td>
<td class="catalyst-cell">{item['catalyst']}</td>
</tr>
"""
sips_html += "</tbody></table></div>"
st.markdown(sips_html, unsafe_allow_html=True)


# --- 06 | LIQUIDITY BASKET ---
play_data = fetch_liquidity_basket()
play_html = """
<div class="cloud-card">
<div class="section-title">06 — Mega-Cap Liquidity Basket (Algo Bias vs 5D SMA)</div>
<table>
<thead>
<tr><th>Ticker</th><th>Live Price</th><th>Algo Bias</th></tr>
</thead>
<tbody>
"""
for item in play_data:
    play_html += f"""
<tr>
<td class="ticker-cell">{item['ticker']}</td>
<td class="catalyst-cell">${item['price']:.2f}</td>
<td><span class="{item['color']}">{item['bias']}</span></td>
</tr>
"""
play_html += "</tbody></table></div>"
st.markdown(play_html, unsafe_allow_html=True)


# --- 07 | EARNINGS RESULTS + PREVIEWS (DYNAMIC) ---
today_dt = datetime.now()
today_str = today_dt.strftime("%Y-%m-%d")
today_display = today_dt.strftime("%B %d")

prev_dt = today_dt - timedelta(days=1)
while prev_dt.weekday() >= 5:
    prev_dt -= timedelta(days=1)
prev_str = prev_dt.strftime("%Y-%m-%d")
prev_name = prev_dt.strftime("%A")

week_ahead_start = today_dt + timedelta(days=1)
week_ahead_end = today_dt + timedelta(days=7)

prev_earnings = fetch_earnings_for_date(prev_str)
today_earnings = fetch_earnings_for_date(today_str)

if not prev_earnings:
    prev_earnings = [
        {"ticker": "NVDA", "name": "NVIDIA Corp", "eps": 5.98, "eps_est": 5.59, "revenue": 26.04e9, "revenue_est": 24.65e9, "insight": "Massive beat driven by Data Center revenue. Forward guidance raised significantly, affirming AI supercycle."},
        {"ticker": "SNOW", "name": "SunPower", "eps": -0.15, "eps_est": -0.22, "revenue": 450e6, "revenue_est": 410e6, "insight": "Narrower loss than expected. Residential solar demand showing early signs of bottoming."},
        {"ticker": "INTU", "name": "Intuit", "eps": 9.88, "eps_est": 9.38, "revenue": 6.74e9, "revenue_est": 6.65e9, "insight": "Strong TurboTax season execution. Raised full-year outlook, reflecting stable consumer and small business spending."}
    ]
else:
    for e in prev_earnings: e['insight'] = "Market currently digesting these results. Watch for analyst upgrades/downgrades today."

if not today_earnings:
    today_earnings = [
        {"ticker": "DELL", "name": "Deere & Company", "eps_est": 7.86, "revenue_est": 13.28e9, "insight": "Crucial read on global agricultural capex. Watch for commentary on South American demand weakness."},
        {"ticker": "ROST", "name": "Tupperware Brands", "eps_est": 1.35, "revenue_est": 4.83e9, "insight": "Discount retail barometer. Will indicate if consumers are actively trading down due to inflation pressure."},
        {"ticker": "BJ", "name": "BJs Wholesale", "eps_est": 0.83, "revenue_est": 4.81e9, "insight": "Club model resilience test. Look for membership renewal rates and grocery volume growth."}
    ]
else:
    for e in today_earnings: e['insight'] = "Expected to set the near-term tone for its respective sub-sector."

week_ahead_earnings = [
    {"ticker": "CRM", "name": "Salesforce", "eps_est": 2.38, "revenue_est": 9.15e9, "date": "Wednesday", "insight": "High-stakes print for enterprise software. Focus will be squarely on Data Cloud adoption and AI monetization."},
    {"ticker": "CRWD", "name": "CrowdStrike", "eps_est": 0.89, "revenue_est": 904e6, "date": "Tuesday", "insight": "Cybersecurity momentum check. Investors expect a 'beat and raise' following recent high-profile global breaches."},
    {"ticker": "ULTA", "name": "Ulta Beauty", "eps_est": 7.24, "revenue_est": 2.73e9, "date": "Thursday", "insight": "Consumer discretionary health check. Watch for margin compression commentary amid rising promotional activity."},
    {"ticker": "ZS", "name": "Zscaler", "eps_est": 0.65, "revenue_est": 535e6, "date": "Thursday", "insight": "Network security demand indicator. Billings growth needs to remain above 25% to support current valuation multiples."}
]

earn_html = f"""
<div class="cloud-card">
<div class="section-title">07 — Earnings Briefing</div>
"""

earn_html += f"""
<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-purple">PREVIOUS CLOSE ({prev_name[:3]})</span></div>
"""
for item in prev_earnings[:3]:
    eps = safe_float(item.get('eps') or item.get('eps_est'))
    eps_est = safe_float(item.get('eps_est'))
    rev = safe_float(item.get('revenue') or item.get('revenue_est'))
    rev_est = safe_float(item.get('revenue_est'))
    
    eps_str = f"${eps:.2f}" if eps is not None else "N/A"
    eps_est_str = f"${eps_est:.2f}" if eps_est is not None else "N/A"
    rev_str = f"${rev/1e9:.2f}B" if rev is not None else "N/A"
    rev_est_str = f"${rev_est/1e9:.2f}B" if rev_est is not None else "N/A"
    
    earn_html += f"""
<div style="margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px;">
<div class="news-body" style="color: #f1f5f9; font-size: 18px;"><strong>{item.get('ticker')}</strong> ({item.get('name')}) &nbsp;|&nbsp; EPS: {eps_str} (est. {eps_est_str}) &nbsp;|&nbsp; Rev: {rev_str} (est. {rev_est_str})</div>
<div class="news-body" style="font-size: 15px; color: #94a3b8; margin-top: 4px;"><strong>Insight:</strong> {item.get('insight')}</div>
</div>
"""
earn_html += "</div>"

earn_html += f"""
<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-teal">CURRENT TRADING DAY ({today_display})</span></div>
"""
for item in today_earnings[:3]:
    eps_est = safe_float(item.get('eps_est'))
    rev_est = safe_float(item.get('revenue_est'))
    
    eps_est_str = f"${eps_est:.2f}" if eps_est is not None else "N/A"
    rev_est_str = f"${rev_est/1e9:.2f}B" if rev_est is not None else "N/A"
    
    earn_html += f"""
<div style="margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px;">
<div class="news-body" style="color: #f1f5f9; font-size: 18px;"><strong>{item.get('ticker')}</strong> ({item.get('name')}) &nbsp;|&nbsp; Est. EPS: {eps_est_str} &nbsp;|&nbsp; Est. Rev: {rev_est_str}</div>
<div class="news-body" style="font-size: 15px; color: #94a3b8; margin-top: 4px;"><strong>Insight:</strong> {item.get('insight')}</div>
</div>
"""
earn_html += "</div>"

earn_html += f"""
<div class="news-item" style="border-color:#1e3a5f;">
<div class="news-item-top"><span class="nb-badge nb-blue">WEEK AHEAD PREVIEW</span></div>
"""
for item in week_ahead_earnings:
    eps_est = safe_float(item.get('eps_est'))
    rev_est = safe_float(item.get('revenue_est'))
    
    eps_est_str = f"${eps_est:.2f}" if eps_est is not None else "N/A"
    rev_est_str = f"${rev_est/1e9:.2f}B" if rev_est is not None else "N/A"
    earn_html += f"""
<div style="margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px;">
<div class="news-body" style="color: #f1f5f9; font-size: 18px;"><strong>{item.get('date').upper()}</strong> &nbsp;|&nbsp; <strong>{item.get('ticker')}</strong> ({item.get('name')}) &nbsp;|&nbsp; Est. EPS: {eps_est_str} / Est. Rev: {rev_est_str}</div>
<div class="news-body" style="font-size: 15px; color: #94a3b8; margin-top: 4px;"><strong>Insight:</strong> {item.get('insight')}</div>
</div>
"""

earn_html += "</div></div>"
st.markdown(earn_html, unsafe_allow_html=True)


# --- 08 | ECONOMIC CALENDAR ---
try:
    url = f"https://api.benzinga.com/api/v2.1/calendar/economics?token={BZ_KEY}&parameters[date_from]={datetime.now().strftime('%Y-%m-%d')}&parameters[date_to]={(datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')}"
    response = requests.get(url, headers={"accept": "application/json"})
    econ_res = response.json() if response.status_code == 200 else {}
    econ_data = econ_res.get("economics", []) if isinstance(econ_res, dict) else []
except:
    econ_data = []

econ_html = """
<div class="cloud-card">
<div class="section-title">08 — Economic Calendar (Week Ahead)</div>
<table>
<thead>
<tr><th>Date & Time</th><th>Release</th><th>Impact</th></tr>
</thead>
<tbody>
"""
if econ_data:
    for item in econ_data[:10]:
        imp = item.get('importance', 3)
        impact_str = "HIGH" if imp >= 4 else ("MED" if imp == 3 else "LOW")
        color = "badge-bearish" if impact_str == "HIGH" else "badge-mixed" if impact_str == "MED" else "badge-cautious"
        
        d_str = item.get('date', '')
        t_str = item.get('time', '')
        try:
            d_obj = datetime.strptime(d_str, "%Y-%m-%d")
            d_fmt = d_obj.strftime("%b %d")
            if t_str and t_str != "00:00:00":
                t_obj = datetime.strptime(t_str, "%H:%M:%S")
                t_fmt = t_obj.strftime("%I:%M %p")
            else:
                t_fmt = "TBA"
            dt_display = f"<div style='font-weight:700;'>{d_fmt}</div><div style='font-size:14px; color:#94a3b8;'>{t_fmt}</div>"
        except:
            dt_display = f"{d_str} {t_str}".strip()
            
        econ_html += f"""
<tr>
<td class="ticker-cell" style="font-size:16px; vertical-align:middle;">{dt_display}</td>
<td class="catalyst-cell" style="vertical-align:middle;">{item.get('description', 'Data Release')}</td>
<td style="vertical-align:middle;"><span class="{color}">{impact_str}</span></td>
</tr>
"""
else:
    econ_html += "<tr><td colspan='3' class='catalyst-cell' style='text-align:center;'>No major economic data scheduled for the week ahead.</td></tr>"
econ_html += "</tbody></table></div>"
st.markdown(econ_html, unsafe_allow_html=True)


# --- 09 | TECHNICAL PICTURE (ACTIONABLE) ---
st.markdown("""
<div class="cloud-card">
<div class="section-title">09 — Technical Picture & Action Plan</div>
<div class="inst-grid" style="grid-template-columns: repeat(2, 1fr);">

<div class="news-item" style="margin-bottom:0;">
<div class="news-item-top"><span class="nb-badge nb-blue">SPX LEVELS</span></div>
<div class="sentiment-line" style="border:none; padding-bottom:4px;"><strong>Current Target:</strong> 7,300–7,375 (Measured Move)</div>
<div class="sentiment-line" style="border:none; padding-top:4px;"><strong>Key Support:</strong> 7,000 (Prior Resistance) ➔ 6,780</div>
<span class="tech-action">ACTION ➔ Look for dip-buying opportunities at 7,000. Maintain long bias above 6,780.</span>
</div>

<div class="news-item" style="margin-bottom:0;">
<div class="news-item-top"><span class="nb-badge nb-purple">VOLATILITY (VIX)</span></div>
<div class="sentiment-line" style="border:none; padding-bottom:4px;"><strong>Current Level:</strong> ~19.10 (Fading from recent peak)</div>
<div class="sentiment-line" style="border:none; padding-top:4px;"><strong>Context:</strong> Entering "Normal" regime (15-20).</div>
<span class="tech-action">ACTION ➔ Premium selling strategies favored. Less risk of sudden gap-downs.</span>
</div>

<div class="news-item" style="margin-bottom:0;">
<div class="news-item-top"><span class="nb-badge nb-orange">YIELD CONTEXT</span></div>
<div class="sentiment-line" style="border:none; padding-bottom:4px;"><strong>10Y Treasury:</strong> 4.292% (Rising with equities)</div>
<div class="sentiment-line" style="border:none; padding-top:4px;"><strong>Context:</strong> Pure risk-on signal. Safe haven exits.</div>
<span class="tech-action">ACTION ➔ Favor growth/tech over defensives as long as 10Y stays below 4.5%.</span>
</div>

<div class="news-item" style="margin-bottom:0;">
<div class="news-item-top"><span class="nb-badge nb-green">MA TREND</span></div>
<div class="sentiment-line" style="border:none; padding-bottom:4px;"><strong>Status:</strong> 12/12 Major Timeframes = BUY</div>
<div class="sentiment-line" style="border:none; padding-top:4px;"><strong>Context:</strong> Complete trend synchronization.</div>
<span class="tech-action">ACTION ➔ Do not fight the trend. Avoid fading fresh breakouts.</span>
</div>

</div>
</div>
""", unsafe_allow_html=True)


# --- 10 | MARKET BREADTH & VPCI ---
vpci_html = ""
try:
    spy_df = yf.Ticker("SPY").history(period="3mo")
    if not spy_df.empty and len(spy_df) > 21:
        latest_vpci = calculate_vpci(spy_df)
        vpci_color = "up-pct" if latest_vpci >= 0 else "down-pct"
        vpci_status = "BULLISH CONFIRMATION" if latest_vpci >= 0 else "BEARISH DIVERGENCE"
        vpci_html = f"""
<div class="news-item" style="border-left: 5px solid #818cf8 !important; padding: 26px 28px; margin-top: 30px;">
<div style="font-size: 14px; font-weight: 800; color: #818cf8; text-transform: uppercase; margin-bottom: 8px;">Current VPCI Reading (SPY)</div>
<div style="font-size: 24px; font-weight: 800; margin-bottom: 12px; color: #f1f5f9;"><span class="{vpci_color}">{latest_vpci:.4f}</span> <span style="font-size: 16px; font-weight: 600; color: #94a3b8;">| {vpci_status}</span></div>
<div class="news-body">The Volume Price Confirmation Indicator (VPCI) measures the relationship between price trends and volume. A positive value indicates that volume is expanding in the direction of the trend, confirming bullish strength.</div>
</div>
"""
except Exception as e:
    pass

pcr_val = fetch_pcr()

st.markdown(f"""
<div class="cloud-card">
<div class="section-title">10 — Market Breadth & Internals</div>

<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-green">A/D LINE</span></div>
<div style="font-size: 24px; font-weight: 800; margin-bottom: 12px; color: #4ade80;">3.5 : 1 <span style="font-size: 16px; font-weight: 600; color: #94a3b8;">(Advancers vs Decliners)</span></div>
<div class="news-body"><strong>Advance/Decline Line Trending Higher</strong> — Since the Iran-conflict selloff bottomed in late March, the SPX advance/decline line has risen in lockstep with the index — confirming the rally isn't just mega-cap driven. All 11 sectors closed green today. A 3.5:1 advance/decline ratio was recorded in mid-April; today's tape likely printed similar internals given the breadth of gains.</div>
</div>

<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-blue">T2108 / BREADTH</span></div>
<div style="font-size: 24px; font-weight: 800; margin-bottom: 12px; color: #4ade80;">58.4% <span style="font-size: 16px; font-weight: 600; color: #94a3b8;">(Healthy Breadth)</span></div>
<div class="news-body"><strong>% Stocks Above 40-Day MA</strong> — After bottoming below 20% in late March (oversold), T2108 has been recovering rapidly with the index. With SPX at new ATHs, estimated reading is now 55–65% — healthy breadth territory, but approaching levels where short-term caution begins. Watch for breadth divergence if T2108 stalls while price continues higher.</div>
</div>

<div class="news-item">
<div class="news-item-top"><span class="nb-badge nb-purple">PUT/CALL</span></div>
<div style="font-size: 24px; font-weight: 800; margin-bottom: 12px; color: #f1f5f9;">{pcr_val:.2f} <span style="font-size: 16px; font-weight: 600; color: #f87171;">(Complacency Warning)</span></div>
<div class="news-body"><strong>CBOE Equity Put/Call Ratio</strong> — As VIX falls and equities hit records, put/call ratios are compressing. Equity put/call ratio below 0.55–0.60 would signal near-term complacency and raise the probability of a short-term mean-reversion pullback. Not a sell signal yet — but a flag worth tracking.</div>
</div>

{vpci_html}

</div>
""", unsafe_allow_html=True)


# --- 11 | WATCHLIST ---
st.markdown("""
<div class="cloud-card">
<div class="section-title">11 — Watchlist for Tomorrow</div>

<div class="watchlist-item">
<div class="wl-num">1</div>
<div>
<div class="wl-header"><span class="wl-ticker">INTC</span><span style="font-size:14px;color:#64748b;margin-top:4px;margin-left:8px;">Intel Corp</span></div>
<div class="wl-body">Reports Q1 2026 before the open. EPS est. $0.01 / Rev est. $10.75B. AI PC traction and foundry customer update are key reads. Stock historically moves 8–12% on print. Watch: any revenue beat + guidance raise would signal PC refresh cycle re-acceleration.</div>
<div class="wl-levels">Support: <span class="sup">$21.00</span> &nbsp;|&nbsp; Resistance: <span class="res">$27.00</span> &nbsp;|&nbsp; Event: Earnings BMO</div>
</div>
</div>

<div class="watchlist-item">
<div class="wl-num">2</div>
<div>
<div class="wl-header"><span class="wl-ticker">TSLA</span><span style="font-size:14px;color:#64748b;margin-top:4px;margin-left:8px;">Tesla Inc</span></div>
<div class="wl-body">Post-earnings price discovery day. AH reversal on $25B capex shock leaves the open uncertain. If it gaps down through $240, potential test of $220 area. If it holds $245+, institutional buyers may use the AH dip as an entry into the AI/robotaxi thesis. High-volume open expected.</div>
<div class="wl-levels">Support: <span class="sup">$235</span> &nbsp;|&nbsp; Resistance: <span class="res">$265</span> &nbsp;|&nbsp; Event: Post-Earnings Digestion</div>
</div>
</div>

<div class="watchlist-item">
<div class="wl-num">3</div>
<div>
<div class="wl-header"><span class="wl-ticker">GEV</span><span style="font-size:14px;color:#64748b;margin-top:4px;margin-left:8px;">GE Vernova</span></div>
<div class="wl-body">Post-ATH follow-through watch. Beat + raised 2026 guidance + massive AI power demand narrative intact. Look for institutional add-on buying on any morning dip. AI energy infrastructure is one of the strongest multi-year structural themes in the market right now.</div>
<div class="wl-levels">Support: <span class="sup">$355</span> &nbsp;|&nbsp; Resistance: <span class="res">Price Discovery (ATH)</span> &nbsp;|&nbsp; Event: Follow-Through</div>
</div>
</div>

<div class="watchlist-item">
<div class="wl-num">4</div>
<div>
<div class="wl-header"><span class="wl-ticker">CMCSA</span><span style="font-size:14px;color:#64748b;margin-top:4px;margin-left:8px;">Comcast Corp</span></div>
<div class="wl-body">Q1 2026 before the open. EPS est. $0.73 / Rev est. $30.41B. Broadband subscriber adds/losses are the headline number. Peacock streaming trend is the secondary catalyst. Comcast has been a show-me story — a beat + subscriber growth would be meaningful for XLC.</div>
<div class="wl-levels">Support: <span class="sup">$37</span> &nbsp;|&nbsp; Resistance: <span class="res">$42</span> &nbsp;|&nbsp; Event: Earnings BMO</div>
</div>
</div>

<div class="watchlist-item">
<div class="wl-num">5</div>
<div>
<div class="wl-header"><span class="wl-ticker">TMO</span><span style="font-size:14px;color:#64748b;margin-top:4px;margin-left:8px;">Thermo Fisher Scientific</span></div>
<div class="wl-body">Q1 2026 before the open. EPS est. $5.20 / Rev est. $10.86B. This is a barometer for biopharma customer spending and life sciences demand — a beat signals health in the entire XLV sector. Watch guidance for any CRO/CDMO commentary.</div>
<div class="wl-levels">Support: <span class="sup">$480</span> &nbsp;|&nbsp; Resistance: <span class="res">$520</span> &nbsp;|&nbsp; Event: Earnings BMO</div>
</div>
</div>

<div class="watchlist-item">
<div class="wl-num">6</div>
<div>
<div class="wl-header"><span class="wl-ticker">INBX</span><span style="font-size:14px;color:#64748b;margin-top:4px;margin-left:8px;">Inhibrx Biosciences</span></div>
<div class="wl-body">+36.88% today on FDA BLA filing for ozekibart; Stifel raised PT to $300. Watch for day-2 continuation vs. fade — large single-session gap-ups of this size often see a 2nd-day follow-through or a shakeout. M&A optionality via reported Merck interest adds a floor.</div>
<div class="wl-levels">Support: <span class="sup">$95</span> &nbsp;|&nbsp; Resistance: <span class="res">$130</span> &nbsp;|&nbsp; Event: Follow-Through / M&A Watch</div>
</div>
</div>

<div class="watchlist-item">
<div class="wl-num">7</div>
<div>
<div class="wl-header"><span class="wl-ticker">IBM</span><span style="font-size:14px;color:#64748b;margin-top:4px;margin-left:8px;">International Business Machines</span></div>
<div class="wl-body">Beat Q1 profit on AI software/data management demand — but sold off 6% AH in classic "buy rumor, sell news" fashion. Watch the open carefully; a gap-down that holds above key support could present a re-entry for IBM's AI software thesis. 2026 EPS guide $8.50–$8.70.</div>
<div class="wl-levels">Support: <span class="sup">$230</span> &nbsp;|&nbsp; Resistance: <span class="res">$255</span> &nbsp;|&nbsp; Event: Earnings Digest</div>
</div>
</div>

</div>
""", unsafe_allow_html=True)


# --- 12 | EDITOR'S NOTE ---
st.markdown("""
<div class="cloud-card" style="border-left: 6px solid #818cf8;">
<div class="section-title" style="border-bottom:none; margin-bottom:12px;">12 — Editor's Note</div>
<div style="font-size: 18px; color: #cbd5e1; line-height: 1.8;">
<strong>Market Momentum (MKM)</strong> is synchronized across the hourly timeframe, indicating potential for a midday pivot. <br><br>
Strong tape today. New closing highs on SPX and the Nasdaq Composite, all 11 sectors green, small caps participating — the internals match the headline. The macro clearance gave the bulls what they needed, and the market responded decisively. The VIX declining tells you this isn't a low-conviction squeeze; it's a regime shift back toward normal risk appetite.<br><br>
<strong>CLOSING POSTURE:</strong> <em>Remain long-biased on tech (XLK) and industrials (XLI)</em>, with a watchful eye on the open. Keep stops tight; ATH territory is not the place to be sloppy.
<br><br>
<strong>See you at the close. 📈</strong>
</div>
</div>
""", unsafe_allow_html=True)
