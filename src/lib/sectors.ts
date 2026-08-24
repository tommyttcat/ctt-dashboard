/* ---------------------------------------------------------------------------
   TWO LEVELS, deliberately.

   cleanSectorDescription below returns a THEMATIC label — Semi's, Fintech,
   Biotech, Aerospace — and that granularity is worth keeping: "Semi's" tells
   you more on a momentum table than "Technology" does.

   What was missing is a canonical level underneath it. /api/sectors speaks
   GICS-11 ("Technology", "Health Care", "Communication Services") while scan
   rows spoke a different vocabulary entirely — measured live on 2026-08-12:
   IT, Other, Aerospace, Fintech, Semi's, and free text that had leaked through
   like "SPCX - Aerospace 2X", "DRAM - Memory ETF" and "EWY - South Korea 3X".
   Nothing could be grouped or filtered across cards because no two surfaces
   agreed on what a sector was called.

   toCanonicalSector maps anything — theme, abbreviation, GICS name, or leaked
   ETF string — onto the same eleven words the sector card uses. Themes still
   display; they now also roll up.
   --------------------------------------------------------------------------- */

export const SECTORS = [
  'Technology', 'Financials', 'Energy', 'Health Care', 'Industrials',
  'Communication Services', 'Consumer Discretionary', 'Consumer Staples',
  'Real Estate', 'Utilities', 'Materials',
] as const;

export type CanonicalSector = (typeof SECTORS)[number] | 'Other';

/* Leading "TICKER - " and leveraged/inverse suffixes are artefacts of ETF
   names arriving in the sector field, not sector information. Stripped before
   any matching so "SOXX - Semi's 3X" and "Semi's" resolve identically. */
export const stripSectorNoise = (raw: string | null | undefined, ticker?: string): string => {
  if (!raw) return '';
  let s = String(raw).trim();
  if (ticker) s = s.replace(new RegExp(`^${ticker}\\s*[-–—:]\\s*`, 'i'), '');
  s = s.replace(/^[A-Z]{1,5}\s*[-–—:]\s*/, '');
  s = s.replace(/\s*\b[23]X\b\s*$/i, '');
  s = s.replace(/\s*\bETF\b\s*$/i, '');
  return s.trim();
};

/* Display form: noise stripped, theme preserved, em dash when there is
   nothing to show. This is the shared version of the cleanSector helper that
   had been copy-pasted into six components — one of which (Vcp) took no
   ticker argument and therefore never stripped the prefix at all. */
export const displaySector = (raw: string | null | undefined, ticker?: string): string => {
  if (!raw || raw === '—' || raw === '-') return '—';
  return stripSectorNoise(raw, ticker) || '—';
};

const THEME_TO_SECTOR: [RegExp, CanonicalSector][] = [
  [/^semi|semiconduct/i,               'Technology'],
  [/^it$|^tech|software|^ai$|cyber|quantum/i, 'Technology'],
  [/memory|dram|nand|storage/i,             'Technology'],
  [/fintech/i,                         'Financials'],
  [/crypto|bitcoin|blockchain/i,       'Financials'],
  [/^financ|bank|insur/i,              'Financials'],
  [/biotech|^health|pharma|medical/i,  'Health Care'],
  [/aerospace|defen[cs]e|industr|space|shipping|tanker|airline/i, 'Industrials'],
  /* Nuclear, uranium and solar sit under Energy here rather than being split
     between Utilities and Technology — on this dashboard they are traded as
     energy themes, and splitting them would put related names on opposite
     sides of a sector filter. */
  [/nuclear|uranium|solar|^energy|\boil\b|\bgas\b/i, 'Energy'],
  [/^ev$|auto|^con disc|consumer discretionary|retail/i, 'Consumer Discretionary'],
  [/^con staples|^staples|consumer staples|food|beverage/i, 'Consumer Staples'],
  [/^comm s|communication|media|telecom/i,              'Communication Services'],
  [/real es|reit/i,                                     'Real Estate'],
  [/utilit/i,                                           'Utilities'],
  [/material|mining|chemical|steel/i,                   'Materials'],
];

export const toCanonicalSector = (
  raw: string | null | undefined,
  ticker?: string
): CanonicalSector => {
  const s = stripSectorNoise(raw, ticker);
  if (!s) return 'Other';

  const exact = SECTORS.find(x => x.toLowerCase() === s.toLowerCase());
  if (exact) return exact;

  for (const [rx, sector] of THEME_TO_SECTOR) if (rx.test(s)) return sector;
  return 'Other';
};

