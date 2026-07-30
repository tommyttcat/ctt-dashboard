// src/app/api/scanner/run/route.ts — v6.11
// v6.1: + RMV(15); thesis is news-headline-only (stats moved to t.readout)
// v6.2: RMV/RME imported from lib/indicators; RME(21) replaces the binary
//       `extended` penalty in CNF; + cnfBreakdown for the badge tooltip
// v6.3: Weinstein sub-stages (2A/2B/2C etc) via lib/indicators/stage
// v6.4: + Money Flow (21) — accumulation vs distribution
// v6.5: + daysToCover (short interest / avg volume) — replaces SHT%
// v6.6: thresholds moved to lib/scanConfig and shipped in the payload
// v6.7: GET is a thin wrapper; ?bg=true runs the scan in the background
// v6.8: macro_insights_v6 gated on freshness; WIIM batch 50 -> 15; Polygon
//       news limit 10 -> 50; newest-article selection; earnings calendar
//       promoted to a catalyst source
// v6.9: deterministic macro briefing (buildMacroBriefing)
// v6.10: + distToEma10 on every enriched row. The 10 EMA was already computed
//        for the aboveEma10 boolean; the distance itself was discarded, which
//        left every downstream consumer unable to identify a first-touch
//        pullback (under the 10, still holding the 21) — the highest-quality
//        Dr. Wish entry. Emitting the number costs nothing.
// v6.11: three fixes.
//        (a) SPAM FILTER. Substring matching on 'rosen law' missed the actual
//            wire format ("ROSEN, A TOP RANKED LAW FIRM, Encourages..."), and
//            'investigation' missed "is Investigating". Rebuilt as two regexes
//            — firm names and solicitation boilerplate — so a firm not on the
//            list still gets caught by its own language. Also drops Form 8.3 /
//            8.5 regulatory filings, which are procedural, not catalysts.
//        (b) STRUCTURAL CEILING ON CNF. A name in Stage 4 with a dead 50/200
//            could grade A on tape components alone — RVOL + gap + range
//            expansion sum to 70 before any penalty, and the RME extension
//            adjustment bottoms out at -12. A 37% gap in a name 79% off its
//            highs is a dead-cat bounce, not an A setup. Grade is now capped
//            by trend structure regardless of how loud the session is.
//        (c) detectPattern returns stageNum alongside the label, so the
//            ceiling can compare a number instead of parsing 'Stage 4B'.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { computeRMV } from '@/lib/indicators/rmv';
import { computeRMEDetail, rmeScoreAdjustment } from '@/lib/indicators/rme';
import { computeStageDetail } from '@/lib/indicators/stage';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { SCANNER, SCANNER_SIP_META, SCANNER_DAILY_META, TOPMOVERS_META } from '@/lib/scanConfig';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
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
  'LUNR': 'Aerospace', 'ASTS': 'Aerospace', 'RKLB': 'Aerospace', 'SPCX': 'Aerospace',
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
  'CONL': 'COIN - Fintech', 'CONZ': 'COIN - Fintech', 'COND': 'COIN - Fintech', 'CONX': 'COIN - Fintech',
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
  'RVNL': 'RIVN - EV', 'LCDL': 'LCID - EV', 'INTW': "INTC - Semi's",
  'GMEU': 'GME - Con Disc', 'APPX': 'APP - IT',
  'IONX': 'IONQ - IT', 'IONZ': 'IONQ - IT', 'QPUX': 'IONQ - IT', 'CEGX': 'CEG - Nuclear',
  'ASMG': "ASML - Semi's", 'UUUG': 'U - IT', 'FBL': 'META - Comm Serv', 'HIMZ': 'HIMS - Healthcare',
  'RDTL': 'RDDT - Comm Serv', 'RCAX': 'RCAT - Aerospace', 'SOUX': 'SOUN - AI',
  'RKLB': 'RKLB - Aerospace', 'RKLX': 'RKLB - Aerospace',
  'ASTS': 'ASTS - Aerospace', 'ASTX': "AXTI - Semi's",
  'SPCF': 'SPCX - Aerospace 2X', 'SSPC': 'SPCX - Aerospace -2X', 'SPCH': 'SPCX - Aerospace 2X',
  'RGTX': 'RGTI - IT', 'RGTU': 'RGTI - IT', 'RGTZ': 'RGTI - IT',
  'TQQQ': 'QQQ - Nasdaq 3X', 'SQQQ': 'QQQ - Nasdaq -3X', 'QID': 'QQQ - Nasdaq -2X', 'QLD': 'QQQ - Nasdaq 2X', 'SNDQ': 'QQQ - Nasdaq ETF',
  'SOXL': "SOXX - Semi's 3X", 'SOXS': "SOXX - Semi's -3X", 'TECL': 'XLK - Tech 3X', 'TECS': 'XLK - Tech -3X',
  'FNGU': 'FNGU - Big Tech 3X', 'FNGD': 'FNGD - Big Tech -3X',
  'TNA': 'IWM - Small Cap 3X', 'TZA': 'IWM - Small Cap -3X', 'FAS': 'XLF - Financials 3X', 'FAZ': 'XLF - Financials -3X',
  'SPY': 'SPY - S&P 500', 'UPRO': 'SPY - S&P 3X', 'SPXL': 'SPY - S&P 3X', 'SPXS': 'SPY - S&P -3X', 'SPXU': 'SPY - S&P -3X',
  'UVXY': 'VIX - Volatility 1.5X', 'UVIX': 'VIX - Volatility 2X', 'SVIX': 'VIX - Volatility -1X', 'VIXY': 'VIX - Volatility',
  'MSOX': 'MSOS - Cannabis 2X', 'NAIL': 'XHB - Homebuilders 3X', 'LABX': 'XBI - Biotech 2X', 'KORU': 'EWY - South Korea 3X',
  'ZSL': 'SLV - Silver -2X', 'URAA': 'URA - Uranium 2X', 'GDXD': 'GDX - Gold Miners -3X',
  'QQQ': 'QQQ - Nasdaq', 'IWM': 'IWM - Small Cap', 'DIA': 'DIA - Dow Jones', 'VOO': 'VOO - S&P 500', 'VTI': 'VTI - Total Market',

  // --- CORRECTIONS (previously mismapped) ---
  'SNXX': "SNDK - Semi's",
  'AXTX': "AXTI - Semi's",
  'CRDU': "CRDO - Semi's",
  'AAOX': "AAOI - Semi's",
  // NOTE: 'CRWV' removed — CoreWeave is common stock, not an ETF

  // --- ASTS leveraged family ---
  'ASTY': 'ASTS - Aerospace', 'ASUP': 'ASTS - Aerospace', 'ASTG': 'ASTS - Aerospace',
  // --- SK Hynix leveraged family ---
  'HYNX': "SKHY - Semi's", 'SKUU': "SKHY - Semi's", 'SKHL': "SKHY - Semi's",
  'SK': "SKHY - Semi's", 'SKHU': "SKHY - Semi's", 'SKHX': "SKHY - Semi's",
  // --- SanDisk (SNDK) ---
  'SNDU': "SNDK - Semi's", 'SNDG': "SNDK - Semi's", 'SNDC': "SNDK - Semi's",
  // --- Seagate (STX) ---
  'STXL': "STX - Semi's", 'STXX': "STX - Semi's", 'STXU': "STX - Semi's",
  // --- AXT Inc (AXTI) ---
  'AXTU': "AXTI - Semi's", 'AXTL': "AXTI - Semi's",
  // --- Memory / DRAM theme ---
  'DRAM': 'DRAM - Memory ETF', 'RAM': 'DRAM - Memory 2X', 'DRAL': 'DRAM - Memory 2X', 'KMEM': 'KMEM - Memory ETF',
  // --- Micron (MU) ---
  'MUU': "MU - Semi's", 'MULL': "MU - Semi's", 'MIC': "MU - Semi's",
  // --- WDC / LITE / SMTC / COHR / AMAT / MRVL / ARM / FN / CLS / AAOI ---
  'WDCX': "WDC - Semi's", 'LITU': "LITE - Semi's", 'LITX': "LITE - Semi's",
  'SMTG': "SMTC - Semi's", 'COHX': "COHR - Semi's", 'COHH': "COHR - Semi's",
  'AMA': "AMAT - Semi's", 'MVLL': "MRVL - Semi's", 'MRVU': "MRVL - Semi's",
  'ARMG': "ARM - Semi's", 'ARMW': "ARM - Semi's", 'FNG': "FN - Semi's",
  'CSEX': 'CLS - IT', 'AAOG': "AAOI - Semi's",
  // --- Nebius (NBIS) / CoreWeave (CRWV) leveraged ---
  'NEBX': 'NBIS - AI', 'NBIG': 'NBIS - AI', 'NBIL': 'NBIS - AI',
  'CWVX': 'CRWV - AI', 'CRWX': 'CRWV - AI',
  // --- Energy / power / nuclear ---
  'BEX': 'BE - Energy', 'BEG': 'BE - Energy', 'EOSU': 'EOSE - Energy',
  'PLUL': 'PLUG - Energy', 'GEVG': 'GEV - Energy', 'GEVX': 'GEV - Energy',
  'LEUX': 'LEU - Nuclear', 'LACG': 'LAC - Lithium',
  'UCO': 'USO - Crude Oil 2X', 'UGA': 'UGA - Gasoline', 'WTIU': 'WTIU - Energy 3X',
  // --- Aerospace / space / drones ---
  'PLU': 'PL - Aerospace', 'UMAL': 'UMAC - Aerospace', 'RDWU': 'RDW - Aerospace',
  // --- Big-name single-stock leveraged ---
  'NFLW': 'NFLX - Comm Serv', 'CSCL': 'CSCO - IT', 'ORCX': 'ORCL - IT', 'ORCU': 'ORCL - IT',
  'PALU': 'PANW - Cyber', 'PANG': 'PANW - Cyber', 'NETG': 'NET - IT',
  'UNHG': 'UNH - Healthcare', 'CATG': 'CAT - Industrials', 'DUOG': 'DUOL - IT',
  'FIGG': 'FIG - IT', 'LMNX': 'LMND - Fintech', 'HUTG': 'HUT - Fintech',
  'BMNG': 'BMNR - Fintech', 'LNOK': 'NOK - IT', 'QUBX': 'QUBT - IT',
  'ECHX': 'ECHO - IT', 'INFH': 'INFQ - IT', 'WYFL': 'WYFI - IT',
  'KEEX': 'KEEL - Industrials', 'VELL': 'VELO - Industrials',
  // --- Sector / index / country ---
  'LABU': 'XBI - Biotech 3X', 'PILL': 'PILL - Pharma 2X',
  'EZJ': 'EWJ - Japan 2X', 'EWY': 'EWY - South Korea', 'FLKR': 'FLKR - South Korea',
  'FOTO': 'FOTO - Photonics ETF'
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

