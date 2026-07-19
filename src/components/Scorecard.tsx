'use client';

import React, { useEffect, useState, useRef } from 'react';

// Unified Asset Dictionary
const MACRO_ASSETS = [
  { id: 'SPY', fmp: 'SPY', ws: 'SPY', name: 'S&P 500', type: 'stock' },
  { id: 'QQQ', fmp: 'QQQ', ws: 'QQQ', name: 'Nasdaq 100', type: 'stock' },
  { id: 'DIA', fmp: 'DIA', ws: 'DIA', name: 'Dow Jones', type: 'stock' },
  { id: 'IWM', fmp: 'IWM', ws: 'IWM', name: 'Russell 2000', type: 'stock' },
  { id: 'VIX', fmp: '^VIX', ws: 'VIX', name: 'VIX Index', type: 'stock' },
  { id: 'TLT', fmp: 'TLT', ws: 'TLT', name: '20Y Treasury', type: 'stock' },
  { id: 'GLD', fmp: 'GLD', ws: 'GLD', name: 'Gold ETF', type: 'stock' },
  { id: 'SLV', fmp: 'SLV', ws: 'SLV', name: 'Silver ETF', type: 'stock' },
  { id: 'USO', fmp: 'USO', ws: 'USO', name: 'Crude Oil', type: 'stock' },
  { id: 'BTC', fmp: 'BTCUSD', ws: 'BTC-USD', name: 'Bitcoin', type: 'crypto' },
  { id: 'ETH', fmp: 'ETHUSD', ws: 'ETH-USD', name: 'Ethereum', type: 'crypto' },
  { id: 'SOL', fmp: 'SOLUSD', ws: 'SOL-USD', name: 'Solana', type: 'crypto' }
];

interface TickData {
  price: number;
  baseline: number; 
  pct: number; 
  tickDirection: 'up' | 'down' | 'flat';
  synced: boolean;
  isExtended?: boolean;
}

interface BreadthData {
  score: number;
  signal: 'GREEN' | 'NEUTRAL' | 'RED';
  advancers: number;
  decliners: number;
  up4: number;
  down4: number;
}

type MarketSession = 'Pre-Market' | 'Open' | 'Post-Market' | 'Closed';

// --- HELPERS ---
const getMarketSession = (): MarketSession => {
  const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = estDate.getDay();
  const timeStr = estDate.getHours() + estDate.getMinutes() / 60;
  if (day === 0 || day === 6) return 'Closed';
  if (timeStr >= 4 && timeStr < 9.5) return 'Pre-Market';
  if (timeStr >= 9.5 && timeStr < 16) return 'Open';
  if (timeStr >= 16 && timeStr < 20) return 'Post-Market';
  return 'Closed'; 
};

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    second: '2-digit',
    timeZone: 'America/New_York' 
  });
};

