'use client';

import { useState } from 'react';

const TV_INDICATOR_FEATURES = [
  'OR & Period Levels Indicator',
  'VPCI — Volume Price Confluence',
  'RMVE — Relative Measured Volatility',
  'BDRD — Dynamic Buy/Red Dot S/R',
];

const plans = [
  {
    name: 'Starter',
    tier: 'starter',
    monthly: 9.99,
    yearly: 7.99,
    description: 'Essential market briefings delivered to your inbox.',
    features: [
      'Morning Briefing Email',
      'Midday Update Email',
      'Closing Print Email',
      'AI-Powered Market Analysis',
    ],
    excluded: [
      'Dashboard Access',
      'Scanner Access',
      'TradingView Indicators',
    ],
    color: '#818cf8',
    popular: false,
    hasMax: false,
  },
  {
    name: 'TV Indicators',
    tier: 'indicators',
    monthly: 14.99,
    yearly: 11.99,
    description: '4 professional TradingView indicators.',
    features: [
      ...TV_INDICATOR_FEATURES,
    ],
    excluded: [
      'Email Briefings',
      'Dashboard Access',
      'Scanner Access',
    ],
    color: '#06b6d4',
    popular: false,
    hasMax: false,
  },
  {
    name: 'Core',
    tier: 'core',
    monthly: 24.99,
    yearly: 19.99,
    maxMonthly: 34.99,
    maxYearly: 27.99,
    description: 'Briefings plus live dashboard access.',
    features: [
      'All Starter Features',
      'All Session Email Updates',
      'Market Briefing Page Access',
      'Scorecard & Regime Scoring',
      'Top Movers',
      'Stocks In Play',
      'Dollar Volume',
      'Sector Performance & Rotation',
      'Key Events',
    ],
    excluded: [
      'Full Scanner Access',
      'Confluence Report',
    ],
    color: '#34d399',
    popular: true,
    hasMax: true,
  },
  {
    name: 'Pro',
    tier: 'pro',
    monthly: 39.00,
    yearly: 29.99,
    maxMonthly: 49.00,
    maxYearly: 39.00,
    description: 'Everything. Full platform access.',
    features: [
      'All Core Features',
      'Full Dashboard & Scanners',
      'Confluence Report',
      'Daily Setups, VCP, Swing Candidates',
      'Multibagger & EP9M Scanners',
      'Session Tape Reading',
      'Stocks In Play Scanner',
      'Dollar Volume Scanner',
      'Consolidation 10/21 EMA Scanner',
      'Hidden Relative Strength Scanner',
      'Setup Confluence Scanner',
      'Earnings Calendar',
    ],
    excluded: [],
    color: '#fbbf24',
    popular: false,
    hasMax: true,
  },
];

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);
  const [maxToggle, setMaxToggle] = useState<Record<string, boolean>>({});

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-body)' }}>
      {/* Header */}
      <div className="text-center pt-12 pb-8 px-4">
        <a href="https://confluencetradingtools.com" style={{ textDecoration: 'none' }}>
          <img src="/logo.svg" alt="CTT" className="h-10 mx-auto mb-4 ctt-logo" />
        </a>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight" style={{ color: 'var(--text-heading)' }}>
          Simple, transparent pricing
        </h1>
        <p className="mt-3 text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
          Professional trading tools for every level. Start with a 14-day free trial.
        </p>

        {/* Toggle */}
        <div className="flex items-center justify-center gap-3 mt-8">
          <span className="text-sm font-medium" style={{ color: annual ? 'var(--text-muted)' : 'var(--text-heading)' }}>Monthly</span>
          <button
            onClick={() => setAnnual(!annual)}
            className="relative w-12 h-6 rounded-full transition-colors cursor-pointer"
            style={{ background: annual ? '#6366f1' : 'var(--border-subtle)' }}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform"
              style={{ left: annual ? '26px' : '2px' }}
            />
          </button>
          <span className="text-sm font-medium" style={{ color: annual ? 'var(--text-heading)' : 'var(--text-muted)' }}>
            Yearly
            <span className="ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: '#6366f120', color: '#818cf8' }}>Save 20%</span>
          </span>
        </div>
      </div>

      {/* Plans */}
      <div className="max-w-6xl mx-auto px-4 pb-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {plans.map((plan) => {
          const isMax = maxToggle[plan.tier] || false;
          const displayMonthly = isMax && plan.hasMax ? plan.maxMonthly! : plan.monthly;
          const displayYearly = isMax && plan.hasMax ? plan.maxYearly! : plan.yearly;
          const price = annual ? displayYearly : displayMonthly;
          const tierParam = isMax ? `${plan.tier}-max` : plan.tier;
          const displayName = isMax ? `${plan.name} Max` : plan.name;

          return (
            <div
              key={plan.tier}
              className="rounded-2xl p-6 flex flex-col relative"
              style={{
                background: 'var(--bg-surface)',
                border: plan.popular ? `2px solid ${plan.color}` : '1px solid var(--border-subtle)',
                boxShadow: plan.popular ? `0 0 40px ${plan.color}15` : 'var(--shadow-card)',
              }}
            >
              {plan.popular && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
                  style={{ background: plan.color, color: '#0b101a' }}
                >
                  Most Popular
                </div>
              )}

              <div className="mb-5">
                <h3 className="text-lg font-bold" style={{ color: plan.color }}>{displayName}</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{plan.description}</p>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold" style={{ color: 'var(--text-heading)' }}>
                    ${price.toFixed(2)}
                  </span>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>/mo</span>
                </div>
                {annual && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Billed annually at ${(displayYearly * 12).toFixed(2)}/yr
                  </p>
                )}
              </div>

              {/* Max toggle for Core and Pro */}
              {plan.hasMax && (
                <button
                  onClick={() => setMaxToggle((prev) => ({ ...prev, [plan.tier]: !prev[plan.tier] }))}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 mb-4 text-xs font-medium transition-colors cursor-pointer"
                  style={{
                    background: isMax ? '#06b6d415' : 'var(--bg-panel)',
                    border: isMax ? '1px solid #06b6d440' : '1px solid var(--border-subtle)',
                    color: isMax ? '#06b6d4' : 'var(--text-muted)',
                  }}
                >
                  <span
                    className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-colors"
                    style={{
                      background: isMax ? '#06b6d4' : 'transparent',
                      border: isMax ? '1px solid #06b6d4' : '1px solid var(--border-subtle)',
                    }}
                  >
                    {isMax && (
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#0b101a" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                    )}
                  </span>
                  + TV Indicators (+$10/mo)
                </button>
              )}

              <a
                href={`/subscribe?tier=${tierParam}&period=${annual ? 'yearly' : 'monthly'}`}
                className="block text-center rounded-lg px-4 py-3 text-sm font-bold transition-opacity cursor-pointer no-underline"
                style={{
                  background: plan.popular ? plan.color : 'transparent',
                  color: plan.popular ? '#0b101a' : plan.color,
                  border: plan.popular ? 'none' : `1px solid ${plan.color}50`,
                  textDecoration: 'none',
                }}
              >
                {plan.tier === 'indicators' ? 'Start 7-Day Free Trial' : 'Start Free Trial'}
              </a>

              <div className="mt-6 pt-5 flex-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                  What&apos;s included
                </p>
                <ul className="space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-body)' }}>
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke={plan.color} strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                      {f}
                    </li>
                  ))}
                  {isMax && TV_INDICATOR_FEATURES.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-body)' }}>
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                      {f}
                    </li>
                  ))}
                  {plan.excluded.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="max-w-2xl mx-auto px-4 pb-16 text-center">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          All plans include a 14-day free trial. Cancel anytime. Questions? Email{' '}
          <a href="mailto:info@confluencetradingtools.com" style={{ color: '#818cf8', textDecoration: 'none' }}>
            info@confluencetradingtools.com
          </a>
        </p>
        <p className="text-[10px] mt-3" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
          &copy; 2026 Confluence Trading Tools LLC
        </p>
      </div>
    </div>
  );
}
