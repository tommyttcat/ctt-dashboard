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
const teal = '#22d3ee';
const rose = '#fb7185';
const orange = '#fb923c';

/* The Saturday routine writes each setup's levels into its body in the same
   words as the dashboard's Buy & stop box (since 24 Sep 2026):
   "buy above 208.10 · stop 202.90 · 0.9% away". Older posts have no such
   line, and then the row simply shows the reason. */
type Levels = { dip: boolean; buy: string; stop: string; status: string };
function levelsOf(body: string): Levels | null {
  const m = String(body || '').replace(/\*\*/g, '').match(/buy (above|dip)\s+([\d.,]+)\s*·\s*stop\s+([\d.,]+)\s*·\s*(HIT|MISS|EXT|OUT|\d+(?:\.\d+)?\s?% away)/i);
  if (!m) return null;
  return { dip: m[1].toLowerCase() === 'dip', buy: m[2], stop: m[3], status: m[4].toUpperCase() };
}
const statusTone = (st: string): [string, string] =>
  st === 'HIT' ? [green, '#064e3b'] : st === 'OUT' ? [rose, '#4c0519'] : st === 'EXT' ? [orange, '#431407'] : st === 'MISS' ? [amber, '#422006'] : [light, '#1e293b'];

/* The narrative writes its headings for the POST, where each one sits under
   its own ticker sub-head: "HOOD — Top of the board, but it already went
   (CNF 97 · A)". On the card the ticker is already the biggest thing in the
   row and the score is already a badge, so that prefix and suffix would
   print the ticker twice and the score three times, in the one place with no
   room to spare. Strip both and let the line be the reason. */
function headingText(raw: string, ticker: string): string {
  return raw
    .replace(new RegExp(`^\\s*\\$?${ticker}\\s*[—–-]\\s*`, 'i'), '')
    .replace(/\s*\((?:CNF\s*)?\d+(?:\s*[·|,/]\s*[A-F][+-]?)?\)\s*$/i, '')
    .trim();
}

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

  const theme = clip(String(narrative?.subtitle || '').replace(/\*\*/g, ''), 70);

  const jsx = (
    <div style={{
      display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
      backgroundColor: '#0b1020', backgroundImage: 'linear-gradient(135deg, #0b1020 0%, #111a33 100%)',
      color: light, fontFamily: 'sans-serif', padding: '38px 52px 30px 52px',
    }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', fontSize: 17, fontWeight: 800, color: teal, letterSpacing: 3 }}>
          CTT · TOP SETUPS OF THE WEEK
        </div>
        <div style={{
          display: 'flex', fontSize: 17, fontWeight: 700, color: teal, backgroundColor: '#0e2a33',
          border: '1px solid #164e5c', borderRadius: 999, padding: '5px 14px',
        }}>{range}</div>
      </div>

      {/* the week's theme */}
      <div style={{ display: 'flex', fontSize: 38, fontWeight: 800, color: white, letterSpacing: -0.5, marginTop: 16, lineHeight: 1.15 }}>
        {theme || 'Top Setups of the Week'}
      </div>
      <div style={{ display: 'flex', height: 3, width: 120, backgroundColor: teal, borderRadius: 2, marginTop: 16, marginBottom: 14 }} />

      {/* the names */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
        {setups.map((s, i) => {
          const ticker = String(s.ticker).toUpperCase();
          const score = scores.get(ticker);
          const lv = levelsOf(s.body || '');
          const [stFg, stBg] = lv ? statusTone(lv.status) : [light, card];
          return (
            <div key={ticker} style={{
              display: 'flex', alignItems: 'center', backgroundColor: 'rgba(30,41,59,0.72)',
              border: `1px solid ${border}`, borderRadius: 12, padding: '10px 16px', marginTop: i ? 8 : 0,
            }}>
              <div style={{
                display: 'flex', justifyContent: 'center', fontSize: 24, fontWeight: 800, color: '#0b1020',
                backgroundColor: score != null ? cnfTone(score) : green, borderRadius: 8, padding: '4px 0', width: 112,
              }}>{ticker}</div>
              <div style={{ display: 'flex', flex: 1, fontSize: 20, color: light, marginLeft: 18 }}>
                {clip(headingText(s.heading || '', ticker), lv ? 34 : 60)}
              </div>
              {lv && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: 16 }}>
                    <div style={{ display: 'flex', fontSize: 12, color: subtle, letterSpacing: 1 }}>{lv.dip ? 'BUY DIP' : 'BUY ABOVE'}</div>
                    <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, color: white }}>{lv.buy}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: 16 }}>
                    <div style={{ display: 'flex', fontSize: 12, color: subtle, letterSpacing: 1 }}>STOP</div>
                    <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, color: rose }}>{lv.stop}</div>
                  </div>
                  <div style={{
                    display: 'flex', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: stFg,
                    backgroundColor: stBg, borderRadius: 999, padding: '5px 0', width: 112,
                  }}>{lv.status}</div>
                </div>
              )}
            </div>
          );
        })}
        {setups.length === 0 && (
          <div style={{ display: 'flex', fontSize: 26, color: muted }}>
            No setups stored for this week yet.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <div style={{ display: 'flex', fontSize: 16, fontWeight: 700, color: white }}>confluencetradingtools.com</div>
        <div style={{ display: 'flex', fontSize: 14, color: muted }}>Setups, not signals · Not financial advice</div>
      </div>
    </div>
  );

  return new ImageResponse(jsx, {
    width: W,
    height: H,
    headers: { 'cache-control': 'public, max-age=0, s-maxage=300' },
  });
}
