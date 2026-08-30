'use client';

import { useState } from 'react';

const TIER_LABELS: Record<string, { name: string; color: string; desc: string }> = {
  starter: { name: 'Starter', color: '#818cf8', desc: 'Essential market briefings delivered to your inbox.' },
  core: { name: 'Core', color: '#34d399', desc: 'Briefings plus live dashboard access.' },
  pro: { name: 'Pro', color: '#fbbf24', desc: 'Everything. Full platform access.' },
};

export default function InvitePage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const code = params?.get('code');
  const tier = params?.get('tier');
  const tierInfo = tier ? TIER_LABELS[tier] : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const body: Record<string, string> = { email, name };
      if (code) body.code = code;
      if (tier) body.tier = tier;

      const res = await fetch('/api/invite/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }
      window.location.href = data.redirect;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!code && !tier) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-body)' }}>
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}
        >
          <a href="https://confluencetradingtools.com"><img src="/logo.svg" alt="CTT" className="h-8 mx-auto mb-4 ctt-logo" /></a>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text-heading)' }}>Invalid Invite</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            This invite link is missing a code. Please check the link and try again.
          </p>
          <a href="/login" className="inline-block mt-6 text-sm font-medium text-indigo-400 hover:text-indigo-300">
            Go to Sign In
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
          {tierInfo ? (
            <>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-heading)' }}>
                Start Your Free Trial
              </h1>
              <div className="mt-3 inline-block text-[11px] font-bold px-3 py-1 rounded-full tracking-wider" style={{ background: `${tierInfo.color}20`, color: tierInfo.color }}>
                {tierInfo.name} — 30 Days Free
              </div>
              <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                {tierInfo.desc}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-heading)' }}>
                You&apos;re Invited
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                Create your account to access Confluence Trading Tools
              </p>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
            Your Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="John Doe"
            required
            className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors mb-4"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', color: 'var(--text-body)' }}
          />

          <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', color: 'var(--text-body)' }}
          />

          {error && (
            <div className="mt-3 rounded-lg px-4 py-3 text-sm" style={{ background: '#4c051918', border: '1px solid #fb718530', color: '#fb7185' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !name || !email}
            className="w-full mt-4 rounded-lg px-4 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-50 cursor-pointer"
            style={{ background: tierInfo ? tierInfo.color : '#6366f1', color: tierInfo?.color === '#fbbf24' ? '#0b101a' : '#fff' }}
          >
            {loading ? 'Creating Account...' : tierInfo ? 'Start Free Trial' : 'Accept Invite'}
          </button>
        </form>

        <p className="text-center text-xs mt-8" style={{ color: 'var(--text-muted)' }}>
          Already have an account? <a href="/login" className="font-medium text-indigo-400 hover:text-indigo-300">Sign in</a>
        </p>
        <p className="text-center text-[10px] mt-4" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
          &copy; 2026 Confluence Trading Tools LLC
        </p>
      </div>
    </div>
  );
}
