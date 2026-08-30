'use client';

import { useState } from 'react';

const TIER_INFO: Record<string, { name: string; color: string; desc: string }> = {
  starter: { name: 'Starter', color: '#818cf8', desc: 'Essential market briefings delivered to your inbox.' },
  indicators: { name: 'TV Indicators', color: '#06b6d4', desc: '4 professional TradingView indicators.' },
  core: { name: 'Core', color: '#34d399', desc: 'Briefings plus live dashboard access.' },
  'core-max': { name: 'Core Max', color: '#34d399', desc: 'Briefings, dashboard, and TradingView indicators.' },
  pro: { name: 'Pro', color: '#fbbf24', desc: 'Everything. Full platform access.' },
  'pro-max': { name: 'Pro Max', color: '#fbbf24', desc: 'Full platform access with TradingView indicators.' },
};

const PRICES: Record<string, { monthly: number; yearly: number }> = {
  starter: { monthly: 9.99, yearly: 7.99 },
  indicators: { monthly: 14.99, yearly: 11.99 },
  core: { monthly: 24.99, yearly: 19.99 },
  'core-max': { monthly: 34.99, yearly: 27.99 },
  pro: { monthly: 39.00, yearly: 29.99 },
  'pro-max': { monthly: 49.00, yearly: 39.00 },
};

const INDICATOR_TIERS = new Set(['indicators', 'core-max', 'pro-max']);

export default function SubscribePage() {
  const [email, setEmail] = useState('');
  const [tvUsername, setTvUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const tier = params?.get('tier') || 'core';
  const period = params?.get('period') || 'yearly';
  const info = TIER_INFO[tier] || TIER_INFO.core;
  const price = PRICES[tier] || PRICES.core;
  const displayPrice = period === 'yearly' ? price.yearly : price.monthly;
  const needsTvUsername = INDICATOR_TIERS.has(tier);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('Please enter a valid email');
      return;
    }
    if (needsTvUsername && !tvUsername.trim()) {
      setError('TradingView username is required for indicator access');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, period, email, ...(needsTvUsername && { tvUsername: tvUsername.trim() }) }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!TIER_INFO[tier]) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-body)' }}>
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}
        >
          <a href="https://confluencetradingtools.com"><img src="/logo.svg" alt="CTT" className="h-8 mx-auto mb-4 ctt-logo" /></a>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text-heading)' }}>Invalid Plan</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            This plan doesn&apos;t exist. Please choose a plan from the pricing page.
          </p>
          <a href="/pricing" className="inline-block mt-6 text-sm font-medium text-indigo-400 hover:text-indigo-300">
            View Plans
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-body)' }}>
      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="text-center mb-8">
          <a href="https://confluencetradingtools.com"><img src="/logo.svg" alt="CTT" className="h-8 mx-auto mb-4 ctt-logo" /></a>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-heading)' }}>
            Start Your Free Trial
          </h1>
          <div
            className="mt-3 inline-block text-[11px] font-bold px-3 py-1 rounded-full tracking-wider"
            style={{ background: `${info.color}20`, color: info.color }}
          >
            {info.name} — {tier === 'indicators' ? '7' : '14'} Days Free
          </div>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            {info.desc}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Then ${displayPrice.toFixed(2)}/mo{period === 'yearly' ? ` (billed annually at $${(price.yearly * 12).toFixed(2)}/yr)` : ''}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
            className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', color: 'var(--text-body)' }}
          />

          {needsTvUsername && (
            <div className="mt-4">
              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                TradingView Username
              </label>
              <input
                type="text"
                value={tvUsername}
                onChange={(e) => setTvUsername(e.target.value)}
                placeholder="Your TradingView username"
                required
                className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors"
                style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', color: 'var(--text-body)' }}
              />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                We&apos;ll grant indicator access to this TradingView account.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg px-4 py-3 text-sm" style={{ background: '#4c051918', border: '1px solid #fb718530', color: '#fb7185' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email}
            className="w-full mt-4 rounded-lg px-4 py-3 text-sm font-bold transition-opacity disabled:opacity-50 cursor-pointer"
            style={{ background: info.color, color: info.color === '#fbbf24' ? '#0b101a' : '#fff' }}
          >
            {loading ? 'Redirecting to checkout...' : 'Continue to Checkout'}
          </button>

          <p className="text-center text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
            You won&apos;t be charged during your 14-day trial. Cancel anytime.
          </p>
        </form>

        <div className="mt-8 pt-6 text-center" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Already have an account? <a href="/login" className="font-medium text-indigo-400 hover:text-indigo-300">Sign in</a>
          </p>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            <a href="/pricing" className="font-medium text-indigo-400 hover:text-indigo-300">Compare plans</a>
          </p>
          <p className="text-[10px] mt-4" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
            &copy; 2026 Confluence Trading Tools LLC
          </p>
        </div>
      </div>
    </div>
  );
}
