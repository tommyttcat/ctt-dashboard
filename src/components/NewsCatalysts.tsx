'use client';

import React, { useState, useEffect } from 'react';

// --- INTERFACES ---
interface NewsItem {
  id: string;
  ticker: string;
  companyName: string;
  sector: string;
  title: string;
  source: string;
  url: string;
  timeStr: string;
  publishedUtc: Date;
  tag: { label: string; color: string };
}

// --- CONSTANTS & MAPS ---
const SECTOR_MAP: Record<string, string> = {
  'AAPL': 'IT', 'MSFT': 'IT', 'SMCI': 'IT',
  'NVDA': "Semi's", 'AMD': "Semi's", 'INTC': "Semi's", 
  'AVGO': "Semi's", 'MU': "Semi's", 'ARM': "Semi's", 
  'QCOM': "Semi's", 'TSM': "Semi's", 'ALOT': 'IT',
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
  'RDTL': 'RDDT - Comm Serv', 'RKLX': 'RKLB - Aerospace', 'RCAX': 'RCAT - Aerospace', 'SOUX': 'SOUN - AI', 'ASTX': 'ASTS - Aerospace',
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

// --- HELPERS ---
const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 10000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) return fallback;
    return await res.json();
  } catch (error) {
    clearTimeout(id);
    return fallback;
  }
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

const resolveEtfSector = (sym: string, apiSector: string | undefined, apiName: string | undefined): string => {
  if (ETF_TARGET_MAP[sym]) return ETF_TARGET_MAP[sym];
  if (SECTOR_MAP[sym]) return SECTOR_MAP[sym]; 

  if (sym.length === 4) {
    const rootCandidate = sym.substring(0, 3) + 'S'; 
    if (SECTOR_MAP[rootCandidate]) {
       return `${rootCandidate} - ${SECTOR_MAP[rootCandidate]}`;
    }
  }

  const n = (apiName || '').toLowerCase();
  const isFund = n.includes(' etf') || n.includes('proshares') || n.includes('direxion') || n.includes('defiance') || n.includes('fund') || n.includes('trust');
  
  if (isFund) return `${sym} - ETF`;

  return apiSector || 'Financials';
};

// --- VISUAL BADGES ---
const getSectorBadgeStyles = (sector: string) => {
  if (sector === 'AI') return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
  if (sector === 'Nuclear' || sector === 'Solar') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (sector === "Semi's") return 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20';
  if (sector === 'Quantum' || sector === 'Cyber') return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
  if (sector === 'EV' || sector === 'Aerospace') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  if (sector === 'Fintech') return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
  if (sector === 'Biotech' || sector === 'Healthcare') return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  if (sector === 'Financials' || sector === 'IT' || sector === 'Energy') return 'bg-slate-700/50 text-slate-300 border-white/10';
  return 'bg-[#161c2a] text-slate-400 border-white/5';
};

