// app/api/t2108/latest/route.ts — v1.0
//
// Read-only KV fetch for T2108, written by the swing-candidates run route.
// Separate endpoint so the Scorecard can poll it without touching the swing
// payload (which is a 40-row array it has no use for).

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  const noStoreHeaders = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };

  try {
    const t = await kv.get<any>('t2108_v1');
    return NextResponse.json({
      success: true,
      value: t?.value ?? null,
      zone: t?.zone ?? 'unknown',
      above: t?.above ?? null,
      total: t?.total ?? null,
      updatedAt: t?.updatedAt ?? null,
    }, { headers: noStoreHeaders });
  } catch (error: any) {
    console.error('T2108_LATEST_ERROR:', error);
    return NextResponse.json(
      { success: false, error: error.message, value: null },
      { status: 500, headers: noStoreHeaders }
    );
  }
}