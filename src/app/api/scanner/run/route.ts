// src/app/api/scanner/run/route.ts — v6.20
//
// v6.20: NEWS MOVED FROM BENZINGA WIIM TO POLYGON.
//
//   WIIM matched 3 of 80 scanned names. 58 fell through to "Technical
//   Momentum". The cause was not thin coverage — it was an entitlement: the
//   Benzinga news endpoint returns an EMPTY JSON ARRAY for an authenticated
//   key without the news product, which is indistinguishable from a quiet
//   news day. Both fetchBenzingaWiims and fetchEarningsCalendar swallow
//   errors and return empty maps, so a dead credential and a slow news week
//   looked identical and had been invisible for weeks.
//
//   THIS COSTS ZERO ADDITIONAL API CALLS. enrichCandidate already fetched
//   /v2/reference/news per ticker and used it only as a fallback behind
//   WIIM — the results were there all along, barely read. What changed is
//   what happens to them.
//
//   Selection now lives in @/lib/indicators/news, because an aggregated feed
//   needs far more rejection than an editorial one. Polygon carries Zacks
//   rank updates published on a schedule, Motley Fool listicles, Simply Wall
//   St auto-valuations. Those are WORSE THAN NO CATALYST: a row showing a
//   headline reads as a stock with a reason to move, so filler converts a
//   technical mover into an apparently news-driven one — a false positive
//   you will act on. "No catalyst" is honest; a Zacks headline is a lie with
//   a link.
//
//   The sharpest of those filters is the causal test. "Shares Rise 5%" is
//   the scan's own finding reflected back at it; "Rises On Blackwell Orders"
//   is a catalyst. A headline containing move-language must also contain a
//   because-clause to survive.
//
//   NOTE ON EARNINGS: fetchEarningsCalendar still uses Benzinga and returned
//   earningsMatched: 0 on the same run that exposed the news problem. That
//   is the same credential on a different endpoint and is probably also
//   dead, which would mean the CNF earnings component (+5) never fires.
//   Left in place rather than removed blind — 0 could legitimately mean no
//   earnings in a three-day window — but it is worth a direct check.
//
// v6.19: rsVsSpy REPLACED by the market-wide RS RATING from /api/rs/run.
// v6.1–v6.10: RMV/RME/stage/money-flow/daysToCover indicators; scanConfig
//   thresholds; background scan mode; deterministic macro briefing;
//   distToEma10 on every row
// v6.11: spam filter rebuilt as regex; structural CNF ceiling on Stage 4 /
//   dead cross / deep drawdown; detectPattern returns stageNum
// v6.12: + blue/red dots; red-dot CNF ceiling with bear-instrument exemption
// v6.13: + reversal pattern for names repairing from BELOW the 21 EMA
// v6.14: reversal collapsed to one name; 10 EMA reclaim carried as a CNF
//   component rather than a second label
// v6.15: + raw EMA levels and a trade plan on every row
// v6.16: changePct passed to the planner; runway component graded rather
//   than binary; collapsed charts capped at 44
// v6.17: + absolute extension ceiling keyed to ATRs above the 21 EMA, because
//   RME is a percentile and saturates — PN at 198% above its anchor and MA at
//   7% above both read -12
// v6.19: rsVsSpy REPLACED by the market-wide RS RATING from /api/rs/run.
//
//   Until now "RS" meant two different things on this dashboard. The VCP
//   table showed a PERCENTILE — 88 meaning stronger than 88% of the liquid
//   market. Every other table, this route included, showed a SPREAD: +18
//   meaning eighteen points of three-month outperformance versus SPY. Same
//   three-letter column header, different claims, and no way to tell from
//   the number which one you were reading.
//
//   The percentile is the better measure for exactly the case where you
//   would want to know: +18 versus SPY might be 60th percentile in a strong
//   tape and 95th in a weak one. The spread cannot distinguish those, and
//   Minervini's 70 floor and 80-90+ preference are percentile statements
//   that mean nothing applied to a spread.
//
//   The rating is NOT computed here. /api/rs/run ranks the whole market once
//   a day and writes a symbol → percentile map to KV; this route looks up.
//   Four routes each computing their own would give four ranking populations
//   and four different answers for the same stock on the same day, which is
//   the inconsistency the change exists to remove.
//
//   AS-OF-CLOSE. A stock up 8% today does not move its rating until the next
//   run. That is correct — IBD's works the same way — and it will look wrong
//   the first time it is noticed.
//
//   rsVsMkt IS UNTOUCHED and still feeds CNF. It measures TODAY's move
//   against SPY's today, which is a different quantity from trailing
//   relative strength and is the one the score actually wants. rsVsSpy was
//   display-only, so this swap does not move a single CNF score.
//
// v6.18: + PER-TICKER CHOPPINESS INDEX (chop14).
//
//   The scan's anti-chop gate is minAdrPct. ADR says the name MOVES. It does
//   not say the name moves SOMEWHERE, and those are different questions.
//
//   A stock with 8% ADR and CHOP 75 travels enormous distance every session
//   and ends the month where it started. It clears the ADR floor cleanly, it
//   looks volatile and therefore tradeable, and it is the single worst thing
//   that can reach the board — every trigger fires, every stop gets hit, and
//   the range never resolves. ADR alone cannot see it. CHOP can:
//
//       CHOP = 100 x log10( sum TR(n) / (maxHigh(n) - minLow(n)) ) / log10(n)
//
//   distance travelled over ground covered. Above 61.8 the name churns;
//   below 38.2 it trends.
//
//   NO NEW API CALL. dailyBars is already in scope for the ADR, ATR, EMA and
//   RME computations — this is the same array read one more way.
//
//   NOT GATED, DELIBERATELY. This version only EMITS the field. Gating at
//   61.8 immediately would silently stop surfacing names with no way to know
//   whether the threshold is right for this universe. catalystCoverage now
//   reports the distribution, including the trap quadrant (ADR >= 5% with
//   CHOP >= 61.8) — the count that says how many current candidates are chop
//   machines the ADR floor is letting through. Gate on evidence, in v6.19,
//   once that number has been watched for a week.
//
//   CNF IS ALSO UNTOUCHED for the same reason. A chop penalty would move
//   every score at once and make the effect impossible to isolate.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { computeRMV } from '@/lib/indicators/rmv';
import { computeRMEDetail, rmeScoreAdjustment } from '@/lib/indicators/rme';
import { computeStageDetail } from '@/lib/indicators/stage';
import { computeMoneyFlow, moneyFlowTrend } from '@/lib/indicators/moneyflow';
import { computeDotDetail } from '@/lib/indicators/dots';
import { computeTradePlan } from '@/lib/indicators/tradeplan';
import { choppiness, CHOP_PERIOD_DEFAULT, CHOP_CHOP_MIN, CHOP_TREND_MAX } from '@/lib/indicators/chop';
import { loadRsRatings, type RsLookup } from '@/lib/indicators/rs';
import { rawRsScore, percentileRank } from '@/lib/indicators/vcp';
import { pickBestNews, fetchBenzingaNewsIndex, enrichBenzingaIndex, type NewsItem } from '@/lib/indicators/news';
import {
  computeCnfScore, atrsAboveAnchor, isBreakoutSetupName, isReversalSetupName,
  EXT_HARD_ATRS, EXT_PARABOLIC_ATRS, EXT_HARD_PCT_NO_ATR, EXT_PARABOLIC_PCT_NO_ATR,
} from '@/lib/indicators/confluence';
import { SCANNER, SCANNER_SIP_META, SCANNER_DAILY_META, TOPMOVERS_META } from '@/lib/scanConfig';
import { enrichWithFundamentals } from '@/lib/indicators/fundamentals';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