// YYYY-MM-DD in Eastern time.
const etDateString = (d: Date): string =>
  d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// --- Promotional / procedural news suppression -------------------------------
// v6.11. The old implementation was a substring list, and the wire format
// beat it. Three headlines from the 7/30 feed, all tagged High impact, all of
// which passed the old filter:
//
//   "ROSEN, A TOP RANKED LAW FIRM, Encourages Intuit Inc. Investors to
//    Secure Counsel..."          -> list had 'rosen law', not present here
//   "Halper Sadeh LLC is Investigating Whether FNWD and PSNL..."
//                                -> list had 'investigation', text says
//                                   'Investigating'
//   "Alert: Capricor Therapeutics... Investors Urged to Contact Hagens..."
//                                -> list had 'investors alerted' and
//                                   'investors reminded', not 'urged'
//
// Two passes now. Firm names catch the known blasters; the boilerplate pass
// catches the language itself, so a firm we have never enumerated is still
// suppressed by how it writes. Stemmed where the old list was literal.
const LAW_FIRM_NAMES = /\b(rosen|pomerantz|glancy|kaskela|bronstein|schall|johnson\s*fistel|bragar|eagel|squire|gross\s*law|faruqi|portnoy|block\s*&?\s*leviton|hagens\s*berman|halper\s*sadeh|levi\s*&?\s*korsinsky|robbins\s*geller|kessler\s*topaz|monteverde|wolf\s*haldenstein|berger\s*montague|scott\s*\+?\s*scott|kahn\s*swick|kirby\s*mcinerney|labaton|bernstein\s*liebhard|howard\s*g\.?\s*smith|kuehn\s*law|grabar|rigrodsky|weiss\s*law|ademi|federman|shall\s*law)\b/i;

const LEGAL_BOILERPLATE = /(class\s*action|securities\s*fraud|shareholder\s*(alert|rights|investigation|deadline)|investors?\s+(are\s+)?(urged|encouraged|reminded|alerted|notified|advised|who\s+lost)|secure\s+counsel|contact\s+the\s+firm|lead\s+plaintiff|investigat(e|es|ed|ing|ion|ions)\s+(whether|on\s+behalf|claims|potential|possible)|important\s+deadline|deadline:|purchasers?\s+of\s+|law\s*firm|law\s*offices|is\s+investigating)/i;

// Regulatory disclosure filings. High-impact by tag, procedural in substance —
// a Form 8.5 position disclosure has never once been the reason a stock moved.
const FILING_BOILERPLATE = /(form\s*8\.[35]\s*\(|notification\s+of\s+(major\s+)?holdings|total\s+voting\s+rights|resolutions?\s+passed\s+by|transaction\s+in\s+own\s+shares|block\s+listing\s+(six|interim)|director\/pdmr\s+shareholding)/i;

const isSpamNews = (title: string): boolean => {
  if (!title) return true;
  return LAW_FIRM_NAMES.test(title) ||
         LEGAL_BOILERPLATE.test(title) ||
         FILING_BOILERPLATE.test(title);
};

// Dilution / distress headlines — these gaps are traps, not catalysts.
const isNegativeHeadline = (title: string | null | undefined): boolean => {
  if (!title) return false;
  const s = title.toLowerCase();
  return /offering|dilut|reverse split|reverse stock split|going concern|delist|bankrupt|chapter 11|at-the-market|atm program|warrant exercise|registered direct|shelf registration/.test(s);
};

// Inverse / bear / long-volatility instruments. Detected from the fund NAME
// rather than the sector map, because single-stock inverse ETFs (NVD, NVDQ)
// map to the same sector string as their long counterparts.
const isBearishInstrument = (name: string | null | undefined): boolean => {
  if (!name) return false;
  return /\bbear\b|\bshort\b|\binverse\b|ultrashort|\-1x\b/i.test(name);
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
    return 'ETF';
  }
  return apiSector || 'Other';
};

const cleanSectorDescription = (sic: string | undefined, sector: string | undefined, industry: string | undefined) => {
  const ind = (industry || '').toLowerCase();
  const sicTxt = (sic || '').toLowerCase();
  const blob = `${ind} ${sicTxt}`;

  if (/nuclear|uranium/.test(blob)) return 'Nuclear';
  if (/solar|photovoltaic/.test(blob)) return 'Solar';
  if (/electric vehicle|auto manufacturer|motor vehicle|passenger car/.test(blob)) return 'EV';
  if (/biotechnolog|biological product|in vitro|medicinal chem/.test(blob)) return 'Biotech';
  if (/semiconductor/.test(blob)) return "Semi's";
  if (/artificial intelligence/.test(blob)) return 'AI';
  if (/cybersecurity|security software/.test(blob)) return 'Cyber';
  if (/fintech|financial technology/.test(blob)) return 'Fintech';
  if (/aerospace|\bdefense\b|aircraft|guided missile|space vehicle/.test(blob)) return 'Aerospace';

  if (sicTxt) {
    if (/software|prepackaged|computer program|data processing|information retrieval|computer integrated|computer communication|electronic computer|computer peripheral|computer storage|computer terminal|electronic component|printed circuit/.test(sicTxt)) return 'IT';
    if (/pharmaceutical|drug|medicinal|surgical|\bmedical\b|\bhealth\b|dental|hospital|diagnostic|laborator/.test(sicTxt)) return 'Healthcare';
    if (/crude petroleum|natural gas|petroleum|drilling|\boil\b|\bcoal\b|\benergy\b/.test(sicTxt)) return 'Energy';
    if (/\bbank\b|savings instit|credit institution|insurance|investment office|securities broker|security broker|personal credit|holding compan|fire, marine/.test(sicTxt)) return 'Financials';
    if (/real estate|land subdivid|operators of apartment|operators of nonresident/.test(sicTxt)) return 'Real Estate';
    if (/electric services|gas & other|water supply|cogeneration|electric & other services/.test(sicTxt)) return 'Utilities';
    if (/telephone|telecommunic|radio|television|broadcast|cable|motion picture|advertising|publishing|newspaper|periodical|entertainment/.test(sicTxt)) return 'Comm Serv';
    if (/retail|catalog|mail-order|eating place|restaurant|apparel|footwear|hotel|department store|grocery|variety store|jewelry/.test(sicTxt)) return 'Con Disc';
    if (/beverage|\bfood\b|tobacco|soap|cosmetic|household|dairy|bakery/.test(sicTxt)) return 'Con Staples';
    if (/gold mining|metal mining|steel|aluminum|chemical|industrial inorganic|plastics material|paper mill|fertilizer|\bmining\b/.test(sicTxt)) return 'Materials';
    if (/aircraft|machinery|industrial|construction|engineering|electrical industrial|transportation|railroad|trucking|air transport/.test(sicTxt)) return 'Industrials';
  }

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

  return 'Other';
};

const deriveTradeType = (setupName: string | null | undefined): string => {
  if (!setupName) return '';
  const s = setupName.toLowerCase();
  if (s === 'none' || s === '—') return '';
  if (s.includes('gap & go') || s.includes('r2g') || s.includes('sqz fired') || s.includes('episodic')) return 'Day Trade';
  if (s.includes('glb') || s.includes('vcp') || s.includes('ema pb') || s.includes('trend hold') ||
      s.includes('inside day') || s.includes('blue dot') || s.includes('sqz building')) return 'Swing';
  return 'Swing';
};

// Setup family classification — used by the regime gate, the RME penalty, and
// the briefing's leadership read, so a name is treated consistently by each.
const isReversalSetupName = (setupName: string | null | undefined): boolean =>
  /blue dot|ema pb|sqz building|inside day/.test((setupName || '').toLowerCase());

const isBreakoutSetupName = (setupName: string | null | undefined): boolean =>
  /gap & go|r2g|sqz fired|episodic|glb/.test((setupName || '').toLowerCase());

