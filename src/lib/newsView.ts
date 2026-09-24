/* lib/newsView.ts — the pure pieces behind the News page's presentation.
 *
 * Kept out of the component so they can be tested without a DOM: how a tag is
 * named and coloured, how an age reads, and the one-line summary the hero card
 * leads with. Nothing here fetches, caches or touches KV.
 */

/* ---- Tags ----------------------------------------------------------------
   Two feeds, two vocabularies. The wire (/api/news) tags in upper case —
   FDA, EARNINGS, WIIM, UPGRADE… — and the scan catalysts (/api/news/pool) use
   classifyNews's labels — 'FDA / Data', 'Earnings', 'M&A'… Both fold into one
   key so a filter pill and a colour mean the same thing in either section. */

export type NewsTag =
  | 'fda' | 'earnings' | 'guidance' | 'mna' | 'wiim' | 'upgrade' | 'downgrade'
  | 'analyst' | 'macro' | 'offering' | 'insider' | 'business' | 'mgmt' | 'legal'
  | 'general';

type TagMeta = { label: string; one: string; many: string; cls: string };

/* Written out in full: Tailwind cannot see a class built by concatenation. */
export const TAG_META: Record<NewsTag, TagMeta> = {
  fda:       { label: 'FDA',             one: 'FDA',                    many: 'FDA',                     cls: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  earnings:  { label: 'Earnings',        one: 'earnings',               many: 'earnings',                cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  guidance:  { label: 'Guidance',        one: 'guidance update',        many: 'guidance updates',        cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  mna:       { label: 'M&A',             one: 'takeover report',        many: 'takeover reports',        cls: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
  wiim:      { label: "Why it's moving", one: "why-it's-moving story",  many: "why-it's-moving stories", cls: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
  upgrade:   { label: 'Upgrade',         one: 'upgrade',                many: 'upgrades',                cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  downgrade: { label: 'Downgrade',       one: 'downgrade',              many: 'downgrades',              cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  analyst:   { label: 'Analyst',         one: 'analyst note',           many: 'analyst notes',           cls: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
  macro:     { label: 'Macro',           one: 'macro story',            many: 'macro stories',           cls: 'text-slate-400 bg-slate-500/10 border-slate-500/20' },
  offering:  { label: 'Offering',        one: 'share offering',         many: 'share offerings',         cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  insider:   { label: 'Insider',         one: 'insider trade',          many: 'insider trades',          cls: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
  business:  { label: 'Contract / product', one: 'contract or product win', many: 'contract or product wins', cls: 'text-lime-400 bg-lime-500/10 border-lime-500/20' },
  mgmt:      { label: 'Management',      one: 'management change',      many: 'management changes',      cls: 'text-slate-400 bg-slate-500/10 border-slate-500/20' },
  legal:     { label: 'Legal / risk',    one: 'legal or risk story',    many: 'legal or risk stories',   cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  general:   { label: 'General',         one: 'general headline',       many: 'general headlines',       cls: 'text-slate-400 bg-slate-500/10 border-slate-500/20' },
};

const WIRE_TAGS: Record<string, NewsTag> = {
  'FDA': 'fda', 'EARNINGS': 'earnings', 'GUIDANCE': 'guidance', 'M&A': 'mna',
  'WIIM': 'wiim', 'UPGRADE': 'upgrade', 'DOWNGRADE': 'downgrade', 'MACRO': 'macro',
  'OFFERING': 'offering', 'INSIDER': 'insider',
};

const POOL_TAGS: Record<string, NewsTag> = {
  'earnings': 'earnings', 'guidance': 'guidance', 'fda / data': 'fda', 'm&a': 'mna',
  'contract': 'business', 'product': 'business', 'analyst': 'analyst',
  'management': 'mgmt', 'offering': 'offering', 'legal / risk': 'legal',
};

/** One key for either feed's tag. Anything unrecognised — including the
    'TECH MOMENTUM' / 'Technical Momentum' placeholder that means "no category
    found" — is 'general' rather than a guess. */
export function tagOf(raw: string | null | undefined): NewsTag {
  const s = String(raw ?? '').replace(/\s*\(Delayed\)\s*$/i, '').trim();
  if (!s) return 'general';
  return WIRE_TAGS[s.toUpperCase()] ?? POOL_TAGS[s.toLowerCase()] ?? 'general';
}

/** Counts per tag, most-cited first; ties keep the order tags first appeared. */
export function tagCounts(tags: NewsTag[]): { tag: NewsTag; n: number }[] {
  const m = new Map<NewsTag, number>();
  for (const t of tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n);
}

/** "5 why-it's-moving stories · 1 FDA · 1 earnings" — the hero's one line.
    General headlines are left out: they are what the line is filtering past. */
export function tapeLine(counts: { tag: NewsTag; n: number }[], max = 4): string {
  const parts = counts
    .filter(c => c.tag !== 'general' && c.n > 0)
    .slice(0, max)
    .map(c => `${c.n} ${c.n === 1 ? TAG_META[c.tag].one : TAG_META[c.tag].many}`);
  return parts.join(' · ');
}

/* ---- Time ----------------------------------------------------------------- */

/** Minutes between an ISO timestamp and `now`; null when unparseable. Future
    timestamps (clock skew) read as zero rather than negative. */
export function minutesSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 60000));
}

/** The scan rows carry only the label the scanner printed ("8h ago",
    "15m ago", "2d ago", "just now"), not a timestamp. Parse it back to
    minutes; null when it cannot be read. */
export function ageLabelMinutes(label: string | null | undefined): number | null {
  const s = String(label ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'just now' || s === 'now') return 0;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2][0];
  return Math.round(u === 'm' ? n : u === 'h' ? n * 60 : n * 1440);
}

/** "just now", "12 min ago", "3 hr ago", "1 day ago", "4 days ago". */
export function relTime(mins: number | null | undefined): string {
  if (mins == null || !Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** The calendar date in New York for an instant, as YYYY-MM-DD. "Today" on a
    US-market page means the trading day's date, not the reader's. */
export function etDateKey(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

/* ---- Numbers -------------------------------------------------------------- */

/** "+4.3%" / "-1.2%" / "0.0%"; empty when unknown. */
export function fmtMove(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}
