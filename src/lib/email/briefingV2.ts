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
  const why = sentences.filter((x, i) => i >= 2 && !/^Target\b/i.test(x)).join(' ');
  const target = sentences.find(x => /^Target\b/i.test(x)) || '';
  const risk = plain(s.risk || '');
  const lvl = (v: unknown) => (v == null || v === '' ? undefined : Number(v).toFixed(2));
  return {
    // Old-format theses open with "Last 206.20, ..." — that is not a name.
    ticker: String(s.ticker), name: name && name.length < 40 && !/^Last\s/.test(name) ? name : undefined,
    dip: /buy dip/i.test(thesis), buy: lvl(s.trigger), stop: lvl(s.stop ?? s.invalidation),
    status: statusOf(thesis), why: plain(why),
    // Why, where it could go, and how it fails — the context a bare level lacks.
    whyHtml: [
      why ? esc(plain(why)) : '',
      target ? `<span style="color:${C.muted};">${esc(plain(target))}</span>` : '',
      risk ? `<span style="color:${C.red};font-weight:600;">Risk:</span> ${esc(risk)}` : '',
    ].filter(Boolean).join('<br>'),
  };
}

/* A four-column table, numbers right-aligned in fixed columns, so the levels
   line up down the list instead of floating with each row's text (24 Sep 2026). */
const WTD = `padding:8px 0;border-bottom:1px solid ${C.rule};vertical-align:middle;`;
const WATCH_HEAD = `<tr>
    <td style="font-size:10px;font-weight:700;letter-spacing:1px;color:${C.muted};padding:4px 0;border-bottom:1px solid ${C.border};">TICKER</td>
    <td align="right" style="font-size:10px;font-weight:700;letter-spacing:1px;color:${C.muted};padding:4px 0;border-bottom:1px solid ${C.border};">BUY</td>
    <td align="right" style="font-size:10px;font-weight:700;letter-spacing:1px;color:${C.muted};padding:4px 0;border-bottom:1px solid ${C.border};">STOP</td>
    <td align="right" style="font-size:10px;font-weight:700;letter-spacing:1px;color:${C.muted};padding:4px 0;border-bottom:1px solid ${C.border};">STATUS</td>
  </tr>`;

function watchRow(p: Pick): string {
  return `<tr>
    <td style="${WTD}font-size:14px;color:${C.body};">
      <b style="color:${C.ink};">${esc(p.ticker)}</b>${p.name ? `<br><span style="font-size:12px;color:${C.muted};">${esc(p.name)}</span>` : ''}
    </td>
    <td width="22%" align="right" style="${WTD}padding-left:8px;font-size:14px;font-weight:700;color:${C.ink};white-space:nowrap;">${p.dip ? '&darr;' : ''}${esc(p.buy)}</td>
    <td width="22%" align="right" style="${WTD}padding-left:8px;font-size:14px;font-weight:700;color:${C.red};white-space:nowrap;">${esc(p.stop)}</td>
    <td width="18%" align="right" style="${WTD}padding-left:8px;">${statusPill(p.status ? { ...p.status, text: p.status.text.replace(/\s*away$/i, '') } : null)}</td>
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
  /* A list, not wrapped chips: sector name left, percent right-aligned in
     its own column, so the numbers line up down each block (24 Sep 2026). */
  const rows = (list: string, fg: string, title: string) => {
    const items = list.split(/,\s*/).map(x => x.trim()).filter(Boolean).slice(0, 4).map(x => {
      const m = x.match(/^(.*?)\s*([+\-−]?\d+(?:\.\d+)?%)$/);
      return m ? [m[1], m[2]] : [x, ''];
    });
    if (!items.length) return '';
    const td = `padding:5px 0;border-bottom:1px solid ${C.rule};font-size:14px;`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
      <tr><td colspan="2" style="font-size:10px;font-weight:700;letter-spacing:1px;color:${fg};padding:0 0 4px 0;border-bottom:1px solid ${C.border};">${title}</td></tr>
      ${items.map(([n, v]) => `<tr><td style="${td}color:${C.body};">${esc(n)}</td><td align="right" style="${td}font-weight:700;color:${fg};white-space:nowrap;">${esc(v)}</td></tr>`).join('')}
    </table>`;
  };
  return { lead: rows(lead, C.green, 'LEADING'), lag: rows(lag.split(/,\s*/).reverse().join(', '), C.red, 'LAGGING'), narrative };
}

/* ---- the email --------------------------------------------------------- */
export interface EmailV2Input {
  phaseLabel: string;
  dateLabel: string;
  updatedTime?: string | null;
  macro: Any;
  brief: Any;
  phaseKey: string;
  /** /api/t2108/latest — share of stocks above their 40-day average. */
  t2108?: Any;
}

