import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300; 

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
  'HIMS': 'Healthcare', 'NVO': 'Healthcare', 'LLY': 'Healthcare', 'COO': 'Healthcare',
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
  'RDTL': 'RDDT - Comm Serv', 'RCAX': 'RCAT - Aerospace', 'SOUX': 'SOUN - AI', 
  'RKLB': 'RKLB - Aerospace', 'RKLX': 'RKLB - Aerospace', 
  'ASTS': 'ASTS - Aerospace', 'ASTX': 'ASTS - Aerospace',
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

const getMarketStatus = () => {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const time = hours + (minutes / 60);
  
  if (time >= 4 && time < 9.5) return 'Pre-Market';
  if (time >= 9.5 && time < 16) return 'Open';
  if (time >= 16 && time < 20) return 'Post-Market';
  return 'Closed';
};

const getUpdatePhase = (hour: number) => {
  if (hour >= 4 && hour < 11) return 'Morning';
  if (hour >= 11 && hour < 15) return 'Mid-Day';
  if (hour >= 15 && hour < 20) return 'Closing';
  return 'Offline';
};

const isSpamNews = (title: string) => {
  if (!title) return true;
  const lower = title.toLowerCase();
  const spamTriggers = [
    'lawsuit', 'class action', 'investigation', 'shareholder', 'investors alerted', 
    'pomerantz', 'rosen law', 'glancy', 'kaskela', 'bronstein', 'schall', 
    'johnson fistel', 'deadline', 'reminder', 'bragar', 'eagel', 'squire',
    'gross law', 'faruqi', 'portnoy', 'investors reminded', 'purchasers of'
  ];
  return spamTriggers.some(w => lower.includes(w));
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

      if (slope > 0.015 && currentPrice > sma150_now) {
        stage = `Stage 2A`; 
      } else if (slope < -0.015 && currentPrice < sma150_now) {
        stage = `Stage 4A`; 
      } else {
        if (sma150_20d > sma150_60d) {
          stage = `Stage 3A`; 
        } else {
          stage = `Stage 1A`; 
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

    const upperBB_25 = sma + (2.5 * stdDev);
    const lowerBB_25 = sma - (2.5 * stdDev);
    const upperBB_35 = sma + (3.5 * stdDev);
    const lowerBB_35 = sma - (3.5 * stdDev);

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

    return (upperBB_25 < upperKC && lowerBB_25 > lowerKC) || (upperBB_35 < upperKC && lowerBB_35 > lowerKC);
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

const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 20000) => {
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
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get('force') === 'true';

  const estNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = estNow.getHours();
  
  const currentPhase = getUpdatePhase(hour);
  const currentDate = estNow.toISOString().split('T')[0];
  const currentMarketStatus = getMarketStatus();
  
  if (!forceRefresh) {
    try {
      const cachedPhase = await kv.get<string>('update_phase_v6');
      const cachedDate = await kv.get<string>('update_date_v6');

      if (cachedPhase === currentPhase && cachedDate === currentDate) {
        const cachedDaily = await kv.get<any[]>('daily_setups_v6');
        const cachedSip = await kv.get<any[]>('stocks_in_play_v6');
        const cachedTopMovers = await kv.get<any>('top_movers_v6');
        const cachedMacro = await kv.get<any>('macro_insights_v6');
        const lastScanTime = await kv.get<number>('last_scan_time_v6');
        
        const isCacheValid = cachedTopMovers && cachedTopMovers['Gainers'] && cachedTopMovers['Gainers'].length > 0;

        if (cachedDaily && cachedSip && cachedTopMovers && isCacheValid) {
          return NextResponse.json({
            success: true,
            marketStatus: currentMarketStatus,
            lastScanTime: lastScanTime || Date.now(), 
            dailyCount: cachedDaily.length,
            sipCount: cachedSip.length,
            topMoversGenerated: true,
            topMovers: cachedTopMovers,
            macroInsights: cachedMacro,
            sips: cachedSip,
            dailySetups: cachedDaily,
            fromCache: true
          }, {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0',
            }
          });
        }
      }
    } catch (cacheErr) {
      console.error("Cache read failed, proceeding with fresh scan.", cacheErr);
    }
  }

  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
  if (!polygonApiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 500 });

  try {
    const MIN_VOLUME = 500000;
    const MIN_AVG_VOL = 2000000; 
    const MIN_MARKET_CAP = 20000000; 
    const MIN_CHANGE = 4.0;
    const MIN_PRICE = 1.00;

    let processedSnapshot: any[] = [];

    if (currentPhase === 'Offline') {
      const todayDate = new Date();
      const lookbackDate = new Date();
      lookbackDate.setDate(todayDate.getDate() - 10); 
      const toStr = todayDate.toISOString().split('T')[0];
      const fromStr = lookbackDate.toISOString().split('T')[0];

      const spyRes = await fetchSafeJson(`https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${fromStr}/${toStr}?adjusted=true&apiKey=${polygonApiKey}`, { results: [] });
      const spyBars = spyRes.results || [];
      
      if (spyBars.length < 2) {
        return NextResponse.json({ error: `Could not resolve valid market dates from benchmark. SPY bars returned: ${spyBars.length}` }, { status: 500 });
      }

      const targetDate = new Date(spyBars[spyBars.length - 1].t).toISOString().split('T')[0];
      const prevDate = new Date(spyBars[spyBars.length - 2].t).toISOString().split('T')[0];

      const [groupedRes, prevGroupedRes] = await Promise.all([
        fetchSafeJson(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${targetDate}?adjusted=true&apiKey=${polygonApiKey}`, { results: [] }, 20000),
        fetchSafeJson(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${prevDate}?adjusted=true&apiKey=${polygonApiKey}`, { results: [] }, 20000)
      ]);

      const rawResults = groupedRes.results || [];
      const prevResults = prevGroupedRes.results || [];

      if (rawResults.length === 0) return NextResponse.json({ error: `No historical data returned from Polygon for confirmed active date ${targetDate}` }, { status: 500 });

      const prevCloseMap = new Map();
      prevResults.forEach((t: any) => {
        prevCloseMap.set(t.T, t.c);
      });

      processedSnapshot = rawResults.map((t: any) => {
        const livePrice = t.c || 0;
        const vol = t.v || 0;
        const vwap = t.vw || livePrice;
        
        const prevClose = prevCloseMap.get(t.T) || t.o || livePrice;
        
        const liveChg = prevClose > 0 ? ((livePrice - prevClose) / prevClose) * 100 : 0;

        return {
          ticker: t.T,
          _livePrice: livePrice,
          _liveChg: liveChg,
          _liveVol: vol,
          _liveVwap: vwap,
          day: { o: t.o, c: t.c, h: t.h, l: t.l, v: t.v, vw: t.vw } 
        };
      });
    } else {
      const snapRes = await fetchSafeJson(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${polygonApiKey}`, { tickers: [] });
      const rawSnapshot = snapRes.tickers || [];
      if (rawSnapshot.length === 0) return NextResponse.json({ error: 'No snapshot data returned' }, { status: 500 });

      processedSnapshot = rawSnapshot.map((t: any) => {
        const livePrice = t.lastTrade?.p || t.min?.c || t.day?.c || t.prevDay?.c || 0;
        const prevClose = t.prevDay?.c || 0;
        const vol = t.day?.v || t.prevDay?.v || t.min?.v || 0;
        const vwap = t.day?.vw || t.prevDay?.vw || livePrice;

        let liveChg = 0;
        if (t.todaysChangePerc !== undefined && t.todaysChangePerc !== null && t.todaysChangePerc !== 0) {
          liveChg = t.todaysChangePerc;
        } else if (prevClose > 0 && livePrice > 0) {
          liveChg = ((livePrice - prevClose) / prevClose) * 100;
        }

        t._livePrice = livePrice;
        t._liveChg = Number.isNaN(liveChg) ? 0 : liveChg;
        t._liveVol = vol;
        t._liveVwap = vwap;

        return t;
      });
    }

    const viableSetups = processedSnapshot.filter((t: any) => t._livePrice >= MIN_PRICE && t._liveVol >= MIN_VOLUME);

    const dailyCandidates = [...viableSetups]
      .filter((t: any) => t._liveChg >= MIN_CHANGE)
      .sort((a: any, b: any) => (b._livePrice * b._liveVol) - (a._livePrice * a._liveVol))
      .slice(0, 30);
      
    const sipCandidates = [...viableSetups]
      .filter((t: any) => Math.abs(t._liveChg) >= MIN_CHANGE && t._livePrice >= t._liveVwap)
      .sort((a: any, b: any) => b._liveVol - a._liveVol)
      .slice(0, 40);

    const MEGA_CAP_TICKERS = new Set(['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'BRK.B', 'AVGO', 'LLY', 'JPM', 'XOM', 'UNH', 'V', 'PG', 'MA', 'JNJ', 'HD', 'AMD', 'NFLX', 'COST']);
    
    const megaCapsRaw = processedSnapshot.filter((t: any) => MEGA_CAP_TICKERS.has(t.ticker)).sort((a: any, b: any) => b._liveChg - a._liveChg).slice(0, 20);
    const knownEtfsRaw = viableSetups.filter((t: any) => ETF_TARGET_MAP[t.ticker]);
    const etfGainersRaw = [...knownEtfsRaw].sort((a: any, b: any) => b._liveChg - a._liveChg).slice(0, 20);
    const etfLosersRaw = [...knownEtfsRaw].sort((a: any, b: any) => a._liveChg - b._liveChg).slice(0, 20);
    
    const regularStocksRaw = viableSetups.filter((t: any) => !ETF_TARGET_MAP[t.ticker] && !MEGA_CAP_TICKERS.has(t.ticker));
    
    const gainersRaw = [...regularStocksRaw].filter((t: any) => t._liveChg >= MIN_CHANGE).sort((a: any, b: any) => b._liveChg - a._liveChg).slice(0, 40);
    const losersRaw = [...regularStocksRaw].sort((a: any, b: any) => a._liveChg - b._liveChg).slice(0, 40);

    const todayDate = new Date();
    const lookbackDate = new Date();
    lookbackDate.setDate(todayDate.getDate() - 400); 
    const toStr = todayDate.toISOString().split('T')[0];
    const fromStr = lookbackDate.toISOString().split('T')[0];

    const allCandidates = [...dailyCandidates, ...sipCandidates, ...megaCapsRaw, ...gainersRaw, ...losersRaw, ...etfGainersRaw, ...etfLosersRaw];
    const uniqueCandidates = Array.from(new Map(allCandidates.map(item => [item.ticker, item])).values());
    
    const enrichCandidate = async (t: any) => {
      const sym = t.ticker || t.single_ticker;
      const price = t._livePrice;
      const vol = t._liveVol;
      const chgPct = t._liveChg;
      const vwap = t._liveVwap;
      const currentOpen = t.day?.o || t.prevDay?.o || price;

      const [details, aggs, newsData, shortData] = await Promise.all([
        fetchSafeJson(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${polygonApiKey}`, {}),
        fetchSafeJson(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=350&apiKey=${polygonApiKey}`, { results: [] }),
        fetchSafeJson(`https://api.polygon.io/v2/reference/news?ticker=${sym}&limit=10&apiKey=${polygonApiKey}`, { results: [] }),
        fetchSafeJson(`https://api.polygon.io/stocks/v1/short-interest?ticker=${sym}&apiKey=${polygonApiKey}`, { results: [] })
      ]);

      const marketCap = details?.results?.market_cap || 0;
      if (marketCap > 0 && marketCap < MIN_MARKET_CAP) return null;

      const rawBars = aggs.results || [];
      const dailyBars = rawBars.sort((a: any, b: any) => b.t - a.t); 

      let avgVol = 0;
      let atr = 0;
      if (dailyBars.length > 0) {
        let sumVol = 0;
        let barCount = 0;
        let sumTR = 0;
        let trCount = 0;
        
        dailyBars.slice(0, 20).forEach((bar: any, index: number) => { 
          if (bar.v) { sumVol += bar.v; barCount++; }
          if (index < 14 && dailyBars[index+1]) {
            const high = bar.h;
            const low = bar.l;
            const prevClose = dailyBars[index+1].c;
            sumTR += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            trCount++;
          }
        });
        avgVol = barCount > 0 ? sumVol / barCount : 0;
        atr = trCount > 0 ? sumTR / trCount : 0;
      }
      
      const rvol = (avgVol > 0 && vol > 0) ? (vol / avgVol) : null;
      const setupMatched = detectPattern(dailyBars, price, currentOpen, vwap, rvol);
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

      const rawNewsList = newsData?.results || [];
      const validNewsList = rawNewsList.filter((n: any) => !isSpamNews(n.title));

      let finalCatalystUrl = null;
      let rawHeadline = null;
      let daysOld = 999;

      if (validNewsList.length > 0) {
        const relatedNews = validNewsList.find((n: any) => ['benzinga', 'massive', 'yahoo', 'google', 'pr newswire', 'globe newswire'].some(p => (n.publisher?.name || '').toLowerCase().includes(p))) || validNewsList[0];
        
        if (relatedNews && relatedNews.published_utc) {
          const pubDate = new Date(relatedNews.published_utc);
          const diffMs = todayDate.getTime() - pubDate.getTime();
          daysOld = diffMs / (1000 * 60 * 60 * 24); 
          
          if (daysOld <= 4) {
            rawHeadline = relatedNews.title;
            finalCatalystUrl = relatedNews.article_url || null;
          }
        }
      }
      
      return {
        ticker: sym, name: companyName, sector: deepSector, price, vwapStatus, changePct: chgPct, vol, avgVol, atr, dVol: vol * vwap, rvol: rvol ? parseFloat(rvol.toFixed(2)) : null,
        float, shortPct, mktCap: marketCap, stage: setupMatched.stage, setupName: setupMatched.name, catalystUrl: finalCatalystUrl,
        _rawHeadline: rawHeadline, _daysOld: daysOld
      };
    };

    const enrichedList: any[] = [];
    const chunkSize = 10; 
    for (let i = 0; i < uniqueCandidates.length; i += chunkSize) {
      const chunk = uniqueCandidates.slice(i, i + chunkSize);
      const results = await Promise.all(chunk.map(enrichCandidate));
      enrichedList.push(...results.filter(item => item !== null && item !== undefined));
      if (i + chunkSize < uniqueCandidates.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const geminiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    
    let aiErrorMessage: string | null = null;
    let confluenceDict: any = {};

    if (!geminiKey) {
        aiErrorMessage = "ERROR: Missing GEMINI_API_KEY in environment variables.";
        console.error(aiErrorMessage);
    } else {
      try {
        const topGainersString = gainersRaw.slice(0, 10).map((t: any) => `${t.ticker} (+${t._liveChg.toFixed(2)}%)`).join(', ');
        const topEtfsString = etfGainersRaw.slice(0, 10).map((t: any) => `${t.ticker} (+${t._liveChg.toFixed(2)}%)`).join(', ');
        const megasString = megaCapsRaw.slice(0, 5).map((t: any) => `${t.ticker} (${t._liveChg > 0 ? '+' : ''}${t._liveChg.toFixed(2)}%)`).join(', ');

        const aiTargets = new Set([
            ...dailyCandidates, 
            ...sipCandidates, 
            ...gainersRaw.slice(0, 15), 
            ...losersRaw.slice(0, 15)
        ].map(t => t.ticker));

        const analysisPayload: any = {};
        enrichedList.forEach((t: any) => {
            if ((aiTargets.has(t.ticker) || MEGA_CAP_TICKERS.has(t.ticker)) && t.vol >= MIN_VOLUME) {
                const safeHeadline = (t._rawHeadline || '').replace(/[^a-zA-Z0-9\s.,!?'-]/g, '').trim();
                analysisPayload[t.ticker] = {
                    Sector: t.sector || 'Unknown',
                    Today_Change: `${t.changePct > 0 ? '+' : ''}${t.changePct.toFixed(2)}%`,
                    Headline: safeHeadline,
                    MathPattern: t.setupName || 'None',
                    Stage: t.stage,
                    ATR: t.atr,
                    AvgVol: t.avgVol
                };
            }
        });
        const analysisMapString = JSON.stringify(analysisPayload, null, 2);
          
        const sipString = sipCandidates.map((t: any) => t.ticker).join(', ');
        const dailyString = dailyCandidates.map((t: any) => t.ticker).join(', ');

        const aiPrompt = `
          You are an elite quantitative technical analyst.
          
          MARKET CONTEXT:
          Mega Caps: ${megasString}
          Stocks In Play (SIPs): ${sipString}
          Daily Setups: ${dailyString}
          Top Gainers (Raw): ${topGainersString}
          Top ETFs/Thematics: ${topEtfsString}

          CRITICAL MANDATES:
          1. Evaluate and return structural objects for EVERY single ticker present in the payload. Do not skip any.
          2. Score each setup utilizing the "Stocks In Play" framework:
             - REASON: Does the Headline constitute a true catalyst?
             - PARTICIPATION: Are AvgVol > 2M and ATR > 1.0 driving range?
             - STRUCTURE: Is the MathPattern and Stage confluence clean on higher time frames?
          3. For the 'conviction' field, ASSIGN A NUMERICAL SCORE (integer 1-100) based on this framework.
          4. For the 'catalyst' field, summarize the Headline into a strict 1-3 word punchy category (e.g., "FDA Approval", "Earnings Beat"). If no news, strictly return "Technical Momentum".
          5. For the 'thesis' field, strictly write an ACTIONABLE, news-driven trade plan. DO NOT repeat the math pattern, indicator, or stage. Focus entirely on the reason (Catalyst) and tactical invalidation levels. Example: "Institutional buying triggered by FDA approval. Look for entry over $12.50 pre-market high, with an invalidation stop below $12.10 VWAP."
          6. For the 'watching' array, select 5 to 8 total symbols representing the highest confluence.
          
          BRIEFING INSTRUCTIONS:
          Your 'briefing' string must be an in-depth synthesis highlighting:
          - SIPs Thesis: Core drivers behind the high-relative-volume stocks.
          - Daily Setups Thesis: Structural context behind setups or breakouts.
          - Sector Flow: Capital allocation trends seen across categories.
          
          Use the exact labels "SIPs Thesis:", "Daily Setups Thesis:", and "Sector Flow:" inside the briefing text.

          PAYLOAD TO ANALYZE:
          ${analysisMapString}
        `;

        const responseSchema = {
          type: "OBJECT",
          properties: {
            macro: {
              type: "OBJECT",
              properties: {
                theme: { type: "STRING", description: "The dominant industry sector active today." },
                briefing: { type: "STRING", description: "Comprehensive tracking summary text matching instructions." },
                watching: { 
                  type: "ARRAY", 
                  items: { 
                    type: "OBJECT",
                    properties: {
                      symbol: { type: "STRING" },
                      score: { type: "INTEGER", description: "Confluence alignment score (pure integer from 1 to 100)." },
                      reason: { type: "STRING", description: "Direct setup trigger context." }
                    },
                    required: ["symbol", "score", "reason"]
                  } 
                }
              },
              required: ["theme", "briefing", "watching"]
            },
            tickers: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  symbol: { type: "STRING" },
                  catalyst: { type: "STRING", description: "Ultra-brief 1-3 word catalyst category. Default to 'Technical Momentum'." },
                  conviction: { type: "INTEGER", description: "Confluence alignment score (pure integer from 1 to 100)." },
                  thesis: { type: "STRING" }
                },
                required: ["symbol", "catalyst", "conviction", "thesis"]
              }
            }
          },
          required: ["macro", "tickers"]
        };

        // EXPLICIT FIX: Calling gemini-3.5-flash as shown in the documentation
        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: aiPrompt }] }],
            generationConfig: { 
              responseMimeType: "application/json", 
              responseSchema: responseSchema,
              temperature: 0.1 
            }
          })
        });

        if (!aiRes.ok) {
          const errorText = await aiRes.text();
          aiErrorMessage = `ERROR: Gemini API Rejected (${aiRes.status}) - ${errorText.substring(0, 40)}...`;
        } else {
          const aiData = await aiRes.json();
          if (aiData.candidates && aiData.candidates[0].content) {
            const text = aiData.candidates[0].content.parts[0].text;
            
            try {
              const parsed = JSON.parse(text);
              if (parsed.macro) {
                await kv.set('macro_insights_v6', parsed.macro);
              }
              if (parsed.tickers && Array.isArray(parsed.tickers)) {
                parsed.tickers.forEach((t: any) => {
                   confluenceDict[t.symbol] = t;
                });
              }
            } catch (parseErr: any) {
              aiErrorMessage = `ERROR: JSON Parsing Failed`;
            }
          }
        }
      } catch (e: any) {
        aiErrorMessage = `ERROR: AI Request Failed`;
      }
    }

    const enrichedMap = new Map();
    enrichedList.forEach((t: any) => { 
      if (confluenceDict[t.ticker]) {
        let tag = confluenceDict[t.ticker].catalyst;
        
        if (tag !== "Technical Momentum" && t._daysOld >= 1.5 && t._daysOld <= 4) {
           tag = `${tag} (Delayed)`; 
        } else if (tag === "Technical Momentum" || t._daysOld > 4) {
           tag = "Technical Momentum";
        }
        
        t.catalyst = tag;
        t.conviction = confluenceDict[t.ticker].conviction;
        t.thesis = confluenceDict[t.ticker].thesis;
      } else {
        if (t._rawHeadline && t._daysOld < 1.5) t.catalyst = "Recent News";
        else if (t._rawHeadline && t._daysOld >= 1.5 && t._daysOld <= 4) t.catalyst = "Delayed Reaction";
        else t.catalyst = 'Technical Momentum';
        
        t.thesis = aiErrorMessage ? aiErrorMessage : null;
      }
      enrichedMap.set(t.ticker, t); 
    });
    
    const finalSip = sipCandidates
      .map((t: any) => enrichedMap.get(t.ticker))
      .filter((r: any) => 
         r !== undefined && 
         r.vol >= MIN_VOLUME && 
         r.changePct >= MIN_CHANGE &&
         r.atr >= 1.0 && 
         r.avgVol >= MIN_AVG_VOL
      )
      .slice(0, 10);

    const finalDaily = dailyCandidates
      .map((t: any) => enrichedMap.get(t.ticker))
      .filter((r: any) => 
         r !== undefined && 
         r.vol >= MIN_VOLUME && 
         r.changePct >= MIN_CHANGE
      )
      .slice(0, 10);
    
    const finalTopMovers = {
      'Mega Caps': megaCapsRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined).slice(0, 10),
      'Gainers': gainersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined && r.vol >= MIN_VOLUME).slice(0, 10),
      'Losers': losersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined).slice(0, 10),
      'ETF Gainers': etfGainersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined).slice(0, 10),
      'ETF Losers': etfLosersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined).slice(0, 10)
    };

    const finalScanTime = Date.now();

    await kv.set('update_phase_v6', currentPhase);
    await kv.set('update_date_v6', currentDate);
    await kv.set('daily_setups_v6', finalDaily);
    await kv.set('stocks_in_play_v6', finalSip);
    await kv.set('top_movers_v6', finalTopMovers);
    await kv.set('last_scan_time_v6', finalScanTime);

    let macroInsights = null;
    try {
      macroInsights = await kv.get('macro_insights_v6');
    } catch(e) {}

    return NextResponse.json({ 
      success: true, 
      marketStatus: currentMarketStatus,
      lastScanTime: finalScanTime,
      dailyCount: finalDaily.length,
      sipCount: finalSip.length,
      topMoversGenerated: true,
      topMovers: finalTopMovers,
      macroInsights,
      sips: finalSip,            
      dailySetups: finalDaily,
      fromCache: false
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });

  } catch (error: any) {
    console.error("Scanner Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}