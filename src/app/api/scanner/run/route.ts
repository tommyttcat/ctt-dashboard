import { NextResponse } from 'next/server';

import { kv } from '@vercel/kv';



export const dynamic = 'force-dynamic';

export const maxDuration = 60;



const SECTOR_MAP: Record<string, string> = {

'AAPL': 'IT', 'MSFT': 'IT', 'SMCI': 'IT',

'NVDA': "Semi's", 'AMD': "Semi's", 'INTC': "Semi's",

'AVGO': "Semi's", 'MU': "Semi's", 'ARM': "Semi's",

'QCOM': "Semi's", 'TSM': "Semi's",

'PLTR': 'AI', 'SOUN': 'AI', 'BBAI': 'AI',

'AI': 'AI', 'CRWD': 'Cyber', 'PANW': 'Cyber', 'ZS': 'Cyber',

'COIN': 'Fintech', 'MSTR': 'Fintech', 'MARA': 'Fintech', 'RIOT': 'Fintech', 'CLSK': 'Fintech',

'IREN': 'Fintech', 'CIFR': 'Fintech', 'HUT': 'Fintech', 'HOOD': 'Fintech', 'SOFI': 'Fintech', 'UPST': 'Fintech',

'TSLA': 'EV', 'NIO': 'EV', 'LI': 'EV', 'XPEV': 'EV',

'LUNR': 'Aerospace', 'ASTS': 'Aerospace', 'RKLB': 'Aerospace',

'CEG': 'Nuclear', 'OKLO': 'Nuclear', 'CCJ': 'Nuclear', 'SMR': 'Nuclear', 'LEU': 'Nuclear',

'FSLR': 'Solar', 'ENPH': 'Solar', 'RUN': 'Solar',

'HIMS': 'Healthcare', 'NVO': 'Healthcare', 'LLY': 'Healthcare', 'ASTX': 'Biotech', 'COO': 'Healthcare',

'AMZN': 'Con Disc', 'UBER': 'Con Disc', 'BABA': 'Con Disc',

'PDD': 'Con Disc', 'JD': 'Con Disc',

'PG': 'Con Staples',

'META': 'Comm Serv', 'GOOGL': 'Comm Serv', 'NFLX': 'Comm Serv',

'RDDT': 'Comm Serv', 'DJT': 'Comm Serv'

};



