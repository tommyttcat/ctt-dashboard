/* lib/email/emailKit.ts — the shared pieces of the light, card-based emails
 * (the phase email in briefingV2 and the weekly wrap in weeklyV2).
 *
 * Email-safe on purpose: table layout, inline styles, 600px, no web fonts,
 * light only. The <style> block in the shell only adds narrow-screen fallbacks.
 */

export const C = {
  page: '#f3f5f9', card: '#ffffff', border: '#cbd5e1', tile: '#f6f8fb', rule: '#e2e8f0',
  ink: '#0f172a', body: '#334155', muted: '#64748b', faint: '#94a3b8',
  green: '#059669', red: '#e11d48', amber: '#d97706', teal: '#0891b2', violet: '#7c3aed', orange: '#ea580c',
  greenBg: '#dcfce7', redBg: '#ffe4ea', amberBg: '#fef3c7', orangeBg: '#ffedd5', tealBg: '#e0f5f9', slateBg: '#eef1f6',
};

export const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escape, then turn **TICKER** / **bold** into styled bold. */
export const rich = (s: unknown) => esc(s).replace(/\*\*([^*]+)\*\*/g, `<b style="color:${C.ink};">$1</b>`);

export const plain = (s: unknown) => String(s ?? '').replace(/\*\*/g, '').trim();

export const label = (text: string, color: string) =>
  `<div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${color};">${esc(text)}</div>`;

export const card = (inner: string) => `
  <tr><td class="pad" style="background:${C.card};border:1px solid ${C.border};border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,.06);padding:22px 28px;">${inner}</td></tr>
  <tr><td style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>`;

/* ---- status ------------------------------------------------------------ */
export type Status = { kind: 'hit' | 'miss' | 'ext' | 'out' | 'wait'; text: string };

const STATUS_RX = /\b(HIT|MISS|EXT|OUT)\b|(\d+(?:\.\d+)?)\s?% away/;

export function statusOf(text: string): Status | null {
  const m = String(text || '').match(STATUS_RX);
  if (!m) return null;
  if (m[1]) return { kind: m[1].toLowerCase() as Status['kind'], text: m[1] };
  return { kind: 'wait', text: `${m[2]}% AWAY` };
}

export function statusPill(st: Status | null): string {
  if (!st) return '';
  const map: Record<Status['kind'], [string, string]> = {
    hit: [C.green, C.greenBg], miss: [C.amber, C.amberBg], ext: [C.orange, C.orangeBg],
    out: [C.red, C.redBg], wait: [C.body, C.slateBg],
  };
  const [fg, bg] = map[st.kind];
  return `<span style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:.8px;color:${fg};background:${bg};border-radius:999px;padding:4px 10px;white-space:nowrap;">${esc(st.text)}</span>`;
}

export const tickerBadge = (t: string, color = C.green) =>
  `<span style="display:inline-block;font-size:13px;font-weight:800;color:#ffffff;background:${color};border-radius:6px;padding:3px 8px;">${esc(t)}</span>`;

/* ---- pick card ----------------------------------------------------------- */
export type Pick = {
  ticker: string; name?: string; dip: boolean; buy?: string; stop?: string; status: Status | null; why: string;
  /** Pre-rendered HTML for the text under the levels; used instead of `why` when set. */
  whyHtml?: string;
};

export function pickCard(p: Pick, last: boolean): string {
  const levels = p.buy && p.stop ? `
    <table role="presentation" width="100%" style="margin-top:10px;"><tr>
      <td width="50%"><div style="font-size:11px;color:${C.muted};">${p.dip ? 'Buy on a dip to' : 'Buy above'}</div><div style="font-size:18px;font-weight:800;color:${C.ink};">${esc(p.buy)}</div></td>
      <td width="50%"><div style="font-size:11px;color:${C.muted};">Stop</div><div style="font-size:18px;font-weight:800;color:${C.red};">${esc(p.stop)}</div></td>
    </tr></table>` : '';
  const why = p.whyHtml ?? (p.why ? esc(p.why) : '');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;${last ? '' : `border-bottom:1px solid ${C.rule};`}">
      <tr><td style="padding-bottom:14px;">
        <table role="presentation" width="100%"><tr>
          <td>${tickerBadge(p.ticker)}${p.name ? `<span style="font-size:14px;color:${C.muted};margin-left:6px;">${esc(p.name)}</span>` : ''}</td>
          <td align="right">${statusPill(p.status)}</td>
        </tr></table>
        ${levels}
        ${why ? `<div style="font-size:14px;line-height:1.5;color:${C.body};margin-top:8px;">${why}</div>` : ''}
      </td></tr>
    </table>`;
}

/* ---- ▲ / ▼ / ● outlook rows ------------------------------------------------ */
/** "What's likely next" rows: ▲ for a hold/bounce scenario, ▼ for a break, ● otherwise. */
export function outlookRows(sentences: string[]): string {
  return sentences.map(s => {
    const up = /close above|holds|above|bounce/i.test(s) && !/below/i.test(s);
    const down = /below|breaks|loses/i.test(s) && !up;
    const [mark, col] = up ? ['▲', C.green] : down ? ['▼', C.red] : ['●', C.amber];
    return `<tr><td width="24" valign="top" style="font-size:14px;color:${col};padding:3px 0 8px 0;">${mark}</td><td style="font-size:15px;line-height:1.5;color:${C.body};padding-bottom:8px;">${rich(s)}</td></tr>`;
  }).join('');
}

/* ---- the shell ------------------------------------------------------------ */
export interface ShellInput {
  /** <title>, plain text. */
  title: string;
  /** The header pill, plain text (rendered uppercase). */
  pill: string;
  updatedTime?: string | null;
  /** Card rows, top to bottom; empty strings are fine. */
  sections: string[];
  /** Extra sentence after "Not investment advice." in the footer (static HTML). */
  footerNote?: string;
}

export function emailShell({ title, pill, updatedTime, sections, footerNote }: ShellInput): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
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
      <td align="right"><span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.teal};background:${C.tealBg};border-radius:999px;padding:5px 11px;">${esc(pill)}</span></td>
    </tr></table>
    ${updatedTime ? `<div style="font-size:11px;color:${C.faint};margin-top:6px;text-align:right;">Updated ${esc(updatedTime)} ET</div>` : ''}
  </td></tr>

${sections.map(s => `  ${s}`).join('\n')}

  <tr><td align="center" style="padding:14px 0 8px 0;">
    <a href="https://app.confluencetradingtools.com/dashboard" style="display:inline-block;background:${C.teal};color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;padding:14px 26px;">Open the live dashboard →</a>
    <div style="margin-top:12px;"><a href="https://app.confluencetradingtools.com/pricing" style="font-size:13px;font-weight:700;color:${C.amber};text-decoration:none;">Upgrade your plan →</a></div>
  </td></tr>

  <tr><td align="center" style="padding:18px 20px 0 20px;font-size:11px;line-height:1.6;color:${C.faint};">
    Confluence Trading Tools LLC © ${new Date().getFullYear()} · Not investment advice.${footerNote ? ` ${footerNote}` : ''}<br>
    <a href="https://confluencetradingtools.com" style="color:${C.faint};">confluencetradingtools.com</a>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}