export function buildEmailV2({ phaseLabel, dateLabel, updatedTime, macro, brief, phaseKey, t2108 }: EmailV2Input): string {
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
  const above40 = typeof t2108?.value === 'number' ? t2108.value : null;
  const up4 = Number(b.up4 ?? b.mm4Up), down4 = Number(b.down4 ?? b.mm4Down);
  const mf = macro?.moneyFlow?.spy ?? macro?.moneyFlow;
  const mfVal = typeof mf?.value === 'number' ? mf.value : null;
  const tiles = [
    pctUp != null ? ['Stocks up today', `${Math.round(pctUp)}%`, pctUp >= 50 ? C.green : C.red] : null,
    hiLo ? ['New lows vs highs', hiLo, lo >= hi ? C.red : C.green] : null,
    vix ? ['Fear (VIX)', Number(vix).toFixed(1), Number(vix) >= 20 ? C.red : C.ink] : null,
    above40 != null ? ['Above 40-day avg', `${Math.round(above40)}%`, above40 < 30 ? C.red : above40 > 70 ? C.amber : C.ink] : null,
    up4 > 0 || down4 > 0 ? ['Big movers (4%+)', `${up4} ▲ / ${down4} ▼`, up4 >= down4 ? C.green : C.red] : null,
    mfVal != null ? ['Money flow (SPY)', `${Math.round(mfVal)} ${mf?.trend > 0 ? '▲' : mf?.trend < 0 ? '▼' : ''}`, mfVal >= 50 ? C.green : C.red] : null,
  ].filter(Boolean) as [string, string, string][];
  const tileCell = ([l, v, c]: [string, string, string]) =>
    `<td width="50%" style="width:50%;padding:8px 0;vertical-align:top;"><div style="font-size:12px;color:${C.muted};white-space:nowrap;">${esc(l)}</div><div style="font-size:20px;font-weight:800;color:${c};white-space:nowrap;">${esc(v)}</div></td>`;
  /* Two across at every width, every cell the same: three across squeezed the
     outer columns on a phone until their labels wrapped to three lines. */
  const tileRows: string[] = [];
  for (let i = 0; i < tiles.length; i += 2) tileRows.push(`<tr>${tiles.slice(i, i + 2).map(tileCell).join('')}</tr>`);
  const tileHtml = tiles.length ? `<tr><td class="pad" style="padding:12px 24px 20px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tileRows.join('')}</table></td></tr>` : '';

  const hero = regime ? `
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td class="pad" style="padding:22px 24px 4px 24px;">
        ${label('The market', tone)}
        <div class="h1" style="font-size:28px;line-height:1.2;font-weight:800;color:${C.ink};margin-top:8px;">${esc(verdict)}</div>
        ${driver ? `<div style="font-size:16px;line-height:1.55;color:${C.body};margin-top:10px;">${esc(driver)}</div>` : ''}
      </td></tr>
      ${tileHtml}
    </table>
  </td></tr>
  <tr><td style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>` : '';

  /* The tape reading — the phase's whole session block, as the page shows it. */
  const block = brief?.sessionUpdates?.[phaseKey];
  const paras: string[] = Array.isArray(block?.paragraphs) ? block.paragraphs.filter(Boolean) : [];
  const since = paras.length || block?.takeaway ? card(`
    ${label(`Tape reading · ${block?.phase || phaseLabel}`, C.violet)}
    ${paras.map(p => `<div style="font-size:15px;line-height:1.6;color:${C.body};margin-top:10px;">${rich(p)}</div>`).join('')}
    ${block?.takeaway ? `<div style="font-size:15px;line-height:1.55;color:${C.ink};font-weight:700;border-left:3px solid ${C.violet};padding:2px 0 2px 12px;margin-top:14px;">${rich(block.takeaway)}</div>` : ''}`) : '';

  /* what's next */
  const nextSentences = String(rd.posture || '').split(/(?<=[.;])\s+(?=[A-Z*])/).map(s => s.trim()).filter(Boolean);
  const next = nextSentences.length ? card(`
    ${label("What's likely next", C.teal)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
      ${outlookRows(nextSentences)}
    </table>
    ${rd.caution ? `<div style="font-size:14px;line-height:1.5;color:${C.muted};margin-top:8px;"><b style="color:${C.red};">Risk:</b> ${rich(rd.caution)}</div>` : ''}`) : '';

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
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">${WATCH_HEAD}${watch.map(watchRow).join('')}</table>` : ''}`) : '';

  /* avoid */
  const traps = (summary.traps || []).slice(0, 4).map((line: string) => {
    const m = String(line).match(/^\s*\*\*([A-Z][A-Z0-9.\-]{0,6})\*\*\s*(?:\([^)]*\))?\s*[—-]?\s*(.*)$/);
    const ticker = m?.[1] || '';
    const rest = plain(m?.[2] ?? line);
    const st = statusOf(rest);
    const text = rest.replace(/^(OUT|EXT|MISS)\s*[:—-]?\s*/i, '');
    /* Three fixed columns — ticker, status, reason — so every reason starts
       at the same place (an inline min-width let long tickers push it). */
    const td = `padding:7px 0;vertical-align:top;border-bottom:1px solid ${C.rule};`;
    return `<tr>
      <td width="56" style="${td}width:56px;font-size:14px;line-height:1.5;"><b style="color:${C.ink};">${esc(ticker)}</b></td>
      <td width="44" style="${td}width:44px;line-height:1.5;">${st && st.kind !== 'wait' ? statusPill(st) : ''}</td>
      <td style="${td}font-size:14px;line-height:1.5;color:${C.body};">${esc(text)}</td>
    </tr>`;
  }).join('');
  const avoid = traps ? card(`${label('Avoid', C.red)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${traps}</table>`) : '';

  /* news, money, calendar, earnings, tomorrow */
  /* The context sections: the macro driver and how broad the move is. */
  const proseCard = (title: string, color: string, text: unknown) => {
    const paras = String(text || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
    return paras.length ? card(`${label(title, color)}${paras.map(p => `<div style="font-size:15px;line-height:1.6;color:${C.body};margin-top:10px;">${rich(p)}</div>`).join('')}`) : '';
  };
  const macroCard = proseCard('The macro picture', C.teal, sectionOf(brief, 'Futures & Macro Snapshot')?.analysis);
  const breadthCard = proseCard('How broad the move is', C.amber, sectionOf(brief, 'Sentiment & Market Breadth')?.analysis);
  const news = listCard('News that matters', C.violet, bullets(sectionOf(brief, 'Key News & Catalysts')?.analysis).slice(0, 8));

  const sec = sectorChips(sectionOf(brief, 'Top Sectors & Money Flow')?.analysis || '');
  const money = sec.lead || sec.lag || sec.narrative ? card(`
    ${label('Where the money went', C.teal)}
    ${sec.narrative ? `<div style="font-size:15px;line-height:1.55;color:${C.body};margin-top:10px;">${rich(sec.narrative)}</div>` : ''}
    ${sec.lead}
    ${sec.lag}`) : '';

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
  const pct = (v: Any) => { const n = Number(v); return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : ''; };
  const xVol = (v: Any) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? `${n >= 10 ? Math.round(n) : n.toFixed(1)}×` : ''; };
  const table = (rows: Any[], cols: [string, (r: Any) => string, 'l' | 'r'][]) => rows.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:collapse;">
      <tr>${cols.map(([h, , a]) => `<td style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.muted};padding:6px 4px;border-bottom:1px solid ${C.border};text-align:${a === 'r' ? 'right' : 'left'};">${esc(h)}</td>`).join('')}</tr>
      ${rows.map(r => `<tr>${cols.map(([, fn, a]) => `<td style="font-size:14px;color:${C.body};padding:7px 4px;border-bottom:1px solid ${C.rule};text-align:${a === 'r' ? 'right' : 'left'};white-space:nowrap;">${fn(r)}</td>`).join('')}</tr>`).join('')}
    </table>` : '';
  const chg = (r: Any) => { const n = Number(r?.changePct); return `<b style="color:${n >= 0 ? C.green : C.red};">${pct(n)}</b>`; };
  const tk = (r: Any) => `<b style="color:${C.ink};">${esc(r?.ticker)}</b>`;
  const mvRows = Array.isArray(movers?.stocks) ? movers.stocks : [];
  const ups = mvRows.filter((r: Any) => (r?.direction ?? (Number(r?.changePct) >= 0 ? 'long' : 'short')) === 'long').slice(0, 5);
  const downs = mvRows.filter((r: Any) => (r?.direction ?? (Number(r?.changePct) >= 0 ? 'long' : 'short')) === 'short').slice(0, 5);
  const moverCols: [string, (r: Any) => string, 'l' | 'r'][] = [['Ticker', tk, 'l'], ['Move', chg, 'r'], ['Volume vs usual', r => xVol(r?.rvol), 'r']];
  const sip = sectionOf(brief, 'Stocks in Play Today');
  const sipRows = (Array.isArray(sip?.stocks) ? sip.stocks : []).slice(0, 8);
  const sipHtml = sipRows.length ? card(`${label('Stocks in play', C.teal)}${sip?.analysis ? `<div style="font-size:15px;line-height:1.55;color:${C.body};margin-top:10px;">${rich(sip.analysis)}</div>` : ''}${table(sipRows, [['Ticker', tk, 'l'], ['Move', chg, 'r'], ['CNF', r => r?.score != null ? esc(String(Math.round(Number(r.score)))) : '', 'r'], ['Volume vs usual', r => xVol(r?.rvol), 'r']])}`) : '';
  const moversHtml = movers?.analysis || mvRows.length ? card(`${label(String(movers.section), C.muted)}${movers?.analysis ? `<div style="font-size:15px;line-height:1.55;color:${C.body};margin-top:10px;">${rich(movers.analysis)}</div>` : ''}${ups.length ? `<div style="margin-top:12px;">${label('Up most', C.green)}</div>${table(ups, moverCols)}` : ''}${downs.length ? `<div style="margin-top:14px;">${label('Down most', C.red)}</div>${table(downs, moverCols)}` : ''}`) : '';

  return emailShell({
    title: `CTT ${phaseLabel}`,
    pill: `${phaseLabel} · ${dateLabel}`,
    updatedTime,
    sections: [hero, since, macroCard, breadthCard, next, picksHtml, avoid, news, money, moversHtml, sipHtml, cal, earn, tomorrow],
    footerNote: "Levels are each scan's own plan.",
  });
}