const ETF_TARGET_MAP: Record<string, string> = {

'MSTX': 'MSTR - Fintech', 'MSTU': 'MSTR - Fintech', 'MSTZ': 'MSTR - Fintech', 'MSTD': 'MSTR - Fintech',

'CONL': 'COIN - Fintech', 'CONZ': 'COIN - Fintech', 'COND': 'COIN - Fintech',

'MRAL': 'MARA - Fintech', 'RIOX': 'RIOT - Fintech',

'BITX': 'BTC - Bitcoin', 'BITZ': 'BTC - Bitcoin', 'BTCZ': 'BTC - Bitcoin', 'IBIT': 'BTC - Bitcoin', 'BITO': 'BTC - Bitcoin',

'ETHU': 'ETH - Ethereum', 'ETHZ': 'ETH - Ethereum', 'ETU': 'ETH - Ethereum', 'SOLT': 'SOL - Solana', 'XRPT': 'XRP - Crypto',

'TSLL': 'TSLA - EV', 'TSLS': 'TSLA - EV', 'TSLQ': 'TSLA - EV', 'TSDD': 'TSLA - EV',

'NVDL': "NVDA - Semi's", 'NVDX': "NVDA - Semi's", 'NVD': "NVDA - Semi's", 'NVDD': "NVDA - Semi's", 'NVDQ': "NVDA - Semi's",

'AMZU': 'AMZN - Con Disc', 'AMZD': 'AMZN - Con Disc',

'AAPU': 'AAPL - IT', 'AAPD': 'AAPL - IT', 'APLX': 'AAPL - IT',

'MSFU': 'MSFT - IT', 'MSFD': 'MSFT - IT',

'GGLL': 'GOOGL - Comm Serv', 'GGLS': 'GOOGL - Comm Serv',

'BABX': 'BABA - Con Disc', 'BABD': 'BABA - Con Disc',

'LLYX': 'LLY - Healthcare', 'LLYD': 'LLY - Healthcare',

'AMDL': "AMD - Semi's", 'AMDS': "AMD - Semi's",

'AVGX': "AVGO - Semi's",

'SMU': 'SMCI - IT', 'SMCX': 'SMCI - IT', 'SMCZ': 'SMCI - IT',

'DLLL': 'DELL - IT', 'LUNL': 'LUNR - Aerospace', 'OKLL': 'OKLO - Nuclear', 'PLTU': 'PLTR - AI',

'METU': 'META - Comm Serv', 'TEMT': 'META - Comm Serv', 'SOFX': 'SOFI - Fintech', 'ROBN': 'HOOD - Fintech',

'RVNL': 'RIVN - EV', 'LCDL': 'LCID - EV', 'CRWV': 'CRWD - Cyber', 'CRDU': 'CRWD - Cyber', 'INTW': "INTC - Semi's",

'GMEU': 'GME - Con Disc', 'APPX': 'APP - IT', 'SNXX': 'SNOW - IT', 'AXTX': 'AXON - Industrials',

'IONX': 'IONQ - IT', 'IONZ': 'IONQ - IT', 'QPUX': 'IONQ - IT', 'CEGX': 'CEG - Nuclear',

'ASMG': "ASML - Semi's", 'UUUG': 'U - IT', 'AAOX': 'AI - AI', 'FBL': 'META - Comm Serv', 'HIMZ': 'HIMS - Healthcare',

'RDTL': 'RDDT - Comm Serv', 'RKLB': 'RKLB - Aerospace', 'RCAX': 'RCAT - Aerospace', 'SOUX': 'SOUN - AI', 'ASTS': 'ASTS - Aerospace',

'RGTX': 'RGT - IT', 'RGTU': 'RGT - IT', 'RGTZ': 'RGT - IT',

'TQQQ': 'QQQ - Nasdaq 3X', 'SQQQ': 'QQQ - Nasdaq -3X', 'QID': 'QQQ - Nasdaq -2X', 'QLD': 'QQQ - Nasdaq 2X', 'SNDQ': 'QQQ - Nasdaq ETF',

'SOXL': "SOXX - Semi's 3X", 'SOXS': "SOXX - Semi's -3X", 'TECL': 'XLK - Tech 3X', 'TECS': 'XLK - Tech -3X',

'FNGU': 'FNGU - Big Tech 3X', 'FNGD': 'FNGD - Big Tech -3X',

'TNA': 'IWM - Small Cap 3X', 'TZA': 'IWM - Small Cap -3X', 'FAS': 'XLF - Financials 3X', 'FAZ': 'XLF - Financials -3X',

'SPY': 'SPY - S&P 500', 'UPRO': 'SPY - S&P 3X', 'SPXL': 'SPY - S&P 3X', 'SPXS': 'SPY - S&P -3X', 'SPXU': 'SPY - S&P -3X',

'UVXY': 'VIX - Volatility 1.5X', 'UVIX': 'VIX - Volatility 2X', 'SVIX': 'VIX - Volatility -1X', 'VIXY': 'VIX - Volatility',

'MSOX': 'MSOS - Cannabis 2X', 'NAIL': 'XHB - Homebuilders 3X', 'LABX': 'XBI - Biotech 2X', 'KORU': 'EWY - South Korea 3X',

'ZSL': 'SLV - Silver -2X', 'URAA': 'URA - Uranium 2X', 'GDXD': 'GDX - Gold Miners -3X',

'QQQ': 'QQQ - Nasdaq', 'IWM': 'IWM - Small Cap', 'DIA': 'DIA - Dow Jones', 'VOO': 'VOO - S&P 500', 'VTI': 'VTI - Total Market'

};



const resolveEtfSector = (sym: string, apiSector: string | undefined, apiName: string | undefined): string => {

if (ETF_TARGET_MAP[sym]) return ETF_TARGET_MAP[sym];

if (SECTOR_MAP[sym]) return SECTOR_MAP[sym];

if (sym.length === 4) {

const rootCandidate = sym.substring(0, 3) + 'S';

if (SECTOR_MAP[rootCandidate]) return `${rootCandidate} - ${SECTOR_MAP[rootCandidate]}`;

}

const n = (apiName || '').toLowerCase();

if (n.includes(' etf') || n.includes('proshares') || n.includes('direxion') || n.includes('defiance') || n.includes('fund') || n.includes('trust')) {

return `${sym} - ETF`;

}

return apiSector || 'Financials';

};



