import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Invalid date format — use YYYY-MM-DD' },
      { status: 400, headers: noCacheHeaders() },
    );
  }

  try {
    const brief = await kv.get<any>(`brief_archive:${date}`);
    if (!brief) {
      return NextResponse.json(
        { error: 'No archived brief for this date' },
        { status: 404, headers: cacheHeaders(CACHE.SLOW) },
      );
    }
    return NextResponse.json(brief, {
      headers: {
        ...cacheHeaders(CACHE.SLOW),
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `KV read failed: ${err.message}` },
      { status: 500, headers: noCacheHeaders() },
    );
  }
}
