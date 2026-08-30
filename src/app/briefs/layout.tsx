import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Market Brief Archive — Confluence Trading Tools',
  description:
    'Daily AI-generated market analysis with tape reading, regime context, and actionable setups. Browse past briefs delayed 24 hours.',
  openGraph: {
    title: 'CTT Market Brief Archive',
    description: 'Browse daily AI analyst briefs — tape reading, regime calls, and top setups.',
    type: 'website',
  },
};

export default function BriefsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