const cleanSectorDescription = (sic: string | undefined, sector: string | undefined, industry: string | undefined) => {

const ind = (industry || '').toLowerCase();

if (ind.includes('nuclear')) return 'Nuclear';

if (ind.includes('solar')) return 'Solar';

if (ind.includes('electric vehicle') || ind.includes('auto manufacturer')) return 'EV';

if (ind.includes('biotechnology')) return 'Biotech';

if (ind.includes('semiconductor')) return "Semi's";

if (ind.includes('artificial intelligence') || ind.includes('ai ')) return 'AI';

if (ind.includes('cybersecurity') || ind.includes('security software')) return 'Cyber';

if (ind.includes('fintech') || ind.includes('financial technology')) return 'Fintech';

if (ind.includes('aerospace') || ind.includes('defense')) return 'Aerospace';



const sec = (sector || '').toLowerCase();

if (sec.includes('technology')) return 'IT';

if (sec.includes('healthcare') || sec.includes('health care')) return 'Healthcare';

if (sec.includes('financial')) return 'Financials';

if (sec.includes('consumer discretionary')) return 'Con Disc';

if (sec.includes('consumer staples')) return 'Con Staples';

if (sec.includes('energy')) return 'Energy';

if (sec.includes('materials')) return 'Materials';

if (sec.includes('industrials')) return 'Industrials';

if (sec.includes('real estate')) return 'Real Estate';

if (sec.includes('utilities')) return 'Utilities';

if (sec.includes('communication')) return 'Comm Serv';



const s = (sic || '').toLowerCase();

if (!s) return 'Financials';

if (s.includes('semiconductor')) return "Semi's";

if (s.includes('biological products') || s.includes('in vitro')) return 'Biotech';

if (s.includes('aircraft') || s.includes('defense')) return 'Aerospace';

if (s.includes('prepackaged software') || s.includes('computer programming') || s.includes('tech')) return 'IT';

if (s.includes('pharmaceutical') || s.includes('surgical') || s.includes('medical') || s.includes('health') || s.includes('drug') || s.includes('ophthalmic')) return 'Healthcare';

if (s.includes('bank') || s.includes('financial') || s.includes('trust') || s.includes('broker') || s.includes('investment') || s.includes('commodity') || s.includes('fund') || s.includes('blank check')) return 'Financials';

if (s.includes('real estate') || s.includes('reit')) return 'Real Estate';

if (s.includes('petroleum') || s.includes('drilling') || s.includes('oil') || s.includes('gas') || s.includes('energy')) return 'Energy';

if (s.includes('motor') || s.includes('retail') || s.includes('apparel') || s.includes('restaurant') || s.includes('eating') || s.includes('entertainment')) return 'Con Disc';

if (s.includes('soap') || s.includes('detergent') || s.includes('food') || s.includes('beverage') || s.includes('grocery') || s.includes('staple') || s.includes('tobacco')) return 'Con Staples';

if (s.includes('transport') || s.includes('freight') || s.includes('machinery') || s.includes('industrial') || s.includes('airline') || s.includes('air transportation')) return 'Industrials';

if (s.includes('telecommunication') || s.includes('telephone') || s.includes('radio') || s.includes('communication')) return 'Comm Serv';

if (s.includes('metal') || s.includes('mining') || s.includes('gold') || s.includes('chemical') || s.includes('wood') || s.includes('paper')) return 'Materials';

if (s.includes('electric services') || s.includes('utilities') || s.includes('water')) return 'Utilities';



return 'Financials';

};



