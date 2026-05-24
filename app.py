import streamlit as st
import yfinance as yf
import pandas as pd
import requests
import re
from datetime import datetime, timedelta

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
.stApp { background: #0a1120; color: #e2e8f0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 16px; line-height: 1.6; }
header {visibility: hidden;}
footer {visibility: hidden;}

/* Wrap constraint */
.block-container { max-width: 1150px !important; margin: 0 auto !important; padding-top: 1rem; padding-bottom: 3rem; }

/* THE CLOUD CARD (Applied to ALL sections) */
.cloud-card { 
    background: #111827 !important; 
    border: none !important; 
    border-radius: 20px !important; 
    padding: 38px 42px !important; 
    margin-bottom: 40px !important; 
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4) !important; 
}

/* HEADER CLOUD */
.hdr { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%) !important; padding: 44px 44px 34px !important; border-radius: 20px !important; margin-bottom: 40px !important; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4) !important; }
.hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
.wrap-type { font-size: 14px; font-weight: 700; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; }
.wrap-title { font-size: 44px; font-weight: 800; color: #f1f5f9; margin-top: 8px; }
.hdr-meta { text-align: right; font-size: 15px; color: #94a3b8; }
.hdr-date { font-size: 20px; color: #c7d2fe; font-weight: 600; margin-bottom: 6px; }

/* STATUS BADGES */
.badge-closed { background: #450a0a; color: #f87171; padding: 6px 16px; border-radius: 20px; font-weight: 800; font-size: 13px; letter-spacing: 1px; }
.badge-live { background: #052e16; color: #4ade80; padding: 6px 16px; border-radius: 20px; font-weight: 800; font-size: 13px; letter-spacing: 1px; animation: pulse 2s infinite;}

/* SECTION TITLE */
.section-title { font-size: 15px; font-weight: 800; letter-spacing: 2px; color: #818cf8; text-transform: uppercase; margin-bottom: 24px; border-bottom: 2px solid rgba(255,255,255,0.05); padding-bottom: 12px;}

/* DATA GRID ROWS */
.t-header-row { display: grid; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 14px; margin-bottom: 6px; font-size: 13px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 1.5px; }
.t-row { display: grid; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding: 18px 0; font-size: 16px; color: #f1f5f9; }
.t-row:last-child { border-bottom: none; }

/* FONT SYNCHRONIZATION: MONO FOR LABELS & DATA */
.label-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important; font-weight: 700 !important; color: #94a3b8 !important; text-transform: uppercase; letter-spacing: 1px; font-size: 14px; }
.ticker-cell { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 800; color: #f1f5f9; font-size: 19px; }
.vol-cell { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 700; color: #f1f5f9; font-size: 16px; }

/* TEXT COLORS */
.up-pct { color: #4ade80; font-weight: 700; font-family: ui-monospace, monospace; }
.down-pct { color: #f87171; font-weight: 700; font-family: ui-monospace, monospace; }
.cat-cell { color: #cbd5e1; font-size: 15px; }

/* INSTRUMENT CARDS (Scorecard) */
.inst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.inst-card { background: #1e293b; border-radius: 14px; padding: 26px 28px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
.inst-name { font-size: 13px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.inst-level { font-size: 30px; font-weight: 800; color: #f1f5f9; margin: 8px 0 6px; }

/* PILL BADGES */
.nb-badge { padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; display: inline-block; margin-bottom: 8px; }
.nb-blue { background: #1e3a8a; color: #93c5fd; }
.nb-purple { background: #4c1d95; color: #ddd6fe; }
.nb-green { background: #064e3b; color: #6ee7b7; }

@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. CALENDAR & DATE LOGIC
# ==========================================
now_dt = datetime.now()
prev_dt = now_dt - timedelta(days=1)
while prev_dt.weekday() >= 5 or prev_dt.strftime('%m-%d') == '05-25':
    prev_dt -= timedelta(days=1)

next_dt = now_dt
if next_dt.weekday() >= 5 or next_dt.strftime('%m-%d') == '05-25':
    while next_dt.weekday() >= 5 or next_dt.strftime('%m-%d') == '05-25':
        next_dt += timedelta(days=1)
    market_status = f"MARKET CLOSED — REOPENS {next_dt.strftime('%A, %b %d').upper()}"
    status_class = "badge-closed"
else:
    market_status = "MARKET OPEN"
    status_class = "badge-live"

# ==========================================
# 3. LIVE DATA ENGINES 
# ==========================================
def get_last_price_change(ticker):
    try:
        hist = yf.Ticker(ticker).history(period="5d").dropna(subset=['Close'])
        if len(hist) >= 2:
            return float(hist['Close'].iloc[-1]), float(((hist['Close'].iloc[-1] - hist['Close'].iloc[-2])/hist['Close'].iloc[-2])*100)
    except: pass
    return 0.0, 0.0

@st.cache_data(ttl=10) 
def fetch_expanded_macro():
    tickers = {"S&P 500 (SPX)": "^GSPC", "Nasdaq Comp": "^IXIC", "Dow Jones": "^DJI", "Russell 2000": "^RUT", "VIX": "^VIX", "10Y Treasury": "^TNX", "WTI Crude": "CL=F", "Bitcoin (BTC)": "BTC-USD", "Ethereum (ETH)": "ETH-USD"}
    data = {}
    for name, ticker in tickers.items():
        p, c = get_last_price_change(ticker)
        data[name] = {"price": p, "pct": c}
    return data

@st.cache_data(ttl=300)
def fetch_sector_flow():
    sector_map = {"XLK": "Technology", "XLY": "Consumer Disc", "XLI": "Industrials", "XLC": "Comm. Services", "XLV": "Health Care", "XLF": "Financials", "XLP": "Consumer Staples", "XLB": "Materials", "XLE": "Energy", "XLRE": "Real Estate"}
    perf = []
    for ticker, name in sector_map.items():
        p, c = get_last_price_change(ticker)
        perf.append({"ticker": ticker, "sector": name, "pct": c, "flow": "Inflow" if c > 0 else "Outflow"})
    return sorted(perf, key=lambda x: x['pct'], reverse=True)

@st.cache_data(ttl=120)
def fetch_gappers():
    results = []
    fallback_tickers = ["AKTX", "PCLA", "RYOJ", "QTEX", "BIYA", "LFS", "VCIG", "HYLN", "FJET", "MEHA", "TSLA", "NVDA", "AAPL", "GME", "AMC"]
    try:
        data = yf.download(fallback_tickers, period="5d", progress=False)
        closes = data['Close']
        volumes = data['Volume']
        for t in fallback_tickers:
            if t in closes.columns:
                series, v_series = closes[t].dropna(), volumes[t].dropna()
                if len(series) >= 2:
                    prev, curr = series.iloc[-2], series.iloc[-1]
                    change = ((curr - prev) / prev) * 100
                    vol = v_series.iloc[-1]
                    avg_vol = v_series.mean() or 1
                    rvol = vol / avg_vol
                    vol_str = f"{vol/1e6:.1f}M" if vol >= 1e6 else f"{vol/1e3:.0f}K"
                    results.append({"ticker": t, "price": float(curr), "change": float(change), "session": "REGULAR", "vol": vol_str, "rvol": float(rvol), "catalyst": "High Volume Breakout"})
    except: pass
    return sorted(results, key=lambda x: x['change'], reverse=True)

# ==========================================
# 4. DATA EXECUTION
# ==========================================
macro_data = fetch_expanded_macro()
sector_data = fetch_sector_flow()
movers_data = fetch_gappers()

# ==========================================
# 5. UI RENDER ENGINE
# ==========================================

# --- HEADER ---
st.markdown(f'<div class="hdr"><div class="hdr-top"><div><div class="wrap-type">Market Briefing</div><div class="wrap-title">Confluence Trading Tools</div></div><div class="hdr-meta"><div class="hdr-date">{now_dt.strftime("%A, %B %d")}</div><span class="{status_class}">{market_status}</span></div></div></div>', unsafe_allow_html=True)

# --- 01 | SCORECARD ---
scorecard_html = '<div class="cloud-card"><div class="section-title">01 — Macro Scorecard</div><div class="inst-grid">'
for name, m in macro_data.items():
    col = "inst-change-up" if m['pct'] >= 0 else "inst-change-down"
    sign = "▲ +" if m['pct'] > 0 else "▼ " if m['pct'] < 0 else ""
    p_str = f"{m['price']:.3f}" if name in ["VIX", "10Y Treasury"] else f"${m['price']:,.2f}"
    scorecard_html += f'<div class="inst-card"><div class="inst-name">{name}</div><div class="inst-level">{p_str}</div><div class="{col}">{sign}{m["pct"]:.2f}%</div></div>'
scorecard_html += "</div></div>"
st.markdown(scorecard_html, unsafe_allow_html=True)

# --- 03 | SECTORS ---
heatmap_html = '<div class="cloud-card"><div class="section-title">03 — Sector Flows</div>'
heatmap_html += '<div class="t-header-row" style="grid-template-columns: 50px 3fr 2fr 2fr;"><div>#</div><div>Sector / ETF</div><div>Change</div><div>Flow</div></div>'
for i, item in enumerate(sector_data):
    col = "up-pct" if item['pct'] >= 0 else "down-pct"
    f_col = "#4ade80" if item['pct'] >= 0 else "#f87171"
    heatmap_html += f'<div class="t-row" style="grid-template-columns: 50px 3fr 2fr 2fr;"><div>{i+1}</div><div class="ticker-cell">{item["ticker"]} <span style="color:#64748b; font-size:14px;">{item["sector"]}</span></div><div class="{col}">{item["pct"]:.2f}%</div><div style="color:{f_col}; font-weight:700;">{item["flow"]}</div></div>'
heatmap_html += '</div>'
st.markdown(heatmap_html, unsafe_allow_html=True)

# --- 04 | MARKET MOVERS ---
movers_html = '<div class="cloud-card"><div class="section-title">04 — Top Market Movers</div>'
movers_html += '<div class="t-header-row" style="grid-template-columns: 1.2fr 1fr 1.2fr 1fr 1.5fr 3fr;"><div>Ticker</div><div>Price</div><div>Gap %</div><div>Vol</div><div>RVOL</div><div>Catalyst</div></div>'
for item in movers_data[:10]:
    movers_html += f'<div class="t-row" style="grid-template-columns: 1.2fr 1fr 1.2fr 1fr 1.5fr 3fr;"><div class="ticker-cell">{item["ticker"]}</div><div>${item["price"]:.2f}</div><div class="up-pct">+{item["change"]:.1f}%</div><div class="vol-cell">{item["vol"]}</div><div class="vol-cell">{item["rvol"]:.1f}x</div><div class="cat-cell">{item["catalyst"]}</div></div>'
movers_html += '</div>'
st.markdown(movers_html, unsafe_allow_html=True)

# --- 09 | TECHNICAL PICTURE (FONT SYNCED) ---
st.markdown("""
<div class="cloud-card">
<div class="section-title">09 — Technical Picture & Action Plan</div>
<div class="inst-grid" style="grid-template-columns: repeat(2, 1fr);">
<div style="background: transparent;">
    <div style="margin-bottom:12px;"><span class="nb-badge nb-blue">SPX LEVELS</span></div>
    <div style="padding-bottom:6px; font-size:16px;"><span class="label-mono">Target:</span> <span style="font-weight:800;">7,300–7,375</span></div>
    <div style="padding-top:6px; font-size:16px;"><span class="label-mono">Support:</span> <span style="font-weight:800;">7,000 ➔ 6,780</span></div>
</div>
<div style="background: transparent;">
    <div style="margin-bottom:12px;"><span class="nb-badge nb-purple">VOLATILITY (VIX)</span></div>
    <div style="padding-bottom:6px; font-size:16px;"><span class="label-mono">Current Level:</span> <span style="font-weight:800;">~19.10</span></div>
    <div style="padding-top:6px; font-size:16px;"><span class="label-mono">Market Context:</span> <span style="font-weight:800;">Normal Regime</span></div>
</div>
</div>
</div>
""", unsafe_allow_html=True)

# --- 11 | WATCHLIST ---
st.markdown("""
<div class="cloud-card">
<div class="section-title">11 — Trading Watchlist</div>
<div class="t-row" style="grid-template-columns: 1fr;">
    <div style="margin-bottom:4px;"><span class="nb-badge nb-green">Institutional Flow</span></div>
    <div class="ticker-cell">NVDA — Post-Earnings Follow Through</div>
    <div class="cat-cell">Massive institutional buy-side pressure remains. Watch for a test of new ATH territory.</div>
</div>
<div class="t-row" style="grid-template-columns: 1fr;">
    <div style="margin-bottom:4px;"><span class="nb-badge nb-blue">Catalyst Play</span></div>
    <div class="ticker-cell">TSLA — FSD China Approval</div>
    <div class="cat-cell">Structural rally in progress. Looking for $220 to act as a launchpad for the next leg.</div>
</div>
</div>
""", unsafe_allow_html=True)