// --- CNF "Confluence" score ---------------------------------------------------
// THE unified score for the dashboard (written into `conviction`).
// Fully deterministic — built from RVOL, gap, range expansion, relative
// strength, extension, and catalyst presence. No AI involved.
//
// NOTE: Money Flow is deliberately NOT scored here. It's shipped as a column
// so you can see it, but folding it into CNF would double-count against RVOL
// and gap, which already reward the same volume event from a different angle.
//
// v6.11 adds a STRUCTURAL CEILING after the additive pass. The components
// measure today — how loud, how fast, how much volume — and they sum to 70
// before a single penalty applies (rvol 30 + gap 20 + rangeExpansion 20).
// The only structural counterweight was the RME extension adjustment, which
// bottoms out at -12. That is not enough to stop a violent bounce in a dead
// name from grading A: a 37% gap on RVOL 2.7 scored 72 while sitting 79% off
// its highs in Stage 4B with the 50 under the 200.
//
// The ceiling does not subtract points, it caps the grade. A loud day in a
// broken structure is still worth SEEING — it is just not an A setup, and the
// grade is what drives position sizing.
const computeCnfScore = (
  rvol: number | null,
  gapPct: number | null,
  atrExpansion: number | null,
  rsVsMkt: number | null,
  q: {
    catalystTier: 'strong' | 'neutral' | 'headline' | 'negative' | 'none';
    hasEarnings: boolean;
    scanStreak: number;
    rme: number | null;
    vwapStatus: string;
    tradeType: string;
    setupName: string | null;
    breadthSignal: string;
    spyAbove21: boolean | null;
    inHotSector: boolean;
    stageNum: number | null;
    goldenCross: boolean | null;
    pctOffHigh: number | null;
  }
): { score: number; grade: string; breakdown: Record<string, number>; ceiling: number } => {
  const b: Record<string, number> = {};

  // --- Core tape components ---
  b.rvol = 0;
  if (rvol != null) {
    if (rvol >= 3) b.rvol = 30;
    else if (rvol >= 2) b.rvol = 24;
    else if (rvol >= 1.5) b.rvol = 18;
    else if (rvol >= 1) b.rvol = 10;
  }

  b.gap = 0;
  if (gapPct != null) {
    const g = Math.abs(gapPct);
    if (g >= 5) b.gap = 20;
    else if (g >= 3) b.gap = 15;
    else if (g >= 1.5) b.gap = 8;
  }

  b.rangeExpansion = 0;
  if (atrExpansion != null) {
    if (atrExpansion >= 2) b.rangeExpansion = 20;
    else if (atrExpansion >= 1.5) b.rangeExpansion = 15;
    else if (atrExpansion >= 1) b.rangeExpansion = 8;
  }

  b.relStrength = 0;
  if (rsVsMkt != null) {
    const d = Math.abs(rsVsMkt);
    if (d >= 3) b.relStrength = 10;
    else if (d >= 1.5) b.relStrength = 6;
  }

  // --- Catalyst quality tier: earnings/FDA/M&A > vague PR; dilution is a trap ---
  b.catalyst = 0;
  if (q.catalystTier === 'strong') b.catalyst = 18;
  else if (q.catalystTier === 'neutral') b.catalyst = 10;
  else if (q.catalystTier === 'headline') b.catalyst = 8;
  else if (q.catalystTier === 'negative') b.catalyst = -15;

  b.earnings = q.hasEarnings ? 5 : 0;

  // --- Scan persistence: held its move across multiple 15-min scans = real ---
  b.persistence = 0;
  if (q.scanStreak >= 4) b.persistence = 10;
  else if (q.scanStreak >= 3) b.persistence = 8;
  else if (q.scanStreak === 2) b.persistence = 4;

  // --- Extension (RME): where price sits vs its own 21 EMA extension history.
  // Reversal setups aren't penalized for being deeply below — that's the setup.
  b.extension = rmeScoreAdjustment(q.rme, isReversalSetupName(q.setupName));

  // --- VWAP: longs below VWAP fight the tape; near-disqualifying for DAY ---
  b.vwap = q.vwapStatus === 'below' ? -(q.tradeType === 'Day Trade' ? 12 : 4) : 0;

  // --- Market regime gate: breakouts fail in weak breadth, reversals thrive ---
  b.regime = 0;
  const isBreakout = isBreakoutSetupName(q.setupName);
  const isReversal = isReversalSetupName(q.setupName);
  if (q.breadthSignal === 'RED') {
    if (isBreakout) b.regime -= 8;
    if (isReversal) b.regime += 4;
  } else if (q.breadthSignal === 'GREEN' && q.spyAbove21 !== false) {
    if (isBreakout) b.regime += 4;
  }

  // --- Sector confirmation: leader inside a hot group, not a lone wolf ---
  b.sector = q.inHotSector ? 5 : 0;

  const raw = Object.values(b).reduce((s, v) => s + v, 0);

  // --- STRUCTURAL CEILING (v6.11) -----------------------------------------
  // Applied after the sum, as a grade cap rather than a deduction, so the
  // breakdown tooltip still shows honestly what the tape did today.
  //
  // Stage 4 with a dead 50/200 is a confirmed downtrend — a bounce inside it
  // caps at B. Add 50%+ off the highs on top of that and it caps at C: the
  // move would need to more than double just to reach the last swing high.
  //
  // Reversal-family setups get one step of relief on the first rule, because
  // a Blue Dot in Stage 4 IS the setup being scanned for — but never on the
  // second, since a 50% drawdown is structural damage no entry signal repairs.
  let ceiling = 100;
  const deepDrawdown = q.pctOffHigh != null && q.pctOffHigh <= -50;
  const stage4 = q.stageNum === 4;
  const deadCross = q.goldenCross === false;

  if (stage4 && deadCross) {
    ceiling = isReversal ? 79 : 69;
  } else if (stage4 || deadCross) {
    ceiling = Math.min(ceiling, 84);
  }
  if (deepDrawdown && (q.stageNum == null || q.stageNum >= 3)) {
    ceiling = Math.min(ceiling, 59);
  }

  const score = Math.max(0, Math.min(ceiling, Math.round(raw)));
  const grade = score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
  return { score, grade, breakdown: b, ceiling };
};

// --- Deterministic setup readout ---------------------------------------------
// The row's own numbers restated as a sentence. NO LONGER used as the thesis
// (that line is news-only now) — parked on `readout` for tooltips.
const buildReadout = (t: any): string | null => {
  const parts: string[] = [];
  if (t.distToEma21 != null) {
    const dir = t.distToEma21 >= 0 ? 'above' : 'below';
    const slope = t.ema21Rising === true ? 'rising ' : t.ema21Rising === false ? 'flat/declining ' : '';
    parts.push(`${Math.abs(t.distToEma21).toFixed(1)}% ${dir} ${slope}21 EMA`);
  }
  if (t.stochK != null) {
    const zone = t.stochK <= 20 ? ' (deeply oversold)' : t.stochK <= 30 ? ' (oversold)' : t.stochK <= 35 ? ' (approaching oversold)' : t.stochK >= 80 ? ' (overbought)' : '';
    parts.push(`stoch ${t.stochK.toFixed(0)}${zone}`);
  }
  if (t.pctOffHigh != null) parts.push(`${Math.abs(t.pctOffHigh).toFixed(0)}% off highs`);
  if (t.rsVsSpy != null) parts.push(`RS ${t.rsVsSpy >= 0 ? '+' : ''}${t.rsVsSpy.toFixed(0)} vs SPY`);
  if (t.atrPct != null) parts.push(`ATR ${t.atrPct.toFixed(1)}%`);
  if (t.adrPct != null) parts.push(`ADR ${t.adrPct.toFixed(1)}%`);
  if (t.goldenCross != null) parts.push(t.goldenCross ? '50>200 intact' : '50<200');
  if (parts.length === 0) return null;
  return parts.join(', ') + '.';
};

// ---------------------------------------------------------------------------
// DETERMINISTIC MACRO BRIEFING (v6.9)
// ---------------------------------------------------------------------------
// Four sentences, each traceable to a number computed earlier in this run:
//   1. REGIME     — breadth signal and its inputs, SPY vs 21 EMA, NH/NL
//   2. LEADERSHIP — hot sectors, and whether the movers are long or inverse
//   3. YIELD      — how many names cleared each table, grade mix, setup mix
//   4. POSTURE    — what the combination of regime and yield supports
interface BriefingInput {
  breadthSignal: string;
  breadthScore: number;
  advancers: number;
  decliners: number;
  up4: number;
  down4: number;
  pctAdv: number;
  newHighs: number;
  newLows: number;
  spyAbove21: boolean | null;
  spyChgToday: number;
  hotSectors: string[];
  surfaced: any[];      // finalSip + finalDaily, deduped
  topMovers: Record<string, any[]>;
}

const buildMacroBriefing = (i: BriefingInput): { theme: string; briefing: string; watching: any[] } => {
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  const sentences: string[] = [];

  // --- 1. REGIME -----------------------------------------------------------
  const adRatio = i.decliners > 0 ? i.advancers / i.decliners : null;
  const regimeWord =
    i.breadthSignal === 'GREEN' ? 'Risk-on' :
    i.breadthSignal === 'RED' ? 'Risk-off' : 'Mixed';

  const regimeBits: string[] = [
    `Breadth is ${i.breadthSignal} (${i.breadthScore}/6) on ${i.advancers.toLocaleString()} advancers vs ${i.decliners.toLocaleString()} decliners${adRatio != null ? ` (A/D ${adRatio.toFixed(2)})` : ''}`,
  ];
  if (i.up4 + i.down4 > 0) {
    regimeBits.push(`${i.up4} names up 4%+ against ${i.down4} down 4%+`);
  }
  if (i.newHighs + i.newLows > 0) {
    regimeBits.push(`${i.newHighs} new highs vs ${i.newLows} new lows`);
  }
  if (i.spyAbove21 != null) {
    regimeBits.push(`SPY ${pct(i.spyChgToday)} and ${i.spyAbove21 ? 'above' : 'below'} its 21 EMA`);
  }
  sentences.push(`${regimeBits.join(', ')}.`);

  // --- 2. LEADERSHIP -------------------------------------------------------
  const moverPool = [
    ...(i.topMovers['Gainers'] || []),
    ...(i.topMovers['ETF Gainers'] || []),
  ].filter(Boolean);
  const bearCount = moverPool.filter((t: any) => isBearishInstrument(t?.name)).length;
  const bearShare = moverPool.length > 0 ? bearCount / moverPool.length : 0;

  const leadBits: string[] = [];
  if (i.hotSectors.length > 0) {
    leadBits.push(`Money is concentrated in ${i.hotSectors.join(' and ')}`);
  } else {
    leadBits.push('No sector is showing coordinated strength');
  }
  if (moverPool.length >= 5) {
    if (bearShare >= 0.5) {
      leadBits.push(`${bearCount} of the top ${moverPool.length} gainers are inverse or long-volatility instruments — the leaderboard itself is bearish, so there is no long momentum theme on offer`);
    } else if (bearShare >= 0.25) {
      leadBits.push(`${bearCount} of the top ${moverPool.length} gainers are inverse or long-volatility instruments, so leadership is split`);
    } else {
      leadBits.push(`long instruments hold the leaderboard (${moverPool.length - bearCount} of ${moverPool.length})`);
    }
  }
  sentences.push(`${leadBits.join('; ')}.`);

  // --- 3. SCAN YIELD -------------------------------------------------------
  const gradeA = i.surfaced.filter((t: any) => t.cnfGrade === 'A').length;
  const gradeB = i.surfaced.filter((t: any) => t.cnfGrade === 'B').length;
  const breakouts = i.surfaced.filter((t: any) => isBreakoutSetupName(t.setupName)).length;
  const reversals = i.surfaced.filter((t: any) => isReversalSetupName(t.setupName)).length;
  const ready = i.surfaced.filter((t: any) => t.status === 'Ready').length;
  const extended = i.surfaced.filter((t: any) => t.extended).length;
  const capped = i.surfaced.filter((t: any) => t.cnfCeiling != null && t.cnfCeiling < 100).length;

  const yieldBits: string[] = [
    `${i.surfaced.length} name${i.surfaced.length === 1 ? '' : 's'} cleared the setup gates`,
  ];
  if (i.surfaced.length > 0) {
    yieldBits.push(`${gradeA} grade A and ${gradeB} grade B`);
    if (breakouts + reversals > 0) {
      yieldBits.push(`${breakouts} breakout-family vs ${reversals} reversal-family`);
    }
    if (extended > 0) {
      yieldBits.push(`${extended} already extended`);
    }
    if (capped > 0) {
      yieldBits.push(`${capped} grade-capped on broken structure`);
    }
    yieldBits.push(`${ready} flagged Ready`);
  }
  sentences.push(`${yieldBits.join(', ')}.`);

  // --- 4. POSTURE ----------------------------------------------------------
  let posture: string;
  const thinYield = gradeA + gradeB <= 2;

  if (i.breadthSignal === 'RED' && thinYield) {
    posture = 'Weak breadth with almost nothing scoring well is the combination that argues for sitting out — breakouts carry a scoring penalty in this regime and the reversal candidates have not confirmed.';
  } else if (i.breadthSignal === 'RED' && reversals > breakouts) {
    posture = 'Breadth is weak but the surfaced names skew reversal-family, which is the setup type that historically works in this regime — the pullback entries are the ones with a defined stop.';
  } else if (i.breadthSignal === 'RED') {
    posture = 'Breadth is weak while the surfaced names skew breakout-family, which is the pairing that fails most often — treat these as day trades rather than swing entries.';
  } else if (i.breadthSignal === 'GREEN' && i.spyAbove21 !== false && breakouts > 0) {
    posture = 'Breadth and trend both confirm, so breakout entries have the regime behind them — this is the tape to press when a name clears its level on volume.';
  } else if (i.breadthSignal === 'GREEN') {
    posture = 'Breadth confirms but the surfaced names are pullback-oriented, so the edge is in entries at the anchor rather than chasing strength.';
  } else if (thinYield) {
    posture = 'A mixed tape with thin scoring is a day to demand A-grade confluence or stay flat.';
  } else {
    posture = 'Mixed breadth means neither side has control — trade smaller and require the setup to prove itself before adding.';
  }
  sentences.push(posture);

  // --- THEME ---------------------------------------------------------------
  const leadDesc =
    bearShare >= 0.5 ? 'bear instruments leading' :
    i.hotSectors.length > 0 ? `${i.hotSectors[0]} leading` :
    'no clear leadership';
  const yieldDesc =
    gradeA + gradeB === 0 ? 'nothing scoring' :
    gradeA > 0 ? `${gradeA} A-grade` :
    `${gradeB} B-grade`;
  const theme = `${regimeWord} — ${leadDesc}, ${yieldDesc}`;

  return {
    theme,
    briefing: sentences.join(' '),
    // Dropped in v6.9 — duplicated the tables below and dressed a tape score
    // up as a thesis. Emitted empty so existing components don't throw.
    watching: [],
  };
};