const detectPattern = (bars: any[], currentPrice: number, currentOpen: number, vwap: number, rvol: number | null): { name: string | null, stage: string } => {

let stage = '-';

if (!bars || bars.length < 80) return { name: null, stage };


const yest = bars[1];

const day3 = bars[2];



const warmUpBars = Math.min(100, bars.length - 1);

let ema20 = bars[warmUpBars].c;

const k20 = 2 / (20 + 1);

for (let i = warmUpBars - 1; i >= 0; i--) {

ema20 = (bars[i].c * k20) + (ema20 * (1 - k20));

}



if (bars.length >= 210) {

const getSMA = (startIndex: number, periods: number) => {

if (bars.length < startIndex + periods) return 0;

let sum = 0;

for (let i = startIndex; i < startIndex + periods; i++) sum += bars[i].c;

return sum / periods;

};



const sma150_now = getSMA(0, 150);

const sma150_20d = getSMA(20, 150);

const sma150_60d = getSMA(60, 150);



if (sma150_now > 0 && sma150_20d > 0 && sma150_60d > 0) {

const slope = (sma150_now - sma150_20d) / sma150_20d;

const subStage = currentPrice >= ema20 ? 'A' : 'B';



if (slope > 0.015 && currentPrice > sma150_now) {

stage = `Stage 2${subStage}`;

} else if (slope < -0.015 && currentPrice < sma150_now) {

stage = `Stage 4${subStage}`;

} else {

if (sma150_20d > sma150_60d) {

stage = `Stage 3${subStage}`;

} else {

stage = `Stage 1${subStage}`;

}

}

}

}



const checkSqueeze = (offset: number) => {

let sum = 0;

for(let i=offset; i<offset+20; i++) sum += bars[i].c;

const sma = sum / 20;



let variance = 0;

for(let i=offset; i<offset+20; i++) variance += Math.pow(bars[i].c - sma, 2);

const stdDev = Math.sqrt(variance / 20);



const upperBB = sma + (2.0 * stdDev);

const lowerBB = sma - (2.0 * stdDev);



let sumTR = 0;

for(let i=offset; i<offset+20; i++) {

const high = bars[i].h;

const low = bars[i].l;

const prevClose = bars[i+1] ? bars[i+1].c : low;

sumTR += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));

}

const avgTR = sumTR / 20;



const upperKC = sma + (1.5 * avgTR);

const lowerKC = sma - (1.5 * avgTR);



return (upperBB < upperKC && lowerBB > lowerKC);

};



const isSqueezingToday = checkSqueeze(0);

const wasSqueezingYest = checkSqueeze(1);



if (wasSqueezingYest && !isSqueezingToday && currentPrice > ema20) {

return { name: 'BB SQZ Fired', stage };

}



const getRawK = (idx: number) => {

const slice = bars.slice(idx, idx + 14);

const highPeriod = Math.max(...slice.map(b => b.h));

const lowPeriod = Math.min(...slice.map(b => b.l));

if (highPeriod === lowPeriod) return 50;

return ((bars[idx].c - lowPeriod) / (highPeriod - lowPeriod)) * 100;

};



const getSmoothedK = (idx: number) => {

let sum = 0;

for (let i = 0; i < 4; i++) sum += getRawK(idx + i);

return sum / 4;

};



const smoothedKArray = [];

for (let i = 0; i < 11; i++) smoothedKArray.push(getSmoothedK(i));



const currentK = smoothedKArray[0];

const prevK = smoothedKArray[1];



let sumStoch = 0;

for (let i = 0; i < 10; i++) sumStoch += smoothedKArray[i];

const stochSma = sumStoch / 10;

let stochVar = 0;

for (let i = 0; i < 10; i++) stochVar += Math.pow(smoothedKArray[i] - stochSma, 2);

const stochStdDev = Math.sqrt(stochVar / 10);

const currentLowerStochBB = stochSma - (1.0 * stochStdDev);



let prevSumStoch = 0;

for (let i = 1; i < 11; i++) prevSumStoch += smoothedKArray[i];

const prevStochSma = prevSumStoch / 10;

let prevStochVar = 0;

for (let i = 1; i < 11; i++) prevStochVar += Math.pow(smoothedKArray[i] - prevStochSma, 2);

const prevStochStdDev = Math.sqrt(prevStochVar / 10);

const prevLowerStochBB = prevStochSma - (1.0 * prevStochStdDev);



if (prevK <= prevLowerStochBB && currentK > currentLowerStochBB) {

return { name: 'Blue Dot Rev', stage };

}



const hasConvictionVol = rvol !== null && rvol >= 1.0;

const high3Months = Math.max(...bars.slice(1, 65).map(b => b.h));



if (hasConvictionVol && currentPrice > high3Months && yest.c <= high3Months && currentPrice >= Math.max(...bars.slice(1, 80).map(b => b.h))) {

return { name: 'GLB', stage };

}



if (hasConvictionVol && currentOpen > (yest.h * 1.01) && currentPrice >= currentOpen) {

return { name: 'Gap & Go', stage };

}



