import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Confluence Trading Tools Market Briefing',
  description: 'AI-powered market analysis from CTT Dashboard data',
};

export default function AnalystLayout({ children }: { children: React.ReactNode }) {
  return children;
}
