import type { MetadataRoute } from 'next';
import { getArchiveDates } from '../lib/briefArchive';

/** Rebuilt hourly — a date archived at the close is listed within the hour. */
export const revalidate = 3600;

const SITE = 'https://app.confluencetradingtools.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const dates = await getArchiveDates();
  const newest = dates[0] ? new Date(`${dates[0]}T21:00:00Z`) : new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE}/briefs`, lastModified: newest, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE}/pricing`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/subscribe`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
  ];

  const briefPages: MetadataRoute.Sitemap = dates.map((date) => ({
    url: `${SITE}/briefs/${date}`,
    lastModified: new Date(`${date}T21:00:00Z`),
    changeFrequency: 'never' as const,
    priority: 0.8,
  }));

  return [...staticPages, ...briefPages];
}
