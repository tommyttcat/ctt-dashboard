import React from 'react';
import { newsStarCount } from '@/lib/newsStars';

/* ---------------------------------------------------------------------------
   ONE definition of what a catalyst looks like.

   hasNews and newsTooltip were copy-pasted into seven components — DailySetups,
   Consolidation1021, Ep9m, TopMovers, SwingCandidates, StocksInPlay and Vcp —
   and had already drifted apart. That is the mechanical reason the same article
   rendered differently depending on which table you were looking at.

   The copies differed in exactly one way worth keeping: each closed with an
   interpretation specific to its scan, because negative news means something
   different on a coil than on a volume spike. That is a parameter here, not
   something flattened away.
   --------------------------------------------------------------------------- */

/* `news`, `headline` and `newsUrl` are the OLDER payload shape. Consolidation
   and SwingCandidates still read it through local accessors, so the fallbacks
   live here too — otherwise moving those tables onto this module would quietly
   drop their links whenever a row arrived in the old form. */
export type CatalystRow = {
  catalyst?: string | null;
  catalystUrl?: string | null;
  newsUrl?: string | null;
  newsPublisher?: string | null;
  newsAge?: string | null;
  newsSentiment?: string | null;
  newsCausal?: boolean | null;
  thesis?: string | null;
  news?: string | null;
  headline?: string | null;
};

export const headlineOf = (row: CatalystRow): string | null => {
  const raw = row.thesis ?? row.news ?? row.headline ?? null;
  if (!raw) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
};

export const catalystUrlOf = (row: CatalystRow): string | null =>
  row.catalystUrl ?? row.newsUrl ?? null;

/* Tags come from classifyNews in @/lib/indicators/news. Anything not listed —
   including the "Technical Momentum" placeholder that means no catalyst was
   found — deliberately renders nothing rather than an empty box. */
const CHIPS: Record<string, { label: string; hue: string }> = {
  'Earnings':     { label: 'EPS', hue: 'emerald' },
  'Guidance':     { label: 'GDE', hue: 'emerald' },
  'FDA / Data':   { label: 'FDA', hue: 'sky' },
  'M&A':          { label: 'M&A', hue: 'violet' },
  'Contract':     { label: 'CTR', hue: 'cyan' },
  'Product':      { label: 'PRD', hue: 'cyan' },
  'Analyst':      { label: 'ANL', hue: 'blue' },
  'Management':   { label: 'MGT', hue: 'slate' },
  'Offering':     { label: 'OFR', hue: 'rose' },
  'Legal / Risk': { label: 'LGL', hue: 'rose' },
};

/* Tailwind cannot see class names built by concatenation, so every hue that
   CHIPS can produce is written out here in full for the JIT to find. */
const HUE_CLASSES: Record<string, { dim: string; bright: string }> = {
  emerald: { dim: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', bright: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/40' },
  sky:     { dim: 'text-sky-400 bg-sky-500/10 border-sky-500/20',             bright: 'text-sky-300 bg-sky-500/20 border-sky-500/40' },
  violet:  { dim: 'text-violet-400 bg-violet-500/10 border-violet-500/20',    bright: 'text-violet-300 bg-violet-500/20 border-violet-500/40' },
  cyan:    { dim: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',          bright: 'text-cyan-300 bg-cyan-500/20 border-cyan-500/40' },
  blue:    { dim: 'text-blue-400 bg-blue-500/10 border-blue-500/20',          bright: 'text-blue-300 bg-blue-500/20 border-blue-500/40' },
  slate:   { dim: 'text-slate-400 bg-slate-500/10 border-slate-500/20',       bright: 'text-slate-300 bg-slate-500/20 border-slate-500/40' },
  rose:    { dim: 'text-rose-400 bg-rose-500/10 border-rose-500/20',          bright: 'text-rose-300 bg-rose-500/20 border-rose-500/40' },
};

export const isGenericCatalyst = (catalyst: string | null | undefined): boolean => {
  if (!catalyst) return true;
  const c = catalyst.toLowerCase().trim();
  return c.startsWith('technical momentum') || c === 'recent news' || c === 'news' || c === 'technical';
};

const baseTag = (catalyst: string | null | undefined): string =>
  (catalyst || '').replace(/\s*\(Delayed\)\s*$/i, '').trim();

/* A row has news only when there is a HEADLINE AND a link. An "Earnings" tag
   with no article behind it comes from the earnings calendar rather than the
   news feed — real information, but nothing to open, and a chip that clicks
   through to nothing is worse than no chip. */
export const hasNews = (row: CatalystRow, headline?: string | null): boolean =>
  !!((headline ?? headlineOf(row)) && catalystUrlOf(row));

/* One tooltip for the chip and the sub-row, so the two can never describe the
   same article differently. `note` is the scan-specific reading of negative
   news; `neutralNote` covers the case where a scan has something to say about
   news that did NOT move the price. */
export const catalystTooltip = (
  row: CatalystRow,
  opts: { headline?: string | null; note?: string; neutralNote?: string } = {}
): string => {
  const headline = opts.headline ?? headlineOf(row);
  if (!headline) return '';

  const meta = [row.catalyst, row.newsPublisher, row.newsAge].filter(Boolean).join(' · ');
  const lines: string[] = [];
  if (meta) { lines.push(meta); lines.push(''); }
  lines.push(String(headline));

  const negative = row.newsSentiment === 'negative';
  if (negative && opts.note) { lines.push(''); lines.push(opts.note); }
  else if (!negative && opts.neutralNote) { lines.push(''); lines.push(opts.neutralNote); }

  return lines.join('\n');
};

/* Replaces both the N star column and the catalyst text column. Renders null
   when there is no real catalyst, so a table full of technical-only names
   costs no width at all — which was the point of removing the column. */
export function CatalystChip({
  row,
  headline,
  note,
  neutralNote,
  className = '',
}: {
  row: CatalystRow;
  headline?: string | null;
  note?: string;
  neutralNote?: string;
  className?: string;
}) {
  const tag = baseTag(row.catalyst);
  if (isGenericCatalyst(tag) || !hasNews(row, headline)) return null;

  const chip = CHIPS[tag];
  if (!chip) return null;

  /* Negative news reads rose whatever the category says: an offering and a
     downgrade should look the same at a glance, which is as a warning. */
  const hue = row.newsSentiment === 'negative' ? 'rose' : chip.hue;
  const stars = newsStarCount(row);
  const cls = HUE_CLASSES[hue][stars >= 2 ? 'bright' : 'dim'];
  const delayed = /\(Delayed\)\s*$/i.test(row.catalyst || '');

  const chipEl = (
    <span
      className={`inline-block rounded border px-1 leading-none text-[7px] font-bold tracking-wide ${cls} ${delayed ? 'opacity-60' : ''} ${className}`}
      title={catalystTooltip(row, { headline, note, neutralNote })}
    >
      {chip.label}
    </span>
  );

  const url = catalystUrlOf(row);
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:brightness-125 transition-all"
      onClick={e => e.stopPropagation()}
    >
      {chipEl}
    </a>
  ) : chipEl;
}
