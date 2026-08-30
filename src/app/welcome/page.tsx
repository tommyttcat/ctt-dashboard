'use client';

import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';

const TIERS = {
  starter: {
    name: 'Starter',
    color: '#818cf8',
    price: { monthly: 9.99, yearly: 7.99 },
    headline: 'Your briefings are on the way',
    description: 'Market analysis delivered straight to your inbox — no login needed.',
    features: [
      'Morning Briefing Email',
      'Midday Update Email',
      'Closing Print Email',
      'AI-Powered Market Analysis',
    ],
    cta: { label: 'View Pricing Plans', href: '/pricing' },
    showDashboardLink: false,
  },
  core: {
    name: 'Core',
    color: '#34d399',
    price: { monthly: 24.99, yearly: 19.99 },
    headline: 'Your dashboard is ready',
    description: 'Full briefings plus live market data at your fingertips.',
    features: [
      'All Session Email Updates',
      'Market Briefing Page Access',
      'Scorecard & Regime Scoring',
      'Top Movers & Stocks In Play',
      'Dollar Volume & Sector Performance',
      'Key Events Calendar',
    ],
    cta: { label: 'Go to Dashboard', href: '/dashboard' },
    showDashboardLink: true,
  },
  pro: {
    name: 'Pro',
    color: '#fbbf24',
    price: { monthly: 39.00, yearly: 29.99 },
    headline: 'Full access unlocked',
    description: 'Every scanner, every signal, every edge — it\'s all yours.',
    features: [
      'Full Dashboard & All Scanners',
      'Confluence Report',
      'Daily Setups, VCP & Swing Candidates',
      'Multibagger & EP9M Scanners',
      'Session Tape Reading',
      'Hidden Relative Strength Scanner',
      'Earnings Calendar',
    ],
    cta: { label: 'Go to Dashboard', href: '/dashboard' },
    showDashboardLink: true,
  },
} as const;

type TierKey = keyof typeof TIERS;

function WelcomeContent() {
  const params = useSearchParams();
  const tierKey = (params.get('tier') || 'core') as TierKey;
  const tier = TIERS[tierKey] || TIERS.core;
  const isStarter = tierKey === 'starter';
  const isPro = tierKey === 'pro';
  const [portalLoading, setPortalLoading] = useState(false);

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // fall back to pricing page
      window.location.href = '/pricing';
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: 'var(--bg-body)' }}>
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <a href="https://confluencetradingtools.com"><img src="/logo.svg" alt="CTT" className="h-8 mx-auto ctt-logo" /></a>
        </div>

        {/* Success card */}
        <div
          className="rounded-2xl p-8 text-center"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* Checkmark */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ background: `${tier.color}18`, border: `2px solid ${tier.color}40` }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={tier.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>

          {/* Tier badge */}
          <div
            className="inline-block text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4"
            style={{ background: `${tier.color}20`, color: tier.color, border: `1px solid ${tier.color}40` }}
          >
            {tier.name} Plan
          </div>

          {/* Headline */}
          <h1 className="text-2xl font-extrabold mb-2" style={{ color: 'var(--text-heading)' }}>
            {tier.headline}
          </h1>
          <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
            {tier.description}
          </p>

          {/* What's included */}
          <div className="text-left mb-8">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
              What&apos;s included
            </p>
            <ul className="space-y-2.5">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-xs" style={{ color: 'var(--text-body)' }}>
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke={tier.color} strokeWidth="2.5" strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Primary CTA */}
          <a
            href={tier.cta.href}
            className="block w-full rounded-lg px-4 py-3 text-sm font-bold text-center no-underline transition-opacity"
            style={{
              background: tier.color,
              color: '#0b101a',
              textDecoration: 'none',
            }}
          >
            {tier.cta.label}
          </a>

          {/* Starter email-only note */}
          {isStarter && (
            <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
              Your reports are delivered by email — check your inbox before the open.
            </p>
          )}
        </div>

        {/* Upgrade card (Starter and Core only) */}
        {!isPro && (
          <div
            className="rounded-2xl p-6 mt-4"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div className="flex items-start gap-4">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: '#fbbf2418', border: '1px solid #fbbf2430' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-heading)' }}>
                  Upgrade anytime
                </p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Move to {isStarter ? 'Core or Pro' : 'Pro'} whenever you&apos;re ready.
                  You&apos;ll only pay the pro-rated difference for the rest of your billing cycle — no double charges, no hassle.
                </p>
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="mt-3 rounded-lg px-4 py-2 text-xs font-bold cursor-pointer disabled:opacity-50"
                  style={{ background: '#fbbf24', color: '#0b101a', border: 'none' }}
                >
                  {portalLoading ? 'Loading...' : 'Upgrade Plan'}
                </button>
                <a
                  href="/pricing"
                  className="inline-block ml-3 mt-3 text-xs font-semibold no-underline"
                  style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
                >
                  Compare plans &rarr;
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-6">
          <button
            onClick={openPortal}
            disabled={portalLoading}
            className="text-xs font-medium cursor-pointer disabled:opacity-50"
            style={{ color: '#818cf8', background: 'none', border: 'none' }}
          >
            Manage Subscription
          </button>
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            Questions? Email{' '}
            <a href="mailto:info@confluencetradingtools.com" className="font-medium" style={{ color: '#818cf8', textDecoration: 'none' }}>
              info@confluencetradingtools.com
            </a>
          </p>
          <p className="text-[10px] mt-3" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
            &copy; 2026 Confluence Trading Tools LLC
          </p>
        </div>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: 'var(--bg-body)' }} />}>
      <WelcomeContent />
    </Suspense>
  );
}