export const cleanSectorDescription = (
  sic: string | undefined,
  sector: string | undefined,
  industry: string | undefined,
): string => {
  const ind = (industry || '').toLowerCase();
  const sicTxt = (sic || '').toLowerCase();
  const blob = `${ind} ${sicTxt}`;

  if (/nuclear|uranium/.test(blob)) return 'Nuclear';
  if (/solar|photovoltaic/.test(blob)) return 'Solar';
  if (/electric vehicle|auto manufacturer|motor vehicle|passenger car/.test(blob)) return 'EV';
  if (/biotechnolog|biological product|in vitro|medicinal chem/.test(blob)) return 'Biotech';
  if (/semiconductor/.test(blob)) return "Semi's";
  if (/artificial intelligence/.test(blob)) return 'AI';
  if (/cybersecurity|security software/.test(blob)) return 'Cyber';
  if (/fintech|financial technology|crypto|bitcoin|blockchain|digital asset|digital currency/.test(blob)) return 'Fintech';
  if (/aerospace|\bdefense\b|aircraft|guided missile|space vehicle/.test(blob)) return 'Aerospace';

  if (sicTxt) {
    if (/software|prepackaged|computer program|data processing|information retrieval|computer integrated|computer communication|electronic computer|computer peripheral|computer storage|computer terminal|electronic component|printed circuit/.test(sicTxt)) return 'Tech';
    if (/pharmaceutical|drug|medicinal|surgical|\bmedical\b|\bhealth\b|dental|hospital|diagnostic|laborator/.test(sicTxt)) return 'Health';
    if (/crude petroleum|natural gas|petroleum|drilling|\boil\b|\bcoal\b|\benergy\b/.test(sicTxt)) return 'Energy';
    if (/\bbank\b|savings instit|credit institution|insurance|investment office|securities broker|security broker|personal credit|holding compan|fire, marine/.test(sicTxt)) return 'Finance';
    if (/real estate|land subdivid|operators of apartment|operators of nonresident/.test(sicTxt)) return 'Real Est';
    if (/electric services|gas & other|water supply|cogeneration|electric & other services/.test(sicTxt)) return 'Utilities';
    if (/telephone|telecommunic|radio|television|broadcast|cable|motion picture|advertising|publishing|newspaper|periodical|entertainment/.test(sicTxt)) return 'Comm Svc';
    if (/retail|catalog|mail-order|eating place|restaurant|apparel|footwear|hotel|department store|grocery|variety store|jewelry/.test(sicTxt)) return 'Con Disc';
    if (/beverage|\bfood\b|tobacco|soap|cosmetic|household|dairy|bakery/.test(sicTxt)) return 'Staples';
    if (/gold mining|metal mining|steel|aluminum|chemical|industrial inorganic|plastics material|paper mill|fertilizer|\bmining\b/.test(sicTxt)) return 'Materials';
    if (/aircraft|machinery|industrial|construction|engineering|electrical industrial|transportation|railroad|trucking|air transport|switchgear|electronic connector|measuring|controlling instrument/.test(sicTxt)) return 'Industrl';
    if (/investment advice|investment counsel|commodity contract|security & commodity|mortgage banker|loan broker|services allied with|short-term business credit|functions related to depository/.test(sicTxt)) return 'Finance';
    if (/educational service|school|instruction/.test(sicTxt)) return 'Con Disc';
    if (/amusement|recreation|fitness|physical fitness|membership sport|bowling|racing/.test(sicTxt)) return 'Con Disc';
    if (/services-management|services-business services|services-help supply|services-misc/.test(sicTxt)) return 'Tech';
    if (/services-engineering|services-research|services-testing/.test(sicTxt)) return 'Tech';
  }

  const sec = (sector || '').toLowerCase();
  if (sec.includes('technology')) return 'Tech';
  if (sec.includes('healthcare') || sec.includes('health care')) return 'Health';
  if (sec.includes('financial')) return 'Finance';
  if (sec.includes('consumer discretionary')) return 'Con Disc';
  if (sec.includes('consumer staples')) return 'Staples';
  if (sec.includes('energy')) return 'Energy';
  if (sec.includes('materials')) return 'Materials';
  if (sec.includes('industrials')) return 'Industrl';
  if (sec.includes('real estate')) return 'Real Est';
  if (sec.includes('utilities')) return 'Utilities';
  if (sec.includes('communication')) return 'Comm Svc';

  return 'Other';
};

/* ---- Industry heat -------------------------------------------------------

   Average change per sector across a pool of rows, best group first — the
   aggregation behind both the dashboard's Industry Heat list and the Sector
   Performance bars, and now the briefing page's copies of the same.

   IT LIVES HERE SO THE TWO PAGES CANNOT DISAGREE. The dashboard computed this
   inline and the briefing page would have needed its own; that is exactly how
   parseSectorItems ended up in three files with two behaviours. The POOL is
   still the caller's choice — the two surfaces feed it different row sets —
   but the grouping, the exclusions and the ordering are one implementation.

   Grouped on the CANONICAL sector, not the raw label: raw values are thematic
   and inconsistent (IT, Semi's, Fintech and "SMCI - IT" each counted as their
   own sector), which split one group's heat across several rows and
   understated every count. */

export const isEtfSector = (sec: string | null | undefined): boolean => {
  if (!sec || sec === '—') return false;
  const s = String(sec);
  if (s === 'ETF' || s.includes('- ETF')) return true;
  if (/^[A-Z]{2,5}\s*-\s/.test(s)) return true;
  return false;
};

export interface SectorHeat { sector: string; avgChg: number; count: number }

export function industryHeat(
  rows: any[],
  chg: (row: any) => number = (r) => Number(r?.change ?? r?.changePct) || 0,
): SectorHeat[] {
  const agg: Record<string, { sum: number; count: number }> = {};
  (rows ?? []).forEach((s) => {
    const canon = toCanonicalSector(s?.sector, s?.ticker);
    const sec = s?.sector && s.sector !== '—' && canon !== 'Other' && !isEtfSector(s.sector) ? canon : null;
    if (!sec) return;
    if (!agg[sec]) agg[sec] = { sum: 0, count: 0 };
    agg[sec].sum += chg(s);
    agg[sec].count += 1;
  });
  return Object.entries(agg)
    .map(([sector, v]) => ({ sector, avgChg: v.sum / v.count, count: v.count }))
    .sort((a, b) => b.avgChg - a.avgChg);
}
