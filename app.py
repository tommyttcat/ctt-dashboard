import streamlit as st
import yfinance as yf
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime

st.set_page_config(
    page_title="CTT Morning Dashboard",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="collapsed"
)

st.markdown("""
    <style>
    .stApp { background-color: #0E1117; color: #FAFAFA; }
    div[data-testid="stMetricValue"] { color: #00FFAA; }
    header {visibility: hidden;}
    footer {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

st.title("Confluence Trading Tools | Daily Briefing")
st.caption(f"Market Data Initialized: {datetime.now().strftime('%A, %b %d, %Y')}")
st.markdown("---")

@st.cache_data(ttl=300) 
def fetch_macro_snapshot():
    tickers = {"S&P 500 Futures": "^ES=F", "Nasdaq Futures": "^NQ=F", "10Y Yield": "^TNX", "Crude Oil": "CL=F"}
    data = {}
    for name, ticker in tickers.items():
        tick = yf.Ticker(ticker)
        hist = tick.history(period="2d")
        if len(hist) >= 2:
            prev_close = hist['Close'].iloc[0]
            curr_close = hist['Close'].iloc[1]
            pct_change = ((curr_close - prev_close) / prev_close) * 100
            data[name] = {"price": curr_close, "pct": pct_change}
    return data

@st.cache_data(ttl=3600)
def fetch_sector_flow():
    sectors = {
        "Technology": "XLK", "Financials": "XLF", "Energy": "XLE", 
        "Healthcare": "XLV", "Consumer Disc": "XLY"
    }
    perf = []
    for name, ticker in sectors.items():
        tick = yf.Ticker(ticker)
        hist = tick.history(period="2d")
        if len(hist) >= 2:
            change = ((hist['Close'].iloc[1] - hist['Close'].iloc[0]) / hist['Close'].iloc[0]) * 100
            perf.append({"Sector": name, "Change %": change})
    return pd.DataFrame(perf).sort_values(by="Change %", ascending=False)

def calculate_vpci(df, short_window=5, long_window=21):
    df['Vol_x_Price'] = df['Close'] * df['Volume']
    vwma_short = df['Vol_x_Price'].rolling(window=short_window).sum() / df['Volume'].rolling(window=short_window).sum()
    vwma_long = df['Vol_x_Price'].rolling(window=long_window).sum() / df['Volume'].rolling(window=long_window).sum()
    sma_short = df['Close'].rolling(window=short_window).mean()
    sma_long = df['Close'].rolling(window=long_window).mean()
    vpc = vwma_long - sma_long
    vpr = vwma_short / sma_short
    vm = df['Volume'].rolling(window=short_window).mean() / df['Volume'].rolling(window=long_window).mean()
    df['VPCI'] = vpc * vpr * vm
    return df

st.subheader("Editor's Morning Note")
st.info("**Macro Context:** Equities are testing key algorithmic liquidity zones this morning. Watch the 10Y Yield closely as it interacts with the 4.2% level. Market Momentum (MKM) across the hourly timeframe indicates potential for a midday pivot. Keep in mind that Monday, May 25 is Memorial Day, so markets will be closed.")

st.subheader("Futures & Macro Snapshot")
macro_data = fetch_macro_snapshot()
cols = st.columns(4)
for i, (name, metrics) in enumerate(macro_data.items()):
    cols[i].metric(label=name, value=f"{metrics['price']:.2f}", delta=f"{metrics['pct']:.2f}%")

st.markdown("---")
col1, col2 = st.columns([1, 1])

with col1:
    st.subheader("Top Sectors & Money Flow")
    sector_df = fetch_sector_flow()
    fig = px.bar(sector_df, x="Change %", y="Sector", orientation='h', color="Change %", color_continuous_scale="RdYlGn", template="plotly_dark")
    fig.update_layout(showlegend=False, height=300, margin=dict(l=0, r=0, t=0, b=0))
    st.plotly_chart(fig, use_container_width=True)

with col2:
    st.subheader("Key News & Catalysts")
    st.markdown("""
    * **SPY:** Core PCE inflation data comes in line with expectations, easing rate hike fears.
    * **NVDA:** Announces next-generation server architecture; price target raised by 3 analysts.
    * **TSLA:** Factory output in Shanghai briefly paused due to supply chain logistics.
    """)

st.markdown("---")
st.subheader("Sentiment & Market Breadth")
st.caption("T2108 Proxy: VIX and Advance/Decline metrics.")
try:
    vix = yf.Ticker("^VIX").history(period="1d")['Close'].iloc[0]
except IndexError:
    vix = 15.00
    
sc1, sc2, sc3 = st.columns(3)
sc1.metric("Volatility Index (VIX)", f"{vix:.2f}", delta="-0.50" if vix < 15 else "+0.50", delta_color="inverse")
sc2.metric("T2108 (Estimated % Above 40D SMA)", "54.2%", delta="Bullish Zone")
sc3.metric("Put/Call Ratio", "0.82", delta="-0.05", delta_color="inverse")

st.markdown("---")
st.subheader("Technical Analysis & VPCI (Volume Price Confirmation)")
spy_df = yf.Ticker("SPY").history(period="3mo")
spy_df = calculate_vpci(spy_df)

fig_tech = go.Figure()
fig_tech.add_trace(go.Scatter(x=spy_df.index, y=spy_df['Close'], name='SPY Close', line=dict(color='#FAFAFA')))
fig_tech.add_trace(go.Bar(x=spy_df.index, y=spy_df['VPCI'], name='VPCI', marker_color='#00FFAA', yaxis='y2'))
fig_tech.update_layout(template="plotly_dark", yaxis=dict(title='Price'), yaxis2=dict(title='VPCI', overlaying='y', side='right'), height=400, margin=dict(l=0, r=0, t=30, b=0))
st.plotly_chart(fig_tech, use_container_width=True)

st.markdown("---")
col3, col4 = st.columns([1, 1])

with col3:
    st.subheader("Stocks in Play Today")
    in_play_data = pd.DataFrame({
        "Ticker": ["AAPL", "AMD", "META", "CRWD"],
        "Setup": ["Breakout Pullback", "Opening Drive", "Earnings Gap", "News Catalyst"],
        "Vol vs Avg": ["150%", "210%", "300%", "180%"]
    })
    st.dataframe(in_play_data, hide_index=True, use_container_width=True)

with col4:
    st.subheader("Economic Data & Earnings")
    events = pd.DataFrame({
        "Time (EST)": ["08:30 AM", "10:00 AM", "After Close", "After Close"],
        "Event / Ticker": ["Core PCE Price Index", "ISM Manufacturing PMI", "SNOW (Earnings)", "CRM (Earnings)"],
        "Impact": ["High", "Medium", "High", "High"]
    })
    st.dataframe(events, hide_index=True, use_container_width=True)
