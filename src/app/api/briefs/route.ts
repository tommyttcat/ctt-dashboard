import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const INDEX_KEY = 'brief_archive_index';

export async function GET() {
  try {
    const dates = await kv.get<string[]>(INDEX_KEY);
    if (!dates || dates.length === 0) {
      return NextResponse.json(
        { dates: [], total: 0 },
        { headers: cacheHeaders(CACHE.SLOW) },
      );
    }
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    return NextResponse.json(
      { dates: sorted, total: sorted.length },
      { headers: cacheHeaders(CACHE.SLOW) },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `KV read failed: ${err.message}` },
      { status: 500, headers: noCacheHeaders() },
    );
  }
}
