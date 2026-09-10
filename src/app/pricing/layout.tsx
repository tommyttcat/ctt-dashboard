import type { Metadata } from 'next';

const SITE = 'https://app.confluencetradingtools.com';

/**
 * `page.tsx` is a client component, so its metadata lives here — the same split
 * already used by the brief archive. Without this the page inherited the root
 * layout's generic "Confluence Trading Tools" title and had no canonical at
 * all, which made it and /subscribe read as duplicates of each other in Search
 * Console and kept both at "Discovered — currently not indexed".
 */
export const metadata: Metadata = {
  title: 'Pricing — Market Briefings, Scanners & TradingView Indicators | Confluence Trading Tools',
  description:
    'Plans from $9.99/mo: daily market briefing emails, the live scanner dashboard, and four professional TradingView indicators. Monthly or yearly, cancel anytime.',
  alternates: { canonical: `${SITE}/pricing` },
  openGraph: {
    title: 'CTT Pricing — Briefings, Scanners & Indicators',
    description:
      'Daily market briefings, a live scanner dashboard, and four TradingView indicators. Plans from $9.99/mo.',
    url: `${SITE}/pricing`,
    type: 'website',
    siteName: 'Confluence Trading Tools',
    images: [{ url: 'https://confluencetradingtools.com/og-image.png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CTT Pricing — Briefings, Scanners & Indicators',
    description: 'Daily market briefings, live scanners and TradingView indicators from $9.99/mo.',
    images: ['https://confluencetradingtools.com/og-image.png'],
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
