/* lib/email/briefingV2.ts — the light, card-based phase email (24 Sep 2026).
 *
 * Built from the simplified brief: one vocabulary (buy / stop / HIT / MISS /
 * EXT / OUT / "x% away") shared with the dashboard's Buy & stop box. Every
 * section reads a brief field directly and is skipped when that field is
 * empty, so an older brief still renders — just with fewer cards.
 *
 * Email-safe on purpose: table layout, inline styles, 600px, no web fonts.
 * The <style> block only adds the narrow-screen fallbacks.
 */

type Any = any;

const C = {
  page: '#f3f5f9', card: '#ffffff', border: '#e6e9f0', tile: '#f6f8fb', rule: '#eef1f6',
  ink: '#0f172a', body: '#334155', muted: '#64748b', faint: '#94a3b8',
  green: '#059669', red: '#e11d48', amber: '#d97706', teal: '#0891b2', violet: '#7c3aed', orange: '#ea580c',
  greenBg: '#dcfce7', redBg: '#ffe4ea', amberBg: '#fef3c7', orangeBg: '#ffedd5', tealBg: '#e0f5f9', slateBg: '#eef1f6',
};

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escape, then turn **TICKER** / **bold** into styled bold. */
const rich = (s: unknown) => esc(s).replace(/\*\*([^*]+)\*\*/g, `<b style="color:${C.ink};">$1</b>`);

const plain = (s: unknown) => String(s ?? '').replace(/\*\*/g, '').trim();

const label = (text: string, color: string) =>
  `<div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${color};">${esc(text)}</div>`;

const card = (inner: string) => `
  <tr><td class="pad" style="background:${C.card};border:1px solid ${C.border};border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,.06);padding:22px 28px;">${inner}</td></tr>
  <tr><td style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>`;

/* ---- status ------------------------------------------------------------ */
type Status = { kind: 'hit' | 'miss' | 'ext' | 'out' | 'wait'; text: string };

const STATUS_RX = /\b(HIT|MISS|EXT|OUT)\b|(\d+(?:\.\d+)?)\s?% away/;

function statusOf(text: string): Status | null {
  const m = String(text || '').match(STATUS_RX);
  if (!m) return null;
  if (m[1]) return { kind: m[1].toLowerCase() as Status['kind'], text: m[1] };
  return { kind: 'wait', text: `${m[2]}% AWAY` };
}

function statusPill(st: Status | null): string {
  if (!st) return '';
  const map: Record<Status['kind'], [string, string]> = {
    hit: [C.green, C.greenBg], miss: [C.amber, C.amberBg], ext: [C.orange, C.orangeBg],
    out: [C.red, C.redBg], wait: [C.body, C.slateBg],
  };
  const [fg, bg] = map[st.kind];
  return `<span style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:.8px;color:${fg};background:${bg};border-radius:999px;padding:4px 10px;white-space:nowrap;">${esc(st.text)}</span>`;
}

const tickerBadge = (t: string, color = C.green) =>
  `<span style="display:inline-block;font-size:13px;font-weight:800;color:#ffffff;background:${color};border-radius:6px;padding:3px 8px;">${esc(t)}</span>`;

/* ---- summary line parser ---------------------------------------------------
   "**CVX** (Chevron) — buy above 208.10 · stop 202.90 · 0.9% away — why." */
type Pick = { ticker: string; name?: string; dip: boolean; buy?: string; stop?: string; status: Status | null; why: string };

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

function pickCard(p: Pick, last: boolean): string {
  const levels = p.buy && p.stop ? `
    <table role="presentation" width="100%" style="margin-top:10px;"><tr>
      <td width="50%"><div style="font-size:11px;color:${C.muted};">${p.dip ? 'Buy on a dip to' : 'Buy above'}</div><div style="font-size:18px;font-weight:800;color:${C.ink};">${esc(p.buy)}</div></td>
      <td width="50%"><div style="font-size:11px;color:${C.muted};">Stop</div><div style="font-size:18px;font-weight:800;color:${C.red};">${esc(p.stop)}</div></td>
    </tr></table>` : '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;${last ? '' : `border-bottom:1px solid ${C.rule};`}">
      <tr><td style="padding-bottom:14px;">
        <table role="presentation" width="100%"><tr>
          <td>${tickerBadge(p.ticker)}${p.name ? `<span style="font-size:14px;color:${C.muted};margin-left:6px;">${esc(p.name)}</span>` : ''}</td>
          <td align="right">${statusPill(p.status)}</td>
        </tr></table>
        ${levels}
        ${p.why ? `<div style="font-size:14px;line-height:1.5;color:${C.body};margin-top:8px;">${esc(p.why)}</div>` : ''}
      </td></tr>
    </table>`;
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
    vix ? ['VIX', Number(vix).toFixed(1), C.ink] : null,
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
      ${nextSentences.map(s => {
        const up = /close above|holds|above|bounce/i.test(s) && !/below/i.test(s);
        const down = /below|breaks|loses/i.test(s) && !up;
        const [mark, col] = up ? ['▲', C.green] : down ? ['▼', C.red] : ['●', C.amber];
        return `<tr><td width="24" valign="top" style="font-size:14px;color:${col};padding:3px 0 8px 0;">${mark}</td><td style="font-size:15px;line-height:1.5;color:${C.body};padding-bottom:8px;">${rich(s)}</td></tr>`;
      }).join('')}
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

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>CTT ${esc(phaseLabel)}</title>
<style>
  body{margin:0;padding:0;background:${C.page};}
  @media (max-width:620px){ .wrap{width:100% !important} .pad{padding-left:18px !important;padding-right:18px !important} .h1{font-size:24px !important} }
</style></head>
<body style="margin:0;padding:0;background:${C.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">

  <tr><td class="pad" style="padding:0 28px 18px 28px;">
    <table role="presentation" width="100%"><tr>
      <td><a href="https://confluencetradingtools.com" style="text-decoration:none;font-size:15px;font-weight:800;letter-spacing:.5px;color:${C.ink};">CTT<span style="color:${C.teal};">.</span></a></td>
      <td align="right"><span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.teal};background:${C.tealBg};border-radius:999px;padding:5px 11px;">${esc(phaseLabel)} · ${esc(dateLabel)}</span></td>
    </tr></table>
    ${updatedTime ? `<div style="font-size:11px;color:${C.faint};margin-top:6px;text-align:right;">Updated ${esc(updatedTime)} ET</div>` : ''}
  </td></tr>

  ${hero}
  ${since}
  ${next}
  ${picksHtml}
  ${avoid}
  ${news}
  ${money}
  ${moversHtml}
  ${cal}
  ${earn}
  ${tomorrow}

  <tr><td align="center" style="padding:14px 0 8px 0;">
    <a href="https://app.confluencetradingtools.com/dashboard" style="display:inline-block;background:${C.teal};color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;padding:14px 26px;">Open the live dashboard →</a>
    <div style="margin-top:12px;"><a href="https://app.confluencetradingtools.com/pricing" style="font-size:13px;font-weight:700;color:${C.amber};text-decoration:none;">Upgrade your plan →</a></div>
  </td></tr>

  <tr><td align="center" style="padding:18px 20px 0 20px;font-size:11px;line-height:1.6;color:${C.faint};">
    Confluence Trading Tools LLC © ${new Date().getFullYear()} · Not investment advice. Levels are each scan's own plan.<br>
    <a href="https://confluencetradingtools.com" style="color:${C.faint};">confluencetradingtools.com</a>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}
