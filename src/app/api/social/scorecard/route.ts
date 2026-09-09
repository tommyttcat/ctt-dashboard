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

/* "about one stock in five", "roughly two in three" — a share the reader does
   not have to convert. Percentages are what the card already shows; the post
   exists for people who are not looking at the card. */
function inWords(pct: number): string {
  const table: [number, string][] = [
    [12, 'barely one stock in ten'],
    [22, 'about one stock in six'],
    [28, 'about one stock in four'],
    [38, 'about one stock in three'],
    [46, 'a little over four in ten'],
    [55, 'about half of all stocks'],
    [64, 'closer to six in ten'],
    [75, 'about two out of every three'],
    [88, 'three quarters of the market'],
    [101, 'almost everything'],
  ];
  for (const [ceil, phrase] of table) if (pct < ceil) return phrase;
  return 'almost everything';
}

/* The ratio, said as a ratio, rounded to something a person would say out loud. */
function ratioPhrase(a: number, b: number): string | null {
  if (!a || !b) return null;
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  const r = hi / lo;
  if (r < 1.4) return null;
  const n = r >= 9 ? 'nearly ten' : r >= 4.5 ? 'five' : r >= 3.5 ? 'four' : r >= 2.5 ? 'three' : 'two';
  return n;
}

export function composeBlurb(macro: any, t2108: any, chop: any): { text: string; why: string } {
  const b = macro?.breadth || {};
  const pctAdv: number = typeof b.pctAdv === 'number' ? b.pctAdv : 50;
  const highs: number = b.newHighs ?? 0;
  const lows: number = b.newLows ?? 0;
  const t: number | null = typeof t2108?.value === 'number' ? t2108.value : null;
  const chopVal: number | null = typeof chop?.blended === 'number' ? chop.blended : null;

  const share = inWords(pctAdv);
  const weak = pctAdv < 40;
  const strong = pctAdv > 60;

  /* Sentence one: what the day's participation actually did. */
  const rn = ratioPhrase(highs, lows);
  let first = weak
    ? `${share.charAt(0).toUpperCase() + share.slice(1)} rose today`
    : strong
      ? `${share.charAt(0).toUpperCase() + share.slice(1)} rose today`
      : `${share.charAt(0).toUpperCase() + share.slice(1)} finished higher`;
  if (rn && lows > highs) first += `, and ${rn} hit new lows for every new high.`;
  else if (rn && highs > lows) first += `, and ${rn} hit new highs for every new low.`;
  else first += '.';

  /* Sentence two: the disagreement, and a claim left open. The medium-term
     reading is the share of stocks above their 40-day line; the trend reading
     is whether the tape is going anywhere at all. */
  let second: string;
  let why: string;
  const mediumHolding = t != null && t >= 45;
  const mediumGone = t != null && t < 35;
  const trendless = chopVal != null && chopVal >= 58;

  if (weak && mediumHolding) {
    second = 'Half the market is still above its 40-day line, which is not what an actual breakdown looks like.';
    why = 'weak day, medium-term intact';
  } else if (weak && mediumGone) {
    second = 'The medium-term trend went with it, and what held through last month is not holding now.';
    why = 'weak day, medium-term broken';
  } else if (weak) {
    second = 'The medium-term trend is thinner than it was a week ago, and it has not decided anything yet.';
    why = 'weak day, medium-term eroding';
  } else if (strong && !mediumHolding) {
    second = 'Most stocks are still below their 40-day line, so this rally is starting from behind.';
    why = 'strong day, medium-term still weak';
  } else if (strong) {
    second = 'The medium-term agrees for once, which leaves the names that did not come along as the interesting part.';
    why = 'strong day, medium-term agrees';
  } else if (trendless) {
    second = 'Neither side took the day, and the tape has gone nowhere for weeks. Something has to give.';
    why = 'mixed day, trendless tape';
  } else {
    second = 'Neither side took the day, and the split runs straight through the sectors that usually move together.';
    why = 'mixed day';
  }

  if (trendless && !/nowhere for weeks/.test(second)) {
    why += ' + trendless';
  }
  return { text: `${first} ${second}`, why };
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

  const { text: blurb, why } = composeBlurb(macro, t2108, chop);
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
