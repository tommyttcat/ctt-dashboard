// scripts/backtest/reference.ts — Polygon's ticker reference, for replays.
//
// The live scans drop a name only when its ticker `type` is KNOWN and is not
// CS/ADRC (funds, warrants, ETNs that slip past the static ETF lists); an
// unknown type passes. Same rule here, from the cached list written by
// download-reference.mjs — which includes delisted tickers, so a name that
// stopped trading in 2023 is still typed correctly when replaying 2022.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA } from './cache';

export interface RefRec { type: string | null; name: string | null; delisted: string | null }
export type Reference = Map<string, RefRec[]>;

export function loadReference(): Reference {
  const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'reference', 'tickers.json.gz'))).toString());
  const m: Reference = new Map();
  for (const [ticker, type, , name, delisted] of j.rows) {
    const arr = m.get(ticker) ?? [];
    arr.push({ type, name, delisted: delisted ? String(delisted).slice(0, 10) : null });
    m.set(ticker, arr);
  }
  return m;
}

export function refAt(ref: Reference, sym: string, date: string): RefRec | null {
  const recs = ref.get(sym);
  if (!recs?.length) return null;
  // A reused symbol: prefer the listing that was alive on the scan date.
  return recs.find(r => !r.delisted || r.delisted >= date) ?? recs[recs.length - 1];
}

/** The live check: reject only a KNOWN non-common type. */
export function isTradeableType(type: string | null | undefined): boolean {
  const t = (type || '').toUpperCase();
  return !t || t === 'CS' || t === 'ADRC';
}