if (hasConvictionVol && currentOpen <= yest.c && currentPrice > yest.c) {

return { name: 'R2G', stage };

}



if (hasConvictionVol && yest.h < day3.h && yest.l > day3.l && currentPrice > yest.h) {

return { name: 'Inside Day BRK', stage };

}



if (currentPrice > ema20 && yest.l <= (ema20 * 1.02) && currentPrice > yest.h) {

return { name: '20 EMA PB', stage };

}



if (isSqueezingToday) {

return { name: 'BB SQZ Building', stage };

}



if (currentPrice > ema20 && currentPrice > vwap) {

return { name: 'Trend Hold', stage };

}



return { name: null, stage };

};



const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 15000) => {

const controller = new AbortController();

const id = setTimeout(() => controller.abort(), timeoutMs);

try {

const res = await fetch(url, { signal: controller.signal as any });

clearTimeout(id);

if (!res.ok) return fallback;

return await res.json();

} catch (error) {

clearTimeout(id);

return fallback;

}

};



export async function GET(request: Request) {

const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';

if (!polygonApiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 500 });



try {

const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));

const timeStr = estDate.getHours() + estDate.getMinutes() / 60;

const isPreMarket = timeStr >= 4 && timeStr < 9.5;


const currentVolumeThreshold = isPreMarket ? 25000 : 500000;



const snapRes = await fetchSafeJson(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${polygonApiKey}`, { tickers: [] });

const rawSnapshot = snapRes.tickers || [];

if (rawSnapshot.length === 0) return NextResponse.json({ error: 'No snapshot data returned' }, { status: 500 });



const processedSnapshot = rawSnapshot.map((t: any) => {

const livePrice = t.lastTrade?.p || t.min?.c || t.day?.c || t.prevDay?.c || 0;

const prevClose = t.prevDay?.c || 0;

const vol = t.day?.v || t.prevDay?.v || t.min?.v || 0;

const vwap = t.day?.vw || t.prevDay?.vw || livePrice;



let liveChg = t.todaysChangePerc || 0;

if (prevClose > 0 && livePrice > 0) {

liveChg = ((livePrice - prevClose) / prevClose) * 100;

}



t._livePrice = livePrice;

t._liveChg = liveChg;

t._liveVol = vol;

t._liveVwap = vwap;



return t;

});



const viableSetups = processedSnapshot.filter((t: any) => t._livePrice >= 1.00 && t._liveVol >= currentVolumeThreshold);



// =========================================================================

// MODIFIED SIZING - Trimmed slightly to keep Polygon + AI strictly under 10s

// =========================================================================

const dailyCandidates = [...viableSetups].sort((a: any, b: any) => b._liveChg - a._liveChg).slice(0, 15);

const sipCandidates = [...viableSetups].filter((t: any) => Math.abs(t._liveChg) >= 4.0 && t._livePrice >= t._liveVwap).sort((a: any, b: any) => b._liveVol - a._liveVol).slice(0, 15);



const MEGA_CAP_TICKERS = new Set(['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'BRK.B', 'AVGO', 'LLY', 'JPM', 'XOM', 'UNH', 'V', 'PG', 'MA', 'JNJ', 'HD']);

const megaCapsRaw = processedSnapshot.filter((t: any) => MEGA_CAP_TICKERS.has(t.ticker)).sort((a: any, b: any) => b._liveChg - a._liveChg).slice(0, 10);

const knownEtfsRaw = viableSetups.filter((t: any) => ETF_TARGET_MAP[t.ticker]);

const etfGainersRaw = [...knownEtfsRaw].sort((a: any, b: any) => b._liveChg - a._liveChg).slice(0, 10);

const etfLosersRaw = [...knownEtfsRaw].sort((a: any, b: any) => a._liveChg - b._liveChg).slice(0, 10);


const regularStocksRaw = viableSetups.filter((t: any) => !ETF_TARGET_MAP[t.ticker]);

const gainersRaw = [...regularStocksRaw].filter((t: any) => t._liveChg >= 4.0).sort((a: any, b: any) => b._liveChg - a._liveChg).slice(0, 10);

const losersRaw = [...regularStocksRaw].sort((a: any, b: any) => a._liveChg - b._liveChg).slice(0, 10);



const today = new Date();

const lookbackDate = new Date();

lookbackDate.setDate(today.getDate() - 400);

const toStr = today.toISOString().split('T')[0];

const fromStr = lookbackDate.toISOString().split('T')[0];



const allCandidates = [...dailyCandidates, ...sipCandidates, ...megaCapsRaw, ...gainersRaw, ...losersRaw, ...etfGainersRaw, ...etfLosersRaw];

const uniqueCandidates = Array.from(new Map(allCandidates.map(item => [item.ticker, item])).values());


// =========================================================================

// ENRICHMENT PIPELINE

// =========================================================================

const enrichCandidate = async (t: any) => {

const sym = t.ticker || t.single_ticker;

const price = t._livePrice;

const vol = t._liveVol;

const chgPct = t._liveChg;

const vwap = t._liveVwap;

const currentOpen = t.day?.o || t.prevDay?.o || price;

const dVol = vol * vwap;



const [details, aggs, newsData, shortData] = await Promise.all([

fetchSafeJson(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${polygonApiKey}`, {}),