// v6.11: returns stageNum alongside the label. The CNF ceiling needs to compare
// a number, and parsing 'Stage 4B' back out of a display string downstream was
// the kind of thing that breaks the first time a sub-stage letter changes.
const detectPattern = (
  bars: any[],
  currentPrice: number,
  currentOpen: number,
  vwap: number,
  rvol: number | null
): { name: string | null, stage: string, stageNum: number | null } => {
  let stage = '-';
  if (!bars || bars.length < 80) return { name: null, stage, stageNum: null };

  const yest = bars[1];
  const day3 = bars[2];

  const warmUpBars = Math.min(100, bars.length - 1);
  let ema20 = bars[warmUpBars].c;
  const k20 = 2 / (20 + 1);
  for (let i = warmUpBars - 1; i >= 0; i--) {
      ema20 = (bars[i].c * k20) + (ema20 * (1 - k20));
  }

  // Weinstein stage + sub-stage. Bars here are DESC (newest first), and the
  // live price is passed so the sub-stage reflects the intraday print rather
  // than yesterday's close — the 30 and 50 SMAs sit close together.
  const stageDetail = computeStageDetail(bars, { order: 'desc', price: currentPrice });
  stage = stageDetail.label;
  const stageNum = stageDetail.stage;

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
      return { name: 'BB SQZ Fired', stage, stageNum };
  }

  const fastStochK = (idx: number) => {
    const slice = bars.slice(idx, idx + 10);
    const hi = Math.max(...slice.map(b => b.h));
    const lo = Math.min(...slice.map(b => b.l));
    if (hi === lo) return 50;
    return ((bars[idx].c - lo) / (hi - lo)) * 100;
  };
  const oversoldLast3 = fastStochK(0) <= 25 || fastStochK(1) <= 25 || fastStochK(2) <= 25;

  let sma30 = 0;
  for (let i = 0; i < 30; i++) sma30 += bars[i].c;
  sma30 /= 30;

  let ema21 = bars[warmUpBars].c;
  const k21 = 2 / (21 + 1);
  for (let i = warmUpBars - 1; i >= 0; i--) {
    ema21 = (bars[i].c * k21) + (ema21 * (1 - k21));
  }

  if (oversoldLast3 && currentPrice > yest.c && (currentPrice > sma30 || currentPrice > ema21)) {
    return { name: 'Blue Dot Rev', stage, stageNum };
  }

  const hasConvictionVol = rvol !== null && rvol >= 1.0;

  const windowRange = (start: number, len: number) => {
    const slice = bars.slice(start, start + len);
    const hi = Math.max(...slice.map(b => b.h));
    const lo = Math.min(...slice.map(b => b.l));
    return lo > 0 ? (hi - lo) / lo : 1;
  };
  const windowVol = (start: number, len: number) => {
    const slice = bars.slice(start, start + len);
    return slice.reduce((s, b) => s + (b.v || 0), 0) / Math.max(slice.length, 1);
  };
  // Compare the stage NUMBER — sub-stages mean 'Stage 2B' and 'Stage 2C' are
  // also valid VCP contexts, and an exact-label match would exclude them.
  if ((stageNum === 2 || stageNum === 3) && bars.length >= 50) {
    const rNear = windowRange(1, 12), rMid = windowRange(13, 12), rFar = windowRange(25, 12);
    const vNear = windowVol(1, 12), vMid = windowVol(13, 12), vFar = windowVol(25, 12);
    const contracting = rNear < rMid && rMid < rFar;
    const volDrying = (vNear > 0 && vMid > 0 && vFar > 0) ? (vNear < vMid && vMid < vFar) : true;
    const tightFinalLeg = rNear < 0.15;
    const baseHigh = Math.max(...bars.slice(1, 37).map(b => b.h));
    if (contracting && volDrying && tightFinalLeg && currentPrice > baseHigh && hasConvictionVol) {
      return { name: 'VCP', stage, stageNum };
    }
  }

  if (rvol !== null && rvol >= 2.0 && currentOpen >= yest.c * 1.04 && currentPrice >= currentOpen * 0.98) {
    return { name: 'Episodic Pivot', stage, stageNum };
  }

  const priorATH = Math.max(...bars.slice(1).map(b => b.h));
  const recentBaseHigh = Math.max(...bars.slice(1, 64).map(b => b.h));
  const baseOldEnough = recentBaseHigh < priorATH * 0.999;
  if (hasConvictionVol && currentPrice > priorATH && yest.c <= priorATH && baseOldEnough) {
    return { name: 'GLB', stage, stageNum };
  }

  if (hasConvictionVol && currentOpen > (yest.h * 1.01) && currentPrice >= currentOpen) {
    return { name: 'Gap & Go', stage, stageNum };
  }

  if (hasConvictionVol && currentOpen <= yest.c && currentPrice > yest.c) {
    return { name: 'R2G', stage, stageNum };
  }

  if (hasConvictionVol && yest.h < day3.h && yest.l > day3.l && currentPrice > yest.h) {
    return { name: 'Inside Day BRK', stage, stageNum };
  }

  if (currentPrice > ema20 && yest.l <= (ema20 * 1.02) && currentPrice > yest.h) {
    return { name: '20 EMA PB', stage, stageNum };
  }

  if (isSqueezingToday) {
      return { name: 'BB SQZ Building', stage, stageNum };
  }

  if (currentPrice > ema20 && currentPrice > vwap) {
    return { name: 'Trend Hold', stage, stageNum };
  }

  return { name: null, stage, stageNum };
};

const fetchSafeJson = async (url: string, fallback: any, timeoutMs = 20000, headers?: Record<string, string>) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal as any, headers });
    clearTimeout(id);
    if (!res.ok) return fallback;
    return await res.json();
  } catch (error) {
    clearTimeout(id);
    return fallback;
  }
};

const WIIM_MAX_AGE_DAYS = 4;
const WIIM_MAX_BREADTH = 12;
// v6.8: was 50. At pageSize=100 a 50-ticker batch truncates badly — the first
// handful of tickers consume the entire item budget and everything after them
// comes back empty, which is why earnings-day names had no WIIM attached.
const WIIM_BATCH_SIZE = 15;

const classifyWiim = (title: string): string => {
  const s = (title || '').toLowerCase();
  if (/\b(earnings|eps|revenue|beat|miss|quarter|q[1-4]\b)/.test(s)) return 'Earnings';
  if (/\b(fda|approval|phase\s*[123]|trial|clinical|topline|drug|therap)/.test(s)) return 'FDA / Data';
  if (/\b(upgrade|downgrade|price target|initiat|analyst|rating|overweight|underweight|outperform|reiterat)/.test(s)) return 'Analyst';
  if (/\b(merger|acquir|acquisition|buyout|takeover|to acquire|stake|going private)/.test(s)) return 'M&A';
  if (/\b(offering|dilut|prices?\s|secondary|registered direct|atm |capital raise|warrant)/.test(s)) return 'Offering';
  if (/\b(contract|partnership|collaborat|agreement|awarded|order|wins |selected)/.test(s)) return 'Contract';
  if (/\b(guidance|raises|lowers|cuts |reaffirm|outlook|forecast)/.test(s)) return 'Guidance';
  if (/\b(lawsuit|sec |investigat|probe|fraud|settle|recall|halt)/.test(s)) return 'Legal / Risk';
  if (/\b(short|squeeze|volatil|spik|surg|plung|tumbl)/.test(s)) return 'Volatility';
  if (/\b(sector|broader market|index|futures|rotat|peers)/.test(s)) return 'Sector Move';
  return 'News';
};

