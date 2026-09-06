import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { buildLedger, LEDGER_KEY, LEDGER_INDEX_KEY } from '@/lib/setupLedger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Ledger-write cron — the ONLY thing that actually writes the setup ledger.
 *
 * WHY THIS EXISTS
 * ---------------
 * `buildLedger` lives in `/api/analyst/brief`, but the analyst brief is written
 * to KV directly by `scripts/analyst-loop.mjs` (a raw Upstash SET), which never
 * calls that route. Nothing else POSTs to it either, so the ledger side effect
 * never ran and `setup_ledger:*` was empty in production.
 *
 * This cron decouples the ledger from however the brief gets written: it reads
 * the already-persisted `analyst_brief_v1` + `confluence_report_v1` from KV and
 * builds the ledger from them. It is immune to the write mechanism.
 *
 * Integrity (unchanged from setupLedger.ts):
 *  - write-once per date; an existing ledger is never overwritten (an entry that
 *    could be revised after the outcome is known would prove nothing).
 *  - no outcome field at write time; the scoring job appends to its own key.
 *  - empty ledgers are not written (nothing to score, and it would lock the date
 *    against a later good write).
 */

function todayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const date = todayET();

  // Write-once: never overwrite a date that already has a ledger.
  const already = await kv.get<any>(LEDGER_KEY(date));
  if (already) {
    return NextResponse.json({
      date,
      written: false,
      reason: 'already-recorded',
      entries: Array.isArray(already?.entries) ? already.entries.length : null,
    });
  }

  const [brief, confluence] = await Promise.all([
    kv.get<any>('analyst_brief_v1'),
    kv.get<any[]>('confluence_report_v1'),
  ]);

  if (!brief || !Array.isArray(brief.sections)) {
    return NextResponse.json({
      date,
      written: false,
      reason: 'no-brief',
    });
  }

  const ledger = buildLedger(brief, Array.isArray(confluence) ? confluence : [], date, 'closing');

  // Don't write an empty ledger — nothing to score, and it would lock the date
  // against a later post that does carry setups.
  if (ledger.entries.length === 0) {
    return NextResponse.json({
      date,
      written: false,
      reason: 'no-entries',
    });
  }

  await kv.set(LEDGER_KEY(date), ledger);
  const idx = (await kv.get<string[]>(LEDGER_INDEX_KEY)) || [];
  if (!idx.includes(date)) {
    idx.push(date);
    await kv.set(LEDGER_INDEX_KEY, idx);
  }

  return NextResponse.json({
    date,
    written: true,
    entries: ledger.entries.length,
    tickers: ledger.entries.map((e) => e.ticker),
  });
}
