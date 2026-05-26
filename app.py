import streamlit as st
import pandas as pd
import requests
from datetime import datetime

# ==========================================
# CONFIGURATION & THEME
# ==========================================
st.set_page_config(
    page_title="Market Wrap",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# Strip out visual noise and force the custom dark UI
st.markdown("""
    <style>
    /* Base Theme */
    .stApp { background-color: #0b0e14; color: #8b9eb7; font-family: 'Inter', sans-serif; }
    
    /* Hide Streamlit Noise */
    #MainMenu {visibility: hidden;}
    header {visibility: hidden;}
    footer {visibility: hidden;}
    
    /* Section Headers */
    .section-header {
        color: #8b9eb7;
        font-size: 0.85rem;
        font-weight: 600;
        letter-spacing: 1px;
        margin-top: 30px;
        margin-bottom: 15px;
        border-bottom: 1px solid #1e2634;
        padding-bottom: 5px;
    }

    /* Scorecard Grid */
    .grid-container {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
        margin-bottom: 20px;
    }
    .card {
        background-color: #151a25;
        border: 1px solid #1e2634;
        border-radius: 8px;
        padding: 15px;
        text-align: center;
    }
    .card-title { font-size: 0.75rem; color: #8b9eb7; font-weight: 700; margin-bottom: 5px; }
    .card-value { font-size: 1.25rem; color: #ffffff; font-weight: 700; margin-bottom: 3px; }
    .text-green { color: #00d26a !important; font-size: 0.8rem; font-weight: 600; }
    .text-red { color: #f94144 !important; font-size: 0.8rem; font-weight: 600; }
    .text-gray { color: #8b9eb7 !important; font-size: 0.8rem; font-weight: 600; }

    /* Custom Tables */
    .custom-table {
        width: 100%;
        border-collapse: collapse;
        background-color: #151a25;
        border-radius: 8px;
        overflow: hidden;
    }
    .custom-table th {
        text-align: left;
        padding: 12px;
        font-size: 0.75rem;
        color: #8b9eb7;
        border-bottom: 1px solid #1e2634;
    }
    .custom-table td {
        padding: 12px;
        font-size: 0.85rem;
        color: #e2e8f0;
        border-bottom: 1px solid #1e2634;
    }
    .custom-table tr:last-child td { border-bottom: none; }
    .ticker-link { color: #4b89ff; font-weight: 600; text-decoration: none; }

    /* Editor Note Box */
    .editor-note {
        background-color: #15162a;
        border: 1px solid #362f6b;
        border-radius: 8px;
        padding: 20px;
        color: #e2e8f0;
        font-size: 0.9rem;
        line-height: 1.6;
    }
    .editor-note b { color: #b392f0; }
    </style>
""", unsafe_allow_html=True)

# ==========================================
# API KEYS
# ==========================================
BZ_KEY = "bz.4DVR2L3LKQD6KU5Z4CHZPPNE5MPV2KLQ"
FMP_KEY = "WMMhcffuHSYVTceXryrt4tHC8GXcsB0g"
AV_KEY = "JDYOYHLL40FDFOUK"

# ==========================================
# DATA FETCHING HELPER FUNCTIONS
# ==========================================
@st.cache_data(ttl=60)
def fetch_quotes(symbols):
    try:
        url = f"https://financialmodelingprep.com/api/v3/quote/{','.join(symbols)}?apikey={FMP_KEY}"
        res = requests.get(url)
        if res.status_code == 200:
            return {item['symbol']: item for item in res.json()}
        else:
            st.error(f"FMP API Error: {res.status_code}")
            return {}
    except Exception as e:
        st.error(f"Connection Error: {e}")
        return {}

@st.cache_data(ttl=300)
def fetch_fmp_market_movers(mover_type="gainers"):
    try:
        url = f"https://financialmodelingprep.com/api/v3/stock_market/{mover_type}?apikey={FMP_KEY}"
        res = requests.get(url)
        if res.status_code == 200:
            return res.json()[:5]
        return []
    except:
        return []

@st.cache_data(ttl=300)
def fetch_benzinga_news():
    try:
        url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&displayOutput=headline,created_at,symbols&limit=5"
        res = requests.get(url, headers={"accept": "application/json"})
        if res.status_code == 200:
            return res.json()
        return []
    except:
        return []

def format_delta(val):
    if val is None: return "<span class='text-gray'>unch</span>"
    if val > 0: return f"<span class='text-green'>+{val:.2f}%</span>"
    if val < 0: return f"<span class='text-red'>{val:.2f}%</span>"
    return "<span class='text-gray'>unch</span>"

def format_price(val):
    if val is None: return "—"
    return f"{val:,.2f}"

# ==========================================
# UI BUILDER
# ==========================================

st.markdown("<h2 style='color: white; margin-bottom: 0;'>Post-Market Wrap</h2>", unsafe_allow_html=True)
st.markdown(f"<p style='color: #8b9eb7; font-size: 0.9rem;'>{datetime.today().strftime('%A — %B %d, %Y')}</p>", unsafe_allow_html=True)

# --- 01 Closing Scorecard ---
st.markdown("<div class='section-header'>01 — Closing Scorecard</div>", unsafe_allow_html=True)

scorecard_tickers = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIXY', 'USO', 'GLD', 'BTCUSD']
quotes = fetch_quotes(scorecard_tickers)

display_map = {
    'SPY': 'SPX (Proxy)', 'QQQ': 'NDX (Proxy)', 'DIA': 'DJIA (Proxy)', 'IWM': 'RUT (Proxy)',
    'VIXY': 'VIX (Proxy)', 'USO': 'WTI (Proxy)', 'GLD': 'GOLD (Proxy)', 'BTCUSD': 'BTC'
}

html_cards = "<div class='grid-container'>"
for ticker, display_name in display_map.items():
    data = quotes.get(ticker, {})
    price = data.get('price')
    change = data.get('changesPercentage')
    
    html_cards += f"<div class='card'><div class='card-title'>{display_name}</div><div class='card-value'>{format_price(price)}</div><div>{format_delta(change)}</div></div>"

html_cards += "</div>"
st.markdown(html_cards, unsafe_allow_html=True)


# --- 02 Top Movers ---
st.markdown("<div class='section-header'>02 — Top Movers</div>", unsafe_allow_html=True)

gainers = fetch_fmp_market_movers("gainers")
losers = fetch_fmp_market_movers("losers")

html_movers = "<table class='custom-table'><tr><th>Ticker</th><th>%</th><th>Close</th><th>Name / Catalyst</th></tr>"
html_movers += "<tr><td colspan='4' style='color:#00d26a; font-size:0.7rem; font-weight:bold;'>▲ Top Gainers</td></tr>"
for g in gainers:
    html_movers += f"<tr><td><a href='#' class='ticker-link'>{g.get('symbol')}</a></td><td class='text-green'>+{g.get('changesPercentage', 0):.2f}%</td><td>${g.get('price', 0):.2f}</td><td style='color:#8b9eb7; font-size:0.8rem;'>{g.get('name', '')[:40]}</td></tr>"

html_movers += "<tr><td colspan='4' style='color:#f94144; font-size:0.7rem; font-weight:bold; border-top: 1px solid #1e2634; padding-top: 15px;'>▼ Top Losers</td></tr>"
for l in losers:
    html_movers += f"<tr><td><a href='#' class='ticker-link'>{l.get('symbol')}</a></td><td class='text-red'>{l.get('changesPercentage', 0):.2f}%</td><td>${l.get('price', 0):.2f}</td><td style='color:#8b9eb7; font-size:0.8rem;'>{l.get('name', '')[:40]}</td></tr>"
html_movers += "</table>"

st.markdown(html_movers, unsafe_allow_html=True)


# --- 03 News & Catalysts ---
st.markdown("<div class='section-header'>03 — News Drivers & Catalysts</div>", unsafe_allow_html=True)
news = fetch_benzinga_news()

if news:
    html_news = "<table class='custom-table'>"
    for item in news:
        syms = ", ".join([s['symbol'] for s in item.get('stocks', [])])
        title = item.get('title', '')
        html_news += f"<tr><td style='width: 80px;'><span style='background:#362f6b; color:#b392f0; padding:3px 6px; border-radius:4px; font-size:0.7rem;'>{syms if syms else 'News'}</span></td><td><b style='color:#e2e8f0;'>{title}</b></td></tr>"
    html_news += "</table>"
    st.markdown(html_news, unsafe_allow_html=True)
else:
    st.markdown("<div style='color:#8b9eb7; font-size: 0.85rem;'>No recent catalysts found or API limit reached.</div>", unsafe_allow_html=True)


# --- 04 Watch List ---
st.markdown("<div class='section-header'>04 — Watch List</div>", unsafe_allow_html=True)

html_watch = "<table class='custom-table'>"
html_watch += "<tr><th>Ticker</th><th>Close</th><th>Key Level</th><th>Catalyst / Thesis</th><th>Bias</th></tr>"
html_watch += "<tr><td><a href='#' class='ticker-link'>INTC</a></td><td>$83.55</td><td>Hold $80 / fade $86</td><td style='color:#8b9eb7; font-size:0.8rem;'>Post-blowout continuation into PT hikes</td><td class='text-green'>Long</td></tr>"
html_watch += "<tr><td><a href='#' class='ticker-link'>MXL</a></td><td>$62.25</td><td>$58 base</td><td style='color:#8b9eb7; font-size:0.8rem;'>Momentum stall zone; watch exhaustion</td><td style='color:#f6ad55; font-weight:bold; font-size:0.8rem;'>Range</td></tr>"
html_watch += "<tr><td><a href='#' class='ticker-link'>XLE</a></td><td>—</td><td>Break $90 WTI</td><td style='color:#8b9eb7; font-size:0.8rem;'>Short — majors faded on strong crude</td><td class='text-red'>Short</td></tr>"
html_watch += "</table>"

st.markdown(html_watch, unsafe_allow_html=True)


# --- 05 Editor's Note ---
st.markdown("<div class='section-header'>05 — Editor's Afternoon Note</div>", unsafe_allow_html=True)

html_note = "<div class='editor-note'>"
html_note += "Two headline sets drove the tape: <b>Intel's Q1 blowout</b> shifted the capex-beneficiary trade from NVDA to a broader bench, and the <b>DOJ shelving the Powell probe</b> removed a tail-risk premium.<br><br>"
html_note += "<b>Closing posture:</b> Tactical long into Monday with semis & AI-optics; pair-trade the energy/healthcare weakness against tech strength; trim Weds AM ahead of mega-cap AMC event risk."
html_note += "</div>"

st.markdown(html_note, unsafe_allow_html=True)
