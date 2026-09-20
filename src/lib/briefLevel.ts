/* lib/briefLevel.ts — reading a price level off a brief.
 *
 * WHY THIS IS NOT JUST `Number(v)`
 * --------------------------------
 * A brief is JSON written by a model-driven routine, so its `trigger`,
 * `stop`, `target` and `rMultiple` are declared numbers but are not
 * guaranteed to be. On 14 Sep 2026 one run emitted them as strings
 * ("266.10"). `.toFixed` on a string is a TypeError, and a `!= null` guard
 * does not catch it — a string passes that test and then throws.
 *
 * The cost of getting this wrong is not a broken cell. /briefs/[date] is
 * statically generated, so the throw happened during prerender and failed
 * `next build`, which blocked EVERY deploy of the app from 14 to 20 Sep
 * while serving a 500 on that page.
 *
 * The write side is guarded now (normalizeBriefLevels, lib/setupLedger), so
 * nothing should reach a renderer unparseable again. This is the belt to
 * that pair of braces: briefs archived before the guard existed still hold
 * whatever they were written with.
 *
 * Pure, no imports — it is used by client components and must stay that way.
 */

/** A level as a number, or null when it cannot be read as one.
 *
 *  Only a number or a string can be a level. The narrowing matters more than
 *  it looks: `Number('')`, `Number(' ')`, `Number([])` and `Number(false)` are
 *  all 0, so without it an empty field would render as a $0.00 price rather
 *  than as the missing value it is. */
export const levelNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A level formatted for display; an em dash when absent or unreadable. */
export const levelText = (v: unknown, dp = 2): string => {
  const n = levelNum(v);
  return n != null && n !== 0 ? n.toFixed(dp) : '—';
};