fetchSafeJson(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=350&apiKey=${polygonApiKey}`, { results: [] }),

fetchSafeJson(`https://api.polygon.io/v2/reference/news?ticker=${sym}&limit=5&apiKey=${polygonApiKey}`, { results: [] }),

fetchSafeJson(`https://api.polygon.io/stocks/v1/short-interest?ticker=${sym}&apiKey=${polygonApiKey}`, { results: [] })

]);



const rawBars = aggs.results || [];

const dailyBars = rawBars.sort((a: any, b: any) => b.t - a.t);



let avgVol = 0;

if (dailyBars.length > 0) {

let sumVol = 0;

let barCount = 0;

dailyBars.forEach((bar: any) => { if (bar.v) { sumVol += bar.v; barCount++; } });

avgVol = barCount > 0 ? sumVol / barCount : 0;

}

const rvol = (avgVol > 0 && vol > 0) ? (vol / avgVol) : null;



const setupMatched = detectPattern(dailyBars, price, currentOpen, vwap, rvol);


const marketCap = details?.results?.market_cap || 0;

const companyName = details?.results?.name || sym;



let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';

if (vwap > 0 && price > 0) vwapStatus = price >= vwap ? 'above' : 'below';



const float = details?.results?.share_class_shares_outstanding || (marketCap && price ? marketCap / price : null);

let shortPct = null;

if (shortData?.results && shortData.results.length > 0 && float) {

shortPct = (shortData.results[0].short_interest / float) * 100;

}



const apiSectorRaw = cleanSectorDescription(details?.results?.sic_description, details?.results?.sector, details?.results?.industry);

const deepSector = resolveEtfSector(sym, apiSectorRaw, companyName);



const newsList = newsData?.results || [];

let finalCatalystUrl = null;

let rawHeadline = null;

let formattedDateStr = '';



if (newsList.length > 0) {

const relatedNews = newsList.find((n: any) => ['benzinga', 'massive', 'yahoo', 'google'].some(p => (n.publisher?.name || '').toLowerCase().includes(p))) || newsList[0];

if (relatedNews) {

const pubDate = relatedNews.published_utc;

if (pubDate) {

const d = new Date(pubDate);

formattedDateStr = d.toDateString() === new Date().toDateString()

? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

: `${d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`;

}

rawHeadline = relatedNews.title;

finalCatalystUrl = relatedNews.article_url || null;

}

}


const recentTrend = dailyBars.slice(0, 5).map((b: any) => b.c);



return {

ticker: sym, name: companyName, sector: deepSector, price, vwapStatus, changePct: chgPct, vol, dVol, rvol: rvol ? parseFloat(rvol.toFixed(2)) : null,

float, shortPct, mktCap: marketCap, stage: setupMatched.stage, setupName: setupMatched.name, catalyst: rawHeadline || '-', catalystUrl: finalCatalystUrl,

_rawHeadline: rawHeadline, _catalystDate: formattedDateStr, _recentTrend: recentTrend

};

};



const enrichedList: any[] = [];

// Increased chunk size to parallelize more Polygon calls at once to save time

const chunkSize = 20;

for (let i = 0; i < uniqueCandidates.length; i += chunkSize) {

const chunk = uniqueCandidates.slice(i, i + chunkSize);

const results = await Promise.all(chunk.map(enrichCandidate));

enrichedList.push(...results.filter(item => item !== null));

}