const SECTOR_MAP: Record<string, string> = {
  'AAPL': 'Tech', 'MSFT': 'Tech', 'SMCI': 'Tech',
  'NVDA': "Semi's", 'AMD': "Semi's", 'INTC': "Semi's",
  'AVGO': "Semi's", 'MU': "Semi's", 'ARM': "Semi's",
  'QCOM': "Semi's", 'TSM': "Semi's",
  'PLTR': 'AI', 'SOUN': 'AI', 'BBAI': 'AI',
  'AI': 'AI', 'CRWD': 'Cyber', 'PANW': 'Cyber', 'ZS': 'Cyber',
  'COIN': 'Fintech', 'MSTR': 'Fintech', 'MARA': 'Fintech', 'RIOT': 'Fintech', 'CLSK': 'Fintech',
  'IREN': 'Fintech', 'CIFR': 'Fintech', 'HUT': 'Fintech', 'HOOD': 'Fintech', 'SOFI': 'Fintech', 'UPST': 'Fintech', 'BMNR': 'Fintech',
  'TSLA': 'EV', 'NIO': 'EV', 'LI': 'EV', 'XPEV': 'EV',
  'LUNR': 'Aerospace', 'ASTS': 'Aerospace', 'RKLB': 'Aerospace', 'SPCX': 'Aerospace',
  'CEG': 'Nuclear', 'OKLO': 'Nuclear', 'CCJ': 'Nuclear', 'SMR': 'Nuclear', 'LEU': 'Nuclear',
  'FSLR': 'Solar', 'ENPH': 'Solar', 'RUN': 'Solar',
  'HIMS': 'Health', 'NVO': 'Health', 'LLY': 'Health', 'COO': 'Health',
  'AMZN': 'Con Disc', 'UBER': 'Con Disc', 'BABA': 'Con Disc',
  'PDD': 'Con Disc', 'JD': 'Con Disc',
  'PG': 'Staples',
  'META': 'Comm Svc', 'GOOGL': 'Comm Svc', 'NFLX': 'Comm Svc',
  'RDDT': 'Comm Svc', 'DJT': 'Comm Svc'
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
  'AAPU': 'AAPL - Tech', 'AAPD': 'AAPL - Tech', 'APLX': 'AAPL - Tech',
  'MSFU': 'MSFT - Tech', 'MSFD': 'MSFT - Tech',
  'GGLL': 'GOOGL - Comm Svc', 'GGLS': 'GOOGL - Comm Svc',
  'BABX': 'BABA - Con Disc', 'BABD': 'BABA - Con Disc',
  'LLYX': 'LLY - Health', 'LLYD': 'LLY - Health',
  'AMDL': "AMD - Semi's", 'AMDS': "AMD - Semi's",
  'AVGX': "AVGO - Semi's",
  'SMU': 'SMCI - Tech', 'SMCX': 'SMCI - Tech', 'SMCZ': 'SMCI - Tech',
  'DLLL': 'DELL - Tech', 'LUNL': 'LUNR - Aerospace', 'OKLL': 'OKLO - Nuclear', 'PLTU': 'PLTR - AI',
  'METU': 'META - Comm Svc', 'TEMT': 'META - Comm Svc', 'SOFX': 'SOFI - Fintech', 'ROBN': 'HOOD - Fintech',
  'RVNL': 'RIVN - EV', 'LCDL': 'LCID - EV', 'INTW': "INTC - Semi's",
  'GMEU': 'GME - Con Disc', 'APPX': 'APP - Tech',
  'IONX': 'IONQ - Tech', 'IONZ': 'IONQ - Tech', 'QPUX': 'IONQ - Tech', 'CEGX': 'CEG - Nuclear',
  'ASMG': "ASML - Semi's", 'UUUG': 'U - Tech', 'FBL': 'META - Comm Svc', 'HIMZ': 'HIMS - Health',
  'RDTL': 'RDDT - Comm Svc', 'RCAX': 'RCAT - Aerospace', 'SOUX': 'SOUN - AI',
  'RKLB': 'RKLB - Aerospace', 'RKLX': 'RKLB - Aerospace',
  'ASTS': 'ASTS - Aerospace', 'ASTX': "AXTI - Semi's",
  'SPCF': 'SPCX - Aerospace 2X', 'SSPC': 'SPCX - Aerospace -2X', 'SPCH': 'SPCX - Aerospace 2X',
  'RGTX': 'RGTI - Tech', 'RGTU': 'RGTI - Tech', 'RGTZ': 'RGTI - Tech',
  'TQQQ': 'QQQ - Nasdaq 3X', 'SQQQ': 'QQQ - Nasdaq -3X', 'QID': 'QQQ - Nasdaq -2X', 'QLD': 'QQQ - Nasdaq 2X', 'SNDQ': 'QQQ - Nasdaq ETF',
  'SOXL': "SOXX - Semi's 3X", 'SOXS': "SOXX - Semi's -3X", 'TECL': 'XLK - Tech 3X', 'TECS': 'XLK - Tech -3X',
  'FNGU': 'FNGU - Big Tech 3X', 'FNGD': 'FNGD - Big Tech -3X',
  'TNA': 'IWM - Small Cap 3X', 'TZA': 'IWM - Small Cap -3X', 'FAS': 'XLF - Financials 3X', 'FAZ': 'XLF - Financials -3X',
  'SPY': 'SPY - S&P 500', 'UPRO': 'SPY - S&P 3X', 'SPXL': 'SPY - S&P 3X', 'SPXS': 'SPY - S&P -3X', 'SPXU': 'SPY - S&P -3X',
  'UVXY': 'VIX - Volatility 1.5X', 'UVIX': 'VIX - Volatility 2X', 'SVIX': 'VIX - Volatility -1X', 'VIXY': 'VIX - Volatility',
  'MSOX': 'MSOS - Cannabis 2X', 'NAIL': 'XHB - Homebuilders 3X', 'LABX': 'XBI - Biotech 2X', 'KORU': 'EWY - South Korea 3X',
  'ZSL': 'SLV - Silver -2X', 'URAA': 'URA - Uranium 2X', 'GDXD': 'GDX - Gold Miners -3X',
  'QQQ': 'QQQ - Nasdaq', 'IWM': 'IWM - Small Cap', 'DIA': 'DIA - Dow Jones', 'VOO': 'VOO - S&P 500', 'VTI': 'VTI - Total Market',

  'SNXX': "SNDK - Semi's",
  'AXTX': "AXTI - Semi's",
  'CRDU': "CRDO - Semi's",
  'AAOX': "AAOI - Semi's",

  'ASTY': 'ASTS - Aerospace', 'ASUP': 'ASTS - Aerospace', 'ASTG': 'ASTS - Aerospace',
  'HYNX': "SKHY - Semi's", 'SKUU': "SKHY - Semi's", 'SKHL': "SKHY - Semi's",
  'SK': "SKHY - Semi's", 'SKHU': "SKHY - Semi's", 'SKHX': "SKHY - Semi's",
  'SNDU': "SNDK - Semi's", 'SNDG': "SNDK - Semi's", 'SNDC': "SNDK - Semi's",
  'STXL': "STX - Semi's", 'STXX': "STX - Semi's", 'STXU': "STX - Semi's",
  'AXTU': "AXTI - Semi's", 'AXTL': "AXTI - Semi's",
  'DRAM': 'DRAM - Memory ETF', 'RAM': 'DRAM - Memory 2X', 'DRAL': 'DRAM - Memory 2X', 'KMEM': 'KMEM - Memory ETF',
  'MUU': "MU - Semi's", 'MULL': "MU - Semi's", 'MIC': "MU - Semi's",
  'WDCX': "WDC - Semi's", 'LITU': "LITE - Semi's", 'LITX': "LITE - Semi's",
  'SMTG': "SMTC - Semi's", 'COHX': "COHR - Semi's", 'COHH': "COHR - Semi's",
  'AMA': "AMAT - Semi's", 'MVLL': "MRVL - Semi's", 'MRVU': "MRVL - Semi's",
  'ARMG': "ARM - Semi's", 'ARMW': "ARM - Semi's", 'FNG': "FN - Semi's",
  'CSEX': 'CLS - Tech', 'AAOG': "AAOI - Semi's",
  'NEBX': 'NBIS - AI', 'NBIG': 'NBIS - AI', 'NBIL': 'NBIS - AI',
  'CWVX': 'CRWV - AI', 'CRWX': 'CRWV - AI',
  'BEX': 'BE - Energy', 'BEG': 'BE - Energy', 'EOSU': 'EOSE - Energy',
  'PLUL': 'PLUG - Energy', 'GEVG': 'GEV - Energy', 'GEVX': 'GEV - Energy',
  'LEUX': 'LEU - Nuclear', 'LACG': 'LAC - Lithium',
  'UCO': 'USO - Crude Oil 2X', 'UGA': 'UGA - Gasoline', 'WTIU': 'WTIU - Energy 3X',
  'PLU': 'PL - Aerospace', 'UMAL': 'UMAC - Aerospace', 'RDWU': 'RDW - Aerospace',
  'NFLW': 'NFLX - Comm Svc', 'CSCL': 'CSCO - Tech', 'ORCX': 'ORCL - Tech', 'ORCU': 'ORCL - Tech',
  'PALU': 'PANW - Cyber', 'PANG': 'PANW - Cyber', 'NETG': 'NET - Tech',
  'UNHG': 'UNH - Health', 'CATG': 'CAT - Industrl', 'DUOG': 'DUOL - Tech',
  'FIGG': 'FIG - Tech', 'LMNX': 'LMND - Fintech', 'HUTG': 'HUT - Fintech',
  'BMNG': 'BMNR - Fintech', 'LNOK': 'NOK - Tech', 'QUBX': 'QUBT - Tech',
  'ECHX': 'ECHO - Tech', 'INFH': 'INFQ - Tech', 'WYFL': 'WYFI - Tech',
  'KEEX': 'KEEL - Industrl', 'VELL': 'VELO - Industrl',
  'LABU': 'XBI - Biotech 3X', 'PILL': 'PILL - Pharma 2X',
  'EZJ': 'EWJ - Japan 2X', 'EWY': 'EWY - South Korea', 'FLKR': 'FLKR - South Korea',
  'FOTO': 'FOTO - Photonics ETF',

  // Single-stock leveraged — AAPL
  'AAPB': 'AAPL - Tech',
  // ADBE
  'ADBG': 'ADBE - Tech',
  // AFRM
  'AFRU': 'AFRM - Fintech',
  // ALB
  'ALBG': 'ALB - Materials',
  // AMD bear
  'AMDD': "AMD - Semi's",
  // ACHR (Archer Aviation)
  'ARCX': 'ACHR - Aerospace',
  // AVGO additional
  'AVGG': "AVGO - Semi's", 'AVGU': "AVGO - Semi's", 'AVL': "AVGO - Semi's", 'AVGW': "AVGO - Semi's",
  // AVAV (AeroVironment)
  'AVXX': 'AVAV - Aerospace',
  // BBAI (BigBear.ai)
  'BAIG': 'BBAI - AI',
  // BIDU
  'BIDG': 'BIDU - Tech', 'KBDU': 'BIDU - Tech',
  // BLSH (Blade Air Mobility)
  'BLSG': 'BLSH - Aerospace',
  // BMNR additional
  'BMNU': 'BMNR - Fintech',
  // BULL (Corcept Therapeutics)
  'BULG': 'BULL - Health',
  // CIFR (Cipher Mining)
  'CIFG': 'CIFR - Crypto', 'CIFU': 'CIFR - Crypto',
  // CLSK (CleanSpark)
  'CLSX': 'CLSK - Crypto',
  // COIN additional
  'COIG': 'COIN - Fintech', 'COIW': 'COIN - Fintech',
  // CRCL (Circle)
  'CRCG': 'CRCL - Fintech', 'CCUP': 'CRCL - Fintech', 'CRCO': 'CRCL - Fintech',
  // CRM (Salesforce)
  'CRMG': 'CRM - Tech',
  // CRML (Caramel/Coreweave?)
  'CRMU': 'CRWV - AI', 'CRMX': 'CRWV - AI', 'CORD': 'CRWV - AI',
  // CRWD (CrowdStrike)
  'CRWL': 'CRWD - Cyber',
  // COIN/CORZ (Core Scientific)
  'COZX': 'CORZ - Crypto',
  // DJT
  'DJTU': 'DJT - Comm Svc',
  // FCX (Freeport-McMoRan)
  'FCXG': 'FCX - Materials',
  // FIGR (Figure?)
  'FGRU': 'FIG - Tech',
  // FNGG/FNGO — FANG+ index leveraged
  'FNGG': 'FANG+ - Big Tech 2X', 'FNGO': 'FANG+ - Big Tech 2X',
  // GEMI (Gemini Therapeutics)
  'GEMG': 'GEMI - Health',
  // GLXY (Galaxy Digital)
  'GLGG': 'GLXY - Crypto', 'GLXU': 'GLXY - Crypto',
  // HOOD additional
  'HODU': 'HOOD - Fintech', 'HOOG': 'HOOD - Fintech', 'HOOX': 'HOOD - Fintech', 'HOOW': 'HOOD - Fintech',
  // INTC additional
  'LINT': "INTC - Semi's",
  // IONQ additional
  'IONL': 'IONQ - Tech',
  // IREN
  'IRE': 'IREN - Crypto', 'IREG': 'IREN - Crypto', 'IREX': 'IREN - Crypto',
  // KTOS (Kratos Defense)
  'KTUP': 'KTOS - Aerospace',
  // LRCX (Lam Research)
  'LRCU': "LRCX - Semi's",
  // META bear
  'METD': 'META - Comm Svc',
  // MSFT additional
  'MSFL': 'MSFT - Tech', 'MSFX': 'MSFT - Tech',
  // MSTR additional
  'MSTP': 'MSTR - Fintech', 'MST': 'MSTR - Fintech', 'MSTW': 'MSTR - Fintech', 'MSTY': 'MSTR - Fintech',
  // MU bear
  'MUD': "MU - Semi's",
  // NEM (Newmont)
  'NEMG': 'NEM - Gold',
  // NFLX bear
  'NFXS': 'NFLX - Comm Svc',
  // NOW (ServiceNow)
  'NOWL': 'NOW - Tech',
  // NVDA additional
  'NVDG': "NVDA - Semi's", 'NVDU': "NVDA - Semi's", 'NVDW': "NVDA - Semi's", 'NVDY': "NVDA - Semi's", 'NVIT': "NVDA - Semi's",
  // OKTA
  'OKTG': 'OKTA - Cyber',
  // ONDS (Ondas Holdings)
  'ONDG': 'ONDS - Tech', 'ONDL': 'ONDS - Tech', 'ONDU': 'ONDS - Tech',
  // PATH (UiPath)
  'PATX': 'PATH - AI',
  // PLTR additional
  'PLTG': 'PLTR - AI', 'PTIR': 'PLTR - AI', 'PLTW': 'PLTR - AI',
  // PONY (Pony AI)
  'PONX': 'PONY - AI',
  // QBTS (D-Wave Quantum)
  'QBTX': 'QBTS - Tech',
  // QCOM
  'QCML': "QCOM - Semi's", 'QCMU': "QCOM - Semi's",
  // QS (QuantumScape)
  'QSU': 'QS - EV',
  // RBLX (Roblox)
  'RBLU': 'RBLX - Tech',
  // RKT (Rocket Companies)
  'RKTL': 'RKT - Fintech',
  // SBET (SharpLink Gaming)
  'SBTU': 'SBET - Tech',
  // SHOP (Shopify)
  'SHPU': 'SHOP - Tech',
  // SMCI additional
  'SMCL': 'SMCI - Tech',
  // SMR (NuScale Power)
  'SMUP': 'SMR - Nuclear',
  // SNAP
  'SNAG': 'SNAP - Comm Svc',
  // SNOW (Snowflake)
  'SNOU': 'SNOW - Tech',
  // SOFI additional
  'SOFA': 'SOFI - Fintech',
  // TER (Teradyne)
  'TERG': "TER - Semi's",
  // TSLA additional
  'TSL': 'TSLA - EV', 'TSLG': 'TSLA - EV', 'TSLR': 'TSLA - EV', 'TSLT': 'TSLA - EV', 'TSLW': 'TSLA - EV', 'TSLY': 'TSLA - EV',
  // TSM (Taiwan Semi)
  'TSMG': "TSM - Semi's", 'TSMU': "TSM - Semi's", 'TSMX': "TSM - Semi's",
  // TTD (The Trade Desk)
  'TTDU': 'TTD - Tech',
  // UEC (Uranium Energy)
  'UECG': 'UEC - Nuclear',
  // UPST (Upstart)
  'UPSX': 'UPST - Fintech',
  // USAR
  'USAX': 'USAR - Aerospace', 'USGG': 'USAR - Aerospace',
  // VRT (Vertiv)
  'VRTL': 'VRT - Tech',
  // WULF (TeraWulf)
  'WULX': 'WULF - Crypto',
  // XYZ (Block)
  'XYZG': 'XYZ - Fintech',
  // ZETA
  'ZETX': 'ZETA - Tech',

  // Crypto ETFs (non-leveraged and leveraged)
  'BITU': 'BTC - Bitcoin', 'BTCL': 'BTC - Bitcoin',
  'ETHT': 'ETH - Ethereum',
  'SLON': 'SOL - Solana',
  'UXRP': 'XRP - Crypto', 'XXRP': 'XRP - Crypto',
  'TXXD': 'DOGE - Crypto', 'TXXS': 'SUI - Crypto',

  // Index/sector leveraged
  'DDM': 'DIA - Dow Jones 2X', 'UDOW': 'DIA - Dow Jones 3X',
  'SSO': 'SPY - S&P 2X',
  'ROM': 'XLK - Tech 2X', 'USD': "SOXX - Semi's 2X",
  'UCYB': 'Cyber - Cyber 2X', 'SKYU': 'Cloud - Cloud 2X',
  'MAGX': 'MAG7 - Big Tech 2X', 'QQQU': 'MAG7 - Big Tech 2X',
  'NUGT': 'GDX - Gold Miners 2X', 'GDXU': 'GDX - Gold Miners 3X', 'JNUG': 'GDXJ - Jr Gold 2X',
  'BULZ': 'FANG+ - Big Tech 3X',
  'TSXU': "Semi's - Top 5 Semi 2X", 'TTXU': 'Tech - Top 5 Tech 2X',
};

