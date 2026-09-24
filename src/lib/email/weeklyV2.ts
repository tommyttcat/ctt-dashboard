/* lib/email/weeklyV2.ts — the light, card-based weekly wrap email (24 Sep 2026).
 *
 * Same look as the phase email (lib/email/briefingV2), built from the weekly
 * narrative the cloud routine POSTs:
 *   { coverImageUrl?, priceAction, macro, catalysts[{title, body}],
 *     watchStocks[{ticker, title: "<STATUS> · <name> · buy above X · stop Y", body}],
 *     avoidStocks[{ticker, reason}], weekAhead }
 *
 * Every card reads one field and is skipped when that field is empty. Older
 * narratives (the deterministic fallback, or pre-v2 routine output with
 * ARMED / TRIGGERED statuses) still render — parts that do not parse fall
 * back to plain text rather than disappearing or throwing.
 */

import { C, esc, plain, label, card, statusOf, statusPill, pickCard, outlookRows, emailShell, type Pick, type Status } from './emailKit';

type Any = any;

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v: unknown): Any[] => (Array.isArray(v) ? v : []);

/** Paragraphs of a plain-text field (blank-line or single-newline separated). */
const paragraphs = (t: unknown) => str(t).split(/\n+/).map(x => x.trim()).filter(Boolean);

/* Sentence boundaries: after . ! ? ; followed by a capital, digit, $ or quote —
   except after an abbreviation ("U.S.", "vs.", "Inc."), which is not an end. */
