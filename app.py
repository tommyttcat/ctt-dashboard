import streamlit as st
import pandas as pd
import requests
from datetime import datetime, timedelta

# ==========================================
# CONFIGURATION & THEME
# ==========================================
st.set_page_config(
    page_title="Market Wrap & Prep",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# Custom CSS for Dark Theme & Card UI to match the screenshots
st.markdown("""
    <style>
    /* Main Background */
    .stApp {
        background-color: #0B0E14;
        color: #E2E8F0;
    }
    /* Headers */
    h1, h2, h3 {
        color: #FFFFFF !important;
        font-family: 'Inter', sans-serif;
    }
    /* Metric Cards */
    div[data-testid="metric-container"] {
        background-color: #171A21;
        border: 1px solid #2D3748;
        padding: 15px;
        border-radius: 10px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    div[data-testid="metric-container"] label {
        color: #A0AEC0 !important;
        font-weight: 600;
        font-size: 0.85rem;
    }
    div[data-testid="metric-container"] div[data-testid="stMetricValue"] {
        color: #FFFFFF !important;
        font-size: 1.5rem;
        font-weight: bold;
    }
    /* Green for Positive, Red for Negative */
    div[data-testid="stMetricDelta"] svg {
        display: none; /* Hide default arrows for cleaner look */
    }
    /* Section Dividers */
    hr {
        border-color: #2D3748;
    }
    /* Dataframes */
    .stDataFrame {
        background-color: #171A21;
        border-radius: 8px;
        padding: 10px;
    }
    /* Notes / Summary Box */
    .summary-box {
        background-color: #1E1A2D;
        border-left: 4px solid #805AD5;
        padding: 15px;
        border-radius: 4px;
        margin-top: 10px;
        margin-bottom: 20px;
    }
    </style>
""", unsafe_allow_html=True)


# ==========================================
# API KEYS (Provided)
# ==========================================
BZ_KEY = "bz.4DVR2L3LKQD6KU5Z4CHZPPNE5MPV2KLQ"
FMP_KEY = "WMMhcffuHSYVTceXryrt4tHC8GXcsB0g"
AV_KEY = "JDYOYHLL40FDFOUK"

# ==========================================
# DATA FETCHING HELPER FUNCTIONS
# ==========================================
@st.cache_data(ttl=300) # Cache for 5 mins to save API calls
def fetch_fmp_quote(symbol):
    try:
        url = f"https://financialmodelingprep.com/api/v3/quote/{symbol}?apikey={FMP_KEY}"
        res = requests.get(url).json()
        return res[0] if res else None
    except:
        return None

@st.cache_data(ttl=600)
def fetch_fmp_market_movers(mover_type="gainers"):
    # mover_type: 'gainers', 'losers', or 'actives'
    try:
        url = f"https://financialmodelingprep.com/api/v3/stock_market/{mover_type}?apikey={FMP_KEY}"
        res = requests.get(url).json()
        df = pd.DataFrame(res)
        if not df.empty:
            return df[['symbol', 'name', 'changesPercentage', 'price']].head(10)
        return pd.DataFrame()
    except:
        return pd.DataFrame()

@st.cache_data(ttl=600)
def fetch_fmp_sectors():
    try:
        url = f"https://financialmodelingprep.com/api/v3/sectors-performance?apikey={FMP_KEY}"
        res = requests.get(url).json()
        df = pd.DataFrame(res)
        return df
    except:
        return pd.DataFrame()

@st.cache_data(ttl=1800)
def fetch_benzinga_news():
    try:
        url = f"https://api.benzinga.com/api/v2/news?token={BZ_KEY}&displayOutput=headline,url,created_at,symbols&limit=5"
        headers = {"accept": "application/json"}
        res = requests.get(url, headers=headers).json()
        return res
    except:
        return []

@st.cache_data(ttl=3600)
def fetch_fmp_earnings(start_date, end_date):
    try:
        url = f"https://financialmodelingprep.com/api/v3/earning_calendar?from={start_date}&to={end_date}&apikey={FMP_KEY}"
        res = requests.get(url).json()
        df = pd.DataFrame(res)
        if not df.empty:
            df = df[['date', 'symbol', 'eps', 'epsEstimated', 'revenue', 'revenueEstimated', 'time']]
            return df.head(15) # Limit for UI cleanliness
        return pd.DataFrame()
    except:
        return pd.DataFrame()

@st.cache_data(ttl=3600)
def fetch_fmp_eco_calendar(start_date, end_date):
    try:
        url = f"https://financialmodelingprep.com/api/v3/economic_calendar?from={start_date}&to={end_date}&apikey={FMP_KEY}"
        res = requests.get(url).json()
        df = pd.DataFrame(res)
        if not df.empty:
             return df[['date', 'event', 'actual', 'estimate', 'impact', 'country']].head(10)
        return pd.DataFrame()
    except:
        return pd.DataFrame()

# Dates for queries
today_str = datetime.today().strftime('%Y-%m-%d')
next_week_str = (datetime.today() + timedelta(days=7)).strftime('%Y-%m-%d')

# ==========================================
# UI BUILDER
# ==========================================

# Header
st.markdown(f"### ✦ POST-MARKET WRAP & PREP | {datetime.today().strftime('%A — %B %d, %Y')}")
st.caption("Market data, catalysts, and technical context.")
st.markdown("---")

# 1. Futures & Macro Snapshot Scorecard
st.markdown("#### 01 — CLOSING SCORECARD")
tickers = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIXY'] # Using proxies for indexes/vix due to API availability
cols = st.columns(5)
for i, ticker in enumerate(tickers):
    data = fetch_fmp_quote(ticker)
    with cols[i]:
        if data:
            pct_change = data.get('changesPercentage', 0)
            color = "inverse" if pct_change < 0 else "normal"
            st.metric(label=ticker, 
                      value=f"${data.get('price', 0):.2f}", 
                      delta=f"{pct_change:.2f}%", 
                      delta_color=color)
        else:
            st.metric(label=ticker, value="N/A", delta="N/A")

st.write("") # Spacer

# Secondary Macro
macro_tickers = ['USO', 'GLD', 'BTCUSD'] # Oil proxy, Gold Proxy, Crypto
cols_macro = st.columns(5)
for i, ticker in enumerate(macro_tickers):
    data = fetch_fmp_quote(ticker)
    with cols_macro[i]:
         if data:
            pct_change = data.get('changesPercentage', 0)
            st.metric(label=ticker, 
                      value=f"${data.get('price', 0):.2f}", 
                      delta=f"{pct_change:.2f}%")
            
st.markdown("---")

# 2. Top Sectors & Money Flow
st.markdown("#### 02 — SECTOR PERFORMANCE")
sectors_df = fetch_fmp_sectors()
if not sectors_df.empty:
    # Formatting for UI
    sectors_df['changesPercentage'] = sectors_df['changesPercentage'].apply(lambda x: f"{float(x.strip('%')):.2f}%" if isinstance(x, str) else f"{x:.2f}%")
    st.dataframe(sectors_df, use_container_width=True, hide_index=True)
else:
    st.info("Sector data currently unavailable.")

st.markdown("---")

# 3. Pre-Market Gappers / Post Market Gappers / Daily movers
st.markdown("#### 03 — TOP MOVERS (GAINERS & LOSERS)")
col_gain, col_loss = st.columns(2)

with col_gain:
    st.success("▲ TOP GAINERS")
    gainers = fetch_fmp_market_movers("gainers")
    if not gainers.empty:
        st.dataframe(gainers, use_container_width=True, hide_index=True)

with col_loss:
    st.error("▼ TOP LOSERS")
    losers = fetch_fmp_market_movers("losers")
    if not losers.empty:
        st.dataframe(losers, use_container_width=True, hide_index=True)

st.markdown("---")

# 4. Key News & Catalysts
st.markdown("#### 04 — NEWS DRIVERS & CATALYSTS")
news = fetch_benzinga_news()
if news:
    for item in news:
        symbols = ", ".join([s['symbol'] for s in item.get('stocks', [])])
        st.markdown(f"**[{symbols}] {item.get('title', 'News Headline')}**")
        st.caption(f"Created: {item.get('created', 'N/A')} | [Read More]({item.get('url', '#')})")
else:
    st.info("No recent news fetched.")

st.markdown("---")

# 5. Stocks in Play Today (Custom Watchlist Placeholder)
st.markdown("#### 05 — STOCKS IN PLAY & WATCHLIST")
# Creating a dummy dataframe to mimic the image's "Monday Watch List"
watchlist_data = {
    "TICKER": ["INTC", "MXL", "NVDA", "SPY"],
    "PRICE": ["83.55", "62.25", "205.00", "716.00"],
    "KEY LEVEL": ["Hold $80 / fade $86", "$58 base", "$200 / $210", "Hold $710"],
    "CATALYST / THESIS": ["Post-blowout continuation", "Momentum stall zone", "18-day SOX streak", "Index scalp ahead of tech"],
    "BIAS": ["LONG", "RANGE", "RANGE", "RANGE"]
}
st.dataframe(pd.DataFrame(watchlist_data), use_container_width=True, hide_index=True)

st.markdown("---")

# 6. Sentiment & Market Breadth (T2108) / Technical Analysis & VPCI
st.markdown("#### 06 — SENTIMENT & TECHNICAL BREADTH")
col_b1, col_b2, col_b3 = st.columns(3)
with col_b1:
    st.metric(label="VIX (Volatility)", value="19.02", delta="+0.5%", delta_color="inverse")
with col_b2:
    st.metric(label="SPX > 50D (Breadth)", value="~72%", delta="Strong", delta_color="normal")
with col_b3:
    st.metric(label="NH-NL (Net Highs)", value="+212", delta="Bullish Expansion", delta_color="normal")
st.caption("*Note: Custom indicator data (T2108, VPCI) requires specialized live feeds. Values shown above are illustrative placeholders based on UI requirements.*")

st.markdown("---")

# 7. Economic Data & Catalysts Today
st.markdown("#### 07 — ECONOMIC DATA RECAP")
eco_df = fetch_fmp_eco_calendar(today_str, next_week_str)
if not eco_df.empty:
    st.dataframe(eco_df.head(5), use_container_width=True, hide_index=True)
else:
    st.info("No major economic data found for the current window.")

st.markdown("---")

# 8. & 9. Earnings Calendar
st.markdown("#### 08 — EARNINGS CALENDAR")
tab1, tab2 = st.tabs(["Today's Earnings", "Week Ahead"])

with tab1:
    todays_earnings = fetch_fmp_earnings(today_str, today_str)
    if not todays_earnings.empty:
        st.dataframe(todays_earnings, use_container_width=True, hide_index=True)
    else:
        st.write("No major earnings reported today.")

with tab2:
    week_earnings = fetch_fmp_earnings(today_str, next_week_str)
    if not week_earnings.empty:
         st.dataframe(week_earnings, use_container_width=True, hide_index=True)
    else:
        st.write("No major earnings expected this week.")

st.markdown("---")

# 10. Summary (Editor's Note Style)
st.markdown("#### 10 — EDITOR'S AFTERNOON NOTE & SUMMARY")
st.markdown("""
<div class="summary-box">
    <p><b>MARKET TONE:</b> Markets hit fresh local highs as major semi-conductor blowouts fuel risk-on flows. Breadth remains relatively narrow, heavily carried by mega-cap tech and semis, while defensive sectors lag. VIX remains sticky near 19 due to lingering macro headlines.</p>
    <p><b>CLOSING POSTURE:</b> Tactical long into the week with semis & AI-optics. Pair-trade energy weakness against tech strength. Trim positions ahead of major mega-cap AMC event risks later this week.</p>
</div>
""", unsafe_allow_html=True)