const getMarketStatus = () => {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const time = now.getHours() + (now.getMinutes() / 60);
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

const etDateString = (d: Date): string =>
  d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/* The spam regexes and isSpamNews/isNegativeHeadline that used to live here
   are gone. Every one of their cases is now covered inside
   @/lib/indicators/news — law-firm solicitations and legal boilerplate by
   its shape filters, dilutive and going-concern language by classifyNews
   landing on Offering or Legal / Risk. Keeping local copies as a
   "defensive" second check is how two classifiers drift apart and start
   disagreeing about the same headline. */

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

import { cleanSectorDescription } from '@/lib/sectors';

const deriveTradeType = (setupName: string | null | undefined): string => {
  if (!setupName) return '';
  const s = setupName.toLowerCase();
  if (s === 'none' || s === '—') return '';
  if (s.includes('gap & go') || s.includes('r2g') || s.includes('sqz fired') || s.includes('episodic')) return 'Day Trade';
  if (s.includes('glb') || s.includes('vcp') || s.includes('ema pb') || s.includes('trend hold') ||
      s.includes('inside day') || s.includes('blue dot') || s.includes('sqz building') ||
      s.includes('reversal')) return 'Swing';
  return 'Swing';
};

const CHOP_TRAP_MIN_ADR = 5;


const buildReadout = (t: any): string | null => {
  const parts: string[] = [];
  if (t.dotKind === 'red') {
    parts.push(`RED DOT${t.dotBarsSince === 0 ? ' today' : ` ${t.dotBarsSince}d ago`}`);
  } else if (t.dotKind === 'blue') {
    parts.push(`BLUE DOT${t.dotBarsSince === 0 ? ' today' : ` ${t.dotBarsSince}d ago`}`);
  }
  if (t.setupName === 'Reversal') {
    parts.push(t.aboveEma10 === true ? '10 EMA reclaimed' : 'still under the 10');
  }
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
  /* The rating is a rank, so it is stated as one. "RS 88" alone reads like
     a score out of 100 and invites the wrong comparison; naming the
     percentile makes the claim explicit in a line that is otherwise all
     magnitudes. */
  if (t.rsRating != null) parts.push(`RS ${t.rsRating} (top ${100 - t.rsRating}%)`);
  if (t.atrPct != null) parts.push(`ATR ${t.atrPct.toFixed(1)}%`);
  if (t.adrPct != null) parts.push(`ADR ${t.adrPct.toFixed(1)}%`);

  /* CHOP is stated with its meaning attached, and PAIRED WITH ADR when the
     two disagree. "ADR 8.2%, CHOP 74" read as two separate numbers looks like
     a volatile name that scores oddly on something; read together it is the
     specific warning — the range is wide and it goes nowhere. That pairing is
     the entire reason the field exists, so the readout says it outright. */
  if (t.chop14 != null) {
    const label =
      t.chop14 >= 70 ? 'dead chop' :
      t.chop14 >= CHOP_CHOP_MIN ? 'choppy' :
      t.chop14 > CHOP_TREND_MAX ? 'mixed' :
      t.chop14 > 30 ? 'trending' : 'strong trend';
    const trap = t.adrPct != null && t.adrPct >= CHOP_TRAP_MIN_ADR && t.chop14 >= CHOP_CHOP_MIN;
    parts.push(`CHOP ${t.chop14.toFixed(0)} (${label})${trap ? ' — wide range going nowhere' : ''}`);
  }

  if (t.goldenCross != null) parts.push(t.goldenCross ? '50>200 intact' : '50<200');

  if (t.plan?.tradeable) {
    const bits: string[] = [];
    if (t.plan.trigger != null) bits.push(`trigger ${t.plan.trigger.toFixed(2)} (${t.plan.triggerLabel})`);
    if (t.plan.stopPct != null) bits.push(`stop −${t.plan.stopPct.toFixed(1)}%`);
    if (t.plan.overextended) bits.push('extended — no usable runway read');
    else if (t.plan.clear) bits.push('2R clear');
    else if (t.plan.resistanceR != null) bits.push(`${t.plan.resistanceLabel} at ${t.plan.resistanceR.toFixed(1)}R`);
    if (bits.length) parts.push(bits.join(', '));
  } else if (t.plan?.collapsed) {
    parts.push('no long plan — price has collapsed');
  }

  if (parts.length === 0) return null;
  return parts.join(', ') + '.';
};

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
  surfaced: any[];
  topMovers: Record<string, any[]>;
}

