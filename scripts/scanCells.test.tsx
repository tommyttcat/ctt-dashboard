/* scripts/scanCells.test.tsx — the shared scanner cells render what the
 * hand-written markup rendered.
 *
 * CLAUDE.md requires every scanner table to match the DailySetups format.
 * Twelve components used to keep their own copy of that markup; they now call
 * components/scan/ScanTable. The risk in that move is invisible: a cell that
 * renders ALMOST the same — a dropped `whitespace-nowrap`, a `—` where a
 * `--` belongs, a colour helper called with the wrong argument — looks fine
 * in review and wrong on the screen.
 *
 * So this pins the ORIGINAL markup, copied verbatim from DailySetups before
 * the extraction, and asserts the shared cell renders it character for
 * character — including every null and edge branch each cell switches on,
 * since those are the ones nobody looks at.
 *
 * If a cell is deliberately restyled, the expected markup here changes in the
 * same commit. That is the point: the format becomes a thing you edit on
 * purpose rather than something that drifts.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { stageShort, stageDescription, stageBadge } from '../src/lib/indicators/stage.ts';
import { mfColor, mfLabel, mfArrow } from '../src/lib/indicators/moneyflow.ts';
import { rsTooltip, rsBadge } from '../src/lib/indicators/rs.ts';
import { chopTooltip } from '../src/lib/indicators/chop.ts';
import {
  rvolColor as getRvolColor, adrColor as getAdrColor, dtcColor as getDtcColor,
  stochColor as getStochColor, floatColor as getFloatColor, scoreCellCls,
} from '../src/lib/indicators/columnColors.ts';
import { formatNumber, formatCurrency, emaDotClass } from '../src/lib/scans/tableFormat.ts';
import {
  SCAN, ScoreCell, RsCell, PriceCell, ChgCell, Ema1021Cell, VolCell, DollarVolCell,
  RvolCell, FloatCell, AdrCell, MfCell, StochCell, DtcCell, McapCell, StageCell, SectorCell,
} from '../src/components/scan/ScanTable.tsx';
import { eq, done } from './testkit.mts';

const tdBase = SCAN.td, tdStage = SCAN.tdStage, tdSector = SCAN.tdSector;
const emaDot = emaDotClass;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const same = (label: string, before: React.ReactElement, after: React.ReactElement) =>
  eq(label, html(after), html(before));
const noop = () => {};

// ---- CNF and RS ------------------------------------------------------------
for (const v of [82, 44, null]) {
  same(`CNF ${v}`,
    <td className={tdBase}><span title="t" className={scoreCellCls(v)}>{v != null ? v : '--'}</span></td>,
    <ScoreCell value={v} title="t" />);
  same(`RS ${v}`,
    <td className={`${tdBase} whitespace-nowrap`} title={rsTooltip(v)}><span className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums cursor-help ${rsBadge(v)}`}>{v ?? '—'}</span></td>,
    <RsCell value={v} />);
}

// ---- price, with the VWAP dot that doubles as a filter control -------------
for (const [price, vw] of [[4.18, 'above'], [886.5, 'below'], [12, 'neutral'], [9.99, null]] as const) {
  same(`PRICE ${price}/${vw}`,
    <td className={`${tdBase} text-[10px] text-slate-300 font-medium whitespace-nowrap tabular-nums`}><div className="flex items-center justify-center gap-1">${price.toFixed(2)}{vw && vw !== 'neutral' && (<div onClick={noop} className={`w-1.5 h-1.5 rounded-full shrink-0 cursor-pointer ${vw === 'above' ? 'bg-emerald-400' : 'bg-rose-500'} ${'above' === vw ? 'ring-1 ring-white/40' : ''}`} title={`VWAP: ${vw} — click to filter`}></div>)}</div></td>,
    <PriceCell price={price} vwapStatus={vw} vwapFilter="above" onToggleVwap={noop} />);
}

/* A table with no VWAP filter state gets a plain dot: no pointer cursor and
   no "click to filter" hint, because there is nothing to click. */
same('PRICE dot is inert without a handler',
  <td className={`${tdBase} text-[10px] text-slate-300 font-medium whitespace-nowrap tabular-nums`}><div className="flex items-center justify-center gap-1">${(12.5).toFixed(2)}<div className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-400" title="VWAP: above"></div></div></td>,
  <PriceCell price={12.5} vwapStatus="above" />);

// ---- change ----------------------------------------------------------------
for (const v of [4.21, -2.5, 0, null]) {
  const isPositive = (v ?? 0) >= 0;
  same(`CHG ${v}`,
    <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{v != null ? `${isPositive ? '+' : ''}${v.toFixed(2)}%` : '—'}</td>,
    <ChgCell value={v} />);
}

// ---- the 10/21 pair, every combination including "no reading" -------------
for (const a of [true, false, null]) for (const b of [true, false, null]) {
  same(`EMA ${a}/${b}`,
    <td className={`${tdBase} whitespace-nowrap`}><div className="flex items-center justify-center gap-1" title="T"><div className="flex items-center gap-px"><span className="text-[8px] font-bold text-slate-500">10</span><div className={`w-1.5 h-1.5 rounded-full ${emaDot(a)}`} title={`10 EMA: ${a == null ? 'n/a' : a ? 'above' : 'below'}`}></div></div><div className="flex items-center gap-px"><span className="text-[8px] font-bold text-slate-500">21</span><div className={`w-1.5 h-1.5 rounded-full ${emaDot(b)}`} title={`21 EMA: ${b == null ? 'n/a' : b ? 'above' : 'below'}`}></div></div></div></td>,
    <Ema1021Cell above10={a} above21={b} title="T" />);
}

