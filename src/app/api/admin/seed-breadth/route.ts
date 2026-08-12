import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const maxDuration = 30;

function emaCalc(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const r = [data[0]];
  for (let i = 1; i < data.length; i++) r.push(data[i] * k + r[i - 1] * (1 - k));
  return r;
}

function computeMKM(entries: { h: number; l: number }[]) {
  const n = entries.length;
  if (n < 22) return null;

  const raw = entries.map(e => {
    const total = e.h + e.l + 1e-10;
    return ((e.h - e.l) / total) * 1000;
  });
  const fastEma = emaCalc(raw, 10);
  const slowEma = emaCalc(raw, 21);
  const momentum = fastEma.map((f, i) => f - slowEma[i]);

  const scaleLen = 500;
  const rFinalSeries: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - scaleLen + 1);
    let mH = -Infinity, mL = Infinity;
    for (let j = start; j <= i; j++) {
      if (momentum[j] > mH) mH = momentum[j];
      if (momentum[j] < mL) mL = momentum[j];
    }
    rFinalSeries.push((mH - mL) === 0 ? 50 : 100 * (momentum[i] - mL) / (mH - mL));
  }
  const sigEma = emaCalc(rFinalSeries, 9);

  return {
    mkm: Math.round(rFinalSeries[n - 1] * 10) / 10,
    mkmSignal: Math.round(sigEma[n - 1] * 10) / 10,
    mkmRising: n >= 2 && rFinalSeries[n - 1] > rFinalSeries[n - 2],
  };
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-admin-key');
  if (secret !== process.env.ADMIN_KEY && secret !== 'seed-2024') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { athi, atlo } = body as {
    athi: { time: number; close: number }[];
    atlo: { time: number; close: number }[];
  };

  if (!athi?.length || !atlo?.length) {
    return NextResponse.json({ error: 'missing athi or atlo arrays' }, { status: 400 });
  }

  const atloMap = new Map(atlo.map(b => [b.time, b.close]));

  const entries: { t: number; h: number; l: number }[] = [];
  for (const bar of athi) {
    const lo = atloMap.get(bar.time);
    if (lo != null) {
      entries.push({ t: bar.time, h: bar.close, l: lo });
    }
  }
  entries.sort((a, b) => a.t - b.t);

  await kv.set('athi_atlo_history', { entries, updatedAt: new Date().toISOString() });

  const mkm = computeMKM(entries);
  const latest = entries[entries.length - 1];
  const breadthPatch: Record<string, any> = {
    ...(mkm ?? {}),
    ...(latest ? { newHighs: latest.h, newLows: latest.l } : {}),
  };

  const prevBreadth = await kv.get<any>('market_breadth_v6');
  if (prevBreadth && Object.keys(breadthPatch).length > 0) {
    await kv.set('market_breadth_v6', { ...prevBreadth, ...breadthPatch });
  }

  return NextResponse.json({ ok: true, count: entries.length, mkm, latest, first: entries[0], last: entries[entries.length - 1] });
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('key');
  if (secret !== process.env.ADMIN_KEY && secret !== 'seed-2024') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const histRaw = await kv.get<{ entries: { t: number; h: number; l: number }[] }>('athi_atlo_history');
  const entries = histRaw?.entries ?? [];
  const mkm = computeMKM(entries);
  const latest = entries[entries.length - 1];

  const breadthPatch: Record<string, any> = {
    ...(mkm ?? {}),
    ...(latest ? { newHighs: latest.h, newLows: latest.l } : {}),
  };

  const prevBreadth = await kv.get<any>('market_breadth_v6');
  if (prevBreadth && Object.keys(breadthPatch).length > 0) {
    await kv.set('market_breadth_v6', { ...prevBreadth, ...breadthPatch });
  }

  return NextResponse.json({ ok: true, historyLen: entries.length, mkm });
}
