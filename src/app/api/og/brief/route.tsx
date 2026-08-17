import { ImageResponse } from 'next/og';

export const runtime = 'edge';

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin || 'https://ctt-dashboard.vercel.app';

  const [brief, macro] = await Promise.all([
    fetchJson(`${origin}/api/analyst/brief`),
    fetchJson(`${origin}/api/macro`),
  ]);

  const rd = brief?.regimeDetail || {};
  const sections: any[] = brief?.sections || [];
  const sectionByName = (rx: RegExp) => sections.find((s: any) => rx.test(s.section));

  const quotes = macro?.quotes || {};
  const indices = ['SPY', 'QQQ', 'DIA', 'IWM'].map(t => ({
    ticker: t,
    chg: quotes[t]?.changePct ?? 0,
  }));

  const tradesSec = sectionByName(/Top Trades/i);
  const trades: any[] = (tradesSec?.stocks || []).slice(0, 4);

  const avoidSec = sectionByName(/Top Avoid/i);
  const avoids: any[] = (avoidSec?.stocks || []).slice(0, 2);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const regime = rd.regime
    ? String(rd.regime).split(/[.!]\s/)[0]
    : 'Analysis unavailable';

  const green = '#34d399';
  const red = '#fb7185';
  const muted = '#64748b';
  const subtle = '#94a3b8';
  const card = '#1e293b';
  const border = '#334155';
  const light = '#cbd5e1';
  const white = '#f1f5f9';

  return new ImageResponse(
    (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#0f172a',
        color: '#e2e8f0',
        fontFamily: 'sans-serif',
        padding: '40px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: white }}>CTT Market Brief</div>
            <div style={{ fontSize: 14, color: muted, marginTop: 4 }}>{dateStr}</div>
          </div>
          <div style={{ display: 'flex' }}>
            {indices.map(idx => (
              <div key={idx.ticker} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginLeft: 16 }}>
                <div style={{ fontSize: 11, color: muted, fontWeight: 600 }}>{idx.ticker}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: idx.chg >= 0 ? green : red }}>{fmtPct(idx.chg)}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          display: 'flex',
          backgroundColor: card,
          borderRadius: 8,
          border: `1px solid ${border}`,
          padding: '16px 20px',
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 14, color: light }}>{regime}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: muted, marginBottom: 12 }}>TRADE IDEAS</div>
          {trades.map((s: any, i: number) => (
            <div key={s.ticker || i} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 0',
              borderBottom: `1px solid ${card}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: i < 2 ? green : subtle,
                  marginRight: 12,
                }}>{s.ticker}</div>
                <div style={{ fontSize: 12, color: subtle }}>
                  {[
                    s.stage ? `Stage ${s.stage}` : '',
                    s.setup || '',
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: muted, marginRight: 16 }}>
                  {s.trigger != null ? `${s.trigger} → ${s.target ?? ''}` : ''}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: (s.changePct ?? 0) >= 0 ? green : red }}>
                  {fmtPct(s.changePct ?? 0)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {avoids.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: muted, marginBottom: 8 }}>STAY AWAY</div>
            {avoids.map((s: any) => (
              <div key={s.ticker} style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 0',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: red, marginRight: 12 }}>{s.ticker}</div>
                <div style={{ fontSize: 12, color: muted }}>
                  {[
                    fmtPct(s.changePct ?? 0),
                    s.stage ? `Stage ${s.stage}` : '',
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div style={{
          display: 'flex',
          marginTop: 'auto',
          paddingTop: 16,
          borderTop: `1px solid ${card}`,
          fontSize: 11,
          color: '#475569',
        }}>
          confluencetradingtools.com
        </div>
      </div>
    ),
    { width: 680, height: 520 },
  );
}