const fetchBenzingaWiims = async (
  tickers: string[],
  apiKey: string
): Promise<Map<string, { title: string; url: string | null; daysOld: number; score: number }>> => {
  const out = new Map<string, { title: string; url: string | null; daysOld: number; score: number }>();
  if (!apiKey || tickers.length === 0) return out;

  const now = Date.now();
  for (let i = 0; i < tickers.length; i += WIIM_BATCH_SIZE) {
    const batch = tickers.slice(i, i + WIIM_BATCH_SIZE);
    const url =
      `https://api.benzinga.com/api/v2/news?token=${apiKey}` +
      `&tickers=${encodeURIComponent(batch.join(','))}` +
      `&channels=WIIM&displayOutput=full&pageSize=100`;

    const items = await fetchSafeJson(url, [], 15000, { accept: 'application/json' });
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      const isWiim =
        Array.isArray(item?.channels) &&
        item.channels.some((c: any) => (c?.name || '').toUpperCase() === 'WIIM');
      if (!isWiim) continue;

      const title = (item?.title || '').trim();
      if (!title) continue;

      // v6.11: WIIM is a curated channel, but litigation solicitations do
      // occasionally carry the tag. Same filter as the Polygon path so a name
      // cannot pick up a law-firm blast as its catalyst through this door.
      if (isSpamNews(title)) continue;

      const stocks = Array.isArray(item?.stocks) ? item.stocks : [];
      if (stocks.length === 0 || stocks.length > WIIM_MAX_BREADTH) continue;

      const created = item?.created ? new Date(item.created).getTime() : 0;
      const daysOld = created > 0 ? (now - created) / (1000 * 60 * 60 * 24) : 999;
      if (daysOld > WIIM_MAX_AGE_DAYS) continue;

      const link = item?.url || null;
      const score = daysOld + stocks.length * 0.02;

      for (const s of stocks) {
        const sym = (s?.name || '').toUpperCase();
        if (!sym) continue;
        const prev = out.get(sym);
        if (!prev || score < prev.score) {
          out.set(sym, { title, url: link, daysOld, score });
        }
      }
    }
  }
  return out;
};

// --- Earnings calendar -------------------------------------------------------
// v6.8: window widened from [today, +2d] to [yesterday, +2d] and the return
// type upgraded from Set to Map so we know WHICH side of the print we're on.
//
// `reported` = the print already happened (yesterday, or today pre-market).
// That's a catalyst, and it's the fix for a -40% earnings gap showing up as
// "Technical Momentum". `upcoming` = still ahead, which is the old +5 nudge.
//
// Fails open — no key or a bad response just means no earnings context.
interface EarningsEntry { date: string; when: string; reported: boolean; }

const fetchEarningsCalendar = async (apiKey: string): Promise<Map<string, EarningsEntry>> => {
  const out = new Map<string, EarningsEntry>();
  if (!apiKey) return out;
  try {
    const today = etDateString(new Date());
    const from = etDateString(new Date(Date.now() - 86400000));
    const to = etDateString(new Date(Date.now() + 2 * 86400000));
    const url =
      `https://api.benzinga.com/api/v2.1/calendar/earnings?token=${apiKey}` +
      `&parameters[date_from]=${from}&parameters[date_to]=${to}&pagesize=1000`;
    const data = await fetchSafeJson(url, {}, 15000, { accept: 'application/json' });
    const rows = Array.isArray(data?.earnings) ? data.earnings : [];

    for (const r of rows) {
      const ticker = (r?.ticker || '').toUpperCase();
      if (!ticker) continue;
      const date: string = r?.date || '';
      // Benzinga marks timing as BMO (before open), AMC (after close), or DMT.
      const when: string = (r?.time_of_day || r?.time || '').toString().toUpperCase();

      // Already printed if it was yesterday, or it's today and reported
      // pre-market. Today's AMC names haven't happened yet at scan time.
      const reported =
        date < today || (date === today && !when.includes('AMC'));

      const prev = out.get(ticker);
      // Prefer the nearest date if a ticker somehow appears twice.
      if (!prev || date < prev.date) out.set(ticker, { date, when, reported });
    }
  } catch {
    // fail open
  }
  return out;
};

// --- macroInsights freshness gate --------------------------------------------
// v6.8 added this because `macro_insights_v6` had no writer — it was produced
// by a removed Gemini route, had no TTL, and got republished forever.
//
// v6.9 restores a writer (buildMacroBriefing), so this gate now does its
// intended job: serve today's briefing, suppress anything older.
const readFreshMacroInsights = async (): Promise<any | null> => {
  try {
    const raw: any = await kv.get('macro_insights_v6');
    if (!raw || typeof raw !== 'object') return null;

    const stampRaw = raw.generatedAt || raw.updatedAt || raw.timestamp || null;
    if (!stampRaw) return null;

    const stamp = new Date(stampRaw);
    if (Number.isNaN(stamp.getTime())) return null;

    if (etDateString(stamp) !== etDateString(new Date())) return null;

    return raw;
  } catch {
    return null;
  }
};

