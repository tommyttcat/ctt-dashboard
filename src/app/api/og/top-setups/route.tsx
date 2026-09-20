import { ImageResponse } from 'next/og';
import { kv } from '@vercel/kv';

/* /api/og/top-setups — the cover for the Saturday "Top Setups of the Week"
 * post.
 *
 * WHY THIS EXISTS
 * ---------------
 * That post used to attach a live screenshot of the Daily Setups scanner
 * (/api/og/screenshot against /scanners?expand=1, 1400x1700). Three things
 * were wrong with it:
 *
 *   1. WRONG DATA. The post recaps a WEEK; the scanner on a Saturday holds
 *      Friday's single session. The picture and the copy disagreed.
 *   2. UNREADABLE. Eighteen columns of 10px text shrink to mush at feed
 *      thumbnail size, and 1400x1700 is portrait, which X crops hard.
 *   3. INDISTINGUISHABLE from the daily posts, so the weekly flagship did
 *      not stand out in a feed.
 *
 * This renders the names instead, at a size a thumb can read, in the 1200x630
 * landscape every platform accepts without cropping.
 *
 * DATA: the same KV narrative the post itself is built from, so the cover can
 * never disagree with the body. That narrative carries only ticker, heading
 * and body — no score — so the CNF badge is drawn ONLY when the ticker is
 * still in the current scan payload, and omitted when it is not. A missing
 * badge is correct; an invented number would not be.
 */

export const runtime = 'edge';

const W = 1200;
const H = 630;

// Same palette as /api/og/brief — one look across every generated card.
const bg = '#0f172a';
const card = '#1e293b';
const border = '#334155';
const white = '#f1f5f9';
const light = '#cbd5e1';
const subtle = '#94a3b8';
const muted = '#64748b';
const accent = '#818cf8';
const green = '#34d399';
const amber = '#fbbf24';

type Setup = { ticker?: string; heading?: string; body?: string };
type Narrative = { title?: string; subtitle?: string; setups?: Setup[] };

/* Monday–Friday of the week that just ended. The post runs Saturday morning
   ET, so "this week" is the five sessions behind it. */
function weekRange(now: Date): string {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const back = (et.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(et);
  monday.setDate(et.getDate() - back);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const f = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${f(monday)} – ${f(friday)}`;
}

const cnfTone = (v: number) => (v >= 70 ? green : v >= 50 ? amber : muted);

/* The heading is editorial prose of unknown length and the row gives it one
   line. Cut on a word so a clipped line never ends mid-word. */
function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\-–—]$/, '')}…`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const narrative = await kv.get<Narrative>('top_setups_data').catch(() => null);
  const setups = (narrative?.setups || []).filter(s => s?.ticker).slice(0, 5);

  /* Scores, when the name is still on the board. Read from the same key the
     dashboard reads so the badge cannot disagree with the site. */
  const scores = new Map<string, number>();
  try {
    const rows = await kv.get<Record<string, unknown>[]>('daily_setups_v6');
    for (const r of rows || []) {
      const t = String(r?.ticker ?? '').toUpperCase();
      const v = Number(r?.conviction ?? r?.cnfScore ?? NaN);
      if (t && Number.isFinite(v)) scores.set(t, v);
    }
  } catch { /* a missing scan payload just means no badges */ }

  const range = url.searchParams.get('range') || weekRange(new Date());

  const jsx = (
    <div style={{
      display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
      backgroundColor: bg, color: light, fontFamily: 'sans-serif', padding: '44px 52px',
    }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 46, fontWeight: 800, color: white, letterSpacing: -1 }}>
            Top Setups of the Week
          </div>
          <div style={{ fontSize: 22, color: accent, fontWeight: 600, marginTop: 6 }}>{range}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: white, letterSpacing: 2 }}>CTT</div>
          <div style={{ fontSize: 13, color: muted, marginTop: 2 }}>Confluence Trading Tools</div>
        </div>
      </div>

      <div style={{ display: 'flex', height: 2, backgroundColor: border, marginTop: 22, marginBottom: 8 }} />

      {/* the names */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
        {setups.map((s, i) => {
          const ticker = String(s.ticker).toUpperCase();
          const score = scores.get(ticker);
          return (
            <div key={ticker} style={{
              display: 'flex', alignItems: 'center', backgroundColor: card,
              border: `1px solid ${border}`, borderRadius: 10, padding: '12px 18px', marginTop: i ? 10 : 0,
            }}>
              <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: muted, width: 34 }}>{i + 1}</div>
              <div style={{ display: 'flex', fontSize: 34, fontWeight: 800, color: white, width: 150 }}>{ticker}</div>
              {score != null && (
                <div style={{
                  display: 'flex', fontSize: 19, fontWeight: 700, color: cnfTone(score),
                  border: `1px solid ${cnfTone(score)}55`, borderRadius: 6, padding: '2px 10px', marginRight: 18,
                }}>{Math.round(score)}</div>
              )}
              <div style={{ display: 'flex', flex: 1, fontSize: 21, color: subtle }}>
                {clip(s.heading || '', score != null ? 58 : 66)}
              </div>
            </div>
          );
        })}
        {setups.length === 0 && (
          <div style={{ display: 'flex', fontSize: 26, color: muted }}>
            No setups stored for this week yet.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
        <div style={{ display: 'flex', fontSize: 17, color: muted }}>confluencetradingtools.com</div>
        <div style={{ display: 'flex', fontSize: 15, color: muted }}>Setups, not signals · Not financial advice</div>
      </div>
    </div>
  );

  return new ImageResponse(jsx, {
    width: W,
    height: H,
    headers: { 'cache-control': 'public, max-age=0, s-maxage=300' },
  });
}