// ---- the numeric columns ---------------------------------------------------
for (const v of [0.4, 1, 3.6, 12345678, null, 0]) {
  same(`VOL ${v}`, <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(v)}</td>, <VolCell value={v} />);
  same(`MCAP ${v}`, <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatNumber(v)}</td>, <McapCell value={v} />);
  same(`$VOL ${v}`, <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{formatCurrency(v)}</td>, <DollarVolCell value={v} />);
  same(`RVOL ${v}`, <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${getRvolColor(v)}`}>{v ? `${v < 1 ? v.toFixed(1) : Math.round(v)}x` : '—'}</td>, <RvolCell value={v} />);
  same(`FLOAT ${v}`, <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${getFloatColor(v)}`}>{formatNumber(v)}</td>, <FloatCell value={v} />);
  same(`STOCH ${v}`, <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${getStochColor(v)}`}>{v != null ? v.toFixed(1) : '—'}</td>, <StochCell value={v} />);
  same(`DTC ${v}`, <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${getDtcColor(v)}`}>{v != null ? v.toFixed(1) : '—'}</td>, <DtcCell value={v} />);
  same(`MF ${v}`, <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${mfColor(v)}`} title={v != null ? `Money Flow ${v.toFixed(0)} — ${mfLabel(v)}` : undefined}>{v != null ? `${v.toFixed(0)}${mfArrow(-1)}` : '—'}</td>, <MfCell value={v} trend={-1} />);
}

/* ADR carries CHOP in the same cell on the momentum tables and stands alone on
   the coil table. Both shapes are in use, so both are pinned. */
for (const adr of [8.2, 2.9, null]) {
  for (const chop of [74, 30, null]) {
    same(`ADR+CHOP ${adr}/${chop}`,
      <td className={`${tdBase} whitespace-nowrap tabular-nums cursor-help`} title={chopTooltip(chop, adr)}><div className="flex flex-col leading-tight"><span className={`text-[10px] font-bold ${getAdrColor(adr)}`}>{adr != null ? `${adr.toFixed(1)}%` : '—'}</span></div></td>,
      <AdrCell adr={adr} chop={chop} />);
  }
  same(`ADR alone ${adr}`,
    <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums ${getAdrColor(adr)}`}>{adr != null ? `${adr.toFixed(1)}%` : '—'}</td>,
    <AdrCell adr={adr} />);
}

// ---- stage and sector ------------------------------------------------------
for (const st of ['Stage 2A', 'Stage 4', 'Stage 1B', '']) {
  same(`STAGE ${st || 'blank'}`,
    <td className={`${tdStage} whitespace-nowrap border-l border-white/5`}><span title={stageDescription(st)} className={`inline-block px-1 py-[1px] rounded border text-[9px] font-bold tabular-nums tracking-wide cursor-help ${stageBadge(st)}`}>{stageShort(st)}</span></td>,
    <StageCell stage={st} />);
}
for (const sec of ['Semiconductors', '']) {
  same(`SECTOR ${sec || 'blank'}`,
    <td className={tdSector}><span title={sec} className="block truncate text-left text-[8px] font-semibold tracking-wide uppercase text-slate-400">{sec}</span></td>,
    <SectorCell text={sec} />);
}

/* The coil table falls back to average dollar volume when a quiet base has no
   dollar volume worth printing. */
same('$VOL fallback',
  <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums`}>{'$252M'}</td>,
  <DollarVolCell value={0} fallback="$252M" />);

/* Hidden RS and the 100-bagger table hang a responsive modifier on some
   columns. It has to land where their hand-written markup put it. */
same('VOL with a responsive modifier',
  <td className={`${tdBase} text-[10px] text-slate-400 font-medium whitespace-nowrap tabular-nums hidden md:table-cell`}>{formatNumber(12345678)}</td>,
  <VolCell value={12345678} className="hidden md:table-cell" />);
same('RVOL keeps the colour after the modifier',
  <td className={`${tdBase} text-[10px] font-bold whitespace-nowrap tabular-nums hidden lg:table-cell ${getRvolColor(3.6)}`}>{`${Math.round(3.6)}x`}</td>,
  <RvolCell value={3.6} className="hidden lg:table-cell" />);

/* The format constants are the rule itself — they were identical in all twelve
   tables, and a change here changes every scanner at once. */
eq('cell padding', SCAN.td, 'px-0.5 pt-2.5 pb-1.5 text-center');
eq('header is centred and clickable', SCAN.th.endsWith('text-center'), true);
eq('stage column is left-aligned', SCAN.tdStage.endsWith('text-left'), true);
eq('sector column is left-aligned', SCAN.tdSector.endsWith('text-left'), true);
eq('filter pill has no stray cursor class', SCAN.pillBtn.includes('cursor-pointer'), false);

done('scan cells');
