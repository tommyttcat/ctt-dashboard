import type { MetadataRoute } from 'next';

/**
 * The app subdomain had no robots.txt at all, so nothing pointed a crawler at
 * the public brief archive. Everything behind the tier gate in middleware.ts is
 * disallowed — those paths only ever redirect a crawler to /login, which wastes
 * crawl budget on the pages that can actually rank.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/briefs', '/briefs/'],
        disallow: [
          '/api/',
          '/admin',
          '/dashboard',
          '/analyst',
          '/confluence',
          '/scanners',
          '/invite',
          '/welcome',
          '/login',
        ],
      },
    ],
    sitemap: 'https://app.confluencetradingtools.com/sitemap.xml',
    host: 'https://app.confluencetradingtools.com',
  };
}