// Builds a data-driven market-tone read straight from the live quotes and
// breadth internals — no AI call, so it costs nothing and updates every
// refresh with the actual numbers.
const buildToneNarrative = (
  q: Record<string, TickData>,
  breadth: BreadthData | null,
  session: MarketSession
): string => {
  const pct = (id: string): number | null => (q[id] && q[id].synced ? q[id].pct : null);
  const fmt = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  const spy = pct('SPY');
  const qqq = pct('QQQ');
  if (spy === null || qqq === null) return '';

  const names: Record<string, string> = { SPY: 'the S&P', QQQ: 'the Nasdaq', DIA: 'the Dow', IWM: 'small caps' };
  const idx = (['SPY', 'QQQ', 'DIA', 'IWM'])
    .map((id) => ({ id, v: pct(id) }))
    .filter((e): e is { id: string; v: number } => e.v !== null);

  const up = idx.filter((e) => e.v > 0.05).length;
  const down = idx.filter((e) => e.v < -0.05).length;

  // Session framing so a weekend/evening read is honest about what it describes.
  const lead =
    session === 'Closed' ? 'At the close, ' :
    session === 'Pre-Market' ? 'In pre-market trade, ' :
    session === 'Post-Market' ? 'In after-hours trade, ' : '';

  // Sentence 1 — leadership / direction with the actual index prints.
  let s1 = '';
  if (down === 0 && up >= 2) {
    s1 = `${lead}the major averages are broadly higher — S&P ${fmt(spy)}, Nasdaq ${fmt(qqq)} — with buyers in control across the board.`;
  } else if (up === 0 && down >= 2) {
    s1 = `${lead}the major averages are broadly lower — S&P ${fmt(spy)}, Nasdaq ${fmt(qqq)} — with sellers in control across the board.`;
  } else if (idx.length >= 2) {
    const leader = idx.reduce((a, b) => (b.v > a.v ? b : a));
    const laggard = idx.reduce((a, b) => (b.v < a.v ? b : a));
    s1 = `${lead}breadth is mixed — ${names[leader.id]} leads at ${fmt(leader.v)} while ${names[laggard.id]} lags at ${fmt(laggard.v)}, pointing to rotation rather than one clean direction.`;
  }
  if (s1) s1 = s1.charAt(0).toUpperCase() + s1.slice(1);

  // Sentence 2 — volatility, havens, risk appetite, with numbers attached.
  const vix = pct('VIX');
  const tlt = pct('TLT');
  const gld = pct('GLD');
  const btc = pct('BTC');
  const bits: string[] = [];
  if (vix !== null) {
    if (vix <= -2) bits.push(`the VIX is dropping sharply (${fmt(vix)}), a calming backdrop`);
    else if (vix < 0) bits.push(`the VIX is easing (${fmt(vix)})`);
    else if (vix >= 3) bits.push(`the VIX is spiking ${fmt(vix)}, flagging rising fear`);
    else if (vix > 0) bits.push(`the VIX is ticking higher (${fmt(vix)})`);
  }
  if (tlt !== null && gld !== null && tlt > 0.1 && gld > 0.1) {
    bits.push(`bonds (${fmt(tlt)}) and gold (${fmt(gld)}) are catching a defensive bid`);
  }
  if (btc !== null) {
    if (btc <= -2) bits.push(`Bitcoin ${fmt(btc)} shows risk appetite pulling back`);
    else if (btc >= 2) bits.push(`Bitcoin ${fmt(btc)} signals healthy risk appetite`);
  }

  let s2 = '';
  if (bits.length) {
    const joined = bits.slice(0, 2).join(', and ');
    s2 = joined.charAt(0).toUpperCase() + joined.slice(1) + '.';
  }

  // Sentence 3 — market internals from the GMI-style breadth feed.
  let s3 = '';
  if (breadth) {
    const ratio = breadth.decliners > 0 ? breadth.advancers / breadth.decliners : null;
    if (breadth.score >= 5) {
      s3 = `Under the surface the tape is strong: breadth ${breadth.score}/6 with ${breadth.advancers.toLocaleString()} advancers vs ${breadth.decliners.toLocaleString()} decliners — participation confirms the move.`;
    } else if (breadth.score <= 1) {
      s3 = `Under the surface the tape is weak: breadth ${breadth.score}/6 with ${breadth.decliners.toLocaleString()} decliners vs ${breadth.advancers.toLocaleString()} advancers — stay selective until internals repair.`;
    } else if (ratio !== null && ratio >= 1.5) {
      s3 = `Internals lean positive — ${breadth.advancers.toLocaleString()} advancers vs ${breadth.decliners.toLocaleString()} decliners (breadth ${breadth.score}/6).`;
    } else if (ratio !== null && ratio > 0 && ratio <= 0.67) {
      s3 = `Internals lean negative — ${breadth.decliners.toLocaleString()} decliners vs ${breadth.advancers.toLocaleString()} advancers (breadth ${breadth.score}/6).`;
    } else {
      s3 = `Internals are split — ${breadth.advancers.toLocaleString()} advancers vs ${breadth.decliners.toLocaleString()} decliners (breadth ${breadth.score}/6).`;
    }
    if (breadth.up4 >= 25) {
      s3 += ` ${breadth.up4} names up 4%+ — momentum is broad, not just index-level.`;
    } else if (breadth.down4 >= 25) {
      s3 += ` ${breadth.down4} names down 4%+ — the selling runs deeper than the indexes show.`;
    }
  }

  return [s1, s2, s3].filter(Boolean).join(' ');
};

/* ============================================================
   Tone narrative renderer — colors percents (VIX-aware),
   breadth scores, and advancer/decliner counts inline.
   ============================================================ */

