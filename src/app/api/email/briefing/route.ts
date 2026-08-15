import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import {
  type ChopMode,
  CHOP_BANDS as CHOP_MODE_BANDS,
  DEFAULT_CHOP_MODE,
  bandsFor,
  chopComposite,
  rawChopOf,
  chopZoneLabel,
  chopHexColor,
  chopCellTone,
} from '@/lib/indicators/chopMarket';
import {
  marketTone,
  t2108ZoneLabel as t2108Zone,
  advPct,
  highsPct,
  toneCellTone,
  vixCellTone,
  breadthSignalTone,
  advCellTone,
  t2108CellTone,
  mkmCellTone,
  highsCellTone,
  marketMonitorOf,
  mmCellTone,
  mmRatioLabel,
} from '@/lib/indicators/marketScorecard';
import { dedupeByTicker, chgOf, dVolOf, advancingDollarShare } from '@/lib/indicators/marketMath';
import { stageHex as stageColor } from '@/lib/indicators/stage';
import { cnfHex, rvolHex, rsHex } from '@/lib/indicators/columnColors';
import { newsStarCount } from '@/lib/newsStars';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PHASES = ['pre', 'morning', 'midday', 'closing'] as const;
type Phase = (typeof PHASES)[number];

const PHASE_LABELS: Record<Phase, string> = {
  pre: 'Pre-Market',
  morning: 'Morning',
  midday: 'Midday',
  closing: 'Closing',
};

function resolveOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== 'null') return u.origin;
  } catch { /* fall through */ }
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

/* CHOP and the scorecard values are shared with the dashboard and the analyst
   page — see @/lib/indicators/{chopMarket,marketScorecard}. This file used to
   carry its own copies: a composite with a smaller modifier cap and no
   high/low term, and a T2108 vocabulary whose words meant different ranges
   than the dashboard's. The active band mode comes from /api/settings/chop —
   whatever was last selected on the site. */

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const chgClr = (v: number) => v >= 0 ? '#34d399' : '#fb7185';
// Stage 1 = basing (neutral), 2 = uptrend (green), 3 = topping (amber), 4 = decline (red) —
// matches the brief's own "Stage 4B/4C = always bearish" rule, so a glance at STG tells the story.
const fmtVol = (v: number) => v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(0) + 'M' : v > 0 ? '$' + (v / 1e3).toFixed(0) + 'K' : '';
const fmtVolShort = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : '—';

/* The page's palette (AnalystBrief SETUP_COLORS), not a second one. The email
   used to run EP indigo / VCP emerald / COIL lime against the page's EP rose /
   VCP violet / COIL cyan, so the same setup arrived in two different colours
   depending on which surface you read. */
const SETUP_COLORS: Record<string, string> = {
  EP: '#fb7185', VCP: '#a78bfa', COIL: '#22d3ee', SWING: '#fbbf24', PB: '#a78bfa',
};

/* Cell styling lives in the stylesheet as .d/.h rather than inline. See the
   size note on minify(): 448 data cells x 30 bytes of identical inline style
   was 13KB of a budget Gmail caps at ~102KB. Only the per-cell colour and
   alignment stay inline, so a client that drops <style> still shows the right
   colours — it just loses the padding. */

/* ===================================================================
   Page-mirroring blocks. Everything below reproduces what the analyst
   page renders, in the same order, so the email is not a second design
   that has to be kept in sync by hand.
   =================================================================== */

const CELL_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  green: { bg: '#064e3b30', border: '#34d39933', text: '#34d399' },
  red: { bg: '#4c111130', border: '#fb718533', text: '#fb7185' },
  amber: { bg: '#78350f30', border: '#fbbf2433', text: '#fbbf24' },
  slate: { bg: '#1e293b60', border: '#ffffff12', text: '#cbd5e1' },
};

interface ScoreCell { label: string; value: string; sub?: string; color: string }

/* The scorecard strip under the title — one cell per reading, wrapping to as
   many rows as the width allows.

   THIS WAS THE TRUNCATION. As a single table row of nine cells, each holding
   nowrap values like "413▲ / 224▼", the strip had a min-content width of
   roughly 740px — so on any pane narrower than that the strip refused to
   shrink, the document stayed 740px wide, and every card to the right of the
   viewport was clipped. Prose two sections down was losing its right-hand
   edge because of a table at the top of the email.

   Inline-block cells with a min-width wrap instead of setting a floor: nine
   across at full width, four across on a phone. font-size:0 on the container
   swallows the whitespace between inline-blocks. */
function scorecardGrid(cells: ScoreCell[]): string {
  if (!cells.length) return '';
  /* Width from the count, not a constant: a table stretched its cells to fill
     the row whatever the count, inline-blocks do not, and the strip is 8 cells
     on a day with no McClellan reading and 9 on a day with one. */
  const pct = (100 / cells.length).toFixed(2);
  const items = cells.map((c) => {
    const col = CELL_COLORS[c.color] || CELL_COLORS.slate;
    return `<div style="display:inline-block;width:${pct}%;min-width:88px;padding:0 1.5px 3px;vertical-align:top;box-sizing:border-box;">
      <div style="border-radius:6px;border:1px solid #ffffff12;background:#1e293b40;padding:6px 4px;text-align:center;">
        <div style="font-size:7px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;margin-bottom:2px;white-space:nowrap;">${c.label}</div>
        <div style="font-size:11px;font-weight:700;color:${col.text};line-height:1.15;white-space:nowrap;">${c.value}</div>
        <div style="font-size:8px;color:#64748b;margin-top:2px;white-space:nowrap;">${c.sub || '&nbsp;'}</div>
      </div>
    </div>`;
  }).join('');
  return `<div style="font-size:0;margin-bottom:8px;">${items}</div>`;
}

/* The page's TICKER_CHIP / TICKER_CHIP_RED, in solid colours. The originals
   are slate-500/10 and rose-950 with translucent borders; mail clients
   (Outlook's Word engine in particular) drop rgba and 8-digit hex, so these
   are the same colours flattened onto the #0f172a card. */
const tickerChip = (t: string) => `<span class="tk">${t}</span>`;
const tickerChipRed = (t: string) => `<span class="tk r">${t}</span>`;

/* The N column. The page links the stars to the article; so does this. */
function newsStarsHtml(row: any): string {
  const n = newsStarCount(row || {});
  if (!n) return '<span style="color:#334155;">&mdash;</span>';
  const stars = `<span style="font-size:8px;color:${n >= 2 ? '#fbbf24' : '#64748b'};">${'&#9733;'.repeat(n)}</span>`;
  const url = row?.catalystUrl;
  return url ? `<a href="${url}" style="text-decoration:none;">${stars}</a>` : stars;
}

/* The page's CNF pill: grade wins over the raw score when both are present,
   so a capped grade cannot be contradicted by its own number. */
function cnfPill(score: number | null | undefined, grade?: string | null): string {
  if (score == null) return '';
  const c = grade === 'A' ? '#34d399' : grade === 'B' ? '#fbbf24' : cnfHex(Number(score));
  return `<span class="p" style="background:${c}1a;border:1px solid ${c}33;color:${c};">${score}</span>`;
}

/* No setup badge in the row tables: the page's SummaryRow and GapperRow do not
   carry one either — SETUP_COLORS reaches the reader through the legend and
   nowhere else. */

/* Percentages carry the sign colour everywhere on the page, so they do here
   too. Applied before ticker chipping so the chip markup is never scanned. */
