// scripts/backtest/cache.ts — shared loader for the backtest bar cache.
//
// The replay (which names would have been flagged) and the scorer (what they
// did next) must read the same bars the same way, so the loader lives here
// once. Columnar split-adjusted history: one Float32Array per field per
// ticker, indexed by session; NaN = did not trade that session.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Bar } from '@/lib/scans/ep9m';

export const APP = process.cwd();
if (!fs.existsSync(path.join(APP, 'src/lib/scans/ep9m.ts'))) {
  throw new Error('Run backtest scripts from trade-dash (npx tsx scripts/backtest/<script>.ts)');
}
export const DATA = path.resolve(APP, '../backtest-data');

export type Row = [string, number, number, number, number, number, number | null]; // T o h l c v vw

export function readDay(kind: 'adj' | 'unadj', date: string): Row[] {
  const file = path.join(DATA, 'grouped', kind, date.slice(0, 4), `${date}.json.gz`);
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString()).rows;
}

export function listSessions(): string[] {
  const root = path.join(DATA, 'grouped', 'adj');
  const out: string[] = [];
  for (const year of fs.readdirSync(root).sort()) {
    for (const f of fs.readdirSync(path.join(root, year)).sort()) {
      if (!f.endsWith('.json.gz')) continue;
      // Holidays are written as a ~95-byte empty marker; a real session is
      // hundreds of KB. Skip markers without parsing them.
      if (fs.statSync(path.join(root, year, f)).size < 1000) continue;
      if (!fs.existsSync(path.join(DATA, 'grouped', 'unadj', year, f))) {
        throw new Error(`unadj file missing for ${f.slice(0, 10)} — finish the download first`);
      }
      out.push(f.slice(0, 10));
    }
  }
  return out;
}

export interface BarCache {
  sessions: string[];
  tMs: number[];
  idOf: Map<string, number>;
  syms: string[];
  O: Float32Array[]; H: Float32Array[]; L: Float32Array[];
  C: Float32Array[]; V: Float32Array[]; VW: Float32Array[];
  /** Bars for one ticker over session indices [from, to], skipping non-trading sessions. */
  barsOf(id: number, from: number, to: number): Bar[];
}

export function loadAdjusted(): BarCache {
  const sessions = listSessions();
  const N = sessions.length;
  const tMs = sessions.map(d => Date.parse(`${d}T00:00:00Z`));
  const idOf = new Map<string, number>();
  const syms: string[] = [];
  const O: Float32Array[] = [], H: Float32Array[] = [], L: Float32Array[] = [];
  const C: Float32Array[] = [], V: Float32Array[] = [], VW: Float32Array[] = [];
  for (let s = 0; s < N; s++) {
    for (const [T, o, h, l, c, v, vw] of readDay('adj', sessions[s])) {
      let id = idOf.get(T);
      if (id === undefined) {
        id = syms.length; idOf.set(T, id); syms.push(T);
        for (const arr of [O, H, L, C, V, VW]) arr.push(new Float32Array(N).fill(NaN));
      }
      O[id][s] = o; H[id][s] = h; L[id][s] = l; C[id][s] = c; V[id][s] = v; VW[id][s] = vw ?? NaN;
    }
  }
  const barsOf = (id: number, from: number, to: number): Bar[] => {
    const out: Bar[] = [];
    for (let j = Math.max(0, from); j <= Math.min(N - 1, to); j++) {
      if (Number.isNaN(C[id][j])) continue;
      out.push({ t: tMs[j], o: O[id][j], h: H[id][j], l: L[id][j], c: C[id][j], v: V[id][j] });
    }
    return out;
  };
  return { sessions, tMs, idOf, syms, O, H, L, C, V, VW, barsOf };
}
