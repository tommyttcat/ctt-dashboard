import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { kv } from '@vercel/kv';
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
  vixPctTone,
  breadthSignalTone,
  advCellTone,
  t2108CellTone,
  mkmCellTone,
  highsCellTone,
  marketMonitorOf,
  mmTodayTone,
  mmCellTone,
  mmRatioLabel,
  instDirSetup,
  instDirSignal,
  instDirCellTone,
} from '@/lib/indicators/marketScorecard';
import { dedupeByTicker, chgOf, dVolOf, advancingDollarShare } from '@/lib/indicators/marketMath';
import { postToBluesky } from '@/lib/bluesky';
import { postToX } from '@/lib/twitter';
import { stageHex as stageColor } from '@/lib/indicators/stage';
import { cnfHex, rvolHex, rsHex } from '@/lib/indicators/columnColors';
import { newsStarCount } from '@/lib/newsStars';
import { isEtfSector, displaySector } from '@/lib/sectors';
import { getEmailRecipients } from '@/lib/users';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PHASES = ['pre', 'morning', 'midday', 'power', 'closing'] as const;
type Phase = (typeof PHASES)[number];

const PHASE_LABELS: Record<Phase, string> = {
  pre: 'Pre-Market',
  morning: 'Morning',
  midday: 'Midday',
  power: 'Power Hour',
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
const fmtPrice = (p: number | null | undefined) => p == null || p === 0 ? '' : p >= 1000 ? p.toFixed(0) : p.toFixed(2);
const chgClr = (v: number) => v >= 0 ? '#34d399' : '#fb7185';
// Stage 1 = basing (neutral), 2 = uptrend (green), 3 = topping (amber), 4 = decline (red) —
// matches the brief's own "Stage 4B/4C = always bearish" rule, so a glance at STG tells the story.
const fmtVol = (v: number) => v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(0) + 'M' : v > 0 ? '$' + (v / 1e3).toFixed(0) + 'K' : '';
const fmtVolShort = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : '—';
const stripStage = (s: string) => String(s || '').replace(/Stage\s*/i, '').trim() || '';

function trimToSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const chunk = text.slice(0, max);
  const lastSentence = Math.max(chunk.lastIndexOf('. '), chunk.lastIndexOf('! '), chunk.lastIndexOf('? '), chunk.lastIndexOf('.\n'));
  if (lastSentence > max * 0.3) return chunk.slice(0, lastSentence + 1).trim();
  const lastEnd = Math.max(chunk.lastIndexOf('.'), chunk.lastIndexOf('!'), chunk.lastIndexOf('?'));
  if (lastEnd > max * 0.3) return chunk.slice(0, lastEnd + 1).trim();
  return chunk.slice(0, chunk.lastIndexOf(' ')).replace(/[,;:\s]+$/, '').trim();
}

const SOCIAL_INDEX_TICKERS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'VIX', 'TLT', 'GLD', 'USO']);

