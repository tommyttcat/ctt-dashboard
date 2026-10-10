/* scripts/moveStatus.test.mts — Confluence "has the move happened" (lib/confluence/readout moveStatus). */
import { moveStatus } from '../src/lib/confluence/readout.ts';
import { eq, done } from './testkit.mts';

const rep = (price: number, chg: number, adr: number | null, ema21: number | null, rsi: number | null = 60) => ({
  ticker: 'T', price, changePct: chg, adrPct: adr, rvol: 1, confluenceLabel: '', levels: { resistance: [], support: [] }, tradeRec: null,
  timeframes: [{ timeframe: 'Daily', rsi, rsiLabel: '', bias: '', ema21 }],
} as any);

eq('near its 21 EMA on a normal day is early', moveStatus(rep(101, 1, 4, 100))?.state, 'early');
eq('a 3%-ADR name up 3% today is moving', moveStatus(rep(101, 3, 4, 100))?.state, 'moving');
eq('up 1.5 ADRs today is extended', moveStatus(rep(101, 6, 4, 100))?.state, 'extended');
eq('8% over the 21 EMA at 4% ADR (2 ADRs) is moving', moveStatus(rep(108, 0.5, 4, 100))?.state, 'moving');
eq('13% over the 21 EMA at 4% ADR is extended', moveStatus(rep(113, 0.5, 4, 100))?.state, 'extended');
eq('RSI 75 is extended', moveStatus(rep(101, 0.5, 4, 100, 76))?.state, 'extended');
eq('no ADR, no reading', moveStatus(rep(101, 1, null, 100)), null);
eq('today counts in ADRs', moveStatus(rep(101, 2, 4, 100))?.today, 0.5);
done('move status');