function colorPctsHtml(text: string): string {
  return text.replace(/([+-]?\d+(?:\.\d+)?)%/g, (whole, num) => {
    const v = parseFloat(num);
    if (isNaN(v)) return whole;
    const signed = /^[+-]/.test(num);
    if (!signed) return `<span style="font-weight:700;color:#cbd5e1;">${whole}</span>`;
    return `<span style="font-weight:700;color:${v >= 0 ? '#34d399' : '#fb7185'};">${whole}</span>`;
  });
}

function richHtml(text: string, known: Set<string>): string {
  const stripped = String(text || '').replace(/\*\*/g, '');
  const colored = colorPctsHtml(stripped);
  // Only chip tokens outside existing tags.
  return colored.replace(/(^|[\s(,])([A-Z]{1,5})(?=$|[\s),.:;])/g, (m, pre, tok) =>
    known.has(tok) ? `${pre}${tickerChip(tok)}` : m
  );
}

/* The analyst writes summary.tomorrow / watchlist / conviction / traps as one
   string per idea, each opening with a bold lead: either a bare ticker
   ("**NBIS** — CNF 85, RS 94…") or a whole headline sentence ("**AMAT reports
   tomorrow — $428.1B cap…**"). Joining them with <br/> ran seven separate
   ideas together into one slab, which is what made What to Look For Tomorrow
   unreadable. Each idea now gets its own block with a hairline above it, the
   same rhythm FormattedBlock gives every other prose section.

   The lead is only promoted to its own line when it ENDS IN TERMINAL
   PUNCTUATION — "**AMAT reports tomorrow — $428.1B cap, est EPS 3.40.**" or
   "**Other large caps reporting:**". Length alone is the wrong test: the
   analyst also bolds the subject of an ordinary sentence
   ("**PPI MoM at 08:30 ET**, est +0.2% against…"), and splitting that one
   stranded the body as ", est +0.2% against…" under a heading. Those stay on
   one line with the lead merely bold — or chipped, when it is a ticker. */
function noteBlocksHtml(arr: string[], known: Set<string>, color = '#cbd5e1'): string {
  if (!arr?.length) return '';
  return arr.map((raw, i) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = s.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/);
    const lead = m ? m[1].trim() : '';
    const rest = m ? m[2].trim() : '';
    const sep = i > 0 ? 'border-top:1px solid #ffffff0d;padding-top:10px;margin-top:10px;' : '';
    const isHeadline = !!lead && !!rest && /[.!?:]$/.test(lead);

    if (!isHeadline) {
      const leadHtml = !lead
        ? ''
        : known.has(lead)
          ? richHtml(lead, known)
          : `<strong style="color:#f1f5f9;">${richHtml(lead, known)}</strong>`;
      /* No space before a comma or full stop — the lead is mid-sentence. */
      const glue = leadHtml && rest && !/^[,.;:!?)]/.test(rest) ? ' ' : '';
      return `<div style="${sep}font-size:11px;color:${color};line-height:1.6;">${leadHtml}${glue}${richHtml(rest || (lead ? '' : s), known)}</div>`;
    }

    return `<div style="${sep}">
      <div style="font-size:11px;font-weight:700;color:#f1f5f9;line-height:1.5;">${richHtml(lead, known)}</div>
      <div style="font-size:10.5px;color:${color};line-height:1.5;padding-left:14px;margin-top:6px;">${richHtml(rest, known)}</div>
    </div>`;
  }).join('');
}

interface LabeledRow { label: string; value: string; detail: string }

