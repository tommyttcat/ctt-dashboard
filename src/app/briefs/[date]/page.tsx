import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BriefDetail from '../../../components/briefs/BriefDetail';
import {
  DATE_RE,
  allTickers,
  extractRegimeLabel,
  getArchiveDates,
  getArchivedBrief,
} from '../../../lib/briefArchive';

/**
 * Archived briefs never change once written, so these render as static pages
 * and refresh at most once a day. That keeps KV reads flat in traffic — a
 * crawler hitting 250 archive pages costs one read per page per day, not one
 * per request. dynamicParams lets a date archived after the last build still
 * render on first request.
 */
export const revalidate = 86400;
export const dynamicParams = true;

const SITE = 'https://app.confluencetradingtools.com';
const OG_IMAGE = 'https://confluencetradingtools.com/og-image.png';

/** Trim to a sentence boundary if there is one, otherwise a word boundary. */
function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const window = t.slice(0, max);
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '));
  if (sentence > max * 0.5) return window.slice(0, sentence + 1);
  const word = window.lastIndexOf(' ');
  return `${window.slice(0, word > 0 ? word : max).replace(/[,;:]$/, '')}\u2026`;
}

function longDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export async function generateStaticParams() {
  const dates = await getArchiveDates();
  return dates.slice(0, 90).map((date) => ({ date }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}): Promise<Metadata> {
  const { date } = await params;
  if (!DATE_RE.test(date)) return { title: 'Market Brief — Confluence Trading Tools' };

  const brief = await getArchivedBrief(date);
  const pretty = longDate(date);
  const canonical = `${SITE}/briefs/${date}`;

  if (!brief) {
    return {
      title: `Market Brief — ${pretty} | Confluence Trading Tools`,
      robots: { index: false, follow: true },
      alternates: { canonical },
    };
  }

  const regime = brief.regimeDetail?.regime
    ? extractRegimeLabel(brief.regimeDetail.regime)
    : null;
  const tickers = allTickers(brief, 6);
  const headline = brief.summary?.conviction?.[0]
    ? String(brief.summary.conviction[0]).replace(/\*\*/g, '')
    : brief.regimeDetail?.posture || '';

  // Unique per date — a shared title across every archived brief is what gets
  // these pages deduplicated out of the index.
  const title = regime
    ? `${pretty} Market Brief — ${regime} | Confluence Trading Tools`
    : `${pretty} Market Brief | Confluence Trading Tools`;

  const parts = [
    headline ? clip(headline, 150) : '',
    tickers.length ? `Tickers covered: ${tickers.join(', ')}.` : '',
  ].filter(Boolean);
  const description =
    parts.join(' ') ||
    `Market brief for ${pretty} — tape reading, regime context and setups.`;

  return {
    title,
    description,
    keywords: tickers.length ? tickers : undefined,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'article',
      publishedTime: brief.generatedAt,
      siteName: 'Confluence Trading Tools',
      images: [{ url: OG_IMAGE }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [OG_IMAGE],
    },
  };
}

export default async function BriefDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const brief = await getArchivedBrief(date);
  if (!brief) notFound();

  const pretty = longDate(date);
  const regime = brief.regimeDetail?.regime
    ? extractRegimeLabel(brief.regimeDetail.regime)
    : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: regime
      ? `${pretty} Market Brief — ${regime}`
      : `${pretty} Market Brief`,
    datePublished: brief.generatedAt,
    dateModified: brief.generatedAt,
    isAccessibleForFree: true,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE}/briefs/${date}` },
    author: { '@type': 'Organization', name: 'Confluence Trading Tools' },
    publisher: {
      '@type': 'Organization',
      name: 'Confluence Trading Tools',
      url: 'https://confluencetradingtools.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://confluencetradingtools.com/og-image.png',
      },
    },
    about: allTickers(brief, 8).map((t) => ({ '@type': 'Thing', name: t })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <BriefDetail date={date} brief={brief} />
    </>
  );
}
