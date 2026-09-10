import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { postToBluesky } from '@/lib/bluesky';
import { postToX } from '@/lib/twitter';
import { isTradingDay, etDateString } from '@/lib/marketCalendar';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* Daily Macro Scorecard post — twice a session, to X and Bluesky.
 *
 * The picture is a screenshot of the real card, not a rebuild of it. The
 * dashboard is behind login, so the screenshot service reaches it with the
 * _ss=CRON_SECRET escape the middleware honours; the same route the weekly
 * Daily Setups cover uses. Rebuilding the card as standalone HTML would have
 * meant a second implementation of it drifting away from the first.
 *
 * The blurb is composed from the numbers, not written by a model. Nothing here
 * may call the Anthropic API, and a scorecard post is a statistics card whose
 * interesting content is the tension between two readings — which is a thing
 * arithmetic can find. */

const DASH_URL = 'confluencetradingtools.com';
const CARD_URL = 'https://app.confluencetradingtools.com/dashboard';
const SELECTOR = '#macro-scorecard-card';

type Slot = 'open' | 'power';
const SLOT_LABEL: Record<Slot, string> = {
  open: 'After the open',
  power: 'Into the afternoon',
};

function resolveOrigin(req: Request): string {
  try { const u = new URL(req.url); if (u.origin && u.origin !== 'null') return u.origin; } catch { /* fall through */ }
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const nf = (n: number) => n.toLocaleString('en-US');

/* Index moves, said the way a person says them. */
function movePhrase(pct: number): string {
  const v = Math.abs(pct);
  if (v < 0.12) return 'barely moved';
  if (v < 0.3) return `${pct < 0 ? 'lost' : 'added'} a quarter of a percent`;
  if (v < 0.6) return `${pct < 0 ? 'lost' : 'added'} half a percent`;
  if (v < 0.9) return `${pct < 0 ? 'lost' : 'added'} three quarters of a percent`;
  if (v < 1.4) return `${pct < 0 ? 'lost' : 'added'} about a percent`;
  return `${pct < 0 ? 'fell' : 'rose'} ${v.toFixed(1)}%`;
}

type Candidate = { id: string; score: number; lead: string[]; follow: string[] };

/* The blurb names the single most unusual thing on the card and says what it
 * means. It used to run one template off one comparison, which produced the
 * same hedged sentence every day — "half the market is still above its 40-day
 * line, which is not what an actual breakdown looks like" commits to nothing
 * while the card beside it is full of specifics.
 *
 * Now every reading that could be the story becomes a candidate with a score
 * for how unusual it is, the strongest one leads, the strongest DIFFERENT one
 * follows, and each has several phrasings rotated by the date so the same
 * market twice running does not read identically. */
export function composeBlurb(
  macro: any, t2108: any, chop: any, slot: Slot = 'open', now: Date = new Date(),
): { text: string; why: string } {
  const b = macro?.breadth || {};
  const q = macro?.quotes || {};
  const adv: number = b.advancers ?? 0;
  const dec: number = b.decliners ?? 0;
  const pctAdv: number = typeof b.pctAdv === 'number' ? b.pctAdv : 50;
  const highs: number = b.newHighs ?? 0;
  const lows: number = b.newLows ?? 0;
  const up4: number = b.up4 ?? 0;
  const down4: number = b.down4 ?? 0;
  const t: number | null = typeof t2108?.value === 'number' ? t2108.value : null;
  const chopVal: number | null = typeof chop?.blended === 'number' ? chop.blended : null;
  const spy: number | null = typeof q?.SPY?.pct === 'number' ? q.SPY.pct : null;
  const iwm: number | null = typeof q?.IWM?.pct === 'number' ? q.IWM.pct : null;
  const vix: number | null = typeof q?.VIX?.pct === 'number' ? q.VIX.pct : null;

  const cands: Candidate[] = [];
  const down = pctAdv < 50;
  const lopsided = Math.max(pctAdv, 100 - pctAdv);

  /* The index says one thing and the market underneath says another. */
  if (spy != null && Math.abs(spy) < 0.9 && lopsided > 66) {
    const side = down ? 'fell' : 'rose';
    const frac = lopsided > 78 ? 'four of every five' : 'three of every four';
    cands.push({
      id: 'index-vs-street',
      score: lopsided + (0.9 - Math.abs(spy)) * 40,
      lead: [
        `The S&P ${movePhrase(spy)} today. Underneath it, ${frac} stocks ${side}.`,
        `Look at the index and almost nothing happened. Look at the list and ${frac} stocks ${side}.`,
        `The S&P ${movePhrase(spy)}. That number is hiding ${frac} stocks that ${side}.`,
      ],
      follow: [
        'A handful of the largest names are carrying the whole tape.',
        'The average stock is having a much worse day than the average portfolio.',
      ],
    });
  }

  /* The tails: how many names made a real move, not a drift. */
  const tail = Math.max(up4, down4);
  const tailOther = Math.min(up4, down4);
  if (tail >= 250 && tailOther > 0 && tail / tailOther >= 1.8) {
    const heavy = down4 >= up4;
    cands.push({
      id: 'tails',
      score: 55 + Math.min(40, (tail / tailOther) * 10),
      lead: [
        `${nf(down4)} stocks dropped more than four percent today. ${nf(up4)} gained that much.`,
        `The big movers were ${heavy ? 'almost all down' : 'almost all up'}: ${nf(tail)} names moved more than four percent ${heavy ? 'lower' : 'higher'}, against ${nf(tailOther)} the other way.`,
      ],
      follow: [
        heavy ? 'That is real selling with size behind it, not a quiet drift lower.' : 'That is real buying with size behind it, not a drift.',
        heavy ? 'Nobody sells that hard in a market they intend to buy back tomorrow.' : 'Money moving that fast is not waiting for confirmation.',
      ],
    });
  }

  /* New lows against new highs. */
  if (highs > 0 && lows > 0 && Math.max(highs, lows) / Math.min(highs, lows) >= 2.5) {
    const lowsWin = lows > highs;
    const ratio = Math.round(Math.max(highs, lows) / Math.min(highs, lows));
    cands.push({
      id: 'highs-lows',
      score: 45 + Math.min(35, ratio * 4),
      lead: [
        `${nf(lows)} stocks hit a new low today. ${nf(highs)} hit a new high.`,
        `New lows are running ${ratio} to one over new highs.`,
      ],
      follow: [
        lowsWin ? 'Damage that wide usually takes more than one session to repair.' : 'Leadership this broad does not turn over in a day.',
        lowsWin ? 'The list of names actually working is getting shorter every session.' : 'The list of names working keeps getting longer.',
      ],
    });
  }

  /* Small caps against the index. */
  if (spy != null && iwm != null && Math.abs(iwm - spy) > 0.35) {
    const worse = iwm < spy;
    cands.push({
      id: 'small-caps',
      score: 40 + Math.min(30, Math.abs(iwm - spy) * 25),
      lead: [
        `Small caps ${worse ? 'fell' : 'rose'} roughly ${Math.max(1.5, Math.abs(iwm / (spy || 1))).toFixed(0)} times as hard as the S&P.`,
        `The gap today is size: small caps ${movePhrase(iwm)} while the S&P ${movePhrase(spy)}.`,
      ],
      follow: [
        worse ? 'That is what a market pricing tighter money for longer looks like.' : 'The riskiest end of the market is leading, which rarely happens quietly.',
      ],
    });
  }

  /* Protection getting bid out of proportion to the move. */
  if (vix != null && spy != null && vix > 4 && Math.abs(spy) < 0.7) {
    cands.push({
      id: 'vol-bid',
      score: 42 + Math.min(30, vix),
      lead: [
        `Volatility jumped ${vix.toFixed(0)}% on a day the S&P ${movePhrase(spy)}.`,
        `Protection got expensive today without the market doing much to justify it.`,
      ],
      follow: [
        'Somebody is paying up for cover ahead of something.',
        'That gap usually closes one way or the other within a week.',
      ],
    });
  }

  /* Medium-term trend against the day. */
  if (t != null && (pctAdv < 38 || pctAdv > 62)) {
    const holding = t >= 45;
    cands.push({
      id: 'medium-term',
      score: 30 + Math.abs(50 - pctAdv),
      lead: [
        `About ${Math.round(t)}% of the market is still above its 40-day line.`,
        `The 40-day line has ${Math.round(t)}% of stocks above it, roughly where it sat a week ago.`,
      ],
      follow: [
        holding && pctAdv < 38 ? 'One ugly session has not touched the trend yet. A second one would.' : '',
        !holding && pctAdv > 62 ? 'A rally starting from underneath the trend has more to prove than one starting above it.' : '',
        'The damage is in the day, not yet in the trend.',
      ].filter(Boolean),
    });
  }

  /* Going nowhere, which is itself the story. */
  if (chopVal != null && chopVal >= 58) {
    cands.push({
      id: 'trendless',
      score: 28 + (chopVal - 58),
      lead: [
        'The tape has gone nowhere for weeks, and today did not change that.',
        'Another session, another day inside the same range.',
      ],
      follow: [
        'Ranges this long tend to end in one move, not a drift.',
        'The longer this holds, the bigger the break when it comes.',
      ],
    });
  }

  if (!cands.length) {
    return {
      text: `${nf(adv)} stocks rose and ${nf(dec)} fell. Neither side took the day.`,
      why: 'no standout reading',
    };
  }

  cands.sort((x, y) => y.score - x.score);
  const top = cands[0];
  const second = cands.find(c => c.id !== top.id);

  /* Rotate phrasings by the date and slot so the same market twice in a row
     does not produce the same sentence. */
  const dayIdx = Math.floor(now.getTime() / 86400000) + (slot === 'power' ? 1 : 0);
  const pick = (arr: string[]) => arr[dayIdx % arr.length];

  const lead = pick(top.lead);
  const follow = second ? pick(second.follow) : pick(top.follow);
  return { text: `${lead} ${follow}`, why: `${top.id} + ${second?.id ?? 'self'}` };
}

async function fetchCard(origin: string): Promise<Uint8Array | null> {
  try {
    const shot = `${origin}/api/og/screenshot?force=1&w=1600&h=1100`
      + `&url=${encodeURIComponent(CARD_URL)}`
      + `&selector=${encodeURIComponent(SELECTOR)}&minText=200`;
    const res = await fetch(shot, { cache: 'no-store' });
    if (!res.ok || !res.headers.get('content-type')?.includes('image')) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const preview = url.searchParams.get('preview') === '1';
  const force = url.searchParams.get('force') === '1';
  const slot = (url.searchParams.get('slot') || 'open') as Slot;
  if (slot !== 'open' && slot !== 'power') {
    return NextResponse.json({ error: "slot must be 'open' or 'power'" }, { status: 400 });
  }

  const secret = process.env.CRON_SECRET;
  if (!preview && !force && secret) {
    if ((req.headers.get('authorization') || '') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const today = etDateString();
  if (!force && !isTradingDay(today)) {
    return NextResponse.json({ skipped: true, reason: `market closed ${today}` });
  }

  const origin = resolveOrigin(req);
  const [macro, t2108, chop] = await Promise.all([
    fetchJson(`${origin}/api/macro`),
    fetchJson(`${origin}/api/t2108/latest`),
    fetchJson(`${origin}/api/chop`),
  ]);
  if (!macro?.breadth) {
    return NextResponse.json({ error: 'no breadth data' }, { status: 503 });
  }

  const { text: blurb, why } = composeBlurb(macro, t2108, chop, slot);
  const cta = `Live scorecard → ${DASH_URL}`;
  const bskyText = `${blurb}\n\n${cta}`;
  const xText = `${blurb}\n\n${cta}`;

  if (preview) {
    return NextResponse.json({
      slot, label: SLOT_LABEL[slot], why, blurb,
      chars: { bsky: bskyText.length, x: xText.length },
      bskyText, xText,
      readings: {
        pctAdv: macro.breadth.pctAdv,
        highs: macro.breadth.newHighs,
        lows: macro.breadth.newLows,
        t2108: t2108?.value,
        chop: chop?.blended,
      },
    });
  }

  /* One post per slot per day. NX so a retrying cron cannot double-post. */
  const lockKey = `scorecard_sent:${slot}:${today}`;
  if (!force) {
    const locked = await kv.set(lockKey, 1, { nx: true, ex: 86400 });
    if (!locked) return NextResponse.json({ skipped: true, slot, reason: 'already posted this slot today' });
  } else {
    await kv.set(lockKey, 1, { ex: 86400 });
  }

  const card = await fetchCard(origin);
  const debug: any = { slot, why, blurb, cardBytes: card?.length ?? 0 };
  if (!card) debug.cardMissing = true;

  const linkStart = bskyText.indexOf(DASH_URL);
  const results = await Promise.allSettled([
    postToBluesky(
      bskyText,
      linkStart >= 0 ? [{ start: linkStart, end: linkStart + DASH_URL.length, url: `https://${DASH_URL}` }] : [],
      card ? { data: card, alt: 'CTT Macro Scorecard', mimeType: 'image/png' } : undefined,
    ),
    postToX(xText, card ? { data: card } : undefined),
  ]);

  if (results[0].status === 'rejected') debug.bskyError = String((results[0] as PromiseRejectedResult).reason);
  if (results[1].status === 'rejected') debug.xError = String((results[1] as PromiseRejectedResult).reason);

  return NextResponse.json({
    success: true,
    bluesky: results[0].status === 'fulfilled' ? (results[0].value as any)?.uri ?? null : null,
    x: results[1].status === 'fulfilled' ? (results[1].value as any)?.id ?? null : null,
    ...debug,
  });
}