function extractBriefTickers(brief: any): Set<string> {
  const tickers = new Set<string>();
  for (const sec of (brief?.sections || [])) {
    for (const s of (sec.stocks || [])) {
      if (s.ticker) tickers.add(s.ticker.toUpperCase());
    }
  }
  const sm = brief?.summary || {};
  for (const arr of [sm.conviction, sm.watchlist, sm.traps, sm.tomorrow]) {
    if (!Array.isArray(arr)) continue;
    for (const line of arr) {
      const str = String(line || '');
      for (const m of str.matchAll(/\*\*([A-Z]{1,5})\*\*/g)) tickers.add(m[1]);
      const lead = str.match(/^([A-Z]{1,5})(?:[\s,:]|'s|$)/);
      if (lead) tickers.add(lead[1]);
    }
  }
  return tickers;
}

function socialCashtags(text: string, brief: any): string {
  const tickers = new Set([...extractBriefTickers(brief), ...SOCIAL_INDEX_TICKERS]);
  let result = text;
  for (const t of tickers) {
    result = result.replace(new RegExp(`(?<!\\$)\\b${t}\\b`, 'g'), `$${t}`);
  }
  return result;
}

const BADGE = 'display:inline-block;font-size:8px;font-weight:700;border-radius:3px;padding:1px 4px;line-height:14px;text-align:center;border:1px solid';
function rsPillHtml(rs: number | null | undefined): string {
  if (rs == null) return '<span style="color:#475569;">-</span>';
  const [bg, bc, tx] = rs >= 90 ? ['#3b0764','#6b21a8','#c084fc']
    : rs >= 80 ? ['#042f2e','#065f46','#34d399']
    : rs >= 70 ? ['#1e293b','#ffffff1a','#cbd5e1']
    : ['#4c0519','#9f1239','#fb7185'];
  return `<span style="${BADGE} ${bc};background:${bg};color:${tx};">${rs}</span>`;
}
function stagePillHtml(stage: string | null | undefined): string {
  const s = stripStage(String(stage || ''));
  if (!s || s === '—') return '<span style="color:#475569;">-</span>';
  const u = s.toUpperCase();
  const [bg, bc, tx] = u.startsWith('2')
    ? (u === '2C' ? ['#422006','#854d0e','#fbbf24'] : u === '2B' ? ['#042f2e','#065f46','#6ee7b7'] : ['#042f2e','#065f46','#34d399'])
    : u.startsWith('4')
    ? (u === '4C' ? ['#431407','#9a3412','#fb923c'] : ['#4c0519','#9f1239','#fb7185'])
    : u.startsWith('3') ? ['#422006','#854d0e','#fbbf24']
    : u.startsWith('1') ? ['#0c1a29','#0e4a6e','#38bdf8']
    : ['#0f172a','#ffffff0d','#475569'];
  return `<span style="${BADGE} ${bc};background:${bg};color:${tx};">${s}</span>`;
}

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
      <div style="border-radius:5px;border:1px solid ${col.border};background:${col.bg};padding:4px 3px;text-align:center;">
        <div style="font-size:6px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;margin-bottom:1px;white-space:nowrap;">${c.label}</div>
        <div style="font-size:9px;font-weight:700;color:${col.text};line-height:1.15;white-space:nowrap;">${c.value}</div>
        <div style="font-size:7px;color:#64748b;margin-top:1px;white-space:nowrap;">${c.sub || '&nbsp;'}</div>
      </div>
    </div>`;
  }).join('');
  return `<div style="font-size:0;margin-bottom:8px;">${items}</div>`;
}

/* The page's TICKER_CHIP / TICKER_CHIP_RED, in solid colours. The originals
   are slate-500/10 and rose-950 with translucent borders; mail clients
   (Outlook's Word engine in particular) drop rgba and 8-digit hex, so these
   are the same colours flattened onto the #0f172a card. */
const tickerChip = (t: string, grade?: string | null) =>
  `<span class="tk${grade === 'A' ? ' a' : grade === 'B' ? ' b' : ''}">${t}</span>`;
const tickerChipRed = (t: string) => `<span class="tk r">${t}</span>`;

/* The N column. The page links the stars to the article; so does this. */
function newsStarsHtml(row: any): string {
  const n = newsStarCount(row || {});
  if (!n) return '<span style="color:#334155;">&mdash;</span>';
  const stars = `<span style="font-size:7px;color:${n >= 2 ? '#fbbf24' : '#64748b'};">${'&#9733;'.repeat(n)}</span>`;
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
const INVERSE_TICKERS = new Set(['VIX', 'UVXY', 'SVXY']);

function colorPctsHtml(text: string): string {
  return text.replace(/([+-]?\d+(?:\.\d+)?)%/g, (whole, num, offset) => {
    const v = parseFloat(num);
    if (isNaN(v)) return whole;
    const signed = /^[+-]/.test(num);
    if (!signed) return `<span style="font-weight:700;color:#cbd5e1;">${whole}</span>`;
    const before = text.slice(Math.max(0, offset - 60), offset);
    const nearTicker = before.match(/\b([A-Z]{2,5})\b(?!.*\b[A-Z]{2,5}\b)/);
    const invert = nearTicker ? INVERSE_TICKERS.has(nearTicker[1]) : false;
    const clr = invert ? (v >= 0 ? '#fb7185' : '#34d399') : (v >= 0 ? '#34d399' : '#fb7185');
    return `<span style="font-weight:700;color:${clr};">${whole}</span>`;
  });
}

function richHtml(text: string, known: Set<string>): string {
  const stripped = String(text || '').replace(/\*\*/g, '');
  const colored = colorPctsHtml(stripped);
  return colored.replace(/(^|[\s(,])([A-Z]{1,5})(?='s|$|[\s),.:;])/g, (m, pre, tok) =>
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
      return `<div style="${sep}font-size:12px;color:${color};line-height:1.6;">${leadHtml}${glue}${richHtml(rest || (lead ? '' : s), known)}</div>`;
    }

    return `<div style="${sep}">
      <div style="font-size:12px;font-weight:700;color:#f1f5f9;line-height:1.5;">${richHtml(lead, known)}</div>
      <div style="font-size:8px;color:${color};line-height:1.5;padding-left:12px;margin-top:4px;">${richHtml(rest, known)}</div>
    </div>`;
  }).join('');
}

interface LabeledRow { label: string; value: string; detail: string }

function parseLabeled(text: string): LabeledRow[] {
  const rows: LabeledRow[] = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^\*{0,2}([A-Za-z0-9\s/&']+?)\*{0,2}:(?!\d)\s*(.+)/);
    if (!m || m[1].trim().length > 15) continue;
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
    const rawLines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    return rawLines.map((p, i) =>
      `<div style="border-left:2px solid #334155;padding-left:10px;${i > 0 ? 'margin-top:12px;' : ''}font-size:12px;color:#cbd5e1;line-height:1.7;">${richHtml(p, known)}</div>`
    ).join('');
  }
  return rows.map((r, i) =>
    `<div style="${i > 0 ? 'border-top:1px solid #ffffff0d;padding-top:10px;margin-top:10px;' : ''}">
      <div style="font-size:8px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">${r.label}</div>
      <div style="font-size:12px;color:#cbd5e1;line-height:1.7;">${richHtml(r.value, known)}</div>
      ${r.detail ? `<div style="font-size:8px;color:#94a3b8;line-height:1.6;margin-top:4px;">${richHtml(r.detail.charAt(0).toUpperCase() + r.detail.slice(1), known)}</div>` : ''}
    </div>`
  ).join('');
}

/* Card shell matching the page's SectionCard: full border, rounded corners,
   indigo pill title with dot — mirrors AnalystBrief.tsx SectionCard. */
function pageCard(title: string, accent: string, bodyHtml: string, _tint = '0a'): string {
  if (!bodyHtml) return '';
  return `<div style="margin-bottom:16px;border-left:3px solid ${accent};padding-left:12px;">
      <div style="margin-bottom:10px;">
        <span style="display:inline-block;font-size:8px;font-weight:700;color:${accent};background:#161c2a66;border:1px solid #ffffff0d;padding:2px 8px;border-radius:4px;letter-spacing:0.14em;text-transform:uppercase;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${accent};margin-right:6px;vertical-align:middle;"></span>${title}
        </span>
      </div>
      ${bodyHtml}
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
      <td width="26%" style="padding:3px 8px 3px 0;text-align:right;font-size:8px;color:${pos ? '#34d399' : '#cbd5e1'};">${s.name}</td>
      <td width="58%" style="padding:4px 0;"><table width="100%" style="border-collapse:collapse;"><tr>${bar}</tr></table></td>
      <td width="16%" style="padding:3px 0 3px 8px;text-align:right;font-size:8px;font-weight:700;color:${pos ? '#34d399' : '#fb7185'};">${fmtPct(s.pct)}</td>
    </tr>`;
  }).join('');

  return `<div style="padding:6px 8px;height:100%;box-sizing:border-box;border-left:3px solid #34d399;">
    <table width="100%" style="border-collapse:collapse;margin:0 0 6px;"><tr>
      <td style="text-align:right;font-size:8px;color:#475569;">Spread ${spread.toFixed(2)}%</td>
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
function buildSetupPool(snapshot: any): any[] {
  const sip = snapshot?.stocksInPlay || {};
  const seen = new Set<string>();
  const out: any[] = [];
  const add = (arr: any[]) => {
    for (const s of arr) {
      const t = s?.ticker ?? s?.symbol;
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push({ ...s, ticker: t });
    }
  };
  add(Array.isArray(sip.stocksInPlay) ? sip.stocksInPlay : []);
  add(Array.isArray(sip.dailySetups) ? sip.dailySetups : []);
  add(Array.isArray(snapshot?.ep9m?.candidates) ? snapshot.ep9m.candidates : []);
  add(Array.isArray(snapshot?.swingCandidates?.candidates) ? snapshot.swingCandidates.candidates : []);
  add(Array.isArray(snapshot?.vcp?.candidates) ? snapshot.vcp.candidates : []);
  add(Array.isArray(snapshot?.multibagger?.candidates) ? snapshot.multibagger.candidates : []);
  return out;
}

function sectorConcentrationHtml(pool: any[]): string {
  const sectorMap: Record<string, { count: number; totalChg: number }> = {};
  pool.forEach((s: any) => {
    const sec = s.sector && s.sector !== '—' && !isEtfSector(s.sector) ? displaySector(s.sector) : null;
    if (!sec || sec === '—' || sec.toLowerCase() === 'other') return;
    if (!sectorMap[sec]) sectorMap[sec] = { count: 0, totalChg: 0 };
    sectorMap[sec].count += 1;
    sectorMap[sec].totalChg += Number(s.changePct ?? s.chg ?? 0);
  });
  const sectors = Object.entries(sectorMap)
    .map(([sector, d]) => ({ sector, count: d.count, avgChg: d.totalChg / d.count }))
    .sort((a, b) => b.count - a.count);
  if (!sectors.length) return '';
  const maxCount = sectors[0].count;
  const rows = sectors.slice(0, 10).map((h) => {
    const pos = h.avgChg >= 0;
    const barW = Math.max(4, Math.round((h.count / maxCount) * 100));
    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:8px;">
      <span style="color:#cbd5e1;font-weight:500;width:60px;flex-shrink:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${h.sector}</span>
      <div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.05);overflow:hidden;">
        <div style="width:${barW}%;height:100%;border-radius:3px;background:${pos ? 'rgba(52,211,153,0.5)' : 'rgba(251,113,133,0.5)'};"></div>
      </div>
      <span style="color:#94a3b8;font-weight:700;width:16px;text-align:right;flex-shrink:0;">${h.count}</span>
      <span style="font-weight:600;width:42px;text-align:right;flex-shrink:0;color:${pos ? '#34d399' : '#fb7185'};">${pos ? '+' : ''}${h.avgChg.toFixed(1)}%</span>
    </div>`;
  }).join('');
  return `<div style="padding:6px 12px;height:100%;box-sizing:border-box;border-left:3px solid #fbbf24;">
    <div style="font-size:9px;font-weight:700;color:#fbbf24;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px;">Sector Concentration</div>
    <div style="font-size:8px;color:#64748b;margin-bottom:6px;">Where scanner setups are clustering by sector.</div>
    ${rows}
  </div>`;
}

function sectorsCardHtml(sectorText: string, snapshot: any): string {
  const movers = snapshot?.stocksInPlay?.topMovers || {};

  const etfAll = dedupeByTicker([...(movers['ETF Gainers'] || []), ...(movers['ETF Losers'] || [])]);
  const etfRows = etfAll
    .filter((e: any) => dVolOf(e) > 0)
    .sort((a: any, b: any) => Math.abs(chgOf(b)) - Math.abs(chgOf(a)))
    .slice(0, 5);

  const flowAll = dedupeByTicker([
    ...(movers['Gainers'] || []), ...(movers['Losers'] || []), ...(movers['Mega Caps'] || []),
  ]);
  const flowRows = flowAll
    .filter((s: any) => dVolOf(s) > 0)
    .sort((a: any, b: any) => Math.abs(chgOf(b)) - Math.abs(chgOf(a)))
    .slice(0, 5);

  const etfShare = advancingDollarShare(etfAll);
  const mfShare = advancingDollarShare(flowAll);
  const totalDVol = flowAll.reduce((a: number, s: any) => a + dVolOf(s), 0);

  const setupPool = buildSetupPool(snapshot);
  const bars = sectorText ? sectorBarsHtml(sectorText) : '';
  const concHtml = sectorConcentrationHtml(setupPool);

  const topRow = (bars || concHtml) ? twoColHtml(bars, concHtml) : '';
  const tables = twoColHtml(
    flowTableHtml('ETF Flow', '#818cf8',
      `${etfShare}% of ETF dollars on the advancing side${etfShare >= 60 ? ' — chasing strength.' : etfShare <= 40 ? ' — favoring defense.' : ' — no clean bet.'}`,
      etfRows),
    flowTableHtml('Money Flow', '#fb7185',
      `${fmtVol(totalDVol)} tracked, ${mfShare}% advancing${mfShare >= 60 ? ' — buyers paying up.' : mfShare <= 40 ? ' — sellers control.' : ' — two-sided fight.'}`,
      flowRows),
  );

  if (!topRow && !tables) return '';
  return pageCard('Sectors &amp; Money Flow', '#22d3ee', topRow + tables);
}

function sortByChg<T extends any>(stocks: T[]): T[] {
  const chg = (s: any) => Math.abs(Number(s?.changePct ?? s?.chg ?? 0));
  const rs = (s: any) => Number(s?.rs ?? s?.rsRating ?? 0);
  return [...stocks].sort((a, b) => (chg(b) - chg(a)) || (rs(b) - rs(a)));
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
    const stage = stripStage(String(s.stage || ''));
    const rsRaw = s.rs ?? s.rsRating ?? null;
    const rs = (typeof rsRaw === 'number' && Number.isFinite(rsRaw)) ? rsRaw : (Number.isFinite(Number(rsRaw)) ? Number(rsRaw) : null);
    return `<tr>
      <td class="d" style="padding-left:0;white-space:nowrap;">${opts.red ? tickerChipRed(s.ticker) : tickerChip(s.ticker, grade)}</td>
      <td class="d" style="text-align:center;">${cnfPill(s.score, grade)}</td>
      <td class="d" style="text-align:right;font-weight:700;color:${chgClr(chg)};white-space:nowrap;">${fmtPct(chg)}</td>
      <td class="d" style="text-align:right;color:#cbd5e1;">${fmtPrice(s.price)}</td>
      <td class="d" style="text-align:right;color:${rvolHex(rv)};font-weight:700;">${rv != null ? (rv < 1 ? rv.toFixed(1) : Math.round(rv)) + 'x' : ''}</td>
      <td class="d" style="text-align:right;color:#94a3b8;">${s.vol || s.volume ? fmtVolShort(s.vol || s.volume) : ''}</td>
      <td class="d" style="text-align:right;color:#cbd5e1;">${dv ? fmtVol(dv) : ''}</td>
      <td class="d" style="text-align:center;">${rsPillHtml(rs)}</td>
      <td class="d" style="text-align:center;">${stagePillHtml(stage)}</td>
      <td class="d" style="text-align:center;">${newsStarsHtml(s)}</td>
    </tr>`;
  }).join('');
  return `<table width="100%" style="border-collapse:collapse;">
    <tr>
      <th class="h" style="text-align:left;">Ticker</th>
      <th class="h" style="text-align:center;">CNF</th>
      <th class="h" style="text-align:right;">Chg%</th>
      <th class="h" style="text-align:right;">PRC</th>
      <th class="h" style="text-align:right;">RVol</th>
      <th class="h" style="text-align:right;">Vol</th>
      <th class="h" style="text-align:right;">$Vol</th>
      <th class="h" style="text-align:right;">RS</th>
      <th class="h" style="text-align:center;">Stg</th>
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
    const grade = r.cnfGrade;
    const rs = r.rsRating || 0;
    const stage = stripStage(String(r.stage || ''));
    const rvol = r.rvol || 0;
    const dot = r.dotKind === 'red' ? '<span style="color:#f43f5e;">&#9679;</span>'
      : r.dotKind === 'blue' ? '<span style="color:#3b82f6;">&#9679;</span>' : '';
    return `<tr>
      <td class="d" style="padding-left:0;white-space:nowrap;">
        ${tickerChip(r.ticker, grade)} ${dot}
      </td>
      <td class="d" style="text-align:center;">${cnfPill(cnf, grade)}</td>
      <td class="d" style="text-align:right;font-weight:700;color:${chgClr(chg)};white-space:nowrap;">${fmtPct(chg)}</td>
      <td class="d" style="text-align:right;color:#cbd5e1;">${fmtPrice(r.price)}</td>
      <td class="d" style="text-align:right;color:${rvol >= 2 ? '#34d399' : rvol >= 1 ? '#cbd5e1' : '#64748b'};font-weight:${rvol >= 2 ? '700' : '400'};">${rvol < 1 ? rvol.toFixed(1) : Math.round(rvol)}x</td>
      <td class="d" style="text-align:right;color:#94a3b8;">${fmtVolShort(r.vol || 0)}</td>
      <td class="d" style="text-align:right;color:#94a3b8;">${fmtVol(dVolOf(r))}</td>
      <td class="d" style="text-align:center;">${rsPillHtml(rs || null)}</td>
      <td class="d" style="text-align:center;">${stagePillHtml(stage)}</td>
      <td class="d" style="text-align:center;">${newsStarsHtml(r)}</td>
    </tr>`;
  }).join('');

  const borderClr = color === '#818cf8' ? '#6366f1' : '#f43f5e';
  return `<div style="padding:6px 0;">
    <div style="font-size:8px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${borderClr};margin-bottom:3px;">${title}</div>
    <div style="font-size:8px;color:#94a3b8;line-height:1.5;margin-bottom:4px;">${blurb}</div>
    <table width="100%" style="border-collapse:collapse;">
      <tr>
        <th class="h" style="padding-left:0;text-align:left;">Ticker</th>
        <th class="h" style="text-align:center;">CNF</th>
        <th class="h" style="text-align:right;">Chg%</th>
        <th class="h" style="text-align:right;">PRC</th>
        <th class="h" style="text-align:right;">RVol</th>
        <th class="h" style="text-align:right;">Vol</th>
        <th class="h" style="text-align:right;">$Vol</th>
        <th class="h" style="text-align:right;">RS</th>
        <th class="h" style="text-align:center;">Stg</th>
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
  return `<table width="100%" style="border-collapse:separate;border-spacing:0;margin-bottom:10px;height:1px;"><tr>
    <td class="col" width="50%" style="padding-right:4px;vertical-align:top;height:100%;">${left}</td>
    <td class="col" width="50%" style="padding-left:4px;vertical-align:top;height:100%;">${right}</td>
  </tr></table>`;
}

function panel(title: string, color: string, bodyHtml: string): string {
  if (!bodyHtml) return '';
  return `<div style="overflow:hidden;height:100%;padding:6px 0;">
      <div style="font-size:8px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${color};margin-bottom:4px;">${title}</div>
      ${bodyHtml}
  </div>`;
}

function legendHtml(): string {
  const dot = (c: string) => `<span style="display:inline-block;width:4px;height:4px;border-radius:50%;background:${c};vertical-align:middle;margin-right:2px;"></span>`;
  return `<div style="margin-bottom:10px;font-size:7px;color:#64748b;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;line-height:2.2;">
    <span style="color:#34d399;">A</span> <span style="color:#fbbf24;">B</span> <span style="color:#64748b;">Grade</span>
    &nbsp;&nbsp;
    <span style="display:inline-block;border:1px solid #ffffff14;background:#ffffff05;border-radius:3px;padding:1px 5px;color:#94a3b8;font-size:7px;">10/21 ${dot('#34d399')}Stacked ${dot('#fbbf24')}Pre-Cross ${dot('#fb7185')}Ext / Below</span>
    &nbsp;&nbsp;
    <span style="display:inline-block;font-size:7px;font-weight:700;padding:1px 5px;border-radius:3px;background:#4c051918;color:#fecdd3;border:1px solid #fb718530;">Trap</span>
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
    <div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Economic${aheadCount ? ` — ${aheadCount} still ahead` : ''}</div>
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
    return `<div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">${label}${pending ? ` — ${pending} pending` : ''}</div>
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
    `<div style="font-size:8px;color:#64748b;line-height:1.5;margin-bottom:12px;">Today&rsquo;s releases and large-cap prints. &#9656; marks what has not happened yet.</div>${econHtml}${earnHtml}`
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
    ? `<div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Economic Releases</div>
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
    ? `<div style="font-size:7px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Large-Cap Prints</div>
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
    `<div style="font-size:8px;color:#64748b;line-height:1.5;margin-bottom:12px;">The setups and scheduled events that carry into the next session. Levels are the analyst&rsquo;s; each directional call states what invalidates it.</div>` +
    noteBlocksHtml(tomorrowArr, knownTickers) +
    (watchArr.length ? subLabel('Carried Watchlist') + noteBlocksHtml(watchArr, knownTickers) : '') +
    calendar
  );
}

