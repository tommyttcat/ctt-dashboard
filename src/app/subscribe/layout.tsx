import type { Metadata } from 'next';

/**
 * /subscribe is a checkout step, not a landing page — it only makes sense with
 * a tier already chosen on /pricing, so every parameterless crawl of it is a
 * thin near-duplicate of /pricing. Noindexed here and dropped from sitemap.ts;
 * `follow` stays on so the links out of it still pass through.
 */
export const metadata: Metadata = {
  title: 'Checkout — Confluence Trading Tools',
  description: 'Complete your Confluence Trading Tools subscription.',
  robots: { index: false, follow: true },
};

export default function SubscribeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
