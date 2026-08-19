'use client';

import { useState } from 'react';

const ERRORS: Record<string, string> = {
  'missing-token': 'Invalid sign-in link.',
  'invalid-or-expired': 'This link has expired. Request a new one below.',
  'account-inactive': 'Your account is not active. Contact the administrator.',
};

const INFOS: Record<string, string> = {
  'email-only': 'Your subscription is email-only. Reports are delivered straight to your inbox — no login needed.',
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [showWaitlist, setShowWaitlist] = useState(false);
  const [wlName, setWlName] = useState('');
  const [wlEmail, setWlEmail] = useState('');
  const [wlType, setWlType] = useState<'general' | 'founder'>('general');
  const [wlMessage, setWlMessage] = useState('');
  const [wlLoading, setWlLoading] = useState(false);
  const [wlError, setWlError] = useState('');
  const [wlDone, setWlDone] = useState(false);

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const urlError = params?.get('error');
  const urlInfo = params?.get('info');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Something went wrong');
        return;
      }
      setSent(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setWlLoading(true);
    setWlError('');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: wlEmail, name: wlName, type: wlType, message: wlMessage }),
      });
      if (!res.ok) {
        const data = await res.json();
        setWlError(data.error || 'Something went wrong');
        return;
      }
      setWlDone(true);
    } catch {
      setWlError('Network error. Please try again.');
    } finally {
      setWlLoading(false);
    }
  }

  const inputStyle = {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-body)',
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-body)' }}>
      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div className="text-center mb-8">
          <img src="/logo.svg" alt="CTT" className="h-8 mx-auto mb-4 ctt-logo" />
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-heading)' }}>
            Confluence Trading Tools
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {showWaitlist ? 'Request access to the platform' : 'Sign in to access your dashboard'}
          </p>
        </div>

        {urlInfo && INFOS[urlInfo] && (
          <div className="mb-6 rounded-lg px-4 py-3 text-sm" style={{ background: '#042f2e30', border: '1px solid #34d39933', color: '#34d399' }}>
            {INFOS[urlInfo]}
          </div>
        )}

        {urlError && ERRORS[urlError] && (
          <div className="mb-6 rounded-lg px-4 py-3 text-sm" style={{ background: '#4c051918', border: '1px solid #fb718530', color: '#fb7185' }}>
            {ERRORS[urlError]}
          </div>
        )}

        {showWaitlist ? (
          wlDone ? (
            <div className="text-center">
              <div
                className="rounded-lg px-4 py-6 mb-4"
                style={{ background: '#042f2e30', border: '1px solid #34d39933' }}
              >
                <div className="text-2xl mb-2">&#x2705;</div>
                <p className="font-semibold text-emerald-400 mb-1">
                  {wlType === 'founder' ? "You're on the Founders list!" : "You're on the waitlist!"}
                </p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  We&apos;ll review your request and get back to you at <strong style={{ color: 'var(--text-body)' }}>{wlEmail}</strong>.
                </p>
              </div>
              <button
                onClick={() => { setShowWaitlist(false); setWlDone(false); }}
                className="text-sm font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                Back to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleWaitlist}>
              <div className="flex gap-2 mb-4">
                {(['general', 'founder'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setWlType(t)}
                    className="flex-1 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors cursor-pointer"
                    style={{
                      background: wlType === t ? (t === 'founder' ? '#fbbf2420' : '#6366f120') : 'var(--bg-panel)',
                      border: `1px solid ${wlType === t ? (t === 'founder' ? '#fbbf2466' : '#6366f166') : 'var(--border-subtle)'}`,
                      color: wlType === t ? (t === 'founder' ? '#fbbf24' : '#818cf8') : 'var(--text-muted)',
                    }}
                  >
                    {t === 'general' ? 'General Inquiry' : 'Founders (100 spots)'}
                  </button>
                ))}
              </div>

              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                Your Name
              </label>
              <input
                type="text"
                value={wlName}
                onChange={(e) => setWlName(e.target.value)}
                placeholder="John Doe"
                required
                className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors mb-3"
                style={inputStyle}
              />

              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                Email Address
              </label>
              <input
                type="email"
                value={wlEmail}
                onChange={(e) => setWlEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors mb-3"
                style={inputStyle}
              />

              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                Message <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
              </label>
              <textarea
                value={wlMessage}
                onChange={(e) => setWlMessage(e.target.value)}
                placeholder="Tell us about your trading experience..."
                rows={3}
                className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors resize-none"
                style={inputStyle}
              />

              {wlError && (
                <div className="mt-3 rounded-lg px-4 py-3 text-sm" style={{ background: '#4c051918', border: '1px solid #fb718530', color: '#fb7185' }}>
                  {wlError}
                </div>
              )}

              <button
                type="submit"
                disabled={wlLoading || !wlName || !wlEmail}
                className="w-full mt-4 rounded-lg px-4 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-50 cursor-pointer"
                style={{ background: wlType === 'founder' ? '#d97706' : '#6366f1' }}
              >
                {wlLoading ? 'Submitting...' : wlType === 'founder' ? 'Apply for Founder Access' : 'Join Waitlist'}
              </button>

              <button
                type="button"
                onClick={() => setShowWaitlist(false)}
                className="w-full mt-2 text-sm font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                Back to Sign In
              </button>
            </form>
          )
        ) : sent ? (
          <div className="text-center">
            <div
              className="rounded-lg px-4 py-6 mb-4"
              style={{ background: '#042f2e30', border: '1px solid #34d39933' }}
            >
              <div className="text-2xl mb-2">&#x2709;</div>
              <p className="font-semibold text-emerald-400 mb-1">Check your email</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                We sent a sign-in link to <strong style={{ color: 'var(--text-body)' }}>{email}</strong>.
                <br />The link expires in 15 minutes.
              </p>
            </div>
            <button
              onClick={() => { setSent(false); setEmail(''); }}
              className="text-sm font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors"
              style={inputStyle}
            />

            {error && (
              <p className="mt-2 text-sm text-rose-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full mt-4 rounded-lg px-4 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-50 cursor-pointer"
              style={{ background: '#6366f1' }}
            >
              {loading ? 'Sending...' : 'Send Sign-In Link'}
            </button>
          </form>
        )}

        <div className="text-center mt-6 pt-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {showWaitlist ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Already have an account? <button onClick={() => setShowWaitlist(false)} className="font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer">Sign in</button>
            </p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Don&apos;t have an account? <button onClick={() => setShowWaitlist(true)} className="font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer">Join the waitlist</button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
