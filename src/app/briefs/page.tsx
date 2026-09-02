import type { Metadata } from 'next';
import BriefsIndex from '../../components/briefs/BriefsIndex';
import { getArchiveDates, getArchivedBriefs, summarizeBrief } from '../../lib/briefArchive';

/**
 * Rebuilt hourly so a newly archived date shows up without a deploy. One KV
 * read for the index plus one mget for the cards, per hour — not per visitor.
 */
export const revalidate = 3600;

const SITE = 'https://app.confluencetradingtools.com';

export const metadata: Metadata = {
  title: 'Market Brief Archive — Daily Analysis & Setups | Confluence Trading Tools',
  description:
    'Free archive of daily market briefs: tape reading by session phase, regime context, sector flow and the setups that were flagged. Published 24 hours after the live brief.',
  alternates: { canonical: `${SITE}/briefs` },
  openGraph: {
    title: 'CTT Market Brief Archive',
    description:
      'Browse daily market briefs — tape reading, regime calls, sector flow and flagged setups.',
    url: `${SITE}/briefs`,
    type: 'website',
    siteName: 'Confluence Trading Tools',
    images: [{ url: 'https://confluencetradingtools.com/og-image.png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CTT Market Brief Archive',
    description: 'Daily market briefs — tape reading, regime calls and flagged setups.',
    images: ['https://confluencetradingtools.com/og-image.png'],
  },
};

export default async function BriefsPage() {
  const dates = (await getArchiveDates()).slice(0, 30);
  const briefs = await getArchivedBriefs(dates);
  const summaries = dates
    .map((date, i) => (briefs[i] ? summarizeBrief(date, briefs[i]) : null))
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Market Brief Archive',
    url: `${SITE}/briefs`,
    isAccessibleForFree: true,
    publisher: {
      '@type': 'Organization',
      name: 'Confluence Trading Tools',
      url: 'https://confluencetradingtools.com',
    },
    hasPart: summaries.map((s) => ({
      '@type': 'Article',
      headline: s.headline,
      url: `${SITE}/briefs/${s.date}`,
      datePublished: s.date,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <BriefsIndex briefs={summaries} />
    </>
  );
}