const ABBREV_RX = /(?:\b[A-Z]\.[A-Z]\.|\b(?:vs|Mr|Mrs|Ms|Dr|Inc|Corp|Co|Ltd|St|approx|est|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.)$/;

export function splitSentences(text: string): string[] {
  const t = str(text).trim();
  if (!t) return [];
  const out: string[] = [];
  let start = 0;
  const rx = /[.!?;]\s+(?=[A-Z0-9$"“*])/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(t))) {
    const end = m.index + 1;
    if (ABBREV_RX.test(t.slice(start, end))) continue;
    out.push(t.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  out.push(t.slice(start).trim());
  return out.filter(Boolean);
}

/** Colour signed percentages (+4.1% / -2.3% / −2.3%) green or red. Input is escaped HTML. */
export function pctColor(html: string): string {
  return html.replace(/(^|[\s(>])([+\-−–]\d+(?:\.\d+)?%)/g, (_, pre: string, pct: string) =>
    `${pre}<span style="font-weight:700;color:${pct.startsWith('+') ? C.green : C.red};">${pct}</span>`);
}

/** "Sep 21 – 25", or "Sep 28 – Oct 2" across a month boundary. */
export function weekRangeLabel(mondayStr: string, fridayStr: string): string {
  const mon = new Date(`${mondayStr}T12:00:00`);
  const fri = new Date(`${fridayStr}T12:00:00`);
  if (isNaN(mon.getTime()) || isNaN(fri.getTime())) return '';
  const mo = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });
  return mo(mon) === mo(fri)
    ? `${mo(mon)} ${mon.getDate()} – ${fri.getDate()}`
    : `${mo(mon)} ${mon.getDate()} – ${mo(fri)} ${fri.getDate()}`;
}

const spacer = `<tr><td style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
const rowsTable = (rows: string, top = 8) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:${top}px;">${rows}</table>`;
const ruleIf = (i: number, n: number) => (i < n - 1 ? `border-bottom:1px solid ${C.rule};` : '');

/* ---- price action: the week + last week's picks ------------------------- */
const PICKS_RX = /Last week[’']?s picks:\s*/i;

function splitPriceAction(priceAction: unknown): { story: string[]; picks: string } {
  const story: string[] = [];
  let picks = '';
  for (const p of paragraphs(priceAction)) {
    const m = p.match(PICKS_RX);
    if (m && m.index != null && !picks) {
      const before = p.slice(0, m.index).trim();
      if (before) story.push(before);
      picks = p.slice(m.index + m[0].length).trim();
    } else story.push(p);
  }
  return { story, picks };
}

/** Lead sentence + the rest, like the phase email's verdict + driver. */
function splitLead(p: string): [string, string] {
  const s = splitSentences(p);
  return [s[0] || '', s.slice(1).join(' ')];
}

function picksRows(text: string): string {
  /* One row per named ticker: items end at ";", at a sentence end, or at a
     comma (or ", and") that is followed by the next ticker. */
  const items = text.split(/;\s+|\.\s+(?=[A-Z$])|,\s+(?:and\s+)?(?=\$?[A-Z]{2,5}\b)/)
    .map(x => x.trim().replace(/[.;,]$/, '')).filter(Boolean);
  return items.map((item, i) => {
    // A single capital is a ticker only with a "$" ("$F"), never the article "A".
    const m = item.match(/^(?:\$([A-Z]{1,5}(?:\.[A-Z])?)|([A-Z]{2,5}(?:\.[A-Z])?))\b\s*[:—-]?\s*(.*)$/);
    const ticker = m ? m[1] || m[2] : '';
    const rest = m ? m[3] : item;
    const st = statusOf(item);
    return `<tr>
      <td style="padding:7px 0;${ruleIf(i, items.length)}font-size:14px;line-height:1.5;color:${C.body};">${ticker ? `<b style="display:inline-block;min-width:48px;color:${C.ink};">${esc(ticker)}</b> ` : ''}${pctColor(esc(rest))}</td>
      <td align="right" valign="top" style="padding:7px 0 7px 8px;${ruleIf(i, items.length)}">${statusPill(st)}</td>
    </tr>`;
  }).join('');
}

/* ---- watch stocks -------------------------------------------------------- */
/** Parse "<STATUS> · <Short name> · buy above <level> · stop <level>" into a pick card. */
export function pickFromWatch(ws: Any): Pick | null {
  const ticker = plain(ws?.ticker).toUpperCase();
  if (!ticker) return null;
  const parts = plain(ws?.title).split(/\s*·\s*/).map(x => x.trim()).filter(Boolean);
  let status: Status | null = null;
  let buy: string | undefined;
  let stop: string | undefined;
  let dip = false;
  const rest: string[] = [];
  parts.forEach((part, i) => {
    let m = part.match(/^buy\s+(above|on\s+a\s+dip\s+to|dip(?:\s+to)?)\s+\$?([\d.,]+)/i);
    if (m) { buy = m[2]; dip = !/above/i.test(m[1]); return; }
    m = part.match(/^stop\s+\$?([\d.,]+)/i);
    if (m) { stop = m[1]; return; }
    if (i === 0 && !status) {
      const st = part.length <= 16 ? statusOf(part) : null;
      if (st) { status = st; return; }
      // Older vocabulary (ARMED, TRIGGERED, WAIT …): show it as-is, neutral.
      if (/^[A-Z][A-Z \-]{1,15}$/.test(part)) { status = { kind: 'wait', text: part }; return; }
    }
    rest.push(part);
  });
  // A lone level has nowhere to go in the two-number row — keep it as text.
  if (buy && !stop) rest.push(`${dip ? 'buy dip to' : 'buy above'} ${buy}`);
  if (stop && !buy) rest.push(`stop ${stop}`);
  const name = rest.length && rest[0].length <= 40 ? rest.shift() : undefined;

  const body = plain(ws?.body);
  const note = rest.length ? `<span style="color:${C.muted};">${esc(rest.join(' · '))}</span>` : '';
  const bodyHtml = body
    ? pctColor(esc(body)).replace(/\b(Target\s+\$?[\d.,]*\d)/, `<b style="color:${C.ink};">$1</b>`)
    : '';
  const whyHtml = [note, bodyHtml].filter(Boolean).join('<br>');
  return {
    ticker, name, dip,
    buy: buy && stop ? buy : undefined, stop: buy && stop ? stop : undefined,
    status, why: body, whyHtml,
  };
}

/* ---- the email ----------------------------------------------------------- */
export interface WeeklyV2Input {
  narrative: Any;
  /** { SPY: { pct }, QQQ: …, DIA: …, IWM: … } — the week's open-to-close change. */
  weeklyChanges?: Record<string, { pct?: number } | undefined> | null;
  mondayStr: string;
  fridayStr: string;
}

const INDEX_TILES: [string, string][] = [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq 100'], ['DIA', 'Dow'], ['IWM', 'Russell 2000']];

export function buildWeeklyEmailV2({ narrative, weeklyChanges, mondayStr, fridayStr }: WeeklyV2Input): string {
  const n = narrative && typeof narrative === 'object' ? narrative : {};
  const range = weekRangeLabel(mondayStr, fridayStr);

  /* cover */
  const coverUrl = str(n.coverImageUrl).trim();
  const cover = /^https?:\/\//i.test(coverUrl)
    ? `<tr><td style="padding:0;"><img src="${esc(coverUrl)}" width="600" alt="CTT Weekly Wrap" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:18px;"></td></tr>
  ${spacer}`
    : '';

  /* the week (hero) */
  const { story, picks } = splitPriceAction(n.priceAction || n.weekRecap);
  const [lead, leadRest] = splitLead(story[0] || '');
  const more = story.slice(1);
  const spy = weeklyChanges?.SPY?.pct;
  const tone = typeof spy === 'number'
    ? (spy >= 0.5 ? C.green : spy <= -0.5 ? C.red : C.amber)
    : /risk-off|selling|sold off|bear/i.test(lead) ? C.red : /risk-on|rally|rallied|bull|record/i.test(lead) ? C.green : C.amber;
  const leadSize = lead.length <= 90 ? 26 : lead.length <= 160 ? 21 : 18;

  const tiles = INDEX_TILES
    .map(([t, l]) => [l, weeklyChanges?.[t]?.pct] as const)
    .filter((x): x is readonly [string, number] => typeof x[1] === 'number' && isFinite(x[1]));
  const tileHtml = tiles.length ? `<tr><td class="pad" style="padding:16px 28px 24px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${
    tiles.map(([l, v], i) => `<td width="${Math.floor(100 / tiles.length)}%" style="padding:${i === 0 ? '0 6px 0 0' : i === tiles.length - 1 ? '0 0 0 6px' : '0 3px'};"><div style="padding:4px 0;"><div style="font-size:12px;color:${C.muted};">${esc(l)}</div><div style="font-size:18px;font-weight:800;color:${v >= 0 ? C.green : C.red};">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</div></div></td>`).join('')
  }</tr></table></td></tr>` : '';

  const hero = lead ? `
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td class="pad" style="padding:22px 24px ${tileHtml ? 4 : 20}px 24px;">
        ${label('The week', tone)}
        <div class="h1" style="font-size:${leadSize}px;line-height:1.25;font-weight:800;color:${C.ink};margin-top:8px;">${pctColor(esc(lead))}</div>
        ${leadRest ? `<div style="font-size:16px;line-height:1.55;color:${C.body};margin-top:10px;">${pctColor(esc(leadRest))}</div>` : ''}
        ${more.map(p => `<div style="font-size:15px;line-height:1.55;color:${C.body};margin-top:10px;">${pctColor(esc(p))}</div>`).join('')}
      </td></tr>
      ${tileHtml}
    </table>
  </td></tr>
  ${spacer}` : '';

  /* last week's picks */
  const picksHtml = picks ? card(`${label("Last week's picks", C.violet)}${rowsTable(picksRows(picks))}`) : '';

  /* the macro driver */
  const macroParas = paragraphs(n.macro);
  const macro = macroParas.length ? card(`
    ${label('The macro driver', C.teal)}
    ${macroParas.map(p => `<div style="font-size:15px;line-height:1.55;color:${C.body};margin-top:10px;">${pctColor(esc(p))}</div>`).join('')}`) : '';

  /* what moved */
  const cats = arr(n.catalysts).filter(c => plain(c?.title) || plain(c?.body)).slice(0, 5);
  const moved = cats.length ? card(`${label('What moved', C.amber)}${rowsTable(cats.map((c, i) => `<tr><td style="padding:9px 0;${ruleIf(i, cats.length)}font-size:14px;line-height:1.5;color:${C.body};">
      ${plain(c?.title) ? `<div style="font-weight:700;color:${C.ink};">${pctColor(esc(plain(c.title)))}</div>` : ''}
      ${plain(c?.body) ? `<div style="margin-top:3px;">${pctColor(esc(plain(c.body)))}</div>` : ''}
    </td></tr>`).join(''), 6)}`) : '';

  /* to watch */
  const watch = arr(n.watchStocks).map(pickFromWatch).filter((p): p is Pick => !!p).slice(0, 5);
  const count = ['One', 'Two', 'Three', 'Four', 'Five'][watch.length - 1] || 'Three';
  const watchHtml = watch.length ? card(`
    ${label(`${count} to watch`, C.green)}
    ${watch.map((p, i, a) => pickCard(p, i === a.length - 1)).join('')}`) : '';

  /* avoid */
  const avoidList = arr(n.avoidStocks).filter(a => plain(a?.ticker) || plain(a?.reason)).slice(0, 5);
  const avoid = avoidList.length ? card(`${label('Avoid', C.red)}${rowsTable(avoidList.map((a, i) => {
    const ticker = plain(a?.ticker).toUpperCase();
    return `<tr><td style="padding:7px 0;${ruleIf(i, avoidList.length)}font-size:14px;line-height:1.5;color:${C.body};">${ticker ? `<b style="display:inline-block;min-width:48px;color:${C.ink};">${esc(ticker)}</b> ` : ''}${pctColor(esc(plain(a?.reason)))}</td></tr>`;
  }).join(''))}`) : '';

  /* what's likely next week */
  const nextSentences = paragraphs(n.weekAhead).flatMap(splitSentences);
  const next = nextSentences.length ? card(`
    ${label("What's likely next week", C.teal)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
      ${outlookRows(nextSentences)}
    </table>`) : '';

  return emailShell({
    title: 'CTT Weekly Wrap',
    pill: range ? `Weekly wrap · ${range}` : 'Weekly wrap',
    sections: [cover, hero, picksHtml, macro, moved, watchHtml, avoid, next],
  });
}