const getCatalystTag = (site: string | undefined, title: string | undefined) => {
  const sStr = (site || '').toLowerCase();
  const tStr = (title || '').toLowerCase();
  const hasInsider = tStr.includes('form 4') || tStr.includes('insider');

  if (hasInsider) return { label: 'INSIDER BUY', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
  if (sStr.includes('analyst') || /upgrade|downgrade|price target/i.test(tStr)) return { label: 'ANALYST', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' };
  if (sStr.includes('earnings') || /earn|q[1-4]|revenue|eps/i.test(tStr)) return { label: 'EARNINGS', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
  if (sStr.includes('fda') || sStr.includes('biotech') || /fda|clinical|trial/i.test(tStr)) return { label: 'BIOTECH', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' };
  if (sStr.includes('m&a') || sStr.includes('merger') || /buyout|takeover/i.test(tStr)) return { label: 'M&A', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
  
  if (site) {
    const formattedSite = site.substring(0, 10).toUpperCase();
    return { label: formattedSite, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
  }

  return { label: '-', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' };
};

export default function NewsFeed() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState<string>('Offline');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || '';

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      second: '2-digit',
      timeZone: 'America/New_York' 
    });
  };

  useEffect(() => {
    let isMounted = true;
    if (!polygonApiKey) { setStatus('Offline'); return; }

    const fetchNewsFeed = async () => {
      try {
        if (isMounted && news.length === 0) setStatus('Scouting...');

        // CRITICAL: Massive API Endpoint Base Route
        const res = await fetch(`https://api.massive.com/v2/reference/news?limit=25&apiKey=${polygonApiKey}`);
        if (!res.ok) throw new Error('Network error');
        
        const data = await res.json();
        const results = data.results || [];

        if (results.length === 0) {
          if (isMounted) setStatus('No Valid Data Found');
          return;
        }

        const validNews = results
          .filter((item: any) => item.tickers && item.tickers.length > 0)
          .slice(0, 15);

        if (validNews.length === 0) return;

        if (isMounted) setStatus('Enriching Sectors...');

        const uniqueTickers = Array.from(new Set(validNews.map((item: any) => {
            let t = item.tickers[0];
            return typeof t === 'string' && t.includes(':') ? t.split(':')[1].toUpperCase() : t.toUpperCase();
        })));

        const profileDataMap = new Map();
        const profilePromises = uniqueTickers.map(async (sym: any) => {
            let details = null;
            try {
              // Isolated inside a separate try/catch safety net to completely absorb 404s on missing tickers
              details = await fetchSafeJson(`https://api.massive.com/v3/reference/tickers/${sym}?apiKey=${polygonApiKey}`, {});
            } catch (error) {
              console.warn(`Massive API skipped ticker ${sym} in News`);
            }
            profileDataMap.set(sym, details?.results || {});
        });
        
        await Promise.all(profilePromises);

        const processedNews: NewsItem[] = validNews.map((item: any) => {
            let ticker = item.tickers[0];
            if (typeof ticker === 'string' && ticker.includes(':')) ticker = ticker.split(':')[1].toUpperCase();
            else if (typeof ticker === 'string') ticker = ticker.toUpperCase();

            const profile = profileDataMap.get(ticker) || {};

            const apiSectorRaw = cleanSectorDescription(
                profile.sic_description, 
                profile.sector, 
                profile.industry
            );
            
            const companyName = profile.name || item.ticker_details?.find((d: any) => d.ticker === ticker)?.name || ticker;
            const deepSector = resolveEtfSector(ticker, apiSectorRaw, companyName);

            const pubDate = new Date(item.published_utc);
            const isToday = pubDate.toDateString() === new Date().toDateString();
            const timePart = pubDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
            const displayTime = isToday ? timePart : `${pubDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} ${timePart}`;

            const publisherName = item.publisher?.name || 'MASSIVE';
            const dynamicTag = getCatalystTag(publisherName, item.title);

            return {
              id: item.id,
              ticker: ticker,
              companyName: companyName,
              sector: deepSector,
              title: item.title,
              source: publisherName,
              url: item.article_url || '#',
              timeStr: displayTime,
              publishedUtc: pubDate,
              tag: dynamicTag
            };
        });

        if (isMounted) {
          setNews(processedNews);
          setLastUpdated(new Date());
          setStatus('Live');
        }
      } catch (error) {
        if (isMounted) setStatus('Offline');
      }
    };

    fetchNewsFeed();
    const interval = setInterval(fetchNewsFeed, 60000);
    return () => { isMounted = false; clearInterval(interval); };
  }, [polygonApiKey]);

  const getSessionTextColor = () => {
    const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = estDate.getDay();
    const hour = estDate.getHours();
    const min = estDate.getMinutes();
    const timeStr = hour + min / 60;

    if (day === 0 || day === 6) return 'text-slate-500';
    if (timeStr >= 4 && timeStr < 9.5) return 'text-amber-500';
    if (timeStr >= 9.5 && timeStr < 16) return 'text-[#00e676]';
    if (timeStr >= 16 && timeStr < 20) return 'text-indigo-400';
    return 'text-slate-500';
  };

  const displaySession = () => {
    const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = estDate.getDay();
    if (day === 0 || day === 6) return 'Closed';

    const hour = estDate.getHours();
    const min = estDate.getMinutes();
    const timeStr = hour + min / 60;

    if (timeStr >= 4 && timeStr < 9.5) return 'Pre-Market';
    if (timeStr >= 9.5 && timeStr < 16) return 'Open';
    if (timeStr >= 16 && timeStr < 20) return 'Post-Market';
    return 'Closed';
  };

  const isLoading = status.includes('Scouting') || status.includes('Enriching');

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-xl w-full">
      
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            NEWS FEED
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${status === 'Live' ? getSessionTextColor() : 'text-slate-500'}`}>
              {status === 'Live' ? displaySession() : status}
            </span>
          </div>
          {lastUpdated && (
             <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">
               Updated: {formatTime(lastUpdated)} EST
             </span>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="relative z-10 custom-scrollbar max-h-[600px] overflow-y-auto pr-2 divide-y divide-white/5" style={{ scrollbarWidth: 'none' }}>
          {isLoading && news.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3"></div>
              <span className="text-xs text-slate-500 font-medium">Connecting Catalyst Stream...</span>
            </div>
          ) : news.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm font-medium">
              No recent catalysts populated on current feed session.
            </div>
          ) : (
            news.map((item) => (
              <div key={item.id} className="py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 hover:bg-white/[0.01] px-2 rounded-xl transition-colors group">
                
                <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap">
                  
                  <div className="relative inline-flex items-center group/ticker">
                    <span className="inline-block bg-indigo-500/10 text-[#7c8bfa] text-[11px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 cursor-help w-14 text-center">
                      {item.ticker}
                    </span>
                    <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#1e293b] border border-white/10 text-slate-200 text-xs font-semibold tracking-wide rounded-md shadow-2xl opacity-0 invisible group-hover/ticker:opacity-100 group-hover/ticker:visible transition-all z-[60] whitespace-nowrap pointer-events-none">
                      {item.companyName}
                    </div>
                  </div>

                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide border whitespace-nowrap w-[88px] text-center truncate ${getSectorBadgeStyles(item.sector)}`} title={item.sector}>
                    {item.sector}
                  </span>

                  <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap w-[60px] text-right">
                    {item.timeStr}
                  </span>
                </div>

                <div className="min-w-0 flex-1 xl:pl-4">
                  <a 
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-slate-300 leading-snug group-hover:text-[#7c8bfa] transition-colors underline-offset-4 hover:underline block"
                  >
                    {item.title}
                  </a>
                </div>

                <div className="shrink-0 flex items-center xl:justify-end">
                  <span className={`text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded border uppercase ${item.tag.color}`}>
                    {item.tag.label}
                  </span>
                </div>

              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}