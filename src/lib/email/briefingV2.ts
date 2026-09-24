/* lib/email/briefingV2.ts — the light, card-based phase email (24 Sep 2026).
 *
 * Built from the simplified brief: one vocabulary (buy / stop / HIT / MISS /
 * EXT / OUT / "x% away") shared with the dashboard's Buy & stop box. Every
 * section reads a brief field directly and is skipped when that field is
 * empty, so an older brief still renders — just with fewer cards.
 *
 * Shared palette, cards, pills and the shell live in ./emailKit (also used by
 * the weekly wrap, ./weeklyV2).
 *
 * Email-safe on purpose: table layout, inline styles, 600px, no web fonts.
 * The <style> block only adds the narrow-screen fallbacks.
 */

import { C, esc, rich, plain, label, card, statusOf, statusPill, pickCard, outlookRows, emailShell, type Pick } from './emailKit';

type Any = any;

/* ---- summary line parser ---------------------------------------------------
   "**CVX** (Chevron) — buy above 208.10 · stop 202.90 · 0.9% away — why." */
const LINE_RX = /^\s*\*\*([A-Z][A-Z0-9.\-]{0,6})\*\*\s*(?:\(([^)]*)\))?\s*[—-]\s*buy (above|dip)\s+([\d.,]+)\s*·\s*stop\s+([\d.,]+)\s*·\s*([^—]+?)\s*(?:—\s*(.*))?$/i;

function parsePickLine(line: string): Pick | null {
  const m = String(line || '').match(LINE_RX);
  if (!m) return null;
  return {
    ticker: m[1], name: m[2]?.trim() || undefined, dip: m[3].toLowerCase() === 'dip',
    buy: m[4], stop: m[5], status: statusOf(m[6]), why: plain(m[7] || ''),
  };
}

function pickFromTopTrade(s: Any): Pick | null {
  if (!s?.ticker) return null;
  const thesis = String(s.thesis || '');
  const name = thesis.split('.')[0]?.trim();
  // The "why" is the sentence after the status sentence, before "Target".
  const sentences = thesis.split(/(?<=\.)\s+/).filter(Boolean);
  const why = sentences.find((x, i) => i >= 2 && !/^Target\b/i.test(x)) || '';
  const lvl = (v: unknown) => (v == null || v === '' ? undefined : Number(v).toFixed(2));
  return {
    // Old-format theses open with "Last 206.20, ..." — that is not a name.
    ticker: String(s.ticker), name: name && name.length < 40 && !/^Last\s/.test(name) ? name : undefined,
    dip: /buy dip/i.test(thesis), buy: lvl(s.trigger), stop: lvl(s.stop ?? s.invalidation),
    status: statusOf(thesis), why: plain(why),
  };
}

