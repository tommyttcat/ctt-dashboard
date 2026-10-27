/* scripts/scanFixes.test.mts — the 27 Oct 2026 scanner audit fixes. */
import { passesSipFinal, passesScannerUniverse } from '../src/lib/scans/scanner.ts';
import { volumeShareAt } from '../src/lib/scans/checklist.ts';
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
// ---- Batch 2: whole-day thresholds on part-day data
eq('U-curve: nothing before the open', volumeShareAt(560), 0);
eq('U-curve: 13% in the first half hour', volumeShareAt(600), 0.13);
eq('U-curve: all of it by the close', volumeShareAt(960), 1);
eq('universe: 200K shares at 10% of the day passes the scaled 500K floor', passesScannerUniverse('ABCD', 20, 200_000, 0.1), true);
eq('universe: the replay (share 1) still needs 500K', passesScannerUniverse('ABCD', 20, 200_000), false);
eq('SIP final: 1M shares / $15M at 22% of the day passes', passesSipFinal({ ...row, vol: 1e6, dVol: 1.5e6, volShare: 0.22, avgDollarVol: 25e6 }), true);
{
  // 10:30 AM (22% of a day): 6M so far on a 5M average = 1.2x raw, 5.5x pace.
  const s2 = new Map<string, LiteBar[]>([['MV', Array.from({ length: 60 }, () => bar(5e6))]]);
  const sn = new Map([['MV', { ...snap, vol: 6e6, price: 10 } as SnapInfo]]);
  eq('EP9M: raw 1.2x fails the 2x gate on a whole-day reading', shortlistAbnormal(s2, sn, { lastBarIsToday: false }).length, 0);
  const paced = shortlistAbnormal(s2, sn, { lastBarIsToday: false, volShare: 0.22 })[0];
  eq('EP9M: at 22% of the day it passes on pace', paced?.sym, 'MV');
  eq('EP9M: rvolPace = 1.2 / 0.22', +paced.rvolPace.toFixed(2), 5.45);
}
done('scan audit fixes');
