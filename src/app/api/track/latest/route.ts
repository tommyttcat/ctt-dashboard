// app/api/track/latest/route.ts — the live record, read side.
//
// Aggregates only (plus the Model Book, which is small by construction): per scan, how many picks have been made, how many have
// settled, and what they returned on the same measuring stick the backtests
// use. Cached at the edge for an hour because the numbers change once a day,
// so this is roughly one KV read an hour no matter how many people look.

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { TRACK_RESULTS_KEY, TRACK_META_KEY, TRACK_OPEN_KEY, type TrackResults, type OpenPosition } from '@/lib/track';
import { PLAN_RESULTS_KEY, type PlanResults } from '@/lib/trackPlan';
import { MODEL_BOOK_KEY, MODEL_BOOK_V2_KEY, type ModelBook } from '@/lib/modelBook';

/* What the page needs from a book: the latest 15 closed trades (the totals
   cover all of them) and a curve that stops growing — daily for the last
   year, weekly before that — so the payload stays flat as the books age. */
function forPage(book: ModelBook | null) {
  if (!book) return null;
  const c = book.curve;
  const recent = c.slice(-260);
  const older = c.slice(0, -260).filter((_, i) => i % 5 === 0);
  return { ...book, closed: book.closed.slice(0, 15), curve: [...older, ...recent] };
}
import { CACHE, cacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [results, meta, open, plan, book, bookV2] = await Promise.all([
      kv.get<TrackResults>(TRACK_RESULTS_KEY),
      kv.get<{ lastBarDate?: string; tickedAt?: string; open?: number }>(TRACK_META_KEY),
      kv.get<OpenPosition[]>(TRACK_OPEN_KEY),
      /* The record kept the way the picks are presented (lib/trackPlan). One
         small key; its recent-trades list is capped at 40. */
      kv.get<PlanResults>(PLAN_RESULTS_KEY),
      /* The Model Book (lib/modelBook). One key, ~10 holdings, a capped
         closed log and one curve point per session. */
      kv.get<ModelBook>(MODEL_BOOK_KEY),
      kv.get<ModelBook>(MODEL_BOOK_V2_KEY),
    ]);
    const live = open ?? [];
    return NextResponse.json({
      success: true,
      results: results ?? {},
      plan: plan ?? null,
      book: forPage(book),
      bookV2: forPage(bookV2),
      meta: meta ?? null,
      openCount: live.length,
      // Enough to show "tracking N ideas" without shipping the whole book.
      openByScan: live.reduce<Record<string, number>>((m, p) => { m[p.scan] = (m[p.scan] || 0) + 1; return m; }, {}),
    }, { headers: cacheHeaders(CACHE.SLOW) });
  } catch (e) {
    console.error('TRACK_LATEST_ERROR', e);
    return NextResponse.json({ success: false, error: 'unavailable' }, { status: 500 });
  }
}
