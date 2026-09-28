/* lib/email/breakoutEmail.ts — the real-time breakout alert (/api/orb/live).
 * Same light kit as the watchlist alert: one row per name, the level, the
 * stop, and when it happened. */

import { C, esc, card, label, emailShell } from './emailKit';
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
  const TD = `padding:9px 0;border-bottom:1px solid ${C.rule};vertical-align:top;font-size:14px;`;
  const body = rows.map(r => {
    const go = r.state === 'go';
    return `<tr>
      <td style="${TD}"><b style="font-size:16px;color:${C.ink};">${esc(r.t)}</b><br><span style="font-size:12px;color:${C.muted};">${esc(r.scan.toUpperCase())} · RS ${r.rs}</span></td>
      <td style="${TD}padding-left:10px;color:${C.body};line-height:1.5;">
        <b style="color:${go ? C.green : C.red};">${go ? 'BREAKOUT' : 'STOPPED'}</b>
        ${go
          ? ` broke its opening-range high ${esc(r.orHigh?.toFixed(2) ?? '—')} on ${esc(r.pace?.toFixed(1) ?? '—')}× volume pace${r.goAt != null ? ` at ${clock(r.goAt)} ET` : ''}`
          : ' broke out, then traded to its stop'}<br>
        <span style="color:${C.muted};">Fill <b style="color:${C.ink};">${esc(r.fill?.toFixed(2) ?? '—')}</b> &middot; Stop <b style="color:${C.red};">${esc(r.stop.toFixed(2))}</b> &middot; Last ${esc(r.last?.toFixed(2) ?? '—')}</span>
      </td>
    </tr>`;
  }).join('');
  const html = card(`${label('Breakout alert', C.teal)}
    <div style="font-size:14px;line-height:1.5;color:${C.body};margin-top:8px;">A name on today's breakout watch just changed, as of ${esc(etTime)} ET, on real-time minute bars. The breakout is the entry that tested best (41% winners against 30% for buying the open). Check your own chart before acting.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">${body}</table>`);
  return emailShell({
    title: 'CTT Breakout Alert',
    pill: 'Breakout alert',
    sections: [html],
    footerNote: 'You get these because breakout alerts are switched on for this address.',
  });
}
