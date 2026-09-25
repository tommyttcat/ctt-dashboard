/* lib/email/alertEmail.ts — the watchlist alert: short, one row per name,
 * same light kit as the briefing so it reads as part of the same product. */

import { C, esc, card, label, emailShell } from './emailKit';
import type { Alert } from '@/lib/alerts';

export function alertSubject(alerts: Alert[]): string {
  if (alerts.length === 1) {
    const a = alerts[0];
    return a.kind === 'hit'
      ? `CTT alert: ${a.ticker} reached its buy level ${a.buy.toFixed(2)}`
      : `CTT alert: ${a.ticker} fell below its stop ${a.stop.toFixed(2)}`;
  }
  const hits = alerts.filter(a => a.kind === 'hit').map(a => a.ticker);
  const outs = alerts.filter(a => a.kind === 'out').map(a => a.ticker);
  return `CTT alert: ${[hits.length ? `${hits.join(', ')} hit` : '', outs.length ? `${outs.join(', ')} out` : ''].filter(Boolean).join(' · ')}`;
}

export function buildAlertEmail(alerts: Alert[], etTime: string): string {
  const TD = `padding:9px 0;border-bottom:1px solid ${C.rule};vertical-align:top;font-size:14px;`;
  const rows = alerts.map(a => {
    const hit = a.kind === 'hit';
    return `<tr>
      <td style="${TD}"><b style="font-size:16px;color:${C.ink};">${esc(a.ticker)}</b><br><span style="font-size:12px;color:${C.muted};">${esc(a.scan)}</span></td>
      <td style="${TD}padding-left:10px;color:${C.body};line-height:1.5;">
        <b style="color:${hit ? C.green : C.red};">${hit ? 'HIT' : 'OUT'}</b>
        ${hit
          ? ` reached its ${a.dip ? 'dip' : 'buy'} level at ${esc(a.price.toFixed(2))}`
          : ` fell below its stop at ${esc(a.price.toFixed(2))}`}<br>
        <span style="color:${C.muted};">${a.dip ? 'Buy dip' : 'Buy above'} <b style="color:${C.ink};">${esc(a.buy.toFixed(2))}</b> &middot; Stop <b style="color:${C.red};">${esc(a.stop.toFixed(2))}</b></span>
      </td>
    </tr>`;
  }).join('');

  const body = card(`${label('Watchlist alert', C.teal)}
    <div style="font-size:14px;line-height:1.5;color:${C.body};margin-top:8px;">A name you starred just changed status, as of the ${esc(etTime)} ET scan. Check your own chart before acting.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">${rows}</table>`);

  return emailShell({
    title: 'CTT Watchlist Alert',
    pill: 'Watchlist alert',
    sections: [body],
    footerNote: 'You get these because alerts are switched on in your watchlist — switch them off there any time.',
  });
}
