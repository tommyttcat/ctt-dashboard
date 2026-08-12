const CATALYST_TAGS = new Set([
  'Earnings', 'FDA / Data', 'M&A', 'Guidance', 'Contract', 'Product',
  'Offering', 'Legal / Risk', 'Analyst', 'Management',
]);

export function newsStarCount(row: {
  catalyst?: string | null;
  catalystUrl?: string | null;
  newsCausal?: boolean | null;
}): number {
  if (!row.catalystUrl && (!row.catalyst || row.catalyst === 'Technical Momentum')) return 0;
  const tag = (row.catalyst || '').replace(/ \(Delayed\)$/, '');
  if (CATALYST_TAGS.has(tag) && row.newsCausal) return 2;
  if (row.catalystUrl) return 1;
  return 0;
}
