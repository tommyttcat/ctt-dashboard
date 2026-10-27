/* scripts/scanFixes.test.mts — the 27 Oct 2026 scanner audit fixes. */
import { passesSipFinal } from '../src/lib/scans/scanner.ts';
import { shortlistAbnormal, type LiteBar, type SnapInfo } from '../src/lib/scans/ep9m.ts';
import { eq, done } from './testkit.mts';

// ---- Average dollar volume over completed sessions, not avgVol x today's price
const row = { vol: 3e6, dVol: 3e7, changePct: 8, atr: 1.5, avgVol: 2.5e6, adrPct: 5, price: 10 };
eq('avg $vol: avgVol x today\'s price still used when no avgDollarVol (replay)', passesSipFinal(row), true);
eq('avg $vol: a $5 stock averaging 2.5M ($12.5M/day) that doubled to $10 fails', passesSipFinal({ ...row, avgDollarVol: 12.5e6 }), false);
eq('avg $vol: a real $25M/day average passes', passesSipFinal({ ...row, avgDollarVol: 25e6 }), true);

// ---- EP9M: the live profile ends yesterday, so yesterday stays in the baseline
const bar = (v: number): LiteBar => ({ c: 10, h: 10.5, l: 9.5, v });
const series = new Map<string, LiteBar[]>([['EP', [...Array.from({ length: 59 }, () => bar(3e6)), bar(60e6)]]]);   // yesterday: 60M
const snap: SnapInfo = { price: 12, prevClose: 11, changePct: 9, vol: 25e6, vwap: 11.8, dayHigh: 12.2, dayLow: 11, dayOpen: 11.2 } as SnapInfo;
const snapMap = new Map([['EP', snap]]);
const live = shortlistAbnormal(series, snapMap, { lastBarIsToday: false })[0];
const old = shortlistAbnormal(series, snapMap)[0];
eq('EP9M live: yesterday\'s 60M is in the 20-day average (5.85M)', Math.round(live.avgVol / 1e4) / 100, 5.85);
eq('EP9M live: day 2 at 25M is not "unprecedented" next to yesterday\'s 60M', live.unprecedented, false);
eq('EP9M replay default unchanged: drops the last bar (avg 3M)', old.avgVol, 3e6);
done('scan audit fixes');