function watchRow(p: Pick): string {
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid ${C.rule};font-size:14px;color:${C.body};">
      <b style="color:${C.ink};">${esc(p.ticker)}</b>${p.name ? ` <span style="color:${C.muted};">${esc(p.name)}</span>` : ''}<br>
      <span style="font-size:13px;color:${C.muted};">${p.dip ? 'dip to' : 'above'} <b style="color:${C.ink};">${esc(p.buy)}</b> · stop <b style="color:${C.red};">${esc(p.stop)}</b></span>
    </td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid ${C.rule};">${statusPill(p.status)}</td>
  </tr>`;
}

/* ---- sections ---------------------------------------------------------- */
const sectionOf = (brief: Any, name: string) =>
  (Array.isArray(brief?.sections) ? brief.sections : []).find((s: Any) => String(s?.section || '').toLowerCase() === name.toLowerCase());

const sectionStartingWith = (brief: Any, prefix: string) =>
  (Array.isArray(brief?.sections) ? brief.sections : []).find((s: Any) => String(s?.section || '').toLowerCase().startsWith(prefix.toLowerCase()));

/** Bullet lines ("• ...") of an analysis, or its paragraphs when it has none. */
function bullets(text: unknown): string[] {
  const t = String(text || '');
  const lines = t.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const b = lines.filter(x => /^[•\-–]\s*/.test(x)).map(x => x.replace(/^[•\-–]\s*/, ''));
  return b.length ? b : lines;
}

function listCard(title: string, color: string, items: string[]): string {
  if (!items.length) return '';
  const rows = items.map((x, i) => `<tr><td style="padding:7px 0;${i < items.length - 1 ? `border-bottom:1px solid ${C.rule};` : ''}font-size:14px;line-height:1.5;color:${C.body};">${rich(x)}</td></tr>`).join('');
  return card(`${label(title, color)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">${rows}</table>`);
}

function sectorChips(analysis: string): { lead: string; lag: string; narrative: string } {
  const t = String(analysis || '');
  const lead = (t.match(/\*\*Leading:\*\*\s*([^\n]*)/) || [])[1] || '';
  const lag = (t.match(/\*\*Lagging:\*\*\s*([^\n]*)/) || [])[1] || '';
  const narrative = t.replace(/\*\*Leading:\*\*[^\n]*\n*/, '').replace(/\*\*Lagging:\*\*[^\n]*\n*/, '').trim();
  const chips = (list: string, fg: string, bg: string) => list.split(/,\s*/).filter(Boolean).slice(0, 4)
    .map(x => `<span style="display:inline-block;font-size:12px;font-weight:700;color:${fg};background:${bg};border-radius:999px;padding:4px 10px;margin:0 6px 6px 0;">${esc(x.trim())}</span>`).join('');
  return { lead: chips(lead, C.green, C.greenBg), lag: chips(lag.split(/,\s*/).reverse().join(', '), C.red, C.redBg), narrative };
}

/* ---- the email --------------------------------------------------------- */
export interface EmailV2Input {
  phaseLabel: string;
  dateLabel: string;
  updatedTime?: string | null;
  macro: Any;
  brief: Any;
  phaseKey: string;
}

export function buildEmailV2({ phaseLabel, dateLabel, updatedTime, macro, brief, phaseKey }: EmailV2Input): string {
  const rd = brief?.regimeDetail || {};
  const regime = plain(rd.regime);
  const firstStop = regime.search(/[.—]\s/);
  const verdict = firstStop > 0 ? regime.slice(0, firstStop + 1).replace(/—$/, '').trim() : regime;
  const driverRaw = firstStop > 0 ? regime.slice(firstStop + 1).trim() : '';
  const driver = driverRaw ? driverRaw.charAt(0).toUpperCase() + driverRaw.slice(1) : '';
  const tone = /risk-off|selling|broad selling|bear/i.test(regime) ? C.red : /risk-on|rally|bull/i.test(regime) ? C.green : C.amber;

  /* stat tiles */
  const b = macro?.breadth || {};
  const pctUp = typeof b.pctAdv === 'number' ? b.pctAdv
    : b.advancers != null && b.decliners != null && b.advancers + b.decliners > 0 ? (100 * b.advancers) / (b.advancers + b.decliners) : null;
  const hi = Number(b.newHighs), lo = Number(b.newLows);
  const hiLo = hi > 0 && lo > 0 ? (lo >= hi ? `${Math.round(lo / hi)} : 1 lows` : `${Math.round(hi / lo)} : 1 highs`) : null;
  const vix = macro?.quotes?.VIX?.price;
  const tiles = [
    pctUp != null ? ['Stocks up today', `${Math.round(pctUp)}%`, pctUp >= 50 ? C.green : C.red] : null,
    hiLo ? ['New lows vs highs', hiLo, lo >= hi ? C.red : C.green] : null,
    vix ? ['Fear (VIX)', Number(vix).toFixed(1), C.ink] : null,
  ].filter(Boolean) as [string, string, string][];
  const tileHtml = tiles.length ? `<tr><td class="pad" style="padding:16px 28px 24px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${
    tiles.map(([l, v, c], i) => `<td width="${Math.floor(100 / tiles.length)}%" style="padding:${i === 0 ? '0 6px 0 0' : i === tiles.length - 1 ? '0 0 0 6px' : '0 3px'};"><div style="background:${C.tile};border:1px solid ${C.border};border-radius:12px;padding:12px;"><div style="font-size:11px;color:${C.muted};">${esc(l)}</div><div style="font-size:20px;font-weight:800;color:${c};">${esc(v)}</div></div></td>`).join('')
  }</tr></table></td></tr>` : '';

  const hero = regime ? `
  <tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,.06);overflow:hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="height:4px;background:${tone};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td class="pad" style="padding:26px 28px 8px 28px;">
        ${label('The market', tone)}
        <div class="h1" style="font-size:28px;line-height:1.2;font-weight:800;color:${C.ink};margin-top:8px;">${esc(verdict)}</div>
        ${driver ? `<div style="font-size:16px;line-height:1.55;color:${C.body};margin-top:10px;">${esc(driver)}</div>` : ''}
      </td></tr>
      ${tileHtml}
    </table>
  </td></tr>
  <tr><td style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>` : '';

  /* since last update + takeaway */
  const block = brief?.sessionUpdates?.[phaseKey];
  const delta = Array.isArray(block?.paragraphs) ? block.paragraphs[0] : '';
  const scoreLine = Array.isArray(block?.paragraphs) ? block.paragraphs.find((p: string) => /^Today's picks:/i.test(plain(p))) : '';
  const since = delta || block?.takeaway ? card(`
    ${label('Since the last update', C.violet)}
    ${delta ? `<div style="font-size:15px;line-height:1.55;color:${C.body};margin-top:10px;">${rich(delta)}</div>` : ''}
    ${scoreLine ? `<div style="font-size:15px;line-height:1.55;color:${C.body};margin-top:10px;">${rich(scoreLine)}</div>` : ''}
    ${block?.takeaway ? `<div style="font-size:15px;line-height:1.55;color:${C.ink};font-weight:600;margin-top:10px;">${rich(block.takeaway)}</div>` : ''}`) : '';

  /* what's next */
  const nextSentences = String(rd.posture || '').split(/(?<=[.;])\s+(?=[A-Z*])/).map(s => s.trim()).filter(Boolean);
  const next = nextSentences.length ? card(`
    ${label("What's likely next", C.teal)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
      ${outlookRows(nextSentences)}
    </table>
    ${rd.caution ? `<div style="font-size:13px;line-height:1.5;color:${C.muted};background:${C.tile};border-radius:10px;padding:10px 12px;margin-top:6px;"><b style="color:${C.red};">Risk:</b> ${rich(rd.caution)}</div>` : ''}`) : '';

  /* picks */
  const topTrades = sectionOf(brief, 'Top Trades');
  const summary = brief?.summary || {};
  let picks: Pick[] = (Array.isArray(topTrades?.stocks) ? topTrades.stocks : []).map(pickFromTopTrade).filter(Boolean) as Pick[];
  if (!picks.length) picks = (summary.conviction || []).map(parsePickLine).filter(Boolean) as Pick[];
  const pickTickers = new Set(picks.map(p => p.ticker));
  const watch = [...(summary.conviction || []), ...(summary.watchlist || [])]
    .map(parsePickLine).filter((p): p is Pick => !!p && !pickTickers.has(p.ticker)).slice(0, 4);
  const picksHtml = picks.length ? card(`
    ${label('Top picks', C.green)}
    ${picks.slice(0, 3).map((p, i, a) => pickCard(p, i === a.length - 1)).join('')}
    ${watch.length ? `<div style="margin-top:6px;">${label('Also watching', C.muted)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">${watch.map(watchRow).join('')}</table>` : ''}`) : '';

  /* avoid */
  const traps = (summary.traps || []).slice(0, 4).map((line: string) => {
    const m = String(line).match(/^\s*\*\*([A-Z][A-Z0-9.\-]{0,6})\*\*\s*(?:\([^)]*\))?\s*[—-]?\s*(.*)$/);
    const ticker = m?.[1] || '';
    const rest = plain(m?.[2] ?? line);
    const st = statusOf(rest);
    const text = rest.replace(/^(OUT|EXT|MISS)\s*[:—-]?\s*/i, '');
    return `<tr><td style="padding:7px 0;font-size:14px;line-height:1.5;color:${C.body};">${ticker ? `<b style="display:inline-block;min-width:48px;color:${C.ink};">${esc(ticker)}</b> ` : ''}${st && st.kind !== 'wait' ? statusPill(st) + ' ' : ''}${esc(text)}</td></tr>`;
  }).join('');
  const avoid = traps ? card(`${label('Avoid', C.red)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${traps}</table>`) : '';

  /* news, money, calendar, earnings, tomorrow */
  const news = listCard('News that matters', C.violet, bullets(sectionOf(brief, 'Key News & Catalysts')?.analysis).slice(0, 6));

  const sec = sectorChips(sectionOf(brief, 'Top Sectors & Money Flow')?.analysis || '');
  const money = sec.lead || sec.lag || sec.narrative ? card(`
    ${label('Where the money went', C.teal)}
    ${sec.narrative ? `<div style="font-size:15px;line-height:1.55;color:${C.body};margin-top:10px;">${rich(sec.narrative)}</div>` : ''}
    ${sec.lead ? `<div style="margin-top:12px;">${sec.lead}</div>` : ''}
    ${sec.lag ? `<div style="margin-top:4px;">${sec.lag}</div>` : ''}`) : '';

  const cal = listCard('Economic calendar', C.amber, bullets(sectionOf(brief, 'Economic Calendar')?.analysis).filter(x => !/^\*\*[^*]+\*\*$/.test(x)).slice(0, 5));
  const earn = listCard('Earnings', C.amber, bullets(sectionOf(brief, 'Earnings')?.analysis).slice(0, 3));

  const tomorrowItems = (summary.tomorrow || []).slice(0, 5).map((line: string) => {
    const parts = plain(line).split(/\s+—\s+/);
    return parts.length >= 2
      ? `<tr><td width="92" valign="top" style="padding:7px 8px 7px 0;font-size:13px;font-weight:700;color:${C.amber};">${esc(parts[0])}</td><td style="padding:7px 0;font-size:14px;line-height:1.5;color:${C.body};">${esc(parts.slice(1).join(' — '))}</td></tr>`
      : `<tr><td colspan="2" style="padding:7px 0;font-size:14px;line-height:1.5;color:${C.body};">${esc(parts[0])}</td></tr>`;
  }).join('');
  const tomorrow = tomorrowItems ? card(`${label('Tomorrow', C.amber)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${tomorrowItems}</table>`) : '';

  const movers = sectionStartingWith(brief, 'Intraday Movers') || sectionStartingWith(brief, 'Pre-Market Gappers') || sectionStartingWith(brief, 'Post-Market Gappers');
  const moversHtml = movers?.analysis ? card(`${label(String(movers.section), C.muted)}<div style="font-size:15px;line-height:1.55;color:${C.body};margin-top:10px;">${rich(movers.analysis)}</div>`) : '';

  return emailShell({
    title: `CTT ${phaseLabel}`,
    pill: `${phaseLabel} · ${dateLabel}`,
    updatedTime,
    sections: [hero, since, next, picksHtml, avoid, news, money, moversHtml, cal, earn, tomorrow],
    footerNote: "Levels are each scan's own plan.",
  });
}
