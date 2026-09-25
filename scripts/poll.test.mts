/* scripts/poll.test.mts — client polls pause in hidden tabs.
 *
 * Two guards. The first is structural: a raw setInterval in a component is
 * how a tab ends up polling all night with nobody looking (the 12 Aug outage
 * and the 24 Sep cost check), so any new one fails here unless it is on the
 * allow-list of timers that never touch the network. The second exercises
 * lib/poll against a stand-in document: hidden stops the timer, shown
 * fetches at once if the data is stale, and the period can change with time.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { eq, done } from './testkit.mts';

// ---- 1. no raw timers in components ------------------------------------------
const ALLOWED = [
  'setSession(getMarketSession())',   // AnalystBrief's session clock — no fetch
];
const walk = (d: string): string[] => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') || p.endsWith('.ts') ? [p] : [];
});
const offenders: string[] = [];
for (const file of walk('src/components')) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!/\bsetInterval\(/.test(line) || line.trim().startsWith('*') || line.trim().startsWith('//')) return;
    if (ALLOWED.some(a => line.includes(a))) return;
    offenders.push(`${file}:${i + 1}`);
  });
}
eq(`no raw setInterval in components (use lib/poll)${offenders.length ? ' — ' + offenders.join(', ') : ''}`, offenders.length, 0);

// ---- 2. behaviour ---------------------------------------------------------------
type Listener = () => void;
const listeners: Listener[] = [];
const doc = {
  hidden: false,
  addEventListener: (_: string, l: Listener) => { listeners.push(l); },
  removeEventListener: (_: string, l: Listener) => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); },
};
(globalThis as any).window = globalThis;
(globalThis as any).document = doc;
const setHidden = (h: boolean) => { doc.hidden = h; listeners.forEach(l => l()); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const { poll } = await import('../src/lib/poll.ts');

{
  let n = 0;
  const stop = poll(() => { n += 1; }, 30);
  await sleep(100);
  eq('visible: keeps polling', n >= 2, true);
  setHidden(true);
  const atHide = n;
  await sleep(120);
  eq('hidden: nothing is fetched', n, atHide);
  setHidden(false);
  eq('shown after a long gap: fetches at once', n, atHide + 1);
  await sleep(80);
  eq('shown: resumes polling', n > atHide + 1, true);
  stop();
  const atStop = n;
  await sleep(80);
  eq('stopped: no more fetches', n, atStop);
  eq('stopped: listener removed', listeners.length, 0);
}
{
  let n = 0;
  const stop = poll(() => { n += 1; }, 200);
  setHidden(true);
  setHidden(false);
  eq('shown again quickly: no extra fetch while data is fresh', n, 0);
  stop();
}
{
  let n = 0;
  let period = 1000;
  const stop = poll(() => { n += 1; }, () => period);
  period = 20;
  await sleep(1100);
  const after = n;
  await sleep(100);
  eq('a function period is re-read before each wait', n > after, true);
  stop();
}

done('poll');