/* Session Updates — the "tape readings" at the bottom of the brief page.
   Each block carries a phase label, timestamp, narrative paragraphs, and a
   highlighted takeaway. Direction is derived from index-move percentages in
   the text, same as the page's deriveDirection. */
const SESSION_THEME: Record<string, { dot: string; label: string; boxBg: string; boxBorder: string; boxText: string }> = {
  emerald: { dot: '#34d399', label: '#34d399', boxBg: '#042f2e', boxBorder: '#34d399', boxText: '#d1fae5' },
  rose:    { dot: '#fb7185', label: '#fb7185', boxBg: '#4c0519', boxBorder: '#fb7185', boxText: '#ffe4e6' },
  cyan:    { dot: '#22d3ee', label: '#22d3ee', boxBg: '#083344', boxBorder: '#22d3ee', boxText: '#cffafe' },
  amber:   { dot: '#fbbf24', label: '#fbbf24', boxBg: '#422006', boxBorder: '#fbbf24', boxText: '#fef3c7' },
  indigo:  { dot: '#818cf8', label: '#818cf8', boxBg: '#1e1b4b', boxBorder: '#818cf8', boxText: '#e0e7ff' },
};
function deriveDir(paragraphs: string[]): 'up' | 'down' | null {
  const text = paragraphs.join(' ');
  const rx = /\b(?:S&P|Nasdaq|Dow|Russell|SPX|NDX)\b[^.]{0,40}?([+-]\d+(?:\.\d+)?)%/gi;
  const moves: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) { const v = parseFloat(m[1]); if (!isNaN(v)) moves.push(v); }
  if (!moves.length) return null;
  const avg = moves.reduce((a, b) => a + b, 0) / moves.length;
  return Math.abs(avg) < 0.25 ? null : avg > 0 ? 'up' : 'down';
}
function sessionUpdatesHtml(brief: any, known: Set<string>, latestOnly?: boolean): string {
  const su = brief?.sessionUpdates;
  if (!su) return '';
  const blocks: { key: string; block: any }[] = [];
  for (const key of ['pre', 'morning', 'midday', 'power', 'closing']) {
    if (su[key]) blocks.push({ key, block: su[key] });
  }
  if (!blocks.length) return '';
  const toRender = latestOnly ? [blocks[blocks.length - 1]] : blocks;
  const rendered = toRender.map(({ block }) => {
    const dir = deriveDir(block.paragraphs || []);
    const themeKey = dir === 'up' ? 'emerald' : dir === 'down' ? 'rose' : (block.colorTheme || 'indigo');
    const st = SESSION_THEME[themeKey] || SESSION_THEME.indigo;
    const paras = (block.paragraphs || []).map((p: string) =>
      `<div style="font-size:12px;color:#94a3b8;line-height:1.6;margin-bottom:6px;">${richHtml(p, known)}</div>`
    ).join('');
    return `<div style="padding:6px 0;margin-top:8px;">
      <div style="margin-bottom:10px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${st.dot};vertical-align:middle;margin-right:8px;"></span>
        <span style="font-size:8px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${st.label};vertical-align:middle;">${block.phase || ''}</span>
        <span style="font-size:8px;color:#64748b;font-weight:500;letter-spacing:0.08em;padding:2px 8px;border:1px solid #ffffff0d;border-radius:3px;margin-left:8px;vertical-align:middle;">${block.timestamp || ''}</span>
      </div>
      ${paras}
      <div style="border-left:4px solid ${st.boxBorder};padding:10px 12px;">
        <div style="font-size:12px;line-height:1.6;color:${st.boxText};">${richHtml(block.takeaway || '', known)}</div>
      </div>
    </div>`;
  }).join('');
  return pageCard('Session Updates', '#818cf8', rendered);
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
      color: mmTodayTone(mm.up4, mm.down4),
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
      color: vixPctTone(Number(vixQ.pct ?? 0)),
    });
  }
  {
    const spyQ = quotes['SPY'];
    const qqqQ = quotes['QQQ'];
    if (spyQ?.price && qqqQ?.price && vixQ?.price) {
      const setup = instDirSetup(
        spyQ.price, spyQ.prevLow ?? null, spyQ.pct ?? 0,
        qqqQ.price, qqqQ.prevLow ?? null,
        vixQ.price, vixQ.prevHigh ?? null, vixQ.pct ?? 0,
      );
      const signal = instDirSignal(setup);
      scCells.push({
        label: 'INST DIR',
        value: signal,
        sub: setup,
        color: instDirCellTone(signal),
      });
    }
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

  const scannerLookup: Record<string, any> = {};
  for (const s of flowPool) if (s?.ticker) scannerLookup[s.ticker] = s;

  const sections = (brief?.sections || []).map((sec: any) => ({
    ...sec,
    stocks: (sec.stocks || []).map((s: any) => {
      const sc = scannerLookup[s.ticker];
      if (!sc) return s;
      const rsVal = s.rs != null && typeof s.rs === 'number' ? s.rs : null;
      return { ...s, rs: rsVal ?? sc.rsRating ?? sc.rs ?? null, stage: s.stage || sc.stage || undefined };
    }),
  }));
  const summary = brief?.summary || {};
  const topTrades = sections.find((s: any) => s.section === 'Top Trades')?.stocks || [];
  const topAvoid = sections.find((s: any) => s.section === 'Top Avoid')?.stocks || [];

  const proseTickers: string[] = [];
  for (const arr of [summary.conviction, summary.watchlist, summary.traps, summary.tomorrow]) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      const bold = String(s || '').match(/\*\*([A-Z]{2,5})\*\*/);
      if (bold) proseTickers.push(bold[1]);
      const lead = String(s || '').match(/^([A-Z]{2,5})(?:\s|'s)/);
      if (lead) proseTickers.push(lead[1]);
    }
  }

  const allSectionStocks = sections.flatMap((s: any) => (s.stocks || []).map((st: any) => st.ticker));
  const knownTickers = new Set<string>([
    ...allSectionStocks,
    ...flowPool.map((s: any) => s.ticker),
    ...Object.keys(quotes),
    ...proseTickers,
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
    ? pageCard('Key News &amp; Catalysts', '#22d3ee', '<div style="color:#f59e0b;font-size:8px;">Analyst brief unavailable when this email was built — news and sector sections are missing, not empty.</div>')
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
  const ups = sortByChg(
    gapStocks.filter((s) => s.direction === 'up' || s.direction === 'long' || (!['down','short'].includes(s.direction) && (s.gapPct ?? s.changePct ?? 0) > 0))
  ).slice(0, 5);
  const downs = sortByChg(
    gapStocks.filter((s) => s.direction === 'down' || s.direction === 'short' || (!['up','long'].includes(s.direction) && (s.gapPct ?? s.changePct ?? 0) < 0))
  ).slice(0, 5);
  const moversAnalysis = gapSec?.analysis
    ? `<div style="margin-top:12px;">${formattedBlockHtml(gapSec.analysis, knownTickers)}</div>`
    : '';
  const moversHtml = (ups.length || downs.length || gapSec?.analysis)
    ? pageCard('Top Movers', '#22d3ee', twoColHtml(
        ups.length ? panel('Movers Up', '#34d399', pageStockTable(ups)) : '',
        downs.length ? panel('Movers Down', '#fb7185', pageStockTable(downs, { red: true })) : '',
      ) + moversAnalysis)
    : '';

  /* ---- Stocks in Play — stock table first, analysis brief below ---------- */
  const sipSec = sections.find((s: any) => s.section === 'Stocks in Play Today');
  const sipStocks: any[] = sortByChg(sipSec?.stocks || []).slice(0, 10);
  const sipMid = Math.ceil(sipStocks.length / 2);
  const sipHtml = (sipStocks.length || sipSec?.analysis)
    ? pageCard('Stocks in Play Today', '#22d3ee',
        (sipStocks.length
          ? twoColHtml(pageStockTable(sipStocks.slice(0, sipMid)), pageStockTable(sipStocks.slice(sipMid)))
          : '') +
        (sipSec?.analysis
          ? `<div style="margin-top:10px;">${formattedBlockHtml(sipSec.analysis, knownTickers)}</div>`
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
  const conviction = sortByChg(topTrades.slice(0, 2));
  const watchlistTrades = sortByChg(topTrades.slice(2, 7));

  const proseList = (arr: string[], color: string) =>
    arr.length
      ? `<div style="margin-bottom:12px;">${noteBlocksHtml(arr, knownTickers, color)}</div>`
      : '';

  const trapsArr: string[] = Array.isArray(summary.traps) ? summary.traps : [];
  const traps = sortByChg(topAvoid.slice(0, 5));
  const trapMid = Math.ceil(traps.length / 2);
  const trapsBlock = (traps.length || trapsArr.length)
    ? panel('Traps to Avoid', '#f43f5e',
        (traps.length
          ? twoColHtml(
              pageStockTable(traps.slice(0, trapMid), { red: true }),
              pageStockTable(traps.slice(trapMid), { red: true }),
            )
          : '') +
        proseList(trapsArr, '#cbd5e1'))
    : '';

  const summaryHtml = (conviction.length || watchlistTrades.length || convictionArr.length || watchlistArr.length || trapsBlock)
    ? pageCard('Actionable Summary', '#22d3ee',
        twoColHtml(
          panel('Highest Conviction', '#818cf8', pageStockTable(conviction) + proseList(convictionArr, '#cbd5e1')),
          panel('Watchlist &mdash; Not Yet Actionable', '#d97706', pageStockTable(watchlistTrades) + proseList(watchlistArr, '#cbd5e1')),
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
  .d { padding: 2px 2px; font-size: 8px; }
  .h { padding: 2px 2px; font-size: 8px; color: #475569; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; border-bottom: 1px solid #ffffff10; }
  .tk { display: inline-block; background: #1b2434; border: 1px solid #2a3446; border-radius: 3px; padding: 1px 4px; font-size: 8px; font-weight: 700; letter-spacing: .06em; color: #cbd5e1; }
  .tk.a { background: #042f2e; border-color: #115e59; color: #6ee7b7; }
  .tk.b { background: #422006; border-color: #854d0e; color: #fde68a; }
  .tk.r { background: #4c0519; border-color: #7f1d3a; color: #fecdd3; }
  .p { display: inline-block; border-radius: 3px; padding: 1px 4px; font-size: 8px; font-weight: 700; }
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
<body style="margin:0;padding:0;background:#020408;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020408;"><tr><td align="center" style="padding:0;">
  <!--[if mso]><table width="900" cellpadding="0" cellspacing="0" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" align="center" style="max-width:900px;width:100%;background:#05080f;border-left:1px solid #0f1729;border-right:1px solid #0f1729;"><tr><td style="padding:0;text-align:left;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="height:3px;background:#6366f1;"></td>
    </tr></table>
    <div style="padding:20px 20px;">

    <div style="padding:10px 0 12px;border-bottom:1px solid #ffffff0d;margin-bottom:14px;">
      <table width="100%" style="border-collapse:collapse;"><tr>
        <td style="padding:0;vertical-align:middle;">
          <a href="https://confluencetradingtools.com" style="text-decoration:none;">
            <img src="https://ctt-dashboard.vercel.app/logo.svg" alt="CTT" style="height:24px;width:auto;vertical-align:middle;" />
            <span style="font-size:11px;font-weight:800;color:#f1f5f9;vertical-align:middle;margin-left:8px;">Confluence Trading Tools</span>
          </a>
          <div style="font-size:8px;font-weight:600;color:#64748b;letter-spacing:0.22em;text-transform:uppercase;margin-top:3px;margin-left:32px;">Market Briefing</div>
        </td>
      </tr></table>
      <div style="font-size:8px;color:#64748b;margin-top:6px;">${phaseLabel} &middot; ${now} ET${updatedTime ? ` &middot; Updated ${updatedTime} ET` : ''}</div>
    </div>

    <div style="margin-bottom:16px;border-left:3px solid #818cf8;padding-left:12px;">
      <div style="margin-bottom:10px;">
        <span style="display:inline-block;font-size:8px;font-weight:700;color:#818cf8;background:#161c2a66;border:1px solid #ffffff0d;padding:2px 8px;border-radius:4px;letter-spacing:0.14em;text-transform:uppercase;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#818cf8;margin-right:6px;vertical-align:middle;"></span>Macro Scorecard
        </span>
      </div>
      ${scorecardHtml}
    </div>

    ${macroHtml}
    ${newsHtml}
    ${regimeHtml}
    ${sectorsHtml}
    ${moversHtml}
    ${sipHtml}
    ${eventsHtml}
    ${sessionUpdatesHtml(brief, knownTickers, true)}

    <div style="padding:20px 0;margin-top:18px;border-top:1px solid #0f1729;text-align:center;">
      <a href="https://app.confluencetradingtools.com/pricing" style="display:inline-block;font-size:11px;font-weight:700;color:#fbbf24;background:#fbbf2415;border:1px solid #fbbf2430;padding:8px 20px;border-radius:8px;text-decoration:none;letter-spacing:0.02em;">
        Upgrade Your Plan
      </a>
      <div style="font-size:9px;color:#475569;margin-top:8px;">
        Unlock scanners, the live dashboard, and the full confluence report.
      </div>
    </div>

    <div style="padding-top:10px;">
      <div style="font-size:8px;color:#475569;text-align:center;">
        <a href="https://confluencetradingtools.com" style="color:#818cf8;text-decoration:none;">confluencetradingtools.com</a>
      </div>
      <div style="font-size:8px;color:#475569;text-align:center;margin-top:4px;">
        Confluence Trading Tools LLC &copy; ${new Date().getFullYear()} &bull; Not investment advice.
      </div>
    </div>
    </div>
  </td></tr></table>
  <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
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

  const origin = resolveOrigin(req);

  /* Guards run cheapest-first, and that ordering is load-bearing. The seven
     upstream fetches further down move ~305 KB per invocation, and
     /api/claude/snapshot alone is 222 KB that fans out to 14 more sources.
     These crons are scheduled to retry — the NX lock below makes a send
     idempotent, so firing repeatedly is how the email survives not knowing
     when the analyst actually posts — but that is only affordable while an
     invocation that will skip returns before reaching the expensive part. */
  const todayET = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const sentKey = `briefing_sent:${phase}:${todayET.replace(/\//g, '-')}`;
  if (!force) {
    const alreadySent = await kv.get(sentKey);
    if (alreadySent) {
      return NextResponse.json({ skipped: true, phase, reason: `${phase} email already sent today` });
    }
  }

  /* Freshness gate — one cheap fetch, and the only one a skipping retry pays
     for. The previous check asked whether a tape block merely *existed*,
     which stays true from the prior session forever: on Monday it passed on
     Friday's blocks. `pre` was exempted from it outright and so sent
     unconditionally, which is how a pre-market email shipped the previous
     session's brief. Compare the brief's own date instead, and apply it to
     every phase — the cron fires on a wall clock that cannot know when the
     analyst run lands, so the brief's date is the only honest signal. */
  const brief = await fetchJson(`${origin}/api/analyst/brief`);
  if (!force) {
    const briefDateET = brief?.generatedAt
      ? new Date(brief.generatedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      : null;
    if (briefDateET !== todayET) {
      return NextResponse.json({
        skipped: true,
        phase,
        reason: 'brief is not from today — waiting for the analyst run',
        briefDateET,
        todayET,
      });
    }
    /* The phase's own block, not any block. sessionUpdates accumulates across
       the day, so `pre` still being there at 2 PM says nothing about whether
       the power reading has been written yet. */
    if (!brief?.sessionUpdates?.[phase]) {
      return NextResponse.json({ skipped: true, phase, reason: `no ${phase} tape reading yet` });
    }
  }

  const testTo = url.searchParams.get('to');
  let recipients: string[];
  if (testTo && force) {
    recipients = [testTo];
  } else {
    const userRecipients = await getEmailRecipients('briefing', phase as any);
    const fallback = process.env.BRIEFING_EMAIL || process.env.Email || 'thomasbeach@gmail.com';
    recipients = userRecipients.length > 0 ? userRecipients : [fallback];
  }

  const [macro, chopData, t2108Data, snapshotRes, chopSetting, econRes, earningsRes] = await Promise.all([
    fetchJson(`${origin}/api/macro`),
    fetchJson(`${origin}/api/chop`),
    fetchJson(`${origin}/api/t2108/latest`),
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

  if (url.searchParams.get('testSocial') === '1') {
    const su = brief?.sessionUpdates || {};
    const block = ['closing', 'power', 'midday', 'morning', 'pre'].reduce((latest: any, k) => latest || su[k], null);
    const takeaway = block?.takeaway || '';
    const regime = brief?.regimeDetail?.regime || '';
    const rawBlurb = (takeaway || regime).replace(/\*\*([^*]+)\*\*/g, '$1').trim();
    const blurb = rawBlurb ? socialCashtags(rawBlurb, brief) : '';
    const dashUrl = 'confluencetradingtools.com';
    const regimeStr = brief?.regimeDetail?.regime || '';
    const regimeLine = regimeStr ? `\nRegime: ${regimeStr}` : '';
    const phaseTag = `${PHASE_LABELS[phase]}: `;
    const debug: any = {
      hasBskyEnv: !!(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD),
      hasXEnv: !!(process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET),
      hasBlurb: !!blurb,
      blurbLen: blurb.length,
      blurbPreview: blurb.slice(0, 80),
      phase,
    };

    let screenshotBuf: Buffer | null = null;
    try {
      const tapePageUrl = `${origin}/api/og/tape?phase=${phase}`;
      const ssUrl = `${origin}/api/og/screenshot?force=1&url=${encodeURIComponent(tapePageUrl)}&w=800&h=1200&selector=${encodeURIComponent('#tape-card')}&minText=80`;
      const ssRes = await fetch(ssUrl);
      if (ssRes.ok && ssRes.headers.get('content-type')?.includes('image')) {
        screenshotBuf = Buffer.from(await ssRes.arrayBuffer());
        debug.screenshotBytes = screenshotBuf.length;
      } else {
        const errBody = await ssRes.text().catch(() => '');
        debug.screenshotError = `status ${ssRes.status}: ${errBody.slice(0, 200)}`;
      }
    } catch (ssErr: any) {
      debug.screenshotError = ssErr?.message || String(ssErr);
    }

    if (blurb) {
      const imagePayload = screenshotBuf
        ? { data: screenshotBuf, alt: `CTT ${PHASE_LABELS[phase]} Tape Reading`, mimeType: 'image/png' }
        : undefined;

      const bskyCta = `Full tape + scanners → ${dashUrl}`;
      const bskyAvail = 300 - phaseTag.length - regimeLine.length - 2 - bskyCta.length;
      const bskyBlurb = trimToSentence(blurb, bskyAvail);
      const bskyText = `${phaseTag}${bskyBlurb}${regimeLine}\n\n${bskyCta}`;
      const linkStart = bskyText.indexOf(dashUrl);

      const xCta = `Full tape + scanners → https://${dashUrl}`;
      const xAvail = 280 - phaseTag.length - regimeLine.length - 2 - xCta.length;
      const xBlurb = trimToSentence(blurb, xAvail);
      const xText = `${phaseTag}${xBlurb}${regimeLine}\n\n${xCta}`;

      debug.bskyText = bskyText;
      debug.xText = xText;

      try {
        const bsky = await postToBluesky(bskyText, [{ start: linkStart, end: linkStart + dashUrl.length, url: `https://${dashUrl}` }], imagePayload);
        debug.bskyResult = bsky ?? 'returned null (env vars missing?)';
      } catch (e: any) { debug.bskyError = e.message; }

      try {
        const x = await postToX(xText, screenshotBuf ? { data: screenshotBuf } : undefined);
        debug.xResult = x ?? 'returned null (env vars missing?)';
      } catch (e: any) { debug.xError = e.message; }
    }
    return NextResponse.json(debug);
  }

  const resend = new Resend(apiKey);
  const subject = `CTT ${phaseLabel} Briefing — ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}`;

  // Atomic lock: NX ensures only one invocation wins when two race
  if (!force) {
    const locked = await kv.set(sentKey, 1, { nx: true, ex: 86400 });
    if (!locked) {
      return NextResponse.json({ skipped: true, phase, reason: `${phase} email already sent today` });
    }
  } else {
    await kv.set(sentKey, 1, { ex: 86400 });
  }

  try {
    const results = await Promise.allSettled(
      recipients.map((to) =>
        resend.emails.send({
          from: 'CTT <noreply@confluencetradingtools.com>',
          to,
          subject,
          html,
        }),
      ),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    try {
      await fetch(`${origin}/api/email/substack?publish=1&phase=${phase}`, {
        headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
      });
    } catch { /* Substack publish is best-effort */ }

    let bskyResult: any = null;
    let xResult: any = null;
    let socialDebug: any = {};
    try {
      const su = brief?.sessionUpdates || {};
      const block = ['closing', 'power', 'midday', 'morning', 'pre'].reduce((latest: any, k) => latest || su[k], null);
      const takeaway = block?.takeaway || '';
      const regime = brief?.regimeDetail?.regime || '';

      const rawBlurb = (takeaway || regime).replace(/\*\*([^*]+)\*\*/g, '$1').trim();
      const blurb = rawBlurb ? socialCashtags(rawBlurb, brief) : '';
      socialDebug.hasBlurb = !!blurb;
      socialDebug.blurbLen = blurb.length;
      socialDebug.hasBskyEnv = !!(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD);
      socialDebug.hasXEnv = !!(process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET);

      if (blurb) {
        const dashUrl = 'confluencetradingtools.com';
        const regimeStr = brief?.regimeDetail?.regime || '';
        const regimeLine = regimeStr ? `\nRegime: ${regimeStr}` : '';
        const phaseTag = `${PHASE_LABELS[phase]}: `;

        let screenshotBuf: Buffer | null = null;
        try {
          const tapePageUrl = `${origin}/api/og/tape?phase=${phase}`;
          const ssUrl = `${origin}/api/og/screenshot?force=1&url=${encodeURIComponent(tapePageUrl)}&w=800&h=1200&selector=${encodeURIComponent('#tape-card')}&minText=80`;
          const ssRes = await fetch(ssUrl);
          if (ssRes.ok && ssRes.headers.get('content-type')?.includes('image')) {
            screenshotBuf = Buffer.from(await ssRes.arrayBuffer());
            socialDebug.screenshotBytes = screenshotBuf.length;
          } else {
            socialDebug.screenshotError = `status ${ssRes.status}`;
          }
        } catch (ssErr: any) {
          socialDebug.screenshotError = ssErr?.message || String(ssErr);
        }

        const imagePayload = screenshotBuf
          ? { data: screenshotBuf, alt: `CTT ${PHASE_LABELS[phase]} Tape Reading`, mimeType: 'image/png' }
          : undefined;

        const bskyCta = `Full tape + scanners → ${dashUrl}`;
        const bskyAvail = 300 - phaseTag.length - regimeLine.length - 2 - bskyCta.length;
        const bskyBlurb = trimToSentence(blurb, bskyAvail);
        const bskyText = `${phaseTag}${bskyBlurb}${regimeLine}\n\n${bskyCta}`;
        const linkStart = bskyText.indexOf(dashUrl);

        const xCta = `Full tape + scanners → https://${dashUrl}`;
        const xAvail = 280 - phaseTag.length - regimeLine.length - 2 - xCta.length;
        const xBlurb = trimToSentence(blurb, xAvail);
        const xText = `${phaseTag}${xBlurb}${regimeLine}\n\n${xCta}`;

        const results = await Promise.allSettled([
          postToBluesky(bskyText, [{
            start: linkStart,
            end: linkStart + dashUrl.length,
            url: `https://${dashUrl}`,
          }], imagePayload),
          postToX(xText, screenshotBuf ? { data: screenshotBuf } : undefined),
        ]);

        socialDebug.bskyStatus = results[0].status;
        socialDebug.xStatus = results[1].status;
        if (results[0].status === 'rejected') socialDebug.bskyError = String((results[0] as PromiseRejectedResult).reason);
        if (results[1].status === 'rejected') socialDebug.xError = String((results[1] as PromiseRejectedResult).reason);

        bskyResult = results[0].status === 'fulfilled' ? results[0].value : null;
        xResult = results[1].status === 'fulfilled' ? results[1].value : null;

        console.log('[social]', JSON.stringify(socialDebug));
      } else {
        console.log('[social] no blurb — skipping posts', JSON.stringify(socialDebug));
      }
    } catch (socialErr: any) {
      console.error('[social] outer error:', socialErr?.message || socialErr);
    }

    // "Called it" archive + receipt post (closing phase only)
    let calledItResult: string | null = null;
    if (phase === 'closing') {
      try {
        const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
        const todayKey = etFmt.format(new Date());
        const yd = new Date(); yd.setDate(yd.getDate() - 1);
        const yesterdayKey = etFmt.format(yd);

        const topSetups = (brief?.sections || [])
          .flatMap((sec: any) => (sec.stocks || []))
          .filter((s: any) => s.ticker && s.trigger)
          .slice(0, 10)
          .map((s: any) => ({
            ticker: s.ticker,
            trigger: s.trigger,
            target: s.target,
            price: s.price,
          }));
        if (topSetups.length) {
          await kv.set(`social_calls:${todayKey}`, topSetups, { ex: 259200 });
        }

        const yesterdayCalls = await kv.get<any[]>(`social_calls:${yesterdayKey}`);
        if (yesterdayCalls?.length) {
          const [sipData, dsData] = await kv.mget<[any[], any[]]>('stocks_in_play_v6', 'daily_setups_v6');
          const priceMap: Record<string, number> = {};
          for (const pool of [sipData || [], dsData || []]) {
            for (const s of (pool || [])) {
              const t = s?.ticker || s?.symbol;
              if (t && s?.price) priceMap[t] = s.price;
            }
          }

          const comparisons: { ticker: string; trigger: number; current: number; gainPct: number; date: string }[] = [];
          let best: { ticker: string; trigger: number; current: number; gain: number } | null = null;
          for (const call of yesterdayCalls) {
            const cur = priceMap[call.ticker];
            if (!cur || !call.trigger) continue;
            const gain = ((cur - call.trigger) / call.trigger) * 100;
            comparisons.push({ ticker: call.ticker, trigger: call.trigger, current: cur, gainPct: gain, date: yesterdayKey });
            if (gain > (best?.gain ?? 1)) {
              best = { ticker: call.ticker, trigger: call.trigger, current: cur, gain };
            }
          }

          // Accumulate weekly stats
          if (comparisons.length) {
            const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
            const weekKey = `social_weekly_stats:${etFmt.format(mon)}`;
            const existing = await kv.get<any[]>(weekKey) || [];
            await kv.set(weekKey, [...existing, ...comparisons], { ex: 1209600 });
          }

          if (best) {
            const cdUrl = 'confluencetradingtools.com';
            const calledBsky = `Yesterday CTT flagged $${best.ticker} at ${best.trigger.toFixed(2)}\n\nToday: ${best.current.toFixed(2)} (+${best.gain.toFixed(1)}%)\n\nDaily setups → ${cdUrl}`;
            const calledX = `Yesterday CTT flagged $${best.ticker} at ${best.trigger.toFixed(2)}\n\nToday: ${best.current.toFixed(2)} (+${best.gain.toFixed(1)}%)\n\nDaily setups → https://${cdUrl}`;

            const cdLinkPos = calledBsky.indexOf(cdUrl);
            await Promise.allSettled([
              postToBluesky(calledBsky, [{ start: cdLinkPos, end: cdLinkPos + cdUrl.length, url: `https://${cdUrl}` }]),
              postToX(calledX),
            ]);
            calledItResult = `${best.ticker} +${best.gain.toFixed(1)}%`;
            console.log('[social] called-it post:', calledItResult);
          }
        }
      } catch (calledErr: any) {
        console.error('[social] called-it error:', calledErr?.message || calledErr);
      }

      // Archive the full brief for the public /briefs page (one write/day)
      try {
        const etFmt2 = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
        const archiveDate = etFmt2.format(new Date());
        const archiveKey = `brief_archive:${archiveDate}`;
        const indexKey = 'brief_archive_index';
        const existing = await kv.get<any>(archiveKey);
        if (!existing && brief) {
          await kv.set(archiveKey, brief);
          const idx = await kv.get<string[]>(indexKey) || [];
          if (!idx.includes(archiveDate)) {
            await kv.set(indexKey, [...idx, archiveDate]);
          }
          console.log('[archive] brief archived for', archiveDate);
        }
      } catch (archiveErr: any) {
        console.error('[archive] error:', archiveErr?.message || archiveErr);
      }
    }

    return NextResponse.json({
      success: true, phase, sent, failed, recipients: recipients.length,
      bluesky: bskyResult ? 'posted' : 'skipped',
      x: xResult ? 'posted' : 'skipped',
      calledIt: calledItResult,
      socialDebug,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Send failed' }, { status: 500 });
  }
}
