/* lib/summary/pctDirection.ts — which way a percentage in brief prose points (25 Nov 2026).
 *
 * The brief writes most moves unsigned: "VRTX down 7.1%", "Technology … down 0.8%". The page
 * coloured every unsigned % green, so a fall read as a gain. Now: a sign wins; otherwise the
 * nearest direction word before it in the same sentence (then just after it); a level ("from
 * Monday's 4.92%", "at 3%") or no direction word at all is neutral (null). */

const DOWN = /\b(?:down|fell|falls?|falling|lost|loses?|losing|dropped|drops?|dropping|slid|slides?|sliding|slipped|slips?|declined?|declines|declining|lower|sank|sinks?|shed|sheds|tumbled?|plunged?|sold off|losers?|weaker|worst)\b/gi;
const UP = /\b(?:up|rose|rises?|rising|gained?|gains|gaining|added|adds?|climbed?|climbs|climbing|jumped|jumps?|rallied|rall(?:y|ies)|higher|surged?|soared|advanced|popped|stronger|best)\b/gi;
const LEVEL_BEFORE = /\b(?:from|at|of|to|near|above|below|under|over|yields?|rates?)\s+(?:[A-Za-z]+'s\s+)?(?:about\s+|around\s+|roughly\s+)?$/i;
const RANGE_BEFORE = /\d%\s+(?:to|and|-|–)\s+$/;

function lastIndex(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let m: RegExpExecArray | null, at = -1;
  while ((m = re.exec(s)) !== null) at = m.index;
  return at;
}

/** +1 up, -1 down, null neutral. `num` is the matched number text (may carry a sign). */
export function pctDirection(num: string, preceding: string, following: string): 1 | -1 | null {
  const t = num.trim();
  if (t.startsWith('+')) return 1;
  if (t.startsWith('-') || t.startsWith('−')) return -1;
  /* The current sentence only: a direction word two sentences back says nothing. */
  const clause = preceding.split(/[.!?;]\s+/).pop() ?? preceding;
  const range = RANGE_BEFORE.test(clause);
  if (!range && LEVEL_BEFORE.test(clause)) return null;
  const d = lastIndex(DOWN, clause), u = lastIndex(UP, clause);
  if (d >= 0 || u >= 0) return d > u ? -1 : 1;
  const after = following.slice(0, 24);
  const da = lastIndex(DOWN, after), ua = lastIndex(UP, after);
  if (da >= 0 || ua >= 0) return da >= 0 && (ua < 0 || da < ua) ? -1 : 1;
  return null;
}
