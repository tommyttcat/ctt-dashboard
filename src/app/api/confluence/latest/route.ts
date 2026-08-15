import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CACHE, cacheHeaders, noCacheHeaders } from '@/lib/httpCache';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  try {
    const [reports, lastScanTime, aiSummary] = await Promise.all([
      kv.get<any[]>('confluence_report_v1'),
      kv.get<number>('confluence_last_scan_v1'),
      kv.get<any>('confluence_ai_summary_v1'),
    ]);

    return NextResponse.json(
      {
        success: true,
        reports: Array.isArray(reports) ? reports : [],
        lastScanTime: lastScanTime ?? null,
        count: Array.isArray(reports) ? reports.length : 0,
        aiSummary: aiSummary ?? null,
      },
      { headers: cacheHeaders(CACHE.SCAN) }
    );
  } catch (error: any) {
    console.error('CONFLUENCE_LATEST_ERROR:', error);
    return NextResponse.json(
      { success: false, error: error.message, reports: [] },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