function parseLabeled(text: string): LabeledRow[] {
  const rows: LabeledRow[] = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^\*{0,2}([A-Za-z0-9\s/&']+?)\*{0,2}:\s*(.+)/);
    if (!m) continue;
    const label = m[1].trim().replace(/\*+/g, '');
    const rest = m[2].replace(/\*+/g, '').trim();
    const i = rest.indexOf(' — ');
    if (i > 0) rows.push({ label, value: rest.slice(0, i).trim(), detail: rest.slice(i + 3).trim() });
    else rows.push({ label, value: rest, detail: '' });
  }
  return rows;
}

/* Mirrors FormattedBlock: label, then the value row, then the detail line
   indented beneath it, divided by hairlines. Falls back to plain paragraphs
   when the text carries no labels. */
function formattedBlockHtml(text: string, known: Set<string>): string {
  const rows = parseLabeled(text);
  if (!rows.length) {
    /* Mirrors the page's FormattedBlock: a line over 200 chars is split into
       sentences so each becomes its own separated block. Without this the
       email rendered multi-sentence analysis as one dense slab while the page
       showed the same text as spaced paragraphs — the two surfaces read the
       same brief and should look alike. Keep this rule in sync with
       AnalystBrief.tsx if either side changes. */
    const rawLines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const paras: string[] = [];
    for (const l of rawLines) {
      if (l.length > 200) {
        paras.push(...l.split(/(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean));
      } else {
        paras.push(l);
      }
    }
    return paras.map((p, i) =>
      `<div style="${i > 0 ? 'border-top:1px solid #ffffff0d;padding-top:10px;margin-top:10px;' : ''}font-size:11px;color:#cbd5e1;line-height:1.7;">${richHtml(p, known)}</div>`
    ).join('');
  }
  return rows.map((r, i) =>
    `<div style="${i > 0 ? 'border-top:1px solid #ffffff0d;padding-top:10px;margin-top:10px;' : ''}">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;margin-bottom:6px;">${r.label}</div>
      <div style="font-size:13px;color:#cbd5e1;line-height:1.8;">${richHtml(r.value, known)}</div>
      ${r.detail ? `<div style="font-size:12px;color:#94a3b8;line-height:1.7;margin-top:6px;">${richHtml(r.detail.charAt(0).toUpperCase() + r.detail.slice(1), known)}</div>` : ''}
    </div>`
  ).join('');
}

/* Card shell matching the page's SectionCard: full border, rounded corners,
   indigo pill title with dot — mirrors AnalystBrief.tsx SectionCard. */
function pageCard(title: string, _color: string, bodyHtml: string, _tint = '0a'): string {
  if (!bodyHtml) return '';
  return `<div style="margin-bottom:14px;border-radius:12px;border:1px solid #ffffff10;overflow:hidden;">
    <div class="card" style="padding:12px 12px;">
      <div style="margin-bottom:10px;border-bottom:1px solid #ffffff0d;padding-bottom:8px;">
        <span style="display:inline-block;font-size:8px;font-weight:700;color:#7c8bfa;background:#161c2a66;border:1px solid #ffffff0d;padding:2px 8px;border-radius:4px;letter-spacing:0.14em;text-transform:uppercase;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#7c8bfa;margin-right:6px;vertical-align:middle;"></span>${title}
        </span>
      </div>
      ${bodyHtml}
    </div>
  </div>`;
}

function parseSectorItems(raw: string): { name: string; pct: number }[] {
  const out: { name: string; pct: number }[] = [];
  /* Parentheses OPTIONAL. The generator writes "Technology +1.34%" now; this
     parser demanded "(+1.34%)" and would have rendered an empty sector block
     for every brief written after that change, with no error anywhere. Briefs
     cached in KV still carry the old shape, so both must parse. The sign is
     what actually delimits the name. */
  const re = /([A-Za-z][A-Za-z\s&]*?)\s*\(?([+-]\d+(?:\.\d+)?)%\)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.push({ name: m[1].trim().replace(/^,\s*/, ''), pct: parseFloat(m[2]) });
  }
  return out;
}

/* Horizontal bars growing from a centre line, same as the page's sector chart. */
function sectorBarsHtml(text: string): string {
  const lines = String(text || '').split('\n').filter((l) => l.trim());
  let leadRaw = '', lagRaw = '';
  for (const line of lines) {
    const stripped = line.replace(/^\*\*[^*]+\*\*:?\s*/, '');
    if (/^\*\*Leading/i.test(line.trim())) leadRaw = stripped;
    else if (/^\*\*Lagging/i.test(line.trim())) lagRaw = stripped;
  }
  if (!leadRaw && !lagRaw) {
    const all = parseSectorItems(text);
    if (!all.length) return '';
    leadRaw = text;
  }
  const all = [...parseSectorItems(leadRaw), ...parseSectorItems(lagRaw)].sort((a, b) => b.pct - a.pct);
  if (!all.length) return '';
  const maxAbs = Math.max(...all.map((s) => Math.abs(s.pct)), 0.01);
  const spread = all[0].pct - all[all.length - 1].pct;

  const rows = all.map((s) => {
    const w = Math.max(2, Math.round((Math.abs(s.pct) / maxAbs) * 46));
    const pos = s.pct >= 0;
    const bar = pos
      ? `<td width="50%" style="padding:0;"></td><td width="50%" style="padding:0;"><div style="width:${w * 2}%;height:16px;border-radius:3px;background:linear-gradient(90deg,#065f46,#34d399);"></div></td>`
      : `<td width="50%" style="padding:0;text-align:right;"><div style="width:${w * 2}%;height:16px;border-radius:3px;background:linear-gradient(90deg,#fb7185,#7f1d3a);margin-left:auto;"></div></td><td width="50%" style="padding:0;"></td>`;
    return `<tr>
      <td width="26%" style="padding:4px 10px 4px 0;text-align:right;font-size:11px;color:${pos ? '#34d399' : '#cbd5e1'};">${s.name}</td>
      <td width="58%" style="padding:4px 0;"><table width="100%" style="border-collapse:collapse;"><tr>${bar}</tr></table></td>
      <td width="16%" style="padding:4px 0 4px 10px;text-align:right;font-size:11px;font-weight:700;color:${pos ? '#34d399' : '#fb7185'};">${fmtPct(s.pct)}</td>
    </tr>`;
  }).join('');

  /* Inner block only — the page nests this inside the Sectors & Money Flow
     card alongside the two flow tables, so it must not carry a card of its
     own. See sectorsCardHtml. */
  return `<div style="border-radius:8px;background:#0b1424;border:1px solid #ffffff08;padding:10px 8px;margin-bottom:10px;">
    <table width="100%" style="border-collapse:collapse;margin:0 8px 6px;"><tr>
      <td style="text-align:right;font-size:10px;color:#475569;">Spread ${spread.toFixed(2)}%</td>
    </tr></table>
    <table width="100%" style="border-collapse:collapse;">${rows}</table>
  </div>`;
}

/* Sectors & Money Flow — ONE card, as on the page: the sector bars, then ETF
   Flow and Money Flow side by side beneath them. The email used to render the
   bars in an unlabelled card and then two more standalone cards built from a
   different pool with different prose, so the same section looked like three
   sections and reported different numbers. Rows, limits, shares and blurb
   wording below are SectorSection's. */
function sectorsCardHtml(sectorText: string, snapshot: any): string {
  const movers = snapshot?.stocksInPlay?.topMovers || {};

  const etfAll = dedupeByTicker([...(movers['ETF Gainers'] || []), ...(movers['ETF Losers'] || [])]);
  const etfRows = etfAll
    .filter((e: any) => dVolOf(e) > 0)
    .sort((a: any, b: any) => dVolOf(b) - dVolOf(a))
    .slice(0, 5);

  const flowAll = dedupeByTicker([
    ...(movers['Gainers'] || []), ...(movers['Losers'] || []), ...(movers['Mega Caps'] || []),
  ]);
  const flowRows = flowAll
    .filter((s: any) => dVolOf(s) > 0)
    .sort((a: any, b: any) => dVolOf(b) - dVolOf(a))
    .slice(0, 5);

  const etfShare = advancingDollarShare(etfAll);
  const mfShare = advancingDollarShare(flowAll);
  const totalDVol = flowAll.reduce((a: number, s: any) => a + dVolOf(s), 0);

  const bars = sectorText ? sectorBarsHtml(sectorText) : '';
  const tables = twoColHtml(
    flowTableHtml('ETF Flow', '#818cf8',
      `${etfShare}% of ETF dollars on the advancing side${etfShare >= 60 ? ' — chasing strength.' : etfShare <= 40 ? ' — favoring defense.' : ' — no clean bet.'}`,
      etfRows),
    flowTableHtml('Money Flow', '#fb7185',
      `${fmtVol(totalDVol)} tracked, ${mfShare}% advancing${mfShare >= 60 ? ' — buyers paying up.' : mfShare <= 40 ? ' — sellers control.' : ' — two-sided fight.'}`,
      flowRows),
  );

  if (!bars && !tables) return '';
  return pageCard('Sectors &amp; Money Flow', '#22d3ee', bars + tables);
}

/* Every table on the page opens sorted by CNF descending — GapperSection,
   SIPSection and ActionableSummary all initialise their sort key to 'cnf' —
   with RS as the tiebreak. The email sorted Top Movers by change% instead, so
   the same section listed different names in a different order on the two
   surfaces. Mirrors sortStocks/getVal in AnalystBrief. */
function sortByCnf<T extends any>(stocks: T[]): T[] {
  const cnf = (s: any) => Number(s?.score ?? 0);
  const rs = (s: any) => Number(s?.rs ?? s?.rsRating ?? 0);
  return [...stocks].sort((a, b) => (cnf(b) - cnf(a)) || (rs(b) - rs(a)));
}

/* The page's SummaryRow / GapperRow, column for column: grade letter, ticker,
   CNF, CHG%, RVOL, VOL, $VOL, STG, RS, N. The ladders come from the same
   modules the page's cells read, so a value cannot be green here and slate
   there. */
function pageStockTable(stocks: any[], opts: { red?: boolean } = {}): string {
  if (!stocks?.length) return '';
  const rows = stocks.map((s: any) => {
    const chg = s.changePct ?? 0;
    const rv = s.rvol != null ? Number(s.rvol) : null;
    const dv = s.dVol ?? s.dvol ?? (s.price && (s.vol || s.volume) ? s.price * (s.vol || s.volume) : 0);
    const grade = s.grade || '';
    const gradeClr = grade === 'A' ? '#34d399' : grade === 'B' ? '#fbbf24' : '#64748b';
    const stage = String(s.stage || '').replace(/Stage\s*/i, '') || '';
    const rs = s.rs ?? s.rsRating ?? null;
    return `<tr>
      <td class="d" style="padding-left:0;font-weight:800;color:${gradeClr};text-align:center;width:14px;font-size:9px;">${grade === 'A' || grade === 'B' ? grade : ''}</td>
      <td class="d" style="white-space:nowrap;">${opts.red ? tickerChipRed(s.ticker) : tickerChip(s.ticker)}</td>
      <td class="d" style="text-align:center;">${cnfPill(s.score, grade)}</td>
      <td class="d" style="text-align:right;font-weight:700;color:${chgClr(chg)};white-space:nowrap;">${fmtPct(chg)}</td>
      <td class="d" style="text-align:right;color:${rvolHex(rv)};font-weight:700;">${rv != null ? rv.toFixed(2) : ''}</td>
      <td class="d" style="text-align:right;color:#94a3b8;">${s.vol || s.volume ? fmtVolShort(s.vol || s.volume) : ''}</td>
      <td class="d" style="text-align:right;color:#cbd5e1;">${dv ? fmtVol(dv) : ''}</td>
      <td class="d" style="text-align:center;color:${stageColor(stage)};font-weight:700;font-size:9px;">${stage}</td>
      <td class="d" style="text-align:right;color:${rsHex(rs)};font-weight:700;">${rs ?? ''}</td>
      <td class="d" style="text-align:center;">${newsStarsHtml(s)}</td>
    </tr>`;
  }).join('');
  return `<table width="100%" style="border-collapse:collapse;">
    <tr>
      <th class="h" style="padding-left:0;"></th>
      <th class="h" style="text-align:left;">Ticker</th>
      <th class="h" style="text-align:center;">CNF</th>
      <th class="h" style="text-align:right;">Chg%</th>
      <th class="h" style="text-align:right;">RVol</th>
      <th class="h" style="text-align:right;">Vol</th>
      <th class="h" style="text-align:right;">$Vol</th>
      <th class="h" style="text-align:center;">Stg</th>
      <th class="h" style="text-align:right;">RS</th>
      <th class="h" style="text-align:center;">N</th>
    </tr>${rows}</table>`;
}

/* The page's FlowTable — ETF Flow and Money Flow inside Sectors & Money Flow.
   It reads the scanner's own field names (cnfScore/cnfGrade/dVol/rsRating) and
   uses its own ladders for RS and stage, which are NOT the ones the stock
   tables above use. Reproduced as-is rather than harmonised: matching the page
   is the point, and quietly "fixing" one of its ladders here would put the two
   surfaces back out of step. */
function flowTableHtml(title: string, color: string, blurb: string, rows: any[]): string {
  if (!rows?.length) return '';
  const body = rows.map((r: any) => {
    const chg = r.changePct || 0;
    const cnf = r.cnfScore ?? 0;
    const rs = r.rsRating || 0;
    const stage = String(r.stage || '').replace(/^Stage\s*/i, '');
    const rvol = r.rvol || 0;
    const chipClr = chg >= 0
      ? { bg: '#0c2b21', border: '#1c5a45', text: '#6ee7b7' }
      : { bg: '#3a121e', border: '#7f2337', text: '#fda4af' };
    const dot = r.dotKind === 'red' ? '<span style="color:#f43f5e;">&#9679;</span>'
      : r.dotKind === 'blue' ? '<span style="color:#3b82f6;">&#9679;</span>' : '';
    return `<tr>
      <td class="d" style="padding-left:0;white-space:nowrap;">
        <span style="display:inline-block;background:${chipClr.bg};border:1px solid ${chipClr.border};border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700;letter-spacing:0.06em;color:${chipClr.text};">${r.ticker}</span> ${dot}
      </td>
      <td class="d" style="text-align:center;">${cnfPill(cnf, r.cnfGrade)}</td>
      <td class="d" style="text-align:right;font-weight:700;color:${chgClr(chg)};white-space:nowrap;">${fmtPct(chg)}</td>
      <td class="d" style="text-align:right;color:${rvol >= 2 ? '#34d399' : rvol >= 1 ? '#cbd5e1' : '#64748b'};font-weight:${rvol >= 2 ? '700' : '400'};">${rvol.toFixed(2)}</td>
      <td class="d" style="text-align:right;color:#94a3b8;">${fmtVolShort(r.vol || 0)}</td>
      <td class="d" style="text-align:right;color:#94a3b8;">${fmtVol(dVolOf(r))}</td>
      <td class="d" style="text-align:center;font-size:10px;color:${/^[12]/.test(stage) ? '#34d399' : /^4/.test(stage) ? '#fb7185' : '#64748b'};">${stage}</td>
      <td class="d" style="text-align:right;font-weight:700;color:${rs >= 80 ? '#34d399' : rs >= 50 ? '#cbd5e1' : rs > 0 ? '#fb7185' : '#475569'};">${rs || ''}</td>
      <td class="d" style="text-align:center;">${newsStarsHtml(r)}</td>
    </tr>`;
  }).join('');

  const borderClr = color === '#818cf8' ? '#6366f1' : '#f43f5e';
  return `<div class="card" style="border-radius:0 6px 6px 0;padding:8px 10px;border-left:3px solid ${borderClr};background:#0a1220;">
    <div style="font-size:9px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${borderClr};margin-bottom:4px;">${title}</div>
    <div style="font-size:9px;color:#94a3b8;line-height:1.5;margin-bottom:6px;">${blurb}</div>
    <table width="100%" style="border-collapse:collapse;">
      <tr>
        <th class="h" style="padding-left:0;text-align:left;">Ticker</th>
        <th class="h" style="text-align:center;">CNF</th>
        <th class="h" style="text-align:right;">Chg%</th>
        <th class="h" style="text-align:right;">RVol</th>
        <th class="h" style="text-align:right;">Vol</th>
        <th class="h" style="text-align:right;">$Vol</th>
        <th class="h" style="text-align:center;">Stg</th>
        <th class="h" style="text-align:right;">RS</th>
        <th class="h" style="text-align:center;">N</th>
      </tr>${body}
    </table>
  </div>`;
}

/* Two panels side by side, stacking is left to the client. */
function twoColHtml(left: string, right: string): string {
  if (!left && !right) return '';
  if (!left || !right) return left || right;
  /* class="col" is the hook the stylesheet uses to stack these on a narrow
     viewport. Two ten-column tables cannot share 380px, and a mail client
     clips rather than scrolls — which is what cut the right-hand edge off. */
  return `<table width="100%" style="border-collapse:separate;border-spacing:0;margin-bottom:10px;"><tr>
    <td class="col" width="50%" style="padding-right:4px;vertical-align:top;">${left}</td>
    <td class="col" width="50%" style="padding-left:4px;vertical-align:top;">${right}</td>
  </tr></table>`;
}

function panel(title: string, color: string, bodyHtml: string): string {
  if (!bodyHtml) return '';
  return `<div style="border-radius:0 6px 6px 0;background:#0a1220;overflow:hidden;height:100%;border-left:3px solid ${color};">
    <div class="card" style="padding:8px 10px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${color};margin-bottom:6px;">${title}</div>
      ${bodyHtml}
    </div>
  </div>`;
}

function legendHtml(): string {
  const dot = (c: string) => `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${c};vertical-align:middle;margin-right:2px;"></span>`;
  return `<div style="margin-bottom:14px;font-size:9px;color:#64748b;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;line-height:2.4;">
    <span style="color:#34d399;">A</span> <span style="color:#fbbf24;">B</span> <span style="color:#64748b;">Grade</span>
    &nbsp;&nbsp;
    <span style="display:inline-block;border:1px solid #ffffff14;background:#ffffff05;border-radius:3px;padding:1px 6px;color:#94a3b8;font-size:8px;">10/21 ${dot('#34d399')}Stacked ${dot('#fbbf24')}Pre-Cross ${dot('#fb7185')}Ext / Below</span>
    &nbsp;&nbsp;
    <span style="display:inline-block;font-size:8px;font-weight:700;padding:1px 6px;border-radius:3px;background:#4c051918;color:#fecdd3;border:1px solid #fb718530;">Trap</span>
    &nbsp;&nbsp;
    ${dot('#3b82f6')}<span style="color:#64748b;">Blue Dot</span>
    &nbsp;&nbsp;
    <span style="color:#64748b;">&starf;</span> <span style="color:#64748b;">News</span>
    &nbsp;&nbsp;
    <span style="color:#fbbf24;">&starf;&starf;</span> <span style="color:#64748b;">Catalyst</span>
  </div>`;
}

/* Key Events — same filters as the page: today's non-Low econ prints, and
   $20B+ caps reporting today or tomorrow. */
/* Shared by Key Events and the closing brief's tomorrow section — one
   implementation so the two can't disagree about which day "tomorrow" is. */
const etDate = (off = 0) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function keyEventsHtml(econ: any[], earnings: any[]): string {
  const nowD = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
  const today = etDate(0), tomorrow = etDate(1);

  const parseTime = (s: string): number | null => {
    const m = String(s || '').match(/(\d{2}):(\d{2})/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
  };
  const fmtTime = (min: number | null) => {
    if (min == null) return '';
    const h = Math.floor(min / 60) % 12 || 12;
    return `${h}:${String(min % 60).padStart(2, '0')} ${min >= 720 ? 'PM' : 'AM'}`;
  };
  const fmtNum = (v: any) => {
    if (v == null) return '—';
    const n = Number(v);
    if (isNaN(n)) return String(v);
    const a = Math.abs(n);
    if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return String(n);
  };

  const econList = (Array.isArray(econ) ? econ : [])
    .map((e: any) => ({ ...e, minutes: parseTime(e.date) }))
    .filter((e: any) => String(e.date || '').startsWith(today) && e.impact !== 'Low')
    .sort((a: any, b: any) => (a.minutes ?? 0) - (b.minutes ?? 0));

  const earnList = (Array.isArray(earnings) ? earnings : [])
    .filter((e: any) => {
      const dk = String(e.date || '').slice(0, 10);
      return (dk === today || dk === tomorrow) && (e.mktCap ?? 0) >= 20e9;
    })
    .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));

  if (!econList.length && !earnList.length) return '';

  const todayE = earnList.filter((e: any) => String(e.date).slice(0, 10) === today);
  const tmrwE = earnList.filter((e: any) => String(e.date).slice(0, 10) === tomorrow);
  const aheadCount = econList.filter((e: any) => (e.minutes ?? 0) > nowMin).length;

  const econRows = econList.map((e: any) => {
    const pending = (e.minutes ?? 0) > nowMin;
    return `<tr>
      <td class="d" style="padding-left:0;color:#64748b;width:10px;">${pending ? '▸' : ''}</td>
      <td class="d" style="color:#cbd5e1;white-space:nowrap;">${fmtTime(e.minutes)}</td>
      <td class="d" style="color:#e2e8f0;">${e.event || ''}</td>
      <td class="d" style="text-align:right;color:${e.actual != null ? '#34d399' : '#475569'};font-weight:${e.actual != null ? '700' : '400'};">${e.actual != null ? fmtNum(e.actual) : '—'}</td>
      <td class="d" style="text-align:right;color:#cbd5e1;">${e.estimate != null ? fmtNum(e.estimate) : '—'}</td>
      <td class="d" style="text-align:right;color:#64748b;">${e.previous != null ? fmtNum(e.previous) : '—'}</td>
    </tr>`;
  }).join('');

  const econHtml = econList.length ? `
    <div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">Economic${aheadCount ? ` — ${aheadCount} still ahead` : ''}</div>
    <table width="100%" style="border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <th class="h" style="padding-left:0;"></th>
        <th class="h" style="text-align:left;">Time</th>
        <th class="h" style="text-align:left;">Event</th>
        <th class="h" style="text-align:right;">Act</th>
        <th class="h" style="text-align:right;">Est</th>
        <th class="h" style="text-align:right;">Prev</th>
      </tr>${econRows}
    </table>` : '';

  const earnCol = (label: string, list: any[]) => {
    if (!list.length) return '';
    const rows = list.map((e: any) => {
      const beat = e.epsActual != null && e.epsEstimated != null ? e.epsActual >= e.epsEstimated : null;
      return `<tr>
        <td class="d" style="padding-left:0;color:#64748b;width:10px;">${e.epsActual == null ? '▸' : ''}</td>
        <td class="d" style="white-space:nowrap;">${tickerChip(e.symbol || e.ticker || '')}</td>
        <td class="d" style="color:#64748b;font-size:9px;">${e.epsActual != null ? (beat ? '<span style="color:#34d399;font-weight:700;">BEAT</span>' : '<span style="color:#fb7185;font-weight:700;">MISS</span>') : 'est'}</td>
        <td class="d" style="text-align:right;color:#e2e8f0;font-weight:700;">${e.epsActual ?? e.epsEstimated ?? '—'}</td>
        <td class="d" style="color:#64748b;font-size:9px;">EPS</td>
        <td class="d" style="text-align:right;color:#64748b;font-size:9px;white-space:nowrap;">${e.revenueEstimated ? 'rev ' + fmtNum(e.revenueEstimated) : ''}</td>
      </tr>`;
    }).join('');
    const pending = list.filter((e: any) => e.epsActual == null).length;
    return `<div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">${label}${pending ? ` — ${pending} pending` : ''}</div>
      <table width="100%" style="border-collapse:collapse;">
        <tr><th class="h" style="padding-left:0;"></th><th class="h" style="text-align:left;">Ticker</th><th class="h" style=""></th><th class="h" style="text-align:right;">EPS</th><th class="h" style=""></th><th class="h" style=""></th></tr>
        ${rows}
      </table>`;
  };

  const earnHtml = (todayE.length || tmrwE.length)
    ? `<table width="100%" style="border-collapse:separate;border-spacing:0;"><tr>
        <td width="50%" style="padding-right:8px;vertical-align:top;">${earnCol('Today', todayE)}</td>
        <td width="50%" style="padding-left:8px;vertical-align:top;">${earnCol('Tomorrow', tmrwE)}</td>
      </tr></table>`
    : '';

  return pageCard('Key Events', '#22d3ee',
    `<div style="font-size:10px;color:#64748b;line-height:1.5;margin-bottom:16px;">Today&rsquo;s releases and large-cap prints. &#9656; marks what has not happened yet.</div>${econHtml}${earnHtml}`
  );
}