const buildMacroBriefing = (i: BriefingInput): { theme: string; briefing: string; watching: any[] } => {
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  const sentences: string[] = [];

  const adRatio = i.decliners > 0 ? i.advancers / i.decliners : null;
  const regimeWord =
    i.breadthSignal === 'GREEN' ? 'Risk-on' :
    i.breadthSignal === 'RED' ? 'Risk-off' : 'Mixed';

  const regimeBits: string[] = [
    `Breadth is ${i.breadthSignal} (${i.breadthScore}/6) on ${i.advancers.toLocaleString()} advancers vs ${i.decliners.toLocaleString()} decliners${adRatio != null ? ` (A/D ${adRatio.toFixed(2)})` : ''}`,
  ];
  if (i.up4 + i.down4 > 0) regimeBits.push(`${i.up4} names up 4%+ against ${i.down4} down 4%+`);
  if (i.newHighs + i.newLows > 0) regimeBits.push(`${i.newHighs} new highs vs ${i.newLows} new lows`);
  if (i.spyAbove21 != null) regimeBits.push(`SPY ${pct(i.spyChgToday)} and ${i.spyAbove21 ? 'above' : 'below'} its 21 EMA`);
  sentences.push(`${regimeBits.join(', ')}.`);

  const moverPool = [
    ...(i.topMovers['Gainers'] || []),
    ...(i.topMovers['ETF Gainers'] || []),
  ].filter(Boolean);
  const bearCount = moverPool.filter((t: any) => isBearishInstrument(t?.name)).length;
  const bearShare = moverPool.length > 0 ? bearCount / moverPool.length : 0;

  const leadBits: string[] = [];
  if (i.hotSectors.length > 0) leadBits.push(`Money is concentrated in ${i.hotSectors.join(' and ')}`);
  else leadBits.push('No sector is showing coordinated strength');
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

  const gradeA = i.surfaced.filter((t: any) => t.cnfGrade === 'A').length;
  const gradeB = i.surfaced.filter((t: any) => t.cnfGrade === 'B').length;
  const breakouts = i.surfaced.filter((t: any) => isBreakoutSetupName(t.setupName)).length;
  const reversals = i.surfaced.filter((t: any) => isReversalSetupName(t.setupName)).length;
  const unnamed = i.surfaced.filter((t: any) => !t.setupName).length;
  const ready = i.surfaced.filter((t: any) => t.status === 'Ready').length;
  const extended = i.surfaced.filter((t: any) => t.extended).length;
  const capped = i.surfaced.filter((t: any) => t.cnfCeiling != null && t.cnfCeiling < 100).length;
  const blueDots = i.surfaced.filter((t: any) => t.dotKind === 'blue').length;
  const redDots = i.surfaced.filter((t: any) => t.dotKind === 'red').length;
  const planned = i.surfaced.filter((t: any) => t.plan?.tradeable).length;
  const clearRunway = i.surfaced.filter((t: any) => t.plan?.tradeable && t.plan.clear).length;
  const collapsed = i.surfaced.filter((t: any) => t.plan?.collapsed).length;
  const choppy = i.surfaced.filter((t: any) => t.chop14 != null && t.chop14 >= CHOP_CHOP_MIN).length;

  const actionable = i.surfaced
    .filter((t: any) => t.plan?.tradeable && t.plan.clear && !t.extended)
    .sort((a: any, b: any) => (b.cnfScore ?? 0) - (a.cnfScore ?? 0));
  const actionNames = actionable.slice(0, 5).map((t: any) => t.ticker).join(' ');
  const yieldBits: string[] = [];
  if (actionable.length > 0) {
    yieldBits.push(`${actionable.length} actionable with a defined entry and room — ${actionNames}`);
  } else if (planned > 0) {
    yieldBits.push(`${planned} have an entry but none have 2R of clear air above the trigger`);
  } else {
    yieldBits.push('Nothing on the board has a defined entry right now');
  }
  if (breakouts + reversals > 0) {
    const lean = breakouts > reversals ? 'breakout-heavy' : reversals > breakouts ? 'pullback-heavy' : 'evenly split';
    yieldBits.push(`setup mix is ${lean} (${breakouts} breakout, ${reversals} reversal)`);
  }
  if (blueDots > 0) yieldBits.push(`${blueDots} blue dot${blueDots === 1 ? '' : 's'} firing`);
  if (extended > 0) yieldBits.push(`${extended} extended — wait for pullback`);
  if (choppy > 0) yieldBits.push(`${choppy} in chop`);
  sentences.push(`${yieldBits.join(', ')}.`);

  let posture: string;
  const thinYield = gradeA + gradeB <= 2;
  const mostlyChop = i.surfaced.length >= 4 && choppy / i.surfaced.length >= 0.6;

  if (mostlyChop) {
    posture = `${choppy} of ${i.surfaced.length} surfaced names are churning inside their own 14-day range — the board is full of movement that is not going anywhere, and breakout triggers on these will fire and reverse.`;
  } else if (i.surfaced.length >= 4 && clearRunway === 0) {
    posture = 'Nothing on the board has two stop-widths of clear air above its trigger. Whatever the grades say, there is no room to be paid — wait for a level to break or for price to come back to an anchor.';
  } else if (i.breadthSignal === 'RED' && thinYield) {
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

  const leadDesc =
    bearShare >= 0.5 ? 'bear instruments leading' :
    i.hotSectors.length > 0 ? `${i.hotSectors[0]} leading` :
    'no clear leadership';
  const yieldDesc =
    gradeA + gradeB === 0 ? 'nothing scoring' :
    gradeA > 0 ? `${gradeA} A-grade` :
    `${gradeB} B-grade`;
  const theme = `${regimeWord} — ${leadDesc}, ${yieldDesc}`;

  return { theme, briefing: sentences.join(' '), watching: [] };
};

const detectPattern = (
  bars: any[],
  currentPrice: number,
  currentOpen: number,
  vwap: number,
  rvol: number | null,
  dotKind: 'blue' | 'red' | null,
  stochK: number | null
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

  if (dotKind === 'blue') {
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

  let ema10 = bars[warmUpBars].c;
  let ema21 = bars[warmUpBars].c;
  const k10 = 2 / (10 + 1);
  const k21 = 2 / (21 + 1);
  for (let i = warmUpBars - 1; i >= 0; i--) {
    ema10 = (bars[i].c * k10) + (ema10 * (1 - k10));
    ema21 = (bars[i].c * k21) + (ema21 * (1 - k21));
  }

  const upToday = currentPrice > yest.c;
  const underThe21 = currentPrice < ema21;

  if (upToday && underThe21) {
    const reclaimedTen = currentPrice > ema10;
    const washedOut = stochK != null && stochK <= 35;
    if (reclaimedTen || washedOut) {
      return { name: 'Reversal', stage, stageNum };
    }
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

interface EarningsEntry {
  date: string;
  when: string;
  reported: boolean;
  epsEstimate: number | null;
  epsActual: number | null;
  revEstimate: number | null;
  revActual: number | null;
  epsSurprisePct: number | null;
}

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
      const when: string = (r?.time_of_day || r?.time || '').toString().toUpperCase();
      const reported = date < today || (date === today && !when.includes('AMC'));
      const epsEst = r?.eps_estimate != null ? parseFloat(String(r.eps_estimate)) : null;
      const epsAct = r?.eps_actual != null ? parseFloat(String(r.eps_actual)) : null;
      const revEst = r?.revenue_estimate != null ? parseFloat(String(r.revenue_estimate)) : null;
      const revAct = r?.revenue_actual != null ? parseFloat(String(r.revenue_actual)) : null;
      const epsSurprisePct = epsAct != null && epsEst != null && epsEst !== 0
        ? Math.round(((epsAct - epsEst) / Math.abs(epsEst)) * 10000) / 100
        : null;
      const prev = out.get(ticker);
      if (!prev || date < prev.date) out.set(ticker, {
        date, when, reported,
        epsEstimate: isNaN(epsEst as number) ? null : epsEst,
        epsActual: isNaN(epsAct as number) ? null : epsAct,
        revEstimate: isNaN(revEst as number) ? null : revEst,
        revActual: isNaN(revAct as number) ? null : revAct,
        epsSurprisePct,
      });
    }
  } catch {
    // fail open
  }
  return out;
};

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
  const currentDate = etDateString(new Date());
  const currentMarketStatus = getMarketStatus();

  const noStoreHeaders = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };

  const scanMeta = {
    sip: SCANNER_SIP_META,
    daily: SCANNER_DAILY_META,
    topMovers: TOPMOVERS_META,
  };

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

  const polygonApiKey = process.env.POLYGON_API_KEY || '';
  /* News only. Polygon's per-ticker feed is Motley Fool wall-to-wall on this
     plan, and pickBestNews blocks that publisher — so every row's catalyst
     came back null until Benzinga was put in front of it. */
  const benzingaKey = (process.env.NEXT_PUBLIC_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '').trim();
  if (!polygonApiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 500 });

  /* One lookup for the whole scan, loaded before any per-ticker work.

     Loading it here rather than inside enrichCandidate matters: that function
     runs once per candidate across ~40 concurrent batches, and a KV read per
     ticker would be forty times the requests for a map that cannot change
     mid-scan. The lookup closes over this.

     A miss is not fatal. If /api/rs/run has not executed, or its map is more
     than three days old, every row gets a null rating and the RS column shows
     em-dashes — which is visible and diagnosable. Refusing to scan at all
     because a secondary field is missing would be worse. */
  const rsLookup: RsLookup = await loadRsRatings();

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
      prevResults.forEach((t: any) => prevCloseMap.set(t.T, t.c));

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

    const viableSetups = processedSnapshot.filter((t: any) => /^[A-Z]{1,5}$/.test(t.ticker) && t._livePrice >= SCANNER.minPrice && t._liveVol >= SCANNER.minVolume);
    const spyChgToday = processedSnapshot.find((t: any) => t.ticker === 'SPY')?._liveChg ?? 0;

    // Lightweight {ticker: [changePct, price]} map from the full snapshot.
    // Persisted to KV so MarketSummary can overlay fresh changePct onto
    // stale swing/consol plan pool entries that still show Friday's 0%.
    const liveChgMap: Record<string, [number, number]> = {};
    for (const t of processedSnapshot) {
      if (t.ticker && /^[A-Z]{1,5}$/.test(t.ticker) && t._livePrice > 0) {
        liveChgMap[t.ticker] = [
          Math.round((t._liveChg ?? 0) * 100) / 100,
          Math.round(t._livePrice * 100) / 100,
        ];
      }
    }

    // Breadth counts use the FULL snapshot (all US equities >= $1 with
    // standard ticker format) so the A/D and ATHI/ATLO readings match
    // market-wide indices rather than the scanner's filtered universe.
    const breadthUniverse = processedSnapshot.filter((t: any) =>
      t._livePrice >= 1 && /^[A-Z]{1,5}$/.test(t.ticker)
    );
    let advancers = 0, decliners = 0, up4 = 0, down4 = 0;
    for (const t of breadthUniverse) {
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

    /* ---- Stockbee Market Monitor -------------------------------------------
       A SECOND, STRICTER UNIVERSE, deliberately not the one above. Stockbee's
       monitor specifies close >= $3 and volume >= 100k precisely to exclude
       the sub-$3 and illiquid names that dominate raw 4% counts — a $1.20
       stock moving four cents clears a 4% move without meaning anything.

       So mm4Up will read LOWER than the up4 beside it. That is the filter
       working, not a discrepancy. The looser counts stay as they are because
       A/D and ATHI/ATLO are meant to track market-wide indices. */
    const MM_MIN_PRICE = 3.00;
    const MM_MIN_VOLUME = 100_000;

    const mmUniverse = processedSnapshot.filter((t: any) =>
      t._livePrice >= MM_MIN_PRICE && t._liveVol >= MM_MIN_VOLUME && /^[A-Z]{1,5}$/.test(t.ticker)
    );
    let mm4Up = 0, mm4Down = 0;
    for (const t of mmUniverse) {
      const chg = t._liveChg || 0;
      if (chg >= 4) mm4Up++; else if (chg <= -4) mm4Down++;
    }

    /* The weekly ratio needs history the snapshot cannot provide, so the daily
       counts are buffered here. Keyed by ET trading date and rewritten in
       place, so several runs in one session update today rather than stacking
       five copies of it into the window. The week starts on Monday — entries
       before this week's Monday are excluded from the sum. */
    let mm5Up: number | null = null, mm5Down: number | null = null, mm5Days = 0;
    try {
      const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const etToday = etNow.toISOString().slice(0, 10);
      const dayOfWeek = etNow.getDay();
      const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(etNow);
      monday.setDate(monday.getDate() - daysBack);
      const mondayStr = monday.toISOString().slice(0, 10);

      const histRaw = await kv.get<{ entries: { d: string; up: number; down: number }[] }>('mm_4pct_history');
      const entries = (histRaw?.entries ?? []).filter(e => e.d !== etToday);
      entries.push({ d: etToday, up: mm4Up, down: mm4Down });
      entries.sort((a, b) => a.d.localeCompare(b.d));
      const kept = entries.slice(-20);
      await kv.set('mm_4pct_history', { entries: kept });

      const thisWeek = kept.filter(e => e.d >= mondayStr);
      mm5Days = thisWeek.length;
      mm5Up = thisWeek.reduce((a, e) => a + e.up, 0);
      mm5Down = thisWeek.reduce((a, e) => a + e.down, 0);
    } catch (e) { console.error('MM history failed (non-blocking):', e); }

    try {
      await kv.set('market_breadth_v6', {
        score: breadthScore, signal: breadthSignal,
        advancers, decliners, up4, down4,
        pctAdv: Math.round(pctAdv * 1000) / 10,
        mm4Up, mm4Down, mm5Up, mm5Down, mm5Days,
        mmUniverseSize: mmUniverse.length,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) { console.error('breadth persist failed', e); }

    let newHighs = 0, newLows = 0;
    let mkmValue: number | null = null, mkmSignal: number | null = null, mkmRising = false;
    let mm25Quarter: number | null = null, mm25AsOf: string | null = null;
    try {
      const breadthTickerSet = new Set(breadthUniverse.map((t: any) => t.ticker));
      const hi52Map = new Map<string, number>();
      const lo52Map = new Map<string, number>();

      const hlDates: string[] = [];
      for (let d = 365; d >= 1; d--) {
        const dt = new Date(Date.now() - d * 86400000);
        const day = dt.getUTCDay();
        if (day === 0 || day === 6) continue;
        hlDates.push(dt.toISOString().slice(0, 10));
      }
      const hlKept = hlDates.slice(-252);

      /* Holidays come back empty from the grouped endpoint, so the calendar
         dates above are not trading days. Recording which ones actually
         returned bars gives a real session count to index off — needed for
         the 65-session lookback below. */
      const datesWithData: string[] = [];

      const HL_BATCH = 7;
      for (let i = 0; i < hlKept.length; i += HL_BATCH) {
        const chunk = hlKept.slice(i, i + HL_BATCH);
        const settled = await Promise.allSettled(chunk.map(async (date) =>
          fetchSafeJson(
            `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${polygonApiKey}`,
            { results: [] }, 15000
          )
        ));
        settled.forEach((r, k) => {
          if (r.status !== 'fulfilled' || !r.value?.results?.length) return;
          datesWithData.push(chunk[k]);
          for (const bar of r.value.results) {
            const sym = bar.T;
            if (!breadthTickerSet.has(sym)) continue;
            const prevHi = hi52Map.get(sym);
            if (!prevHi || bar.h > prevHi) hi52Map.set(sym, bar.h);
            const prevLo = lo52Map.get(sym);
            if (!prevLo || bar.l < prevLo) lo52Map.set(sym, bar.l);
          }
        });
      }

      for (const t of breadthUniverse) {
        const price = t._livePrice;
        if (!price || price <= 0) continue;
        const hi = hi52Map.get(t.ticker);
        const lo = lo52Map.get(t.ticker);
        if (hi && hi > 0 && price >= hi) newHighs++;
        if (lo && lo > 0 && price <= lo) newLows++;
      }

      /* ---- Market Monitor: 25%+ in a quarter -----------------------------
         Stockbee's longer-horizon breadth leg — how many names are up 25% or
         more over 65 sessions. One extra grouped call rather than a second
         252-day sweep: the sessions are already enumerated above, so this
         just re-reads the one date that sits 65 back. */
      try {
        const MM_QUARTER_SESSIONS = 65;
        if (datesWithData.length > MM_QUARTER_SESSIONS) {
          const targetDate = datesWithData[datesWithData.length - 1 - MM_QUARTER_SESSIONS];
          const past = await fetchSafeJson(
            `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${targetDate}?adjusted=true&apiKey=${polygonApiKey}`,
            { results: [] }, 20000
          );
          const close65 = new Map<string, number>();
          for (const bar of past?.results ?? []) {
            if (bar.c > 0) close65.set(bar.T, bar.c);
          }
          let count = 0;
          for (const t of mmUniverse) {
            const then = close65.get(t.ticker);
            if (!then) continue;
            if ((t._livePrice - then) / then >= 0.25) count++;
          }
          mm25Quarter = count;
          mm25AsOf = targetDate;
        }
      } catch (e) { console.error('MM 25%/quarter failed (non-blocking):', e); }

      // --- MKM: Market Momentum (McClellan-style oscillator on ATHI/ATLO history) ---
      // ATHI/ATLO history is seeded from TradingView (ATHI.US / ATLO.US).
      // Use those values for display instead of the Polygon approximation.
      try {
        const histRaw = await kv.get<{ entries: { t: number; h: number; l: number }[] }>('athi_atlo_history');
        const entries = histRaw?.entries ?? [];

        if (entries.length > 0) {
          const latest = entries[entries.length - 1];
          newHighs = latest.h;
          newLows = latest.l;
        }

        if (entries.length >= 22) {
          const emaCalc = (data: number[], period: number): number[] => {
            const k = 2 / (period + 1);
            const r = [data[0]];
            for (let i = 1; i < data.length; i++) r.push(data[i] * k + r[i - 1] * (1 - k));
            return r;
          };

          const raw = entries.map(e => {
            const total = e.h + e.l + 1e-10;
            return ((e.h - e.l) / total) * 1000;
          });
          const fastEma = emaCalc(raw, 10);
          const slowEma = emaCalc(raw, 21);
          const momentum = fastEma.map((f, i) => f - slowEma[i]);

          const scaleLen = 500;
          const n = momentum.length;
          const rFinalSeries: number[] = [];
          for (let i = 0; i < n; i++) {
            const start = Math.max(0, i - scaleLen + 1);
            let mH = -Infinity, mL = Infinity;
            for (let j = start; j <= i; j++) {
              if (momentum[j] > mH) mH = momentum[j];
              if (momentum[j] < mL) mL = momentum[j];
            }
            rFinalSeries.push((mH - mL) === 0 ? 50 : 100 * (momentum[i] - mL) / (mH - mL));
          }

          const sigEma = emaCalc(rFinalSeries, 9);
          mkmValue = Math.round(rFinalSeries[n - 1] * 10) / 10;
          mkmSignal = Math.round(sigEma[n - 1] * 10) / 10;
          mkmRising = n >= 2 && rFinalSeries[n - 1] > rFinalSeries[n - 2];
        }
      } catch (e) { console.error('MKM computation failed (non-blocking):', e); }

      const prevBreadth = await kv.get<any>('market_breadth_v6');
      if (prevBreadth) {
        await kv.set('market_breadth_v6', {
          ...prevBreadth, newHighs, newLows,
          ...(mkmValue != null ? { mkm: mkmValue, mkmSignal, mkmRising } : {}),
          ...(mm25Quarter != null ? { mm25Quarter, mm25AsOf } : {}),
        });
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

    const spyHistRes = await fetchSafeJson(
      `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=350&apiKey=${polygonApiKey}`,
      { results: [] }
    );
    /* spyReturn3M was computed here and used only to derive rsVsSpy. With
       the rating coming from /api/rs/run it has no consumer, so it is gone —
       these bars are still fetched because spyAbove21 below needs them. */
    const spyHistBars = (spyHistRes.results || []).sort((a: any, b: any) => b.t - a.t);

    const spyReturnsByDate = new Map<number, number>();
    for (let i = 0; i < spyHistBars.length - 1; i++) {
      const prevC = spyHistBars[i + 1].c;
      if (prevC > 0) spyReturnsByDate.set(spyHistBars[i].t, (spyHistBars[i].c - prevC) / prevC);
    }

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

    /* General Benzinga feed (200 articles) indexed by ticker, then enriched with
       per-ticker lookups for candidates the general feed missed. */
    const bzIndex = await fetchBenzingaNewsIndex(polygonApiKey);
    const candidateTickers = uniqueCandidates.map((c: any) => c.ticker || c.single_ticker).filter(Boolean);
    await enrichBenzingaIndex(bzIndex, candidateTickers, polygonApiKey);

    const enrichCandidate = async (t: any) => {
      const sym = t.ticker || t.single_ticker;
      const price = t._livePrice;
      const vol = t._liveVol;
      const chgPct = t._liveChg;
      const vwap = t._liveVwap;
      const currentOpen = t.day?.o || t.prevDay?.o || price;
      const dayHigh = t.day?.h ?? null;
      const dayLow = t.day?.l ?? null;

      const [details, aggs, newsData, shortData] = await Promise.all([
        fetchSafeJson(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${polygonApiKey}`, {}),
        fetchSafeJson(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=350&apiKey=${polygonApiKey}`, { results: [] }),
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
        let sumVol = 0, barCount = 0, sumTR = 0, trCount = 0;
        dailyBars.slice(0, 20).forEach((bar: any, index: number) => {
          if (bar.v) { sumVol += bar.v; barCount++; }
          if (index < 14 && dailyBars[index+1]) {
            const prevClose = dailyBars[index+1].c;
            sumTR += Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
            trCount++;
          }
        });
        avgVol = barCount > 0 ? sumVol / barCount : 0;
        atr = trCount > 0 ? sumTR / trCount : 0;
      }

      let adrPct: number | null = null;
      if (dailyBars.length >= 20) {
        let ratioSum = 0, ratioCount = 0;
        for (let i = 0; i < 20; i++) {
          const b = dailyBars[i];
          if (b && b.h > 0 && b.l > 0) { ratioSum += b.h / b.l; ratioCount++; }
        }
        if (ratioCount > 0) adrPct = ((ratioSum / ratioCount) - 1) * 100;
      }

      /* --- CHOP (v6.18) ---------------------------------------------------
         BAR ORDER IS THE ONE THING TO GET RIGHT HERE. dailyBars is sorted
         DESCENDING (newest first) for every other consumer in this function;
         the chop lib expects ASCENDING, oldest first. Passing the descending
         array would return a plausible-looking number computed from the wrong
         end of the series, which is worse than an error because nothing would
         look broken.

         Slicing before reversing keeps this cheap: only the 15 bars the
         calculation needs get touched, not all 350. `.slice()` returns a new
         array, so the `.reverse()` cannot mutate dailyBars out from under the
         EMA and RME loops that run after this. */
      let chop14: number | null = null;
      if (dailyBars.length >= CHOP_PERIOD_DEFAULT + 1) {
        const chopBars = dailyBars
          .slice(0, CHOP_PERIOD_DEFAULT + 1)
          .reverse()
          .map((b: any) => ({ h: b.h, l: b.l, c: b.c }));
        chop14 = choppiness(chopBars, CHOP_PERIOD_DEFAULT);
      }

      const rmv = computeRMV(dailyBars, { order: 'desc', lookback: 15 });
      const rmeDetail = computeRMEDetail(dailyBars, { order: 'desc', maLength: 21, lookback: 250 });
      const mf = computeMoneyFlow(dailyBars, { order: 'desc', length: 21 });
      const mfTrend = moneyFlowTrend(dailyBars, { order: 'desc', length: 21, lookback: 5 });

      const dot = computeDotDetail(dailyBars, { order: 'desc', price });

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

      let ema10Val: number | null = null;
      let ema21Val: number | null = null;
      let ema50Val: number | null = null;
      let aboveEma10: boolean | null = null;
      let aboveEma21: boolean | null = null;
      let distToEma10: number | null = null;
      let distToEma21: number | null = null;
      let ema21Rising: boolean | null = null;
      if (dailyBars.length >= 30) {
        const emaWarm = Math.min(100, dailyBars.length - 1);
        let e10 = dailyBars[emaWarm].c;
        let e21 = dailyBars[emaWarm].c;
        let e50 = dailyBars[emaWarm].c;
        let e21FiveAgo: number | null = null;
        const k10 = 2 / (10 + 1);
        const k21e = 2 / (21 + 1);
        const k50 = 2 / (50 + 1);
        for (let i = emaWarm - 1; i >= 0; i--) {
          e10 = (dailyBars[i].c * k10) + (e10 * (1 - k10));
          e21 = (dailyBars[i].c * k21e) + (e21 * (1 - k21e));
          e50 = (dailyBars[i].c * k50) + (e50 * (1 - k50));
          if (i === 5) e21FiveAgo = e21;
        }
        ema10Val = e10;
        ema21Val = e21;
        ema50Val = dailyBars.length >= 60 ? e50 : null;
        aboveEma10 = price >= e10;
        aboveEma21 = price >= e21;
        if (e10 > 0) distToEma10 = ((price - e10) / e10) * 100;
        if (e21 > 0) distToEma21 = ((price - e21) / e21) * 100;
        if (e21FiveAgo != null) ema21Rising = e21 > e21FiveAgo;
      }

      let goldenCross: boolean | null = null;
      if (dailyBars.length >= 200) {
        let s50 = 0, s200 = 0;
        for (let i = 0; i < 200; i++) {
          s200 += dailyBars[i].c;
          if (i < 50) s50 += dailyBars[i].c;
        }
        goldenCross = (s50 / 50) > (s200 / 200);
      }

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

      // Prior swing high — highest bar in the last 63 sessions EXCLUDING the
      // last five, so a name that just ran does not become its own resistance.
      let priorSwingHigh: number | null = null;
      if (dailyBars.length >= 20) {
        const win = dailyBars.slice(5, Math.min(63, dailyBars.length));
        if (win.length > 0) priorSwingHigh = Math.max(...win.map((b: any) => b.h));
      }

      let rsRating = rsLookup.get(sym);
      if (rsRating == null && dailyBars.length >= 63 && rsLookup.sortedRaws.length > 0) {
        const p0c = dailyBars[0]?.c;
        const p63c = dailyBars[Math.min(63, dailyBars.length - 1)]?.c;
        const p126c = dailyBars.length > 126 ? dailyBars[126]?.c : null;
        const p189c = dailyBars.length > 189 ? dailyBars[189]?.c : null;
        const p252c = dailyBars.length > 252 ? dailyBars[252]?.c : null;
        const raw = rawRsScore({ p0: p0c, p63: p63c, p126: p126c, p189: p189c, p252: p252c });
        if (raw != null) rsRating = percentileRank(raw, rsLookup.sortedRaws);
      }

      let beta: number | null = null;
      let alpha: number | null = null;
      if (dailyBars.length >= 60) {
        const stockRets: number[] = [];
        const mktRets: number[] = [];
        for (let i = 0; i < dailyBars.length - 1 && stockRets.length < 60; i++) {
          const prevC = dailyBars[i + 1].c;
          if (prevC > 0) {
            const sr = (dailyBars[i].c - prevC) / prevC;
            const mr = spyReturnsByDate.get(dailyBars[i].t);
            if (mr !== undefined) { stockRets.push(sr); mktRets.push(mr); }
          }
        }
        if (stockRets.length >= 30) {
          const n = stockRets.length;
          let sumS = 0, sumM = 0;
          for (let i = 0; i < n; i++) { sumS += stockRets[i]; sumM += mktRets[i]; }
          const meanS = sumS / n;
          const meanM = sumM / n;
          let cov = 0, varM = 0;
          for (let i = 0; i < n; i++) {
            const dm = mktRets[i] - meanM;
            cov += (stockRets[i] - meanS) * dm;
            varM += dm * dm;
          }
          if (varM > 0) {
            beta = parseFloat((cov / varM).toFixed(2));
            alpha = parseFloat(((meanS - beta * meanM) * 252).toFixed(2));
          }
        }
      }

      let gapPct: number | null = null;
      let atrExpansion: number | null = null;
      let moveVsAtr: number | null = null;
      if (dailyBars.length >= 2) {
        const prevDailyClose = dailyBars[1]?.c;
        if (prevDailyClose > 0 && currentOpen > 0) gapPct = ((currentOpen - prevDailyClose) / prevDailyClose) * 100;
        const todayBar = dailyBars[0];
        if (atr > 0 && todayBar?.h != null && todayBar?.l != null) atrExpansion = (todayBar.h - todayBar.l) / atr;
        if (atr > 0 && prevDailyClose > 0) moveVsAtr = (price - prevDailyClose) / atr;
      }
      const rsVsMkt = chgPct - spyChgToday;

      const rvol = (avgVol > 0 && vol > 0) ? (vol / avgVol) : null;
      const setupMatched = detectPattern(dailyBars, price, currentOpen, vwap, rvol, dot.kind, stochK);
      const companyName = details?.results?.name || sym;

      const plan = computeTradePlan({
        price,
        adrPct,
        atrPct,
        changePct: chgPct,
        ema10: ema10Val,
        ema21: ema21Val,
        ema50: ema50Val,
        dayHigh: dayHigh ?? dailyBars[0]?.h ?? null,
        priorSwingHigh,
        aboveEma10,
        aboveEma21,
        setupName: setupMatched.name,
      });

      let vwapStatus: 'above' | 'below' | 'neutral' = 'neutral';
      if (vwap > 0 && price > 0) vwapStatus = price >= vwap ? 'above' : 'below';

      const float = details?.results?.share_class_shares_outstanding || (marketCap && price ? marketCap / price : null);
      let shortPct = null;
      let daysToCover = null;
      const shortInterest = shortData?.results?.[0]?.short_interest;
      if (shortInterest && float) shortPct = (shortInterest / float) * 100;
      if (shortInterest && avgVol > 0) daysToCover = shortInterest / avgVol;

      const apiSectorRaw = cleanSectorDescription(details?.results?.sic_description, details?.results?.sector, details?.results?.industry);
      const deepSector = resolveEtfSector(sym, apiSectorRaw, companyName);

      /* v6.20 — the whole news selection is one call now.

         The previous block took the NEWEST non-spam article within four
         days, which is the wrong sort key: recency alone will hand you a
         Zacks rank update from twenty minutes ago over a GlobeNewswire
         contract award from this morning. pickBestNews ranks on publisher
         tier, whether the headline states a cause, category, focus and age
         together, and returns null when nothing qualifies — which is the
         common and correct outcome. */
      const newsPick: NewsItem | null = pickBestNews(
        [...(bzIndex.get(sym) ?? []), ...(newsData?.results ?? [])],
        sym
      );

      const round2 = (v: number | null): number | null =>
        v == null ? null : parseFloat(v.toFixed(2));

      return {
        ticker: sym, name: companyName, sector: deepSector, price, vwapStatus, changePct: chgPct, vol, avgVol, atr, dVol: vol * vwap, rvol: rvol ? parseFloat(rvol.toFixed(2)) : null,
        float, shortPct,
        daysToCover: daysToCover != null ? parseFloat(daysToCover.toFixed(1)) : null,
        mktCap: marketCap, stage: setupMatched.stage, setupName: setupMatched.name, catalystUrl: null,
        _stageNum: setupMatched.stageNum,
        dotKind: dot.kind,
        dotStochK: dot.stochK,
        dotBarsSince: dot.barsSinceExtreme,
        aboveEma10, aboveEma21,
        ema10: round2(ema10Val),
        ema21: round2(ema21Val),
        ema50: round2(ema50Val),
        dayHigh: round2(dayHigh ?? dailyBars[0]?.h ?? null),
        dayLow: round2(dayLow ?? dailyBars[0]?.l ?? null),
        priorSwingHigh: round2(priorSwingHigh),
        plan: plan.tradeable ? {
          family: plan.family,
          trigger: round2(plan.trigger),
          triggerLabel: plan.triggerLabel,
          stop: round2(plan.stop),
          stopPct: plan.stopPct != null ? parseFloat(plan.stopPct.toFixed(2)) : null,
          target: round2(plan.target),
          rMultiple: plan.rMultiple,
          resistanceR: plan.resistanceR != null ? parseFloat(plan.resistanceR.toFixed(2)) : null,
          resistanceLabel: plan.resistanceLabel,
          clear: plan.clear,
          collapsed: plan.collapsed,
          overextended: plan.overextended,
          tradeable: true,
          note: plan.note,
        } : { tradeable: false, collapsed: plan.collapsed, overextended: plan.overextended, note: plan.note, family: plan.family },
        distToEma10: distToEma10 != null ? parseFloat(distToEma10.toFixed(2)) : null,
        distToEma21: distToEma21 != null ? parseFloat(distToEma21.toFixed(2)) : null,
        ema21Rising,
        goldenCross,
        pctOffHigh: pctOffHigh != null ? parseFloat(pctOffHigh.toFixed(1)) : null,
        pctOffLow: pctOffLow != null ? parseFloat(pctOffLow.toFixed(1)) : null,
        atrPct: atrPct != null ? parseFloat(atrPct.toFixed(2)) : null,
        adrPct: adrPct != null ? parseFloat(adrPct.toFixed(2)) : null,
        chop14: chop14 != null ? parseFloat(chop14.toFixed(1)) : null,
        rmv, mf, mfTrend,
        rme: rmeDetail.rme,
        rmeExtPct: rmeDetail.extPct,
        rmeSampled: rmeDetail.sampled,
        stochK: stochK != null ? parseFloat(stochK.toFixed(1)) : null,
        rsRating,
        gapPct: gapPct != null ? parseFloat(gapPct.toFixed(2)) : null,
        atrExpansion: atrExpansion != null ? parseFloat(atrExpansion.toFixed(2)) : null,
        moveVsAtr: moveVsAtr != null ? parseFloat(moveVsAtr.toFixed(2)) : null,
        rsVsMkt: parseFloat(rsVsMkt.toFixed(2)),
        beta,
        alpha,
        _news: newsPick
      };
    };

    const enrichedList: any[] = [];
    const chunkSize = 10;
    for (let i = 0; i < uniqueCandidates.length; i += chunkSize) {
      const chunk = uniqueCandidates.slice(i, i + chunkSize);
      const results = await Promise.all(chunk.map(enrichCandidate));
      enrichedList.push(...results.filter(item => item !== null && item !== undefined));
      if (i + chunkSize < uniqueCandidates.length) await new Promise(resolve => setTimeout(resolve, 200));
    }

    /* The WIIM fetch is gone — see the v6.20 header. It was a per-batch
       round trip to an endpoint this key is not entitled to, returning empty
       arrays that read as quiet news days. News now comes from the Polygon
       results already fetched in enrichCandidate. */
    const earningsMap = await fetchEarningsCalendar(benzingaApiKey);

    let prevStreaks: Record<string, number> = {};
    try {
      const storedStreaks = await kv.get<any>('scan_streaks_v6');
      if (storedStreaks && storedStreaks.date === currentDate && storedStreaks.counts) {
        prevStreaks = storedStreaks.counts;
      }
    } catch (e) { console.error('streak read failed', e); }
    const newStreaks: Record<string, number> = {};

    const enrichedMap = new Map();

    /* Age at which the chip gains a "(Delayed)" qualifier. 36 hours rather
       than the old 1.5 days in disguise — a headline from yesterday morning
       explaining today's move is a delayed reaction and the row should say
       so, because the trade is different: the market has had a session to
       price it and you are buying the follow-through, not the news. */
    const DELAYED_AGE_HOURS = 36;

    enrichedList.forEach((t: any) => {
      const news: NewsItem | null = t._news ?? null;
      const earn = earningsMap.get(t.ticker);
      const reportedEarnings = !!earn?.reported;

      if (news) {
        t.catalyst = news.ageHours >= DELAYED_AGE_HOURS ? `${news.tag} (Delayed)` : news.tag;
        t.catalystUrl = news.url;
        t.thesis = news.title;

        /* Provenance on the row. The old pipeline surfaced a bare headline,
           which gave you no way to tell a GlobeNewswire 8-K from a Fool
           opinion piece — and the whole reason this feed needs filtering is
           that those two look identical once you strip the source. */
        t.newsPublisher = news.publisher;
        t.newsAge = news.ageLabel;
        t.newsSentiment = news.sentiment;
        t.newsCausal = news.causal;

        /* SENTIMENT DEMOTES BUT DOES NOT PROMOTE. Polygon attaches a
           per-article sentiment, and the case worth catching is a headline
           that classifies as strong while reading badly: "Reports Q2
           Results" is tagged Earnings, and a miss and a beat carry the same
           tag. Demoting to neutral withholds the bonus without applying a
           penalty, because the price action is already in the score and
           penalising here would count the same fact twice.

           The reverse — promoting on positive sentiment — is not done. It is
           a per-article LLM judgement, and letting it manufacture a strong
           tier out of a weak category would put unearned points on rows
           whose only distinction is an upbeat headline. */
        t._catalystTier =
          news.tier === 'strong' && news.sentiment === 'negative'
            ? 'neutral'
            : news.tier;
      } else if (reportedEarnings) {
        // No article, but the calendar says it reported. That IS a catalyst
        // even with nothing written about it.
        t.catalyst = 'Earnings';
        t.catalystUrl = null;
        t.thesis = null;
        t._catalystTier = 'neutral';
      } else {
        t.catalyst = 'Technical Momentum';
        t.catalystUrl = null;
        t.thesis = null;
        t._catalystTier = 'none';
      }

      t.readout = buildReadout(t);

      t.earningsDate = earn?.date || null;
      t.earningsWhen = earn?.when || null;
      t.earningsReported = reportedEarnings;
      t.earningsEpsEst = earn?.epsEstimate ?? null;
      t.earningsEpsActual = earn?.epsActual ?? null;
      t.earningsRevEst = earn?.revEstimate ?? null;
      t.earningsRevActual = earn?.revActual ?? null;
      t.earningsEpsSurprise = earn?.epsSurprisePct ?? null;

      t.tradeType = deriveTradeType(t.setupName);

      t.scanStreak = currentPhase !== 'Offline'
        ? (prevStreaks[t.ticker] || 0) + 1
        : (prevStreaks[t.ticker] || 1);
      newStreaks[t.ticker] = t.scanStreak;

      t.extended = (t.moveVsAtr != null && t.moveVsAtr >= 3.5) ||
        (t.distToEma21 != null && t.atrPct != null && t.atrPct > 0 && t.distToEma21 > EXT_HARD_ATRS * t.atrPct);

      // v6.18: chop trap flag. Emitted for the UI and the coverage counts;
      // it gates nothing yet.
      t.chopTrap = t.chop14 != null && t.adrPct != null &&
        t.adrPct >= CHOP_TRAP_MIN_ADR && t.chop14 >= CHOP_CHOP_MIN;

      t.status = (t.stochK != null && t.stochK <= 25 && t.distToEma21 != null && Math.abs(t.distToEma21) <= 2.5)
        ? 'Ready' : 'Forming';
      if (t.tradeType === 'Day Trade' && t.vwapStatus === 'below') t.status = 'Forming';
      if (t.dotKind === 'red' && !isBearishInstrument(t.name)) t.status = 'Forming';
      if (!t.plan?.tradeable) t.status = 'Forming';
      if (t.plan?.overextended) t.status = 'Forming';
    });

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

    enrichedList.forEach((t: any) => {
      const earn = earningsMap.get(t.ticker);
      const hasEarnings = !!earn && !earn.reported;

      const cnf = computeCnfScore(
        t.rvol, t.gapPct, t.atrExpansion, t.rsVsMkt,
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
          dotKind: t.dotKind ?? null,
          dotBarsSince: t.dotBarsSince ?? null,
          isBearInstrument: isBearishInstrument(t.name),
          aboveEma10: t.aboveEma10 ?? null,
          planTradeable: t.plan?.tradeable === true,
          planResistanceR: t.plan?.resistanceR ?? null,
          planClear: t.plan?.clear === true,
          planCollapsed: t.plan?.collapsed === true,
          distToEma21: t.distToEma21 ?? null,
          atrPct: t.atrPct ?? null,
        }
      );
      t.cnfScore = cnf.score;
      t.cnfGrade = cnf.grade;
      t.cnfBreakdown = cnf.breakdown;
      t.cnfCeiling = cnf.ceiling;
      t.cnfCeilingReason = cnf.ceilingReason;
      t.hasEarnings = hasEarnings;
      t.conviction = cnf.score;
      delete t._catalystTier;
      delete t._news;
      delete t._stageNum;

      enrichedMap.set(t.ticker, t);
    });

    if (currentPhase !== 'Offline') {
      try {
        await kv.set('scan_streaks_v6', { date: currentDate, counts: newStreaks });
      } catch (e) { console.error('streak persist failed', e); }
    }

    /* v6.18 NOTE: chop is NOT in either filter chain below. The ADR floor is
       the only volatility gate for now. Adding `r.chop14 <= CHOP_CHOP_MIN`
       here is the v6.19 change, once catalystCoverage.chopTrap has been
       watched long enough to know what it costs. */
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

    // Enrich with fundamentals — cross-reference multibagger KV first, Polygon for the rest
    try {
      const mbData = await kv.get<any[]>('multibagger_v1');
      const allSetups = [...finalSip, ...finalDaily];
      const fundInput = allSetups
        .filter((t: any) => t.ticker && t.price > 0)
        .map((t: any) => ({ ticker: t.ticker, price: t.price, marketCap: t.mktCap || undefined }));
      if (fundInput.length > 0) {
        const fundMap = await enrichWithFundamentals(fundInput, polygonApiKey, mbData ?? undefined);
        for (const t of allSetups) {
          const f = fundMap.get((t.ticker ?? '').toUpperCase());
          if (f) t._fund = f;
        }
      }
    } catch (e) { console.error('[scanner] fundamental enrichment failed:', e); }

    const finalTopMovers = {
      'Mega Caps': megaCapsRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined).slice(0, 10),
      'Gainers': gainersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined && r.vol >= SCANNER.minVolume).slice(0, 10),
      'Losers': losersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined && r.vol >= SCANNER.minVolume).slice(0, 10),
      'ETF Gainers': etfGainersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined && r.vol >= SCANNER.minVolume).slice(0, 10),
      'ETF Losers': etfLosersRaw.map((t: any) => enrichedMap.get(t.ticker)).filter((r: any) => r !== undefined && r.vol >= SCANNER.minVolume).slice(0, 10)
    };

    const finalHighBeta = enrichedList
      .filter((t: any) => t.beta != null && t.beta >= 1.5 && t.vol >= SCANNER.minVolume && !ETF_TARGET_MAP[t.ticker])
      .sort((a: any, b: any) => b.beta - a.beta)
      .slice(0, 10);

    let benchmark: any = null;
    const benchmarks: any[] = [];
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
        if (!seenWeeks.has(wi)) { seenWeeks.add(wi); weeklyBars.push({ c: b.c }); }
      }

      const emaOf = (bars: any[], n: number): number | null => {
        if (bars.length < n) return null;
        const k = 2 / (n + 1);
        let ema = bars[bars.length - 1].c;
        for (let i = bars.length - 2; i >= 0; i--) {
          ema = (bars[i].c * k) + (ema * (1 - k));
        }
        return ema;
      };
      const smaOf = (bars: any[], n: number): number | null => {
        if (bars.length < n) return null;
        let sum = 0;
        for (let i = 0; i < n; i++) sum += bars[i].c;
        return sum / n;
      };
      const buildSet = (bars: any[], price: number, periods: number[], useSma = false) =>
        periods
          .map((p) => {
            const v = useSma ? smaOf(bars, p) : emaOf(bars, p);
            return v == null ? null : { label: String(p), value: parseFloat(v.toFixed(2)), above: price >= v };
          })
          .filter((m): m is { label: string; value: number; above: boolean } => m !== null);

      if (dailyBars.length >= 10) {
        const qqqPrice = parseFloat(dailyBars[0].c.toFixed(2));
        benchmark = {
          symbol: 'QQQ',
          price: qqqPrice,
          day: buildSet(dailyBars, qqqPrice, [10, 21, 30, 50], true),
          week: buildSet(weeklyBars, qqqPrice, [5, 10, 30, 50], true),
        };
      }

      /* SPY gets the same treatment as QQQ. `benchmark` stays QQQ-only so
         nothing reading the old field changes behaviour; `benchmarks` is the
         list the UI renders. */
      const spyRes = await fetchSafeJson(
        `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${dFromDate.toISOString().split('T')[0]}/${qqqTo}?adjusted=true&sort=desc&limit=400&apiKey=${polygonApiKey}`,
        { results: [] }
      );
      const spyDaily = (spyRes.results || []).sort((a: any, b: any) => b.t - a.t);
      const spySeen = new Set<number>();
      const spyWeekly: { c: number }[] = [];
      for (const b of spyDaily) {
        const wi = weekIndex(b.t);
        if (!spySeen.has(wi)) { spySeen.add(wi); spyWeekly.push({ c: b.c }); }
      }
      if (spyDaily.length >= 10) {
        const spyPrice = parseFloat(spyDaily[0].c.toFixed(2));
        benchmarks.push({
          symbol: 'SPY',
          price: spyPrice,
          day: buildSet(spyDaily, spyPrice, [10, 21, 30, 50], true),
          week: buildSet(spyWeekly, spyPrice, [5, 10, 30, 50], true),
        });
      }
      if (benchmark) benchmarks.unshift(benchmark);
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
      await kv.set('scan_meta_v6', scanMeta);
      await kv.set('high_beta_v6', finalHighBeta);
    } else {
      console.warn('Scan produced no movers; preserving previous KV snapshot.');
    }

    if (Object.keys(liveChgMap).length > 500) {
      await kv.set('live_chg_map_v1', liveChgMap);
    }

    if (benchmark) await kv.set('benchmark_v6', benchmark);
    if (benchmarks.length) await kv.set('benchmarks_v1', benchmarks);

    let macroInsights: any = null;
    if (hasRealData) {
      const surfaced = Array.from(
        new Map([...finalSip, ...finalDaily].map((t: any) => [t.ticker, t])).values()
      );
      const built = buildMacroBriefing({
        breadthSignal, breadthScore, advancers, decliners, up4, down4, pctAdv,
        newHighs, newLows, spyAbove21, spyChgToday,
        hotSectors: hotSectorList,
        surfaced,
        topMovers: finalTopMovers,
      });
      macroInsights = { ...built, generatedAt: new Date().toISOString(), phase: currentPhase };
      try {
        await kv.set('macro_insights_v6', macroInsights);
      } catch (e) { console.error('macro insights persist failed', e); }
    } else {
      macroInsights = await readFreshMacroInsights();
    }

    const rBucket = (t: any, lo: number, hi: number) =>
      t.plan?.tradeable && !t.plan.clear && t.plan.resistanceR != null &&
      t.plan.resistanceR >= lo && t.plan.resistanceR < hi;

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
      benchmarks,
      sips: finalSip,
      dailySetups: finalDaily,
      highBeta: finalHighBeta,
      scanMeta,
      dataPersisted: hasRealData,
      /* RS diagnostics. `rated` well below `scanned` is expected — the
         ranking floor is $5 and 100k shares, and recent listings have no
         quarter to weight — but a rated count of ZERO means the map is
         missing or stale, and `rsReason` says which. Without this the only
         symptom would be a column of em-dashes with no explanation. */
      rsCoverage: {
        available: rsLookup.available,
        asOf: rsLookup.asOf,
        ageDays: rsLookup.ageDays,
        rankedUniverse: rsLookup.ranked,
        reason: rsLookup.reason,
        rated: enrichedList.filter((t: any) => t.rsRating != null).length,
        above80: enrichedList.filter((t: any) => (t.rsRating ?? 0) >= 80).length,
        above70: enrichedList.filter((t: any) => (t.rsRating ?? 0) >= 70).length,
      },
      catalystCoverage: {
        scanned: enrichedList.length,
        /* v6.20 — the counter that made the old problem visible, rebuilt for
           the new source. `withNews` well below `scanned` is normal: most
           stocks on most days have no catalyst. `technicalOnly` near
           `scanned` for several sessions running is the signal that
           something upstream is broken again, which is precisely what 3/80
           was telling us for weeks without anyone reading it.

           `rejectedFiller` is the number to watch to know the filters are
           earning their place — it counts rows that HAD Polygon articles and
           still ended up with no catalyst, meaning everything available was
           listicle, valuation or price-restating noise. If that is near zero
           the filters may be too loose; if it dwarfs `withNews`, they may be
           too tight. */
        withNews: enrichedList.filter((t: any) => t.thesis != null).length,
        newsCausal: enrichedList.filter((t: any) => t.newsCausal === true).length,
        newsNegativeSentiment: enrichedList.filter((t: any) => t.newsSentiment === 'negative').length,
        earningsMatched: enrichedList.filter((t: any) => t.earningsReported).length,
        technicalOnly: enrichedList.filter((t: any) => t.catalyst === 'Technical Momentum').length,
        gradeCapped: enrichedList.filter((t: any) => t.cnfCeiling != null && t.cnfCeiling < 100).length,
        blueDots: enrichedList.filter((t: any) => t.dotKind === 'blue').length,
        redDots: enrichedList.filter((t: any) => t.dotKind === 'red').length,
        reversals: enrichedList.filter((t: any) => t.setupName === 'Reversal').length,
        unnamed: enrichedList.filter((t: any) => !t.setupName).length,
        planned: enrichedList.filter((t: any) => t.plan?.tradeable).length,
        collapsed: enrichedList.filter((t: any) => t.plan?.collapsed).length,
        overextended: enrichedList.filter((t: any) => t.plan?.overextended).length,
        extCapped: enrichedList.filter((t: any) => t.cnfCeilingReason?.includes('above the 21 EMA')).length,
        triggerPassed: enrichedList.filter((t: any) => t.plan?.note === 'trigger already passed').length,
        runwayClear: enrichedList.filter((t: any) => t.plan?.tradeable && t.plan.clear).length,
        runwayMid: enrichedList.filter((t: any) => rBucket(t, 1.0, 2.0)).length,
        runwayNear: enrichedList.filter((t: any) => rBucket(t, 0.5, 1.0)).length,
        runwayTight: enrichedList.filter((t: any) => rBucket(t, 0, 0.5)).length,

        /* v6.18 CHOP DISTRIBUTION. This block is the whole reason chop ships
           unwired: it answers, on live data and immediately, what a gate at
           61.8 would actually cost.

           chopTrap IS THE NUMBER TO WATCH. It counts names that cleared the
           ADR floor at 5%+ AND are churning — wide range, no direction. Those
           are the rows the current gate cannot see and the ones a chop gate
           would remove. If that count is consistently 0-1, the trap is rare
           and a gate is not worth the false negatives. If it is 5+ every
           session, the ADR floor has been quietly admitting chop machines
           the whole time and v6.19 should gate on it.

           chopScored guards the read: a low chopChoppy count means nothing if
           half the universe returned null for want of 15 bars. */
        chopScored: enrichedList.filter((t: any) => t.chop14 != null).length,
        chopTrending: enrichedList.filter((t: any) => t.chop14 != null && t.chop14 <= CHOP_TREND_MAX).length,
        chopMixed: enrichedList.filter((t: any) => t.chop14 != null && t.chop14 > CHOP_TREND_MAX && t.chop14 < CHOP_CHOP_MIN).length,
        chopChoppy: enrichedList.filter((t: any) => t.chop14 != null && t.chop14 >= CHOP_CHOP_MIN).length,
        chopTrap: enrichedList.filter((t: any) => t.chopTrap === true).length,
        chopTrapSurfaced: [...finalSip, ...finalDaily].filter((t: any) => t?.chopTrap === true).length,
      },
      fromCache: false
    }, { headers: noStoreHeaders });

  } catch (error: any) {
    console.error("Scanner Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

const bgHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

async function scheduleAfterResponse(work: () => Promise<any>): Promise<boolean> {
  try {
    const nx: any = await import('next/server');
    const after = nx.after || nx.unstable_after;
    if (typeof after === 'function') { after(() => work()); return true; }
  } catch { /* fall through */ }
  return false;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const background = searchParams.get('bg') === 'true';
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