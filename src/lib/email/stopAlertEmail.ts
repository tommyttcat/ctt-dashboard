/* lib/email/stopAlertEmail.ts — the owner's position stop alert
 * (/api/positions/check), in the same layout as the breakout alert: one
 * block per stock, three short lines. */

import { C, esc, card, emailShell } from './emailKit';

export interface StopAlert { t: string; kind: 'near' | 'broke'; price: number; stop: number }

export const stopAlertSubject = (a: StopAlert[]): string =>
  `CTT stop alert: ${a.map(x => `${x.t} ${x.kind === 'broke' ? 'broke its stop' : 'near its stop'}`).join(' · ')}`;

export function buildStopAlertEmail(alerts: StopAlert[], etTime: string): string {
  const body = alerts.map((a, i) => {
    const broke = a.kind === 'broke';
    const gap = ((a.price / a.stop - 1) * 100).toFixed(1);
    return `<tr><td style="padding:12px 0;${i < alerts.length - 1 ? `border-bottom:1px solid ${C.rule};` : ''}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:18px;font-weight:800;color:${C.ink};">${esc(a.t)}</td>
        <td align="right" style="font-size:13px;font-weight:800;letter-spacing:1px;color:${broke ? C.red : C.amber};">${broke ? 'BELOW STOP' : 'NEAR STOP'}</td>
      </tr></table>
      <div style="font-size:15px;color:${C.body};margin-top:4px;">Now <b style="color:${C.ink};">${esc(a.price.toFixed(2))}</b> &middot; Stop <b style="color:${C.red};">${esc(a.stop.toFixed(2))}</b></div>
      <div style="font-size:13px;color:${C.muted};margin-top:3px;">${broke ? 'At or under the stop.' : `${gap}% above the stop.`}</div>
    </td></tr>`;
  }).join('');
  const html = card(`<div style="font-size:14px;line-height:1.5;color:${C.body};">A position you hold is at its stop level (${esc(etTime)} ET, pre-market and after-hours included). This is an alert, not advice — the decision is yours.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">${body}</table>`);
  return emailShell({ title: 'CTT Stop Alert', pill: 'Stop alert', sections: [html], footerNote: 'You get these because stop alerts are set for your positions.' });
}