/* ---- What to Look For Tomorrow — CLOSING PHASE ONLY --------------------
   The other three phases are about the session in progress; the closing brief
   is the only one read after the bell, when the useful question is what sets
   up next. Key Events shows tomorrow's earnings but drops tomorrow's econ
   entirely (its econ filter is same-day), so the calendar half of this is
   information the closing email otherwise never carried. */
function tomorrowHtml(brief: any, econ: any[], earnings: any[], knownTickers: Set<string>): string {
  const tomorrow = etDate(1);
  const summary = brief?.summary || {};

  const parseTime = (s: string): number | null => {
    const m = String(s || '').match(/(\d{2}):(\d{2})/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
  };
  const fmtTime = (min: number | null) => {
    if (min == null) return '';
    const h = Math.floor(min / 60) % 12 || 12;
    return `${h}:${String(min % 60).padStart(2, '0')} ${min >= 720 ? 'PM' : 'AM'}`;
  };

  /* The analyst's own forward view. `tomorrow` is the dedicated field; the
     watchlist is carried in behind it because a name that was "not yet
     actionable" at the close is exactly what tomorrow's plan hangs on. */
  const tomorrowArr: string[] = Array.isArray(summary.tomorrow) ? summary.tomorrow : [];
  const watchArr: string[] = Array.isArray(summary.watchlist) ? summary.watchlist : [];

  const econList = (Array.isArray(econ) ? econ : [])
    .map((e: any) => ({ ...e, minutes: parseTime(e.date) }))
    .filter((e: any) => String(e.date || '').startsWith(tomorrow) && e.impact !== 'Low')
    .sort((a: any, b: any) => (a.minutes ?? 0) - (b.minutes ?? 0));

  const earnList = (Array.isArray(earnings) ? earnings : [])
    .filter((e: any) => String(e.date || '').slice(0, 10) === tomorrow && (e.mktCap ?? 0) >= 20e9);

  if (!tomorrowArr.length && !watchArr.length && !econList.length && !earnList.length) return '';

  const econRows = econList.map((e: any) => `<tr>
      <td class="d" style="padding-left:0;color:#cbd5e1;white-space:nowrap;">${fmtTime(e.minutes)}</td>
      <td class="d" style="color:#e2e8f0;">${e.event || ''}</td>
      <td class="d" style="text-align:right;color:#cbd5e1;">${e.estimate != null ? e.estimate : '—'}</td>
      <td class="d" style="text-align:right;color:#64748b;">${e.previous != null ? e.previous : '—'}</td>
    </tr>`).join('');

  const econBlock = econList.length
    ? `<div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">Economic Releases</div>
       <table width="100%" style="border-collapse:collapse;">
         <tr>
           <th class="h" style="padding-left:0;text-align:left;">Time</th>
           <th class="h" style="text-align:left;">Event</th>
           <th class="h" style="text-align:right;">Est</th>
           <th class="h" style="text-align:right;">Prev</th>
         </tr>${econRows}
       </table>`
    : '';

  const earnRows = earnList.map((e: any) => `<tr>
      <td class="d" style="padding-left:0;white-space:nowrap;">${tickerChip(e.symbol || e.ticker || '')}</td>
      <td class="d" style="color:#64748b;font-size:9px;">${e.when || e.time || ''}</td>
      <td class="d" style="text-align:right;color:#e2e8f0;font-weight:700;">${e.epsEstimated ?? '—'}</td>
      <td class="d" style="color:#64748b;font-size:9px;">EPS est</td>
    </tr>`).join('');

  const earnBlock = earnList.length
    ? `<div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">Large-Cap Prints</div>
       <table width="100%" style="border-collapse:collapse;">
         <tr><th class="h" style="padding-left:0;text-align:left;">Ticker</th><th class="h" style=""></th><th class="h" style="text-align:right;">EPS</th><th class="h" style=""></th></tr>
         ${earnRows}
       </table>`
    : '';

  const calendar = (econBlock || earnBlock)
    ? `<div style="border-top:1px solid #ffffff0d;padding-top:14px;margin-top:16px;">${twoColHtml(econBlock, earnBlock)}</div>`
    : '';

  const subLabel = (t: string) =>
    `<div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin:16px 0 10px;">${t}</div>`;

  return pageCard('What to Look For Tomorrow', '#22d3ee',
    `<div style="font-size:10px;color:#64748b;line-height:1.5;margin-bottom:16px;">The setups and scheduled events that carry into the next session. Levels are the analyst&rsquo;s; each directional call states what invalidates it.</div>` +
    noteBlocksHtml(tomorrowArr, knownTickers) +
    (watchArr.length ? subLabel('Carried Watchlist') + noteBlocksHtml(watchArr, knownTickers) : '') +
    calendar
  );
}

/* GMAIL CLIPS A MESSAGE OVER ~102KB, hiding everything past the cut behind a
   "[Message clipped]" link. The briefing hit 125KB and the last card — What to
   Look For Tomorrow, which starts around byte 116,000 — simply never appeared
   in the inbox, while the ?preview=1 render showed it fine. That is a nasty
   failure: the email looks correct everywhere you would check it.

   The markup is generated from indented template literals, so most of the
   excess is leading whitespace. Only whitespace runs CONTAINING A NEWLINE are
   collapsed — a single space between two tags on one line is a real word gap
   (the chip and its dot in flowTableHtml), and eating it would join them. */
function minify(html: string): string {
  return html.replace(/>[^\S\n]*\n\s*</g, '><').replace(/\n\s+/g, '\n').trim();
}

function buildEmail(phase: Phase, macro: any, chop: any, t2108Data: any, brief: any, snapshot: any, chopMode: ChopMode = DEFAULT_CHOP_MODE, econ: any[] = [], earnings: any[] = []): string {
  const chopBands = bandsFor(chopMode);
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const phaseLabel = PHASE_LABELS[phase];

  const quotes = macro?.quotes || {};
  const bData = macro?.breadth;

  const { tone } = marketTone(quotes, bData?.score);
  const chopVal = chop?.success ? chopComposite(rawChopOf(chop), bData ?? null) : null;
  const tVal = t2108Data?.value ?? null;

  /* ---- Scorecard strip — same order as MacroScorecardPanel on the page --- */
  const scCells: ScoreCell[] = [];
  scCells.push({ label: 'TONE', value: tone, color: toneCellTone(tone) });

  if (bData) {
    scCells.push({ label: 'BREADTH', value: `${bData.score}/6`, sub: bData.signal, color: breadthSignalTone(bData.signal) });
  }
  const mm = marketMonitorOf(bData);
  if (mm) {
    const partial = mm.days > 0 && mm.days < 5;
    scCells.push({
      label: 'MARKET MON',
      value:
        `<span style="color:#34d399;">${mm.up4}&#9650;</span>` +
        `<span style="color:#475569;"> / </span>` +
        `<span style="color:#fb7185;">${mm.down4}&#9660;</span>`,
      sub: mm.ratio5 != null
        ? `${mmRatioLabel(mm)}&times;${partial ? ` &middot; ${mm.days}/5d` : ' 5d'}`
        : partial ? `${mm.days}/5d` : '',
      color: mmCellTone(mm.ratio5),
    });
  }
  if (bData) {
    const ad = advPct(bData.advancers, bData.decliners);
    scCells.push({ label: 'ADV / DEC', value: `${ad.toFixed(1)}%`, sub: `${bData.advancers ?? 0} / ${bData.decliners ?? 0}`, color: advCellTone(ad) });
  }
  if (bData && (bData.newHighs != null || bData.newLows != null)) {
    const hp = highsPct(bData.newHighs, bData.newLows);
    scCells.push({ label: 'HI / LO', value: `${hp.toFixed(1)}%`, sub: `${bData.newHighs ?? 0} / ${bData.newLows ?? 0}`, color: highsCellTone(hp) });
  }
  if (tVal != null) {
    scCells.push({ label: 'T2108', value: `${tVal.toFixed(0)}%`, sub: t2108Zone(tVal), color: t2108CellTone(tVal) });
  }
  if (bData?.mkm != null) {
    const rising = !!bData.mkmRising;
    scCells.push({
      label: 'McCLELLAN',
      value: `${Number(bData.mkm).toFixed(0)}%`,
      sub: `${rising ? '▲' : '▼'} vs ${Number(bData.mkmSignal ?? 0).toFixed(0)}`,
      color: mkmCellTone(Number(bData.mkm), Number(bData.mkmSignal ?? 0), rising),
    });
  }
  const vixQ = quotes['VIX'];
  if (vixQ?.price) {
    const sign = (vixQ.pct ?? 0) >= 0 ? '+' : '';
    scCells.push({
      label: 'VIX',
      value: Number(vixQ.price).toFixed(2),
      sub: `${sign}${Number(vixQ.pct ?? 0).toFixed(2)}%`,
      color: vixCellTone(Number(vixQ.price)),
    });
  }
  if (chopVal != null) {
    scCells.push({
      label: 'CHOP',
      value: chopVal.toFixed(0),
      sub: chopZoneLabel(chopVal, chopBands),
      color: chopCellTone(chopVal, chopBands),
    });
  }
  const scorecardHtml = scorecardGrid(scCells);

  /* ---- Pool behind the ticker chipping in prose ------------------------- */
  const sip = snapshot?.stocksInPlay || {};
  const movers = sip?.topMovers || {};
  const ep9mList: any[] = Array.isArray(snapshot?.ep9m?.candidates) ? snapshot.ep9m.candidates : [];
  const flowPool = dedupeByTicker([
    ...(Array.isArray(sip.stocksInPlay) ? sip.stocksInPlay : []),
    ...(Array.isArray(sip.dailySetups) ? sip.dailySetups : []),
    ...ep9mList,
    ...(movers['Gainers'] || []), ...(movers['Losers'] || []), ...(movers['Mega Caps'] || []),
  ]);

  const sections = brief?.sections || [];
  const summary = brief?.summary || {};
  const topTrades = sections.find((s: any) => s.section === 'Top Trades')?.stocks || [];
  const topAvoid = sections.find((s: any) => s.section === 'Top Avoid')?.stocks || [];

  const knownTickers = new Set<string>([
    ...topTrades.map((s: any) => s.ticker),
    ...topAvoid.map((s: any) => s.ticker),
    ...flowPool.map((s: any) => s.ticker),
    ...Object.keys(quotes),
  ].filter(Boolean));

  const sectionByName = (rx: RegExp) => sections.find((s: any) => rx.test(s.section));

  /* ---- Cards, in page order -------------------------------------------- */
  const macroSec = sectionByName(/Futures.*Macro|Macro.*Snapshot/i);
  const macroHtml = macroSec?.analysis
    ? pageCard('Macro Snapshot', '#22d3ee', formattedBlockHtml(macroSec.analysis, knownTickers))
    : '';

  const newsSec = sections.find((s: any) => s.section === 'Key News & Catalysts');
  /* An absent brief and a quiet news day used to render identically — both as
     nothing at all. That hid a broken analyst pipeline for as long as it stayed
     broken, so the unavailable case now says so. */
  const briefMissing = !sections.length;
  const newsHtml = newsSec?.analysis
    ? pageCard('Key News &amp; Catalysts', '#22d3ee', formattedBlockHtml(newsSec.analysis, knownTickers))
    : briefMissing
    ? pageCard('Key News &amp; Catalysts', '#22d3ee', '<div style="color:#f59e0b;font-size:12px;">Analyst brief unavailable when this email was built — news and sector sections are missing, not empty.</div>')
    : '';

  /* ---- Market Regime — regime + Risk + Structure in ONE card ------------
     The dashboard builds a single "Market Regime:" paragraph out of these
     three fields and the analyst page now renders the same three in one
     cyan card, so the email does too. It previously carried Caution Flag
     alone, under its own amber heading, and dropped the regime read and the
     posture entirely — the two fields the whole brief is conditioned on. */
  const rd = brief?.regimeDetail || {};
  const regimeDetailText = [
    rd.caution ? `Risk: ${rd.caution}` : null,
    rd.posture ? `Structure: ${rd.posture}` : null,
  ].filter(Boolean).join('\n');
  const regimeHtml = (rd.regime || regimeDetailText)
    ? pageCard('Market Regime', '#22d3ee',
        (rd.regime ? formattedBlockHtml(rd.regime, knownTickers) : '') +
        (regimeDetailText
          ? `<div style="${rd.regime ? 'border-top:1px solid #ffffff0d;padding-top:12px;margin-top:12px;' : ''}">${formattedBlockHtml(regimeDetailText, knownTickers)}</div>`
          : ''))
    : '';

  const sectorSec = sections.find((s: any) => s.section === 'Top Sectors & Money Flow');
  const sectorsHtml = sectorsCardHtml(sectorSec?.analysis || '', snapshot);

  /* ---- Top Movers — five a side inside one card, as on the page --------- */
  const gapSec = sections.find((s: any) => /Gappers|Intraday Movers/i.test(s.section));
  const gapStocks: any[] = gapSec?.stocks || [];
  const ups = sortByCnf(
    gapStocks.filter((s) => s.direction === 'up' || s.direction === 'long' || (!['down','short'].includes(s.direction) && (s.gapPct ?? s.changePct ?? 0) > 0))
  ).slice(0, 5);
  const downs = sortByCnf(
    gapStocks.filter((s) => s.direction === 'down' || s.direction === 'short' || (!['up','long'].includes(s.direction) && (s.gapPct ?? s.changePct ?? 0) < 0))
  ).slice(0, 5);
  const moversHtml = (ups.length || downs.length)
    ? pageCard('Top Movers', '#22d3ee', twoColHtml(
        ups.length ? panel('Movers Up', '#34d399', pageStockTable(ups)) : '',
        downs.length ? panel('Movers Down', '#fb7185', pageStockTable(downs, { red: true })) : '',
      ))
    : '';

  /* ---- Stocks in Play — stock table first, analysis brief below ---------- */
  const sipSec = sections.find((s: any) => s.section === 'Stocks in Play Today');
  const sipStocks: any[] = sortByCnf(sipSec?.stocks || []).slice(0, 10);
  const sipMid = Math.ceil(sipStocks.length / 2);
  const sipHtml = (sipStocks.length || sipSec?.analysis)
    ? pageCard('Stocks in Play Today', '#22d3ee',
        (sipStocks.length
          ? twoColHtml(pageStockTable(sipStocks.slice(0, sipMid)), pageStockTable(sipStocks.slice(sipMid)))
          : '') +
        (sipSec?.analysis
          ? `<div style="font-size:12px;color:#cbd5e1;line-height:1.75;margin-top:12px;">${richHtml(sipSec.analysis, knownTickers)}</div>`
          : ''))
    : '';

  /* ---- Actionable Summary ----------------------------------------------
     THE ORDER OF Top Trades IS THE RANKING — first two are the conviction
     calls, the next five the watchlist, exactly as ActionableSummary slices
     them. The email used to re-derive conviction by scraping **TICKER**
     out of summary.conviction, which the page ignores entirely, so the two
     surfaces could disagree about which names were the high-conviction ones.

     Traps sit INSIDE this card on the page rather than taking their own. */
  const convictionArr: string[] = Array.isArray(summary.conviction)
    ? summary.conviction
    : summary.conviction ? [String(summary.conviction)] : [];
  const watchlistArr: string[] = Array.isArray(summary.watchlist) ? summary.watchlist : [];
  /* Slice THEN sort, in that order — the page ranks by position first and
     only sorts within each panel. Sorting first would let a high-CNF
     watchlist name climb into the conviction pair. */
  const conviction = sortByCnf(topTrades.slice(0, 2));
  const watchlistTrades = sortByCnf(topTrades.slice(2, 7));

  const proseList = (arr: string[], color: string) =>
    arr.length
      ? `<div style="margin-bottom:12px;">${noteBlocksHtml(arr, knownTickers, color)}</div>`
      : '';

  const trapsArr: string[] = Array.isArray(summary.traps) ? summary.traps : [];
  const traps = sortByCnf(topAvoid.slice(0, 5));
  const trapMid = Math.ceil(traps.length / 2);
  const trapsBlock = (traps.length || trapsArr.length)
    ? panel('Traps to Avoid', '#f43f5e',
        proseList(trapsArr, '#fb7185') +
        (traps.length
          ? twoColHtml(
              pageStockTable(traps.slice(0, trapMid), { red: true }),
              pageStockTable(traps.slice(trapMid), { red: true }),
            )
          : ''))
    : '';

  const summaryHtml = (conviction.length || watchlistTrades.length || convictionArr.length || watchlistArr.length || trapsBlock)
    ? pageCard('Actionable Summary', '#22d3ee',
        twoColHtml(
          panel('Highest Conviction', '#818cf8', proseList(convictionArr, '#cbd5e1') + pageStockTable(conviction)),
          panel('Watchlist &mdash; Not Yet Actionable', '#d97706', proseList(watchlistArr, '#cbd5e1') + pageStockTable(watchlistTrades)),
        ) + trapsBlock)
    : '';

  const eventsHtml = keyEventsHtml(econ, earnings);

  /* Closing phase only — see tomorrowHtml. The other phases go out while the
     session is still running, where a "tomorrow" block would be noise. */
  const tomorrowSecHtml = phase === 'closing'
    ? tomorrowHtml(brief, econ, earnings, knownTickers)
    : '';

  const updatedTime = brief?.snapshotTime
    ? new Date(brief.snapshotTime).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    : '';

  return minify(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  /* Everything here is a fallback for narrow viewports only — the inline
     styles carry the design, because Outlook and parts of Gmail drop or
     partially apply <style>. Below 760px the side-by-side panels stack
     instead of being clipped, and the tables shed padding so ten columns
     still fit a phone. */
  table { max-width: 100%; }
  /* Repeated cell/chip styling, hoisted out of the markup to keep the message
     under Gmail's clip threshold — see minify(). Colour and alignment stay
     inline so they survive a client that strips this block. */
  .d { padding: 3px 2px; font-size: 10px; }
  .h { padding: 3px 2px; font-size: 8px; color: #475569; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; border-bottom: 1px solid #ffffff10; }
  .tk { display: inline-block; background: #1b2434; border: 1px solid #2a3446; border-radius: 4px; padding: 1px 6px; font-size: 9px; font-weight: 700; letter-spacing: .06em; color: #cbd5e1; }
  .tk.r { background: #4c0519; border-color: #7f1d3a; color: #fecdd3; }
  .p { display: inline-block; border-radius: 3px; padding: 1px 5px; font-size: 9px; font-weight: 700; }
  /* 860, not 760: two ten-column tables need ~330px each plus card padding,
     so anything under about 860 has to stack rather than squeeze. */
  @media only screen and (max-width: 860px) {
    .shell { padding: 12px 4px !important; }
    .col { display: block !important; width: 100% !important; padding: 0 0 8px 0 !important; }
    .card { padding: 10px 10px !important; }
    td, th { padding: 3px 2px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#05080f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div class="shell" style="max-width:900px;margin:0 auto;padding:16px 8px;background:#0b101a;">

    <div style="padding:12px 0 14px;border-bottom:1px solid #ffffff0d;margin-bottom:14px;">
      <table width="100%" style="border-collapse:collapse;"><tr>
        <td style="padding:0;vertical-align:middle;">
          <img src="https://ctt-dashboard.vercel.app/logo.svg" alt="CTT" style="height:28px;width:auto;vertical-align:middle;" />
          <span style="font-size:15px;font-weight:800;color:#f1f5f9;vertical-align:middle;margin-left:8px;">Confluence Trading Tools</span>
          <div style="font-size:9px;font-weight:600;color:#64748b;letter-spacing:0.22em;text-transform:uppercase;margin-top:4px;margin-left:36px;">Market Briefing</div>
        </td>
      </tr></table>
      <div style="font-size:10px;color:#64748b;margin-top:8px;">${phaseLabel} &middot; ${now} ET${updatedTime ? ` &middot; Updated ${updatedTime} ET` : ''}</div>
    </div>

    <div style="margin-bottom:14px;border-radius:12px;border:1px solid #ffffff10;padding:12px;overflow:hidden;">
      <div style="margin-bottom:10px;border-bottom:1px solid #ffffff0d;padding-bottom:8px;">
        <span style="display:inline-block;font-size:8px;font-weight:700;color:#7c8bfa;background:#161c2a66;border:1px solid #ffffff0d;padding:2px 8px;border-radius:4px;letter-spacing:0.14em;text-transform:uppercase;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#7c8bfa;margin-right:6px;vertical-align:middle;"></span>Macro Scorecard
        </span>
      </div>
      ${scorecardHtml}
    </div>

    ${macroHtml}
    ${newsHtml}
    ${regimeHtml}
    ${sectorsHtml}
    ${legendHtml()}
    <div style="border-top:1px solid #ffffff1a;margin:0 0 14px;"></div>
    ${moversHtml}
    ${sipHtml}
    ${summaryHtml}
    ${eventsHtml}
    ${tomorrowSecHtml}

    <div style="padding-top:14px;margin-top:18px;">
      <div style="font-size:10px;color:#475569;text-align:center;">
        Confluence Trading Tools &copy; ${new Date().getFullYear()} &bull; Not investment advice.
      </div>
    </div>
  </div>
</body>
</html>`);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const phase = (url.searchParams.get('phase') || 'morning') as Phase;
  if (!PHASES.includes(phase)) {
    return NextResponse.json({ error: `Invalid phase. Use: ${PHASES.join(', ')}` }, { status: 400 });
  }

  const force = url.searchParams.get('force') === '1';
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !force) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }

  const recipientEmail = process.env.BRIEFING_EMAIL || process.env.Email || 'thomasbeach@gmail.com';
  const origin = resolveOrigin(req);

  const [macro, chopData, t2108Data, brief, snapshotRes, chopSetting, econRes, earningsRes] = await Promise.all([
    fetchJson(`${origin}/api/macro`),
    fetchJson(`${origin}/api/chop`),
    fetchJson(`${origin}/api/t2108/latest`),
    fetchJson(`${origin}/api/analyst/brief`),
    fetchJson(`${origin}/api/claude/snapshot?full=1`),
    fetchJson(`${origin}/api/settings/chop`),
    /* Key Events reads these directly, the same two endpoints the page's
       KeyEventsSection uses — not the brief's prose summary of them. */
    fetchJson(`${origin}/api/econ`),
    fetchJson(`${origin}/api/earnings`),
  ]);
  const snapshot = snapshotRes?.data || {};
  const chopMode: ChopMode = chopSetting?.mode || DEFAULT_CHOP_MODE;
  const econ: any[] = Array.isArray(econRes) ? econRes : [];
  const earnings: any[] = Array.isArray(earningsRes) ? earningsRes : (earningsRes?.events ?? []);

  const html = buildEmail(phase, macro, chopData, t2108Data, brief, snapshot, chopMode, econ, earnings);
  const phaseLabel = PHASE_LABELS[phase];

  /* ?preview=1 renders the email in the browser instead of sending it. Email
     layout can only really be judged by looking at it, and the alternative is
     a test send per iteration. Read-only: it returns before any Resend call. */
  if (url.searchParams.get('preview') === '1') {
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const preview = url.searchParams.get('preview');
  if (preview === '1') {
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: 'CTT Briefing <onboarding@resend.dev>',
      to: recipientEmail,
      subject: `CTT ${phaseLabel} Briefing — ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}`,
      html,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, emailId: data?.id, phase, to: recipientEmail });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Send failed' }, { status: 500 });
  }
}