async function runScan(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get('force') === 'true' || searchParams.get('refresh') === 'true';

  const estNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = estNow.getHours();
  const dayOfWeek = estNow.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const currentPhase = getUpdatePhase(hour);
  // v6.11: was estNow.toISOString().split('T')[0]. That round-trips correctly
  // only while the server clock is UTC — estNow already holds ET wall-clock
  // values, so toISOString() applies a second shift on any other host TZ and
  // the streak key silently rolls a day early or late. etDateString() derives
  // the ET calendar date directly and does not care where this runs.
  const currentDate = etDateString(new Date());
  const currentMarketStatus = getMarketStatus();

  const noStoreHeaders = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };

  // Scan-gate metadata for the on-screen key. Shipped with every response,
  // including cached and weekend ones, so the "?" panel always has something
  // to render regardless of which path served the data.
  const scanMeta = {
    sip: SCANNER_SIP_META,
    daily: SCANNER_DAILY_META,
    topMovers: TOPMOVERS_META,
  };

  // --- WEEKEND GUARD ---------------------------------------------------------
  if (isWeekend && !forceRefresh) {
    const [wDaily, wSip, wTop, wMacro, wBench, wTime] = await Promise.all([
      kv.get<any[]>('daily_setups_v6'),
      kv.get<any[]>('stocks_in_play_v6'),
      kv.get<any>('top_movers_v6'),
      readFreshMacroInsights(),
      kv.get<any>('benchmark_v6'),
      kv.get<number>('last_scan_time_v6'),
    ]);
    return NextResponse.json({
      success: true,
      weekend: true,
      note: 'Weekend — serving last stored session (Friday close); no scan run.',
      marketStatus: 'Closed',
      lastScanTime: wTime || Date.now(),
      topMoversGenerated: true,
      topMovers: wTop || { 'Mega Caps': [], 'Gainers': [], 'Losers': [], 'ETF Gainers': [], 'ETF Losers': [] },
      macroInsights: wMacro || null,
      benchmark: wBench || null,
      sips: wSip || [],
      dailySetups: wDaily || [],
      scanMeta,
      fromCache: true
    }, { headers: noStoreHeaders });
  }

  // --- SHORT DEDUPE THROTTLE -------------------------------------------------
  if (!forceRefresh) {
    try {
      const lastScanTime = await kv.get<number>('last_scan_time_v6');
      const cachedTopMovers = await kv.get<any>('top_movers_v6');
      const isRecent = lastScanTime && (Date.now() - lastScanTime) < 5 * 60 * 1000;
      const hasData = cachedTopMovers?.['Gainers']?.length > 0;

      if (isRecent && hasData) {
        const [cachedDaily, cachedSip, cachedMacro, cachedBenchmark] = await Promise.all([
          kv.get<any[]>('daily_setups_v6'),
          kv.get<any[]>('stocks_in_play_v6'),
          readFreshMacroInsights(),
          kv.get<any>('benchmark_v6'),
        ]);
        return NextResponse.json({
          success: true,
          marketStatus: currentMarketStatus,
          lastScanTime: lastScanTime || Date.now(),
          dailyCount: (cachedDaily || []).length,
          sipCount: (cachedSip || []).length,
          topMoversGenerated: true,
          topMovers: cachedTopMovers,
          macroInsights: cachedMacro,
          benchmark: cachedBenchmark,
          sips: cachedSip,
          dailySetups: cachedDaily,
          scanMeta,
          fromCache: true
        }, { headers: noStoreHeaders });
      }
    } catch (cacheErr) {
      console.error("Cache read failed, proceeding with fresh scan.", cacheErr);
    }
  }

  const polygonApiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || process.env.POLYGON_API_KEY || '';
  if (!polygonApiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 500 });

  const benzingaApiKey = process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '';

  try {
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

    const viableSetups = processedSnapshot.filter((t: any) => t._livePrice >= SCANNER.minPrice && t._liveVol >= SCANNER.minVolume);

    const spyChgToday = processedSnapshot.find((t: any) => t.ticker === 'SPY')?._liveChg ?? 0;

    // --- Market breadth / GMI-style regime -----------------------------------
    let advancers = 0, decliners = 0, up4 = 0, down4 = 0;
    for (const t of viableSetups) {
      const chg = t._liveChg || 0;
      if (chg > 0) advancers++; else if (chg < 0) decliners++;
      if (chg >= 4) up4++; else if (chg <= -4) down4++;
    }
    const breadthTotal = advancers + decliners;
    const pctAdv = breadthTotal > 0 ? advancers / breadthTotal : 0;
    const ratio4 = (up4 + down4) > 0 ? up4 / (up4 + down4) : 0.5;
    let breadthScore = 0;
    if (advancers > decliners) breadthScore++;
    if (pctAdv >= 0.55) breadthScore++;
    if (up4 > down4) breadthScore++;
    if (up4 >= 100) breadthScore++;
    if (ratio4 >= 0.6) breadthScore++;
    if (down4 < 50) breadthScore++;
    const breadthSignal = breadthScore >= 4 ? 'GREEN' : breadthScore <= 2 ? 'RED' : 'NEUTRAL';
    try {
      await kv.set('market_breadth_v6', {
        score: breadthScore, signal: breadthSignal,
        advancers, decliners, up4, down4,
        pctAdv: Math.round(pctAdv * 1000) / 10,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) { console.error('breadth persist failed', e); }

    // --- ATHI/ATLO: new 52-week highs vs lows across the FULL viable universe.
    // Uses grouped daily bars (one API call per trading day) to compute each
    // ticker's 252-day high and low, then compares to today's price.
    let newHighs = 0, newLows = 0;
    try {
      const viableSet = new Set(viableSetups.map((t: any) => t.ticker));
      const hi52Map = new Map<string, number>();
      const lo52Map = new Map<string, number>();

      // Fetch grouped daily for ~252 trading days in batches of 7
      const hlDates: string[] = [];
      for (let d = 365; d >= 1; d--) {
        const dt = new Date(Date.now() - d * 86400000);
        const day = dt.getUTCDay();
        if (day === 0 || day === 6) continue;
        hlDates.push(dt.toISOString().slice(0, 10));
      }
      const hlKept = hlDates.slice(-252);

      const HL_BATCH = 7;
      for (let i = 0; i < hlKept.length; i += HL_BATCH) {
        const chunk = hlKept.slice(i, i + HL_BATCH);
        const settled = await Promise.allSettled(chunk.map(async (date) => {
          return fetchSafeJson(
            `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${polygonApiKey}`,
            { results: [] }, 15000
          );
        }));
        for (const r of settled) {
          if (r.status !== 'fulfilled' || !r.value?.results) continue;
          for (const bar of r.value.results) {
            const sym = bar.T;
            if (!viableSet.has(sym)) continue;
            const prevHi = hi52Map.get(sym);
            if (!prevHi || bar.h > prevHi) hi52Map.set(sym, bar.h);
            const prevLo = lo52Map.get(sym);
            if (!prevLo || bar.l < prevLo) lo52Map.set(sym, bar.l);
          }
        }
      }

      // Compare today's price to the 52-week extremes
      for (const t of viableSetups) {
        const price = t._livePrice;
        if (!price || price <= 0) continue;
        const hi = hi52Map.get(t.ticker);
        const lo = lo52Map.get(t.ticker);
        if (hi && hi > 0) {
          const pctOff = ((price - hi) / hi) * 100;
          if (pctOff >= -1) newHighs++;
        }
        if (lo && lo > 0) {
          const pctOff = ((price - lo) / lo) * 100;
          if (pctOff <= 1) newLows++;
        }
      }

      // Merge into the breadth KV payload
      const prevBreadth = await kv.get<any>('market_breadth_v6');
      if (prevBreadth) {
        await kv.set('market_breadth_v6', { ...prevBreadth, newHighs, newLows });
      }
    } catch (e) { console.error('ATHI/ATLO failed (non-blocking):', e); }


    const dailyCandidates = [...viableSetups]
      .filter((t: any) => t._liveChg >= SCANNER.minChange)
      .sort((a: any, b: any) => (b._livePrice * b._liveVol) - (a._livePrice * a._liveVol))
      .slice(0, 30);

    const sipCandidates = [...viableSetups]
      .filter((t: any) => Math.abs(t._liveChg) >= SCANNER.minChange && t._livePrice >= t._liveVwap)
      .sort((a: any, b: any) => b._liveVol - a._liveVol)
      .slice(0, 40);

    const MEGA_CAP_TICKERS = new Set(['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'BRK.B', 'AVGO', 'LLY', 'JPM', 'XOM', 'UNH', 'V', 'PG', 'MA', 'JNJ', 'HD', 'AMD', 'NFLX', 'COST']);

    const megaCapsRaw = processedSnapshot.filter((t: any) => MEGA_CAP_TICKERS.has(t.ticker)).sort((a: any, b: any) => b._liveChg - a._liveChg).slice(0, 20);
    const knownEtfsRaw = viableSetups.filter((t: any) => ETF_TARGET_MAP[t.ticker]);
    const etfGainersRaw = [...knownEtfsRaw].sort((a: any, b: any) => b._liveChg - a._liveChg).slice(0, 20);
    const etfLosersRaw = [...knownEtfsRaw].sort((a: any, b: any) => a._liveChg - b._liveChg).slice(0, 20);

    const regularStocksRaw = viableSetups.filter((t: any) => !ETF_TARGET_MAP[t.ticker] && !MEGA_CAP_TICKERS.has(t.ticker));

    const gainersRaw = [...regularStocksRaw].filter((t: any) => t._liveChg >= SCANNER.minChange).sort((a: any, b: any) => b._liveChg - a._liveChg).slice(0, 40);
    const losersRaw = [...regularStocksRaw].sort((a: any, b: any) => a._liveChg - b._liveChg).slice(0, 40);

    const todayDate = new Date();
    const lookbackDate = new Date();
    lookbackDate.setDate(todayDate.getDate() - 400);
    const toStr = todayDate.toISOString().split('T')[0];
    const fromStr = lookbackDate.toISOString().split('T')[0];

    // SPY 63-day (~3 month) return — benchmark for the RS column.
    const spyHistRes = await fetchSafeJson(
      `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=350&apiKey=${polygonApiKey}`,
      { results: [] }
    );
    const spyHistBars = (spyHistRes.results || []).sort((a: any, b: any) => b.t - a.t);
    let spyReturn3M: number | null = null;
    if (spyHistBars.length >= 64 && spyHistBars[63].c > 0) {
      spyReturn3M = ((spyHistBars[0].c - spyHistBars[63].c) / spyHistBars[63].c) * 100;
    }

    // SPY vs its own 21 EMA — trend confirmation for the regime gate.
    let spyAbove21: boolean | null = null;
    if (spyHistBars.length >= 30) {
      const spyWarm = Math.min(100, spyHistBars.length - 1);
      let spyE21 = spyHistBars[spyWarm].c;
      const kSpy = 2 / 22;
      for (let i = spyWarm - 1; i >= 0; i--) spyE21 = (spyHistBars[i].c * kSpy) + (spyE21 * (1 - kSpy));
      spyAbove21 = spyHistBars[0].c >= spyE21;
    }

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
        // v6.8: limit 10 -> 50. The spam filter strips law-firm blasts, and on
        // an earnings blowup those ARE the top results — a 10-item window left
        // nothing behind and fell through to months-old news.
        fetchSafeJson(`https://api.polygon.io/v2/reference/news?ticker=${sym}&limit=50&order=desc&sort=published_utc&apiKey=${polygonApiKey}`, { results: [] }),
        fetchSafeJson(`https://api.polygon.io/stocks/v1/short-interest?ticker=${sym}&apiKey=${polygonApiKey}`, { results: [] })
      ]);

      const marketCap = details?.results?.market_cap || 0;
      if (marketCap > 0 && marketCap < SCANNER.minMarketCap) return null;

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

      // Average Daily Range % (Minervini): SMA20(High/Low) - 1. Unlike ATR it
      // has no gap component, so it measures the intraday room a typical
      // session actually offers — the anti-chop metric.
      let adrPct: number | null = null;
      if (dailyBars.length >= 20) {
        let ratioSum = 0;
        let ratioCount = 0;
        for (let i = 0; i < 20; i++) {
          const b = dailyBars[i];
          if (b && b.h > 0 && b.l > 0) { ratioSum += b.h / b.l; ratioCount++; }
        }
        if (ratioCount > 0) adrPct = ((ratioSum / ratioCount) - 1) * 100;
      }

      const rmv = computeRMV(dailyBars, { order: 'desc', lookback: 15 });
      const rmeDetail = computeRMEDetail(dailyBars, { order: 'desc', maLength: 21, lookback: 250 });
      const mf = computeMoneyFlow(dailyBars, { order: 'desc', length: 21 });
      const mfTrend = moneyFlowTrend(dailyBars, { order: 'desc', length: 21, lookback: 5 });

      // 10 & 21 EMA + trend-structure fields.
      let aboveEma10: boolean | null = null;
      let aboveEma21: boolean | null = null;
      let distToEma10: number | null = null;
      let distToEma21: number | null = null;
      let ema21Rising: boolean | null = null;
      if (dailyBars.length >= 30) {
        const emaWarm = Math.min(100, dailyBars.length - 1);
        let e10 = dailyBars[emaWarm].c;
        let e21 = dailyBars[emaWarm].c;
        let e21FiveAgo: number | null = null;
        const k10 = 2 / (10 + 1);
        const k21e = 2 / (21 + 1);
        for (let i = emaWarm - 1; i >= 0; i--) {
          e10 = (dailyBars[i].c * k10) + (e10 * (1 - k10));
          e21 = (dailyBars[i].c * k21e) + (e21 * (1 - k21e));
          if (i === 5) e21FiveAgo = e21;
        }
        aboveEma10 = price >= e10;
        aboveEma21 = price >= e21;
        // v6.10: the 10 EMA distance was computed and thrown away — only the
        // boolean was emitted. Without the number, nothing downstream can
        // distinguish a first-touch pullback (under the 10, still over the
        // 21) from a name stacked well above both lines.
        if (e10 > 0) distToEma10 = ((price - e10) / e10) * 100;
        if (e21 > 0) distToEma21 = ((price - e21) / e21) * 100;
        if (e21FiveAgo != null) ema21Rising = e21 > e21FiveAgo;
      }

      // Golden cross: 50 SMA above 200 SMA
      let goldenCross: boolean | null = null;
      if (dailyBars.length >= 200) {
        let s50 = 0, s200 = 0;
        for (let i = 0; i < 200; i++) {
          s200 += dailyBars[i].c;
          if (i < 50) s50 += dailyBars[i].c;
        }
        goldenCross = (s50 / 50) > (s200 / 200);
      }

      // % off 52-week high/low (~252 trading days, capped to available bars).
      // Used for scanner display AND for the ATHI/ATLO breadth count.
      let pctOffHigh: number | null = null;
      let pctOffLow: number | null = null;
      if (dailyBars.length >= 20 && price > 0) {
        const window = dailyBars.slice(0, Math.min(252, dailyBars.length));
        const hi = Math.max(...window.map((b: any) => b.h));
        const lo = Math.min(...window.map((b: any) => b.l));
        if (hi > 0) pctOffHigh = ((price - hi) / hi) * 100;
        if (lo > 0) pctOffLow = ((price - lo) / lo) * 100;
      }
      const atrPct = (atr > 0 && price > 0) ? (atr / price) * 100 : null;

      // Smoothed stochastic %K (10, 4) — matches the Dr. Wish dots.
      let stochK: number | null = null;
      if (dailyBars.length >= 14) {
        const rawK = (idx: number) => {
          const win = dailyBars.slice(idx, idx + 10);
          const hi = Math.max(...win.map((b: any) => b.h));
          const lo = Math.min(...win.map((b: any) => b.l));
          return hi === lo ? 50 : ((dailyBars[idx].c - lo) / (hi - lo)) * 100;
        };
        stochK = (rawK(0) + rawK(1) + rawK(2) + rawK(3)) / 4;
      }

      // 3-month RS vs SPY (63 trading days).
      let rsVsSpy: number | null = null;
      if (spyReturn3M != null && dailyBars.length >= 64 && dailyBars[63].c > 0) {
        const ret3M = ((dailyBars[0].c - dailyBars[63].c) / dailyBars[63].c) * 100;
        rsVsSpy = ret3M - spyReturn3M;
      }

      // --- CNF raw components -------------------------------------------------
      let gapPct: number | null = null;
      let atrExpansion: number | null = null;
      let moveVsAtr: number | null = null;
      if (dailyBars.length >= 2) {
        const prevDailyClose = dailyBars[1]?.c;
        if (prevDailyClose > 0 && currentOpen > 0) {
          gapPct = ((currentOpen - prevDailyClose) / prevDailyClose) * 100;
        }
        const todayBar = dailyBars[0];
        if (atr > 0 && todayBar?.h != null && todayBar?.l != null) {
          atrExpansion = (todayBar.h - todayBar.l) / atr;
        }
        if (atr > 0 && prevDailyClose > 0) {
          moveVsAtr = (price - prevDailyClose) / atr;
        }
      }
      const rsVsMkt = chgPct - spyChgToday;

      const rvol = (avgVol > 0 && vol > 0) ? (vol / avgVol) : null;
      const setupMatched = detectPattern(dailyBars, price, currentOpen, vwap, rvol);
      const companyName = details?.results?.name || sym;

      let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
      if (vwap > 0 && price > 0) vwapStatus = price >= vwap ? 'above' : 'below';

      const float = details?.results?.share_class_shares_outstanding || (marketCap && price ? marketCap / price : null);
      let shortPct = null;
      let daysToCover = null;
      const shortInterest = shortData?.results?.[0]?.short_interest;
      if (shortInterest && float) {
        shortPct = (shortInterest / float) * 100;
      }
      // Days to cover — the "5" in Bonde's MAGNA 53. Sessions of normal trade
      // for shorts to exit; scales short interest against the liquidity to
      // unwind it, which raw short percent does not.
      if (shortInterest && avgVol > 0) {
        daysToCover = shortInterest / avgVol;
      }

      const apiSectorRaw = cleanSectorDescription(details?.results?.sic_description, details?.results?.sector, details?.results?.industry);
      const deepSector = resolveEtfSector(sym, apiSectorRaw, companyName);

      const rawNewsList = newsData?.results || [];
      const validNewsList = rawNewsList.filter((n: any) => !isSpamNews(n.title) && n.published_utc);

      let finalCatalystUrl = null;
      let rawHeadline = null;
      let daysOld = 999;

      if (validNewsList.length > 0) {
        // v6.8: take the NEWEST surviving article. The old code ran .find()
        // for a preferred publisher, which could return an older story than
        // validNewsList[0] and misreport how fresh the catalyst was.
        const relatedNews = validNewsList
          .slice()
          .sort((a: any, b: any) =>
            new Date(b.published_utc).getTime() - new Date(a.published_utc).getTime())[0];

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
        float, shortPct,
        daysToCover: daysToCover != null ? parseFloat(daysToCover.toFixed(1)) : null,
        mktCap: marketCap, stage: setupMatched.stage, setupName: setupMatched.name, catalystUrl: finalCatalystUrl,
        _stageNum: setupMatched.stageNum,
        aboveEma10, aboveEma21,
        distToEma10: distToEma10 != null ? parseFloat(distToEma10.toFixed(2)) : null,
        distToEma21: distToEma21 != null ? parseFloat(distToEma21.toFixed(2)) : null,
        ema21Rising,
        goldenCross,
        pctOffHigh: pctOffHigh != null ? parseFloat(pctOffHigh.toFixed(1)) : null,
        pctOffLow: pctOffLow != null ? parseFloat(pctOffLow.toFixed(1)) : null,
        atrPct: atrPct != null ? parseFloat(atrPct.toFixed(2)) : null,
        adrPct: adrPct != null ? parseFloat(adrPct.toFixed(2)) : null,
        rmv,
        mf,
        mfTrend,
        rme: rmeDetail.rme,
        rmeExtPct: rmeDetail.extPct,
        rmeSampled: rmeDetail.sampled,
        stochK: stochK != null ? parseFloat(stochK.toFixed(1)) : null,
        rsVsSpy: rsVsSpy != null ? parseFloat(rsVsSpy.toFixed(1)) : null,
        gapPct: gapPct != null ? parseFloat(gapPct.toFixed(2)) : null,
        atrExpansion: atrExpansion != null ? parseFloat(atrExpansion.toFixed(2)) : null,
        moveVsAtr: moveVsAtr != null ? parseFloat(moveVsAtr.toFixed(2)) : null,
        rsVsMkt: parseFloat(rsVsMkt.toFixed(2)),
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

    const wiimTickers = enrichedList.map((t: any) => t.ticker).filter(Boolean);
    const wiimMap = await fetchBenzingaWiims(wiimTickers, benzingaApiKey);

    const earningsMap = await fetchEarningsCalendar(benzingaApiKey);

    // --- Scan persistence: how many consecutive scans has each name held? ---
    let prevStreaks: Record<string, number> = {};
    try {
      const storedStreaks = await kv.get<any>('scan_streaks_v6');
      if (storedStreaks && storedStreaks.date === currentDate && storedStreaks.counts) {
        prevStreaks = storedStreaks.counts;
      }
    } catch (e) { console.error('streak read failed', e); }
    const newStreaks: Record<string, number> = {};

    const enrichedMap = new Map();

    // --- PASS 1: catalyst tier, tradeType, streaks, extension, status --------
    const NEGATIVE_TAGS = new Set(['Offering', 'Legal / Risk']);
    const STRONG_TAGS = new Set(['Earnings', 'FDA / Data', 'M&A', 'Guidance', 'Contract']);

    enrichedList.forEach((t: any) => {
      const wiim = wiimMap.get(t.ticker);
      const earn = earningsMap.get(t.ticker);
      const reportedEarnings = !!earn?.reported;
      let catalystTag: string | null = null;

      if (wiim) {
        catalystTag = classifyWiim(wiim.title);
        let tag = catalystTag;
        if (wiim.daysOld >= 1.5) tag = `${tag} (Delayed)`;
        t.catalyst = tag;
        if (wiim.url) t.catalystUrl = wiim.url;
      } else if (reportedEarnings) {
        // v6.8: the calendar itself is the catalyst. Without this a name that
        // gapped 40% on its print reads "Technical Momentum" whenever the WIIM
        // feed misses it — which is most of the time on a heavy earnings day.
        catalystTag = 'Earnings';
        t.catalyst = 'Earnings';
      } else {
        if (t._rawHeadline && t._daysOld < 1.5) t.catalyst = "Recent News";
        else if (t._rawHeadline && t._daysOld >= 1.5 && t._daysOld <= 4) t.catalyst = "Delayed Reaction";
        else t.catalyst = 'Technical Momentum';
      }

      // THESIS = NEWS HEADLINE ONLY. Null when the move has no news behind it.
      t.thesis = wiim
        ? wiim.title
        : (t._rawHeadline && t._daysOld <= 4 ? t._rawHeadline : null);

      t.readout = buildReadout(t);

      // Earnings context, exposed for the row tooltip.
      t.earningsDate = earn?.date || null;
      t.earningsWhen = earn?.when || null;
      t.earningsReported = reportedEarnings;

      if ((catalystTag && NEGATIVE_TAGS.has(catalystTag)) ||
          isNegativeHeadline(t._rawHeadline) ||
          (wiim && isNegativeHeadline(wiim.title))) {
        t._catalystTier = 'negative';
      } else if (catalystTag && STRONG_TAGS.has(catalystTag)) {
        t._catalystTier = 'strong';
      } else if (wiim) {
        t._catalystTier = 'neutral';
      } else if (t._rawHeadline) {
        t._catalystTier = 'headline';
      } else {
        t._catalystTier = 'none';
      }

      t.tradeType = deriveTradeType(t.setupName);

      t.scanStreak = currentPhase !== 'Offline'
        ? (prevStreaks[t.ticker] || 0) + 1
        : (prevStreaks[t.ticker] || 1);
      newStreaks[t.ticker] = t.scanStreak;

      t.extended = (t.moveVsAtr != null && t.moveVsAtr >= 3.5) ||
        (t.distToEma21 != null && t.atrPct != null && t.atrPct > 0 && t.distToEma21 > 3 * t.atrPct);

      t.status = (t.stochK != null && t.stochK <= 25 && t.distToEma21 != null && Math.abs(t.distToEma21) <= 2.5)
        ? 'Ready' : 'Forming';
      if (t.tradeType === 'Day Trade' && t.vwapStatus === 'below') t.status = 'Forming';
    });

    // --- Sector heat: avg % move per sector across the full scanned universe --
    const sectorHeatAgg: Record<string, { sum: number; count: number }> = {};
    enrichedList.forEach((t: any) => {
      const sec = t.sector && t.sector !== '—' && t.sector !== 'Other' ? String(t.sector) : null;
      if (!sec) return;
      if (!sectorHeatAgg[sec]) sectorHeatAgg[sec] = { sum: 0, count: 0 };
      sectorHeatAgg[sec].sum += (t.changePct || 0);
      sectorHeatAgg[sec].count += 1;
    });
    const hotSectorList = Object.entries(sectorHeatAgg)
      .map(([sec, v]) => ({ sec, avg: v.sum / v.count, count: v.count }))
      .filter(h => h.count >= 2 && h.avg > 0)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 2)
      .map(h => h.sec);
    const hotSectors = new Set(hotSectorList);

    // --- PASS 2: CNF scoring with full market context -------------------------
    enrichedList.forEach((t: any) => {
      // `hasEarnings` remains the FORWARD-looking flag (print still ahead) so
      // the +5 nudge keeps its original meaning. A name that already reported
      // gets its credit through the catalyst tier instead, not twice.
      const earn = earningsMap.get(t.ticker);
      const hasEarnings = !!earn && !earn.reported;

      const cnf = computeCnfScore(
        t.rvol,
        t.gapPct,
        t.atrExpansion,
        t.rsVsMkt,
        {
          catalystTier: t._catalystTier,
          hasEarnings,
          scanStreak: t.scanStreak || 1,
          rme: t.rme,
          vwapStatus: t.vwapStatus || 'neutral',
          tradeType: t.tradeType || '',
          setupName: t.setupName || null,
          breadthSignal,
          spyAbove21,
          inHotSector: t.sector ? hotSectors.has(t.sector) : false,
          stageNum: t._stageNum ?? null,
          goldenCross: t.goldenCross ?? null,
          pctOffHigh: t.pctOffHigh ?? null,
        }
      );
      t.cnfScore = cnf.score;
      t.cnfGrade = cnf.grade;
      t.cnfBreakdown = cnf.breakdown;
      // Shipped so the UI can explain a score that looks lower than its
      // components — "capped at 69 on Stage 4 + dead cross" is actionable,
      // a silently reduced number is not.
      t.cnfCeiling = cnf.ceiling;
      t.hasEarnings = hasEarnings;
      t.conviction = cnf.score;
      delete t._catalystTier;
      delete t._stageNum;

      enrichedMap.set(t.ticker, t);
    });

    if (currentPhase !== 'Offline') {
      try {
        await kv.set('scan_streaks_v6', { date: currentDate, counts: newStreaks });
      } catch (e) { console.error('streak persist failed', e); }
    }

    const finalSip = sipCandidates
      .map((t: any) => enrichedMap.get(t.ticker))
      .filter((r: any) =>
         r !== undefined &&
         r.vol >= SCANNER.minVolume &&
         r.dVol >= SCANNER.minDollarVol &&
         r.changePct >= SCANNER.minChange &&
         r.atr >= SCANNER.minAtr &&
         r.avgVol >= SCANNER.minAvgVol &&
         r.adrPct != null && r.adrPct >= SCANNER.minAdrPct
      )
      .slice(0, SCANNER.finalSize);

    const finalDaily = dailyCandidates
      .map((t: any) => enrichedMap.get(t.ticker))
      .filter((r: any) =>
         r !== undefined &&
         r.vol >= SCANNER.minVolume &&
         r.dVol >= SCANNER.minDollarVol &&
         r.changePct >= SCANNER.minChange &&
         r.adrPct != null && r.adrPct >= SCANNER.minAdrPct
      )
      .slice(0, SCANNER.finalSize);

    // v6.11: minVolume applied to every bucket. Gainers already had it; the
    // other four did not, so an illiquid name could occupy a Losers or ETF row
    // that a tradeable one was competing for.
    const finalTopMovers = {
      'Mega Caps': megaCapsRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined).slice(0, 10),
      'Gainers': gainersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined && r.vol >= SCANNER.minVolume).slice(0, 10),
      'Losers': losersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined && r.vol >= SCANNER.minVolume).slice(0, 10),
      'ETF Gainers': etfGainersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined && r.vol >= SCANNER.minVolume).slice(0, 10),
      'ETF Losers': etfLosersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined && r.vol >= SCANNER.minVolume).slice(0, 10)
    };

    // QQQ benchmark moving averages
    let benchmark: any = null;
    try {
      const qqqTo = new Date().toISOString().split('T')[0];

      const dFromDate = new Date();
      dFromDate.setDate(dFromDate.getDate() - 420);
      const dailyRes = await fetchSafeJson(
        `https://api.polygon.io/v2/aggs/ticker/QQQ/range/1/day/${dFromDate.toISOString().split('T')[0]}/${qqqTo}?adjusted=true&sort=desc&limit=400&apiKey=${polygonApiKey}`,
        { results: [] }
      );
      const dailyBars = (dailyRes.results || []).sort((a: any, b: any) => b.t - a.t);

      const weekIndex = (ms: number) => Math.floor((Math.floor(ms / 86400000) + 3) / 7);
      const seenWeeks = new Set<number>();
      const weeklyBars: { c: number }[] = [];
      for (const b of dailyBars) {
        const wi = weekIndex(b.t);
        if (!seenWeeks.has(wi)) {
          seenWeeks.add(wi);
          weeklyBars.push({ c: b.c });
        }
      }

      const smaOf = (bars: any[], n: number): number | null => {
        if (bars.length < n) return null;
        let sum = 0;
        for (let i = 0; i < n; i++) sum += bars[i].c;
        return sum / n;
      };
      const buildSet = (bars: any[], price: number, periods: number[]) =>
        periods
          .map((p) => {
            const v = smaOf(bars, p);
            return v == null ? null : { label: String(p), value: parseFloat(v.toFixed(2)), above: price >= v };
          })
          .filter((m): m is { label: string; value: number; above: boolean } => m !== null);

      if (dailyBars.length >= 10) {
        const qqqPrice = parseFloat(dailyBars[0].c.toFixed(2));
        benchmark = {
          symbol: 'QQQ',
          price: qqqPrice,
          day: buildSet(dailyBars, qqqPrice, [10, 21, 30, 50]),
          week: buildSet(weeklyBars, qqqPrice, [5, 10, 30, 50]),
        };
      }
    } catch (e) {
      benchmark = null;
    }

    const finalScanTime = Date.now();

    const hasRealData =
      (finalTopMovers['Gainers']?.length > 0) ||
      (finalTopMovers['Losers']?.length > 0) ||
      (finalDaily.length > 0) ||
      (finalSip.length > 0);

    if (hasRealData) {
      await kv.set('update_phase_v6', currentPhase);
      await kv.set('update_date_v6', currentDate);
      await kv.set('daily_setups_v6', finalDaily);
      await kv.set('stocks_in_play_v6', finalSip);
      await kv.set('top_movers_v6', finalTopMovers);
      await kv.set('last_scan_time_v6', finalScanTime);
      // Persist the gate metadata too, so the `latest` endpoint can serve the
      // key even on a cold read where no scan has run this session.
      await kv.set('scan_meta_v6', scanMeta);
    } else {
      console.warn('Scan produced no movers; preserving previous KV snapshot.');
    }

    if (benchmark) await kv.set('benchmark_v6', benchmark);

    // --- MACRO BRIEFING (v6.9) ------------------------------------------------
    // Built from this run's own numbers and written with the generatedAt stamp
    // the freshness gate looks for. Same write guard as everything else: a run
    // that surfaced nothing preserves the previous briefing rather than
    // replacing it with a description of an empty scan.
    let macroInsights: any = null;
    if (hasRealData) {
      const surfaced = Array.from(
        new Map([...finalSip, ...finalDaily].map((t: any) => [t.ticker, t])).values()
      );
      const built = buildMacroBriefing({
        breadthSignal,
        breadthScore,
        advancers,
        decliners,
        up4,
        down4,
        pctAdv,
        newHighs,
        newLows,
        spyAbove21,
        spyChgToday,
        hotSectors: hotSectorList,
        surfaced,
        topMovers: finalTopMovers,
      });
      macroInsights = {
        ...built,
        generatedAt: new Date().toISOString(),
        phase: currentPhase,
      };
      try {
        await kv.set('macro_insights_v6', macroInsights);
      } catch (e) { console.error('macro insights persist failed', e); }
    } else {
      macroInsights = await readFreshMacroInsights();
    }

    return NextResponse.json({
      success: true,
      marketStatus: currentMarketStatus,
      lastScanTime: finalScanTime,
      dailyCount: finalDaily.length,
      sipCount: finalSip.length,
      topMoversGenerated: true,
      topMovers: finalTopMovers,
      macroInsights,
      benchmark,
      sips: finalSip,
      dailySetups: finalDaily,
      scanMeta,
      dataPersisted: hasRealData,
      // Diagnostics — how much of the universe actually got a real catalyst.
      catalystCoverage: {
        scanned: enrichedList.length,
        wiimMatched: wiimMap.size,
        earningsMatched: enrichedList.filter((t: any) => t.earningsReported).length,
        technicalOnly: enrichedList.filter((t: any) => t.catalyst === 'Technical Momentum').length,
        // v6.11: how often the structural ceiling bound. If this is near zero
        // the thresholds are too loose; if it is most of the board, the scan
        // is surfacing broken names and the upstream gates want a look.
        gradeCapped: enrichedList.filter((t: any) => t.cnfCeiling != null && t.cnfCeiling < 100).length,
      },
      fromCache: false
    }, { headers: noStoreHeaders });

  } catch (error: any) {
    console.error("Scanner Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// BACKGROUND WRAPPER (v6.7)
// ---------------------------------------------------------------------------
// DEFAULT BEHAVIOUR IS UNCHANGED: a plain GET runs the scan and returns the
// full payload. Nothing in the dashboard or in any existing caller changes.
//
// Background mode is OPT-IN via ?bg=true — that is the URL you give
// cron-job.org. It replies in ~50ms so the 30s caller timeout never fires,
// while the scan keeps running via Next's after().
//
//   cron-job.org URL:  /api/scanner/run?bg=true
//   browser / manual:  /api/scanner/run?force=true   (unchanged, full JSON)

const bgHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

// Keeps the function alive after the response is sent. Uses Next's after(),
// which needs no extra package. Returns false if this Next version lacks it.
async function scheduleAfterResponse(work: () => Promise<any>): Promise<boolean> {
  try {
    const nx: any = await import('next/server');
    const after = nx.after || nx.unstable_after;
    if (typeof after === 'function') {
      after(() => work());
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const background = searchParams.get('bg') === 'true';

  // Not a background call — behave exactly as before.
  if (!background) return runScan(request);

  const work = async () => {
    const started = Date.now();
    try {
      const res = await runScan(request);
      console.log(`[scanner] background run finished ${res.status} in ${Date.now() - started}ms`);
    } catch (err: any) {
      console.error(`[scanner] background run failed after ${Date.now() - started}ms:`, err?.message || err);
    }
  };

  const scheduled = await scheduleAfterResponse(work);

  if (!scheduled) {
    // after() unavailable on this runtime — replying now would freeze the
    // function and kill the scan, so run it inline instead.
    await work();
    return NextResponse.json(
      { success: true, mode: 'inline-fallback', startedAt: new Date().toISOString() },
      { headers: bgHeaders }
    );
  }

  return NextResponse.json(
    { success: true, mode: 'background', startedAt: new Date().toISOString() },
    { headers: bgHeaders }
  );
}

export async function POST(request: Request) {
  return GET(request);
}