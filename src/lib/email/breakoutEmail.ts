/* lib/email/breakoutEmail.ts — the real-time breakout alert (/api/orb/live).
 * Same light kit as the watchlist alert: one row per name, the level, the
 * stop, and when it happened. */

import { C, esc, card, emailShell } from './emailKit';
import type { OrbWatchRow } from '@/lib/orb';

const clock = (min: number | null) => (min == null ? '' : `${Math.floor(min / 60) % 12 || 12}:${String(min % 60).padStart(2, '0')}`);

export function breakoutSubject(rows: OrbWatchRow[]): string {
  const go = rows.filter(r => r.state === 'go').map(r => r.t);
  const st = rows.filter(r => r.state === 'stopped').map(r => r.t);
  if (rows.length === 1) {
    const r = rows[0];
    return r.state === 'go'
      ? `CTT breakout: ${r.t} broke out at ${r.fill?.toFixed(2) ?? '—'} · stop ${r.stop.toFixed(2)}`
      : `CTT breakout: ${r.t} hit its stop ${r.stop.toFixed(2)}`;
  }
  return `CTT breakout: ${[go.length ? `${go.join(', ')} broke out` : '', st.length ? `${st.join(', ')} stopped` : ''].filter(Boolean).join(' · ')}`;
}

export function buildBreakoutEmail(rows: OrbWatchRow[], etTime: string): string {
  /* One block per stock, three short lines, so nothing wraps into a column
     beside it on a phone (30 Sep 2026: the two-column layout read jumbled). */
  const body = rows.map((r, i) => {
    const go = r.state === 'go';
    const last = r.last != null && r.fill ? ` · now ${r.last.toFixed(2)} (${r.last >= r.fill ? '+' : '−'}${Math.abs((r.last / r.fill - 1) * 100).toFixed(1)}%)` : '';
    const what = go
      ? `Broke its 10:00 high${r.goAt != null ? ` at ${clock(r.goAt)} ET` : ''} on ${r.pace != null ? r.pace.toFixed(1) : '—'}× volume${last}`
      : `Broke out${r.goAt != null ? ` at ${clock(r.goAt)} ET` : ''}, then hit its stop${last}`;
    return `<tr><td style="padding:12px 0;${i < rows.length - 1 ? `border-bottom:1px solid ${C.rule};` : ''}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:18px;font-weight:800;color:${C.ink};">${esc(r.t)}</td>
        <td align="right" style="font-size:13px;font-weight:800;letter-spacing:1px;color:${go ? C.green : C.red};">${go ? 'BUY SIGNAL' : 'STOPPED OUT'}</td>
      </tr></table>
      <div style="font-size:15px;color:${C.body};margin-top:4px;">Buy above <b style="color:${C.ink};">${esc((r.fill ?? r.orHigh)?.toFixed(2) ?? '—')}</b> &middot; Stop <b style="color:${C.red};">${esc(r.stop.toFixed(2))}</b></div>
      <div style="font-size:13px;color:${C.muted};margin-top:3px;line-height:1.5;">${esc(what)}</div>
    </td></tr>`;
  }).join('');
  const html = card(`<div style="font-size:14px;line-height:1.5;color:${C.body};">One of today's Best Setups just changed (${esc(etTime)} ET). Check your own chart before acting.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">${body}</table>`);
  return emailShell({
    title: 'CTT Breakout Alert',
    pill: 'Breakout alert',
    sections: [html],
    footerNote: 'You get these because breakout alerts are switched on for this address.',
  });
}

/** Plain-text twin: also what the inbox shows as the preview line. */
export function breakoutText(rows: OrbWatchRow[], etTime: string): string {
  const lines = rows.map(r => `${r.t} — ${r.state === 'go' ? 'BUY SIGNAL' : 'STOPPED OUT'} · Buy above ${(r.fill ?? r.orHigh)?.toFixed(2) ?? '—'} · Stop ${r.stop.toFixed(2)}`);
  return `${lines.join('\n')}\n\nOne of today's Best Setups just changed (${etTime} ET). Check your own chart before acting.`;
}