const renderToneText = (text: string): React.ReactNode[] => {
  // Capture: VIX phrases w/ percent, signed percents, breadth n/6,
  // "N advancers/decliners", and "N names up/down 4%+"
  const rx = /((?:the )?VIX is [a-z ]+?\(?[+-]\d+(?:\.\d+)?%\)?|[+-]\d+(?:\.\d+)?%|breadth \d\/6|[\d,]+ advancers|[\d,]+ decliners|\d+ names (?:up|down) 4%\+)/g;
  const parts = text.split(rx);

  return parts.map((part, i) => {
    if (!part) return null;

    // VIX phrase — invert coloring: VIX up = red, VIX down = green
    const vixMatch = part.match(/^((?:the )?VIX is [a-z ]+?\(?)([+-]\d+(?:\.\d+)?%)(\)?)$/);
    if (vixMatch) {
      const v = parseFloat(vixMatch[2]);
      const cls = v > 0 ? 'text-rose-400' : 'text-emerald-400';
      return (
        <span key={i}>
          {vixMatch[1]}<span className={`font-bold tabular-nums ${cls}`}>{vixMatch[2]}</span>{vixMatch[3]}
        </span>
      );
    }

    // Signed percent — green/red
    if (/^[+]\d+(?:\.\d+)?%$/.test(part)) {
      return <span key={i} className="text-emerald-400 font-bold tabular-nums">{part}</span>;
    }
    if (/^-\d+(?:\.\d+)?%$/.test(part)) {
      return <span key={i} className="text-rose-400 font-bold tabular-nums">{part}</span>;
    }

    // breadth n/6 — green >=5, red <=1, amber between
    const bm = part.match(/^breadth (\d)\/6$/);
    if (bm) {
      const s = parseInt(bm[1], 10);
      const cls = s >= 5 ? 'text-emerald-400' : s <= 1 ? 'text-rose-400' : 'text-amber-400';
      return <span key={i}>breadth <span className={`font-bold tabular-nums ${cls}`}>{bm[1]}/6</span></span>;
    }

    // advancer/decliner counts
    const am = part.match(/^([\d,]+) advancers$/);
    if (am) {
      return <span key={i}><span className="text-emerald-400 font-bold tabular-nums">{am[1]}</span> advancers</span>;
    }
    const dm = part.match(/^([\d,]+) decliners$/);
    if (dm) {
      return <span key={i}><span className="text-rose-400 font-bold tabular-nums">{dm[1]}</span> decliners</span>;
    }

    // "N names up/down 4%+"
    const nm = part.match(/^(\d+) names (up|down) 4%\+$/);
    if (nm) {
      const cls = nm[2] === 'up' ? 'text-emerald-400' : 'text-rose-400';
      return <span key={i}><span className={`font-bold tabular-nums ${cls}`}>{nm[1]}</span> names {nm[2]} <span className={`font-bold ${cls}`}>4%+</span></span>;
    }

    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

export default function MacroScorecard() {
  const [quotes, setQuotes] = useState<Record<string, TickData>>({});
  const [stockStatus, setStockStatus] = useState<'CONNECTING' | 'LIVE' | 'ERROR' | 'AUTH_ERROR'>('CONNECTING');
  const [session, setSession] = useState<MarketSession>('Closed');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [riskMode, setRiskMode] = useState<'ON' | 'OFF'>('ON');
  const [marketTone, setMarketTone] = useState<'BULLISH' | 'NEUTRAL' | 'BEARISH'>('NEUTRAL');
  const [breadth, setBreadth] = useState<BreadthData | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const cryptoWs = useRef<WebSocket | null>(null);

  // --- ENGINE 1: AUTO-MACRO SENTIMENT ALGO ---
  useEffect(() => {
    if (!quotes['SPY'] || !quotes['QQQ'] || !quotes['VIX']) return;

    const getPct = (id: string) => quotes[id]?.pct || 0;

    // Equities are the PRIMARY tape signal. VIX only confirms/tempers — a normal
    // uptick in VIX on a green day must NOT flip the read bearish, which the old
    // -3.0 weight did (it could swamp SPY+QQQ entirely). So VIX is lightly
    // weighted and ignored inside a small dead-band; only a genuine spike/crush
    // moves tone. Crypto is a minor risk-appetite tell.
    const eqScore = (getPct('SPY') * 3.0) + (getPct('QQQ') * 2.5) + (getPct('IWM') * 1.0);
    const vixPct = getPct('VIX');
    const volScore = Math.abs(vixPct) > 2 ? (vixPct * -0.6) : 0;
    const cryptoScore = (getPct('BTC') * 0.25);

    // GMI-style market-internals breadth (0-6) as a co-driver: a strong/weak
    // tape under the surface should pull tone even when the index print is muted.
    // Maps 6 -> +1.5, 3 -> 0, 0 -> -1.5.
    const breadthAdj = breadth ? ((breadth.score - 3) / 3) * 1.5 : 0;

    const totalScore = eqScore + volScore + cryptoScore + breadthAdj;

    if (totalScore >= 1.0) {
      setMarketTone('BULLISH');
      setRiskMode('ON');
    } else if (totalScore <= -1.0) {
      setMarketTone('BEARISH');
      setRiskMode('OFF');
    } else {
      setMarketTone('NEUTRAL');
      setRiskMode(totalScore >= 0 ? 'ON' : 'OFF');
    }
  }, [quotes, breadth]);

  // --- ENGINE 2: SERVER-CACHED MACRO QUOTES ---
  // Reads /api/macro (KV-cached, ~1 FMP hit/min for ALL clients) instead of
  // calling FMP directly from every browser tab. Polls once a minute.
  useEffect(() => {
    let isMounted = true;

    const fetchMacro = async () => {
      try {
        const res = await fetch('/api/macro', { cache: 'no-store' });
        if (!res.ok) {
          if (isMounted) setStockStatus('ERROR');
          return;
        }
        const data = await res.json();
        if (!isMounted || !data || !data.quotes) return;

        setSession(getMarketSession());
        setLastUpdated(new Date());
        setStockStatus('LIVE');

        if (data.breadth && typeof data.breadth.score === 'number') setBreadth(data.breadth);

        setQuotes(prev => {
          const next = { ...prev };
          Object.entries<any>(data.quotes).forEach(([id, v]) => {
            const prevQuote = prev[id];
            let direction: 'up' | 'down' | 'flat' = prevQuote?.tickDirection || 'flat';
            if (prevQuote && v.price > prevQuote.price) direction = 'up';
            else if (prevQuote && v.price < prevQuote.price) direction = 'down';

            next[id] = {
              price: v.price,
              baseline: v.baseline,
              pct: v.pct,
              tickDirection: direction,
              synced: true,
              isExtended: v.isExtended
            };
          });
          return next;
        });
      } catch (err) {
        if (isMounted) setStockStatus('ERROR');
      }
    };

    fetchMacro();

    const pollingInterval = setInterval(() => {
      if (isMounted) fetchMacro();
    }, 60000);

    return () => {
      isMounted = false;
      clearInterval(pollingInterval);
    };
  }, []);

  // --- ENGINE 3: COINBASE WEBSOCKET (CRYPTO) ---
  useEffect(() => {
    let isMounted = true;
    const connectCoinbase = () => {
      if (cryptoWs.current && (cryptoWs.current.readyState === 0 || cryptoWs.current.readyState === 1)) return;

      const cWs = new WebSocket('wss://ws-feed.exchange.coinbase.com');
      cryptoWs.current = cWs;

      cWs.onopen = () => {
        if (!isMounted) return;
        const cryptoTickers = MACRO_ASSETS.filter(a => a.type === 'crypto').map(a => a.ws);
        cWs.send(JSON.stringify({
          type: 'subscribe',
          product_ids: cryptoTickers,
          channels: ['ticker']
        }));
      };
      
      cWs.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ticker' && msg.product_id && msg.price) {
            const asset = MACRO_ASSETS.find(a => a.ws === msg.product_id && a.type === 'crypto');
            const currentPrice = parseFloat(msg.price);
            
            if (asset && currentPrice > 0) {
              setQuotes(prev => {
                const prevQuote = prev[asset.id];
                
                const msgOpen = msg.open_24h ? parseFloat(msg.open_24h) : 0;
                const baseline = msgOpen > 0 ? msgOpen : (prevQuote?.baseline || currentPrice);
                
                const pct = baseline > 0 ? ((currentPrice - baseline) / baseline) * 100 : 0;

                let direction: 'up' | 'down' | 'flat' = prevQuote?.tickDirection || 'flat';
                if (prevQuote && currentPrice > prevQuote.price) direction = 'up';
                else if (prevQuote && currentPrice < prevQuote.price) direction = 'down';

                return { ...prev, [asset.id]: { price: currentPrice, baseline, pct, tickDirection: direction, synced: true } };
              });
            }
          }
        } catch (e) {}
      };
      
      cWs.onclose = () => {
        if (isMounted) {
          setTimeout(connectCoinbase, 3000);
        }
      };
    };

    connectCoinbase();

    return () => {
      isMounted = false;
      if (cryptoWs.current) {
        cryptoWs.current.onclose = null; 
        cryptoWs.current.close();
      }
    };
  }, []);

  const getSessionTextColor = () => {
    if (session === 'Pre-Market') return 'text-amber-500';
    if (session === 'Open') return 'text-[#00e676]';
    if (session === 'Post-Market') return 'text-indigo-400';
    return 'text-slate-500';
  };

  const getToneStyles = () => {
    if (marketTone === 'BULLISH') return { border: 'border-emerald-500/20', bg: 'bg-emerald-500/[0.04]', label: 'text-emerald-400', dot: 'bg-emerald-400' };
    if (marketTone === 'BEARISH') return { border: 'border-rose-500/20', bg: 'bg-rose-500/[0.04]', label: 'text-rose-400', dot: 'bg-rose-400' };
    return { border: 'border-amber-500/20', bg: 'bg-amber-500/[0.04]', label: 'text-amber-400', dot: 'bg-amber-400' };
  };

  const narrative = buildToneNarrative(quotes, breadth, session);
  const toneStyles = getToneStyles();

  // Advance/decline share for the internals bar (0-100)
  const adTotal = breadth ? breadth.advancers + breadth.decliners : 0;
  const advPct = breadth && adTotal > 0 ? (breadth.advancers / adTotal) * 100 : 50;

  return (
    <div className="bg-[#101623] border border-white/5 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-xl">
      
      <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

      {/* HEADER CONTAINER */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex justify-between items-center relative z-10 cursor-pointer group transition-all duration-200 ${isExpanded ? 'mb-6 border-b border-white/5 pb-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs md:text-sm font-bold text-[#7c8bfa] bg-[#161c2a]/40 border border-white/5 px-4 py-1.5 rounded-lg tracking-widest uppercase flex items-center gap-2 group-hover:bg-white/[0.02] transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
            MACRO SCORECARD
          </span>
        </div>

        <div className="hidden sm:flex absolute left-1/2 -translate-x-1/2 items-center gap-3">
          <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
              riskMode === 'ON' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}
          >
            RISK {riskMode}
          </div>
          <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
              marketTone === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
              marketTone === 'BEARISH' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
              'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}
          >
            TONE: {marketTone}
          </div>
          {breadth && (
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                breadth.signal === 'GREEN' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                breadth.signal === 'RED' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
              title={`Advancers ${breadth.advancers} / Decliners ${breadth.decliners} · +4%: ${breadth.up4} / -4%: ${breadth.down4}`}
            >
              BREADTH {breadth.score}/6
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center border border-white/5 bg-[#161c2a]/40 px-4 py-1.5 rounded-[10px] min-w-[120px]">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${stockStatus === 'LIVE' ? getSessionTextColor() : 'text-slate-500'}`}>
              {stockStatus === 'LIVE' ? session : stockStatus === 'CONNECTING' ? 'Scouting...' : 'Offline'}
            </span>
          </div>
          {lastUpdated && (
             <span className="text-[11px] text-slate-400/80 font-medium px-1 tracking-wide">
               Updated: {formatTime(lastUpdated)} EST
             </span>
          )}
        </div>
      </div>

      {/* COLLAPSIBLE CONTENT */}
      {isExpanded && (
        <>
          <div className="flex sm:hidden justify-center items-center gap-3 mb-6 relative z-10">
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                riskMode === 'ON' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              RISK {riskMode}
            </div>
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border shadow-sm ${
                marketTone === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                marketTone === 'BEARISH' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              TONE: {marketTone}
            </div>
          </div>

          {narrative && (
            <div className={`flex items-start gap-3 mb-4 border rounded-xl px-4 py-3 relative z-10 ${toneStyles.bg} ${toneStyles.border}`}>
              <span className={`flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase mt-1 shrink-0 ${toneStyles.label}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${toneStyles.dot}`}></span>
                Tone
              </span>
              <p className="text-[14px] leading-relaxed text-slate-200">{renderToneText(narrative)}</p>
            </div>
          )}

          {/* INTERNALS — advance/decline strip from the breadth feed */}
          {breadth && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 mb-6 border border-white/5 bg-[#161c2a]/40 rounded-xl px-4 py-3 relative z-10">
              <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase text-slate-500 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c8bfa]"></span>
                Internals
              </span>

              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-[11px] font-bold text-emerald-400 tabular-nums whitespace-nowrap">
                  ADV {breadth.advancers.toLocaleString()}
                </span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-rose-500/30 min-w-[60px]" title={`${advPct.toFixed(0)}% of movers advancing`}>
                  <div
                    className="h-full bg-emerald-400/80 rounded-full transition-all duration-500"
                    style={{ width: `${advPct}%` }}
                  ></div>
                </div>
                <span className="text-[11px] font-bold text-rose-400 tabular-nums whitespace-nowrap">
                  DEC {breadth.decliners.toLocaleString()}
                </span>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <span className="flex items-center gap-1.5 whitespace-nowrap" title="Names up 4%+ today">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">+4%:</span>
                  <span className="text-[11px] font-bold text-emerald-400 tabular-nums">{breadth.up4}</span>
                </span>
                <span className="flex items-center gap-1.5 whitespace-nowrap" title="Names down 4%+ today">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">-4%:</span>
                  <span className="text-[11px] font-bold text-rose-400 tabular-nums">{breadth.down4}</span>
                </span>
                <span className="flex items-center gap-1.5 whitespace-nowrap" title="A/D ratio">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500">A/D:</span>
                  <span className={`text-[11px] font-bold tabular-nums ${breadth.decliners > 0 && breadth.advancers / breadth.decliners >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {breadth.decliners > 0 ? (breadth.advancers / breadth.decliners).toFixed(2) : '—'}
                  </span>
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 relative z-10">
            {MACRO_ASSETS.map((asset) => {
              const q = quotes[asset.id];
              
              if (!q || !q.synced || q.price === 0) {
                return (
                  <div key={asset.id} className="bg-[#161c2a]/60 border border-white/5 rounded-xl p-4 flex flex-col justify-between h-24 opacity-60">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-bold text-slate-300">{asset.id}</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{asset.name}</span>
                    </div>
                    <div className="flex flex-col mt-2">
                      <span className="text-sm font-medium text-slate-500 animate-pulse">Syncing...</span>
                    </div>
                  </div>
                );
              }

              const pct = q.pct || 0;
              const isMathPositive = pct >= 0;
              
              // Invert VIX color logic: Drop = Green (Bullish), Spike = Red (Bearish)
              const isBullish = asset.id === 'VIX' ? pct <= 0 : pct >= 0;
              
              const cardBg = isBullish ? 'bg-emerald-950/10' : 'bg-rose-950/10';
              const cardBorder = isBullish ? 'border-emerald-500/20' : 'border-rose-500/20';
              
              let tickColor = 'text-slate-100';
              if (q.tickDirection === 'up') {
                tickColor = asset.id === 'VIX' ? 'text-rose-300' : 'text-emerald-300';
              } else if (q.tickDirection === 'down') {
                tickColor = asset.id === 'VIX' ? 'text-emerald-300' : 'text-rose-300';
              }

              return (
                <div key={asset.id} className={`rounded-xl p-4 flex flex-col justify-between h-24 transition-colors duration-300 border ${cardBg} ${cardBorder} hover:bg-white/[0.02] shadow-sm`}>
                  
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-200">{asset.id}</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 truncate max-w-[90px]">
                        {asset.name}
                      </span>
                    </div>
                    
                    <div className="flex flex-col items-end">
                      <span className={`text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded ${isBullish ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        {isMathPositive ? '+' : ''}{pct.toFixed(2)}%
                      </span>
                      {q.isExtended && (
                        <span className="text-[8px] font-bold text-amber-500/80 tracking-wider mt-1 uppercase">
                          {session === 'Pre-Market' ? 'PRE' : 'POST'}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-start mt-2">
                    <span className={`text-2xl font-semibold tracking-tight transition-colors duration-200 ${tickColor}`}>
                      {asset.type === 'crypto' && q.price > 100 ? q.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : q.price.toFixed(2)}
                    </span>
                  </div>

                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}