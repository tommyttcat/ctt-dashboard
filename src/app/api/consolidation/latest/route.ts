import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const [candidates, meta, lastScanTime] = await Promise.all([
      kv.get<any[]>('consol_1021_v1'),
      kv.get<any>('consol_1021_meta_v1'),
      kv.get<number>('consol_1021_last_scan_v1'),
    ]);

    return NextResponse.json({
      success: true,
      candidates: candidates || [],
      count: meta?.count ?? (candidates ? candidates.length : 0),
      lastScanTime: lastScanTime || null,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}