// =========================================================================

// GEMINI AI SCORING (STRICTLY FILTERED TO ONLY SCORE DAILY & SIPS)

// =========================================================================

const geminiKey = process.env.GEMINI_API_KEY;

if (geminiKey) {

try {

const aiTargets = new Set([...dailyCandidates, ...sipCandidates].map(t => t.ticker));



const analysisMap = enrichedList

.filter((t: any) => aiTargets.has(t.ticker) && (t.setupName !== null || (t._rawHeadline && t._rawHeadline !== '-')))

.map((t: any) => `"${t.ticker}": { "Headline": "${(t._rawHeadline || '').replace(/"/g, '\\"')}", "MathPattern": "${t.setupName || 'None'}", "Stage": "${t.stage}", "RecentTrend_Last5Days": [${t._recentTrend.join(',')}] }`)

.join(',\n');


if (analysisMap.length > 0) {

const aiPrompt = `

You are an elite quantitative technical analyst.

I am providing a JSON map of stock setups. Each contains a recent news headline, a mathematically detected technical pattern (like BB Squeeze, Blue Dot, GLB), its structural market stage, and its closing prices over the last 5 days.


For EACH stock, evaluate the confluence of the news catalyst and the technical structure.


Return ONLY a valid JSON object where the keys are the tickers. For each ticker, provide:

1. "catalyst": A punchy 2-5 word summary of the headline. If there is no specific news, return "Technical Setup".

2. "conviction": A score from 1-100 rating the synergy of the setup.

3. "thesis": A brutal, 1-sentence institutional tape-reading thesis explaining why this is or isn't a high-probability setup.


Do not include markdown formatting like \`\`\`json.


Setups:

{

${analysisMap}

}

`;



const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {

method: 'POST',

headers: { 'Content-Type': 'application/json' },

body: JSON.stringify({

contents: [{ parts: [{ text: aiPrompt }] }],

generationConfig: { responseMimeType: "application/json", temperature: 0.1 }

})

});



if (aiRes.ok) {

const aiData = await aiRes.json();

if (aiData.candidates && aiData.candidates[0].content) {

let text = aiData.candidates[0].content.parts[0].text;

text = text.replace(/```json/gi, '').replace(/```/g, '').trim();

const confluenceDict = JSON.parse(text);


enrichedList.forEach((t: any) => {

if (confluenceDict[t.ticker]) {

const tag = confluenceDict[t.ticker].catalyst;

t.catalyst = t._catalystDate ? `${t._catalystDate} — ${tag}` : tag;

t.conviction = confluenceDict[t.ticker].conviction;

t.thesis = confluenceDict[t.ticker].thesis;

} else if (t._rawHeadline) {

t.catalyst = t._catalystDate ? `${t._catalystDate} — ${t._rawHeadline}` : t._rawHeadline;

}

});

}

}

} else {

enrichedList.forEach((t: any) => {

if (t._rawHeadline) t.catalyst = t._catalystDate ? `${t._catalystDate} — ${t._rawHeadline}` : t._rawHeadline;

});

}

} catch (e) {

console.error("Gemini Batch Confluence Scorer Failed:", e);

}

} else {

enrichedList.forEach((t: any) => {

if (t._rawHeadline) t.catalyst = t._catalystDate ? `${t._catalystDate} — ${t._rawHeadline}` : t._rawHeadline;

});

}



const enrichedMap = new Map();

enrichedList.forEach((item: any) => { enrichedMap.set(item.ticker, item); });



const finalDaily = dailyCandidates.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined && r.setupName !== null);

const finalSip = sipCandidates.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined);


const finalTopMovers = {

'Mega Caps': megaCapsRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined),

'Gainers': gainersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined),

'Losers': losersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined),

'ETF Gainers': etfGainersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined),

'ETF Losers': etfLosersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined)

};



await kv.set('daily_setups', finalDaily);

await kv.set('stocks_in_play', finalSip);

await kv.set('top_movers', finalTopMovers);

await kv.set('last_scan_time', Date.now());



return NextResponse.json({

success: true,

dailyCount: finalDaily.length,

sipCount: finalSip.length,

topMoversGenerated: true

});



} catch (error: any) {

return NextResponse.json({ error: error.message }, { status: 500 });

}

} 