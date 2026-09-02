'use client';

import { useState, useEffect, useCallback } from 'react';

interface EmailPrefs {
  pre: boolean;
  morning: boolean;
  midday: boolean;
  power: boolean;
  closing: boolean;
  weekly: boolean;
}

const DEFAULT_EMAIL_PREFS: EmailPrefs = {
  pre: true, morning: true, midday: true, power: true, closing: true, weekly: true,
};

const EMAIL_PHASE_LABELS: Record<keyof EmailPrefs, string> = {
  pre: 'Pre-Market',
  morning: 'Morning',
  midday: 'Midday',
  power: 'Power Hour',
  closing: 'Closing',
  weekly: 'Weekly',
};

const STARTER_PHASES = new Set<keyof EmailPrefs>(['pre', 'midday', 'closing']);

function phaseAvailable(tier: string, phase: keyof EmailPrefs): boolean {
  if (tier === 'starter') return STARTER_PHASES.has(phase);
  return true;
}

interface User {
  id: string;
  email: string;
  name: string;
  tier: 'starter' | 'indicators' | 'core' | 'core-max' | 'pro' | 'pro-max' | 'trial_7' | 'trial_14' | 'trial_30';
  source: 'founder' | 'general' | 'admin' | 'invite';
  isAdmin: boolean;
  active: boolean;
  createdAt: string;
  accessExpiresAt?: string;
  emailPrefs?: EmailPrefs;
}

interface Invite {
  code: string;
  tier: User['tier'];
  label: string;
  maxUses: number;
  uses: number;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
}

type FilterTier = 'all' | User['tier'];
type FilterSource = 'all' | User['source'];
type FilterStatus = 'all' | 'active' | 'inactive';

const TIER_COLORS: Record<User['tier'], string> = {
  starter: '#94a3b8',
  indicators: '#06b6d4',
  core: '#34d399',
  'core-max': '#34d399',
  pro: '#fbbf24',
  'pro-max': '#fbbf24',
  trial_7: '#fb923c',
  trial_14: '#f472b6',
  trial_30: '#f472b6',
};

const TIER_LABELS: Record<User['tier'], string> = {
  starter: 'Starter',
  indicators: 'TV Indicators',
  core: 'Core',
  'core-max': 'Core Max',
  pro: 'Pro',
  'pro-max': 'Pro Max',
  trial_7: '7-Day Trial',
  trial_14: '14-Day Trial',
  trial_30: '30-Day Trial',
};

const SOURCE_LABELS: Record<User['source'], string> = {
  founder: 'Founder',
  general: 'General',
  admin: 'Admin',
  invite: 'Invite',
};

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<{ name: string; email: string } | null>(null);

  const [filterTier, setFilterTier] = useState<FilterTier>('all');
  const [filterSource, setFilterSource] = useState<FilterSource>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', name: '', tier: 'pro' as User['tier'], isAdmin: false });
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<User>>({});

  const [emailPrefsId, setEmailPrefsId] = useState<string | null>(null);
  const [emailPrefsForm, setEmailPrefsForm] = useState<EmailPrefs>(DEFAULT_EMAIL_PREFS);

  const [invites, setInvites] = useState<Invite[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ label: '', tier: 'pro' as User['tier'], maxUses: 0 });
  const [inviteSaving, setInviteSaving] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  interface WaitlistEntry {
    id: string;
    email: string;
    name: string;
    type: 'general' | 'founder';
    message: string;
    createdAt: string;
    status: 'pending' | 'approved' | 'rejected';
  }
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [wlFilter, setWlFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveTier, setApproveTier] = useState<User['tier']>('pro');

  const [activeTab, setActiveTab] = useState<'users' | 'stats'>('users');

  const [briefingPhase, setBriefingPhase] = useState<'pre' | 'morning' | 'midday' | 'power' | 'closing' | 'weekly'>('closing');
  const [briefingSending, setBriefingSending] = useState(false);
  const [briefingRegenerate, setBriefingRegenerate] = useState(true);
  const [briefingStatus, setBriefingStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [briefingLog, setBriefingLog] = useState<string[]>([]);

  const handleSendBriefing = async () => {
    setBriefingSending(true);
    setBriefingStatus(null);
    setBriefingLog([]);
    const log = (msg: string) => setBriefingLog(prev => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]);
    try {
      if (briefingPhase === 'weekly') {
        log('Sending weekly email + Substack + social…');
      } else {
        if (briefingRegenerate) {
          log('Regenerating analyst brief…');
          const genRes = await fetch('/api/analyst/generate?force=1');
          if (!genRes.ok) {
            const txt = await genRes.text();
            throw new Error(`Brief generation failed (${genRes.status}): ${txt.slice(0, 200)}`);
          }
          log('Brief regenerated.');
        }
        log(`Sending ${briefingPhase} email + Substack…`);
      }
      const sendUrl = briefingPhase === 'weekly'
        ? '/api/email/weekly?force=1'
        : `/api/email/briefing?phase=${briefingPhase}&force=1`;
      const sendRes = await fetch(sendUrl);
      const sendData = await sendRes.json().catch(() => null);
      if (!sendRes.ok) {
        throw new Error(`Email send failed (${sendRes.status}): ${sendData?.error || sendRes.statusText}`);
      }
      const sent = sendData?.sentTo || sendData?.recipients || '?';
      log(`Email sent to ${typeof sent === 'number' ? sent : Array.isArray(sent) ? sent.length : sent} recipients.`);
      if (sendData?.substackPublished) log('Substack published.');
      if (sendData?.blueskyPosted) log('Bluesky posted.');
      setBriefingStatus({ ok: true, message: `${briefingPhase.charAt(0).toUpperCase() + briefingPhase.slice(1)} briefing sent successfully.` });
    } catch (err: any) {
      log(`Error: ${err.message}`);
      setBriefingStatus({ ok: false, message: err.message });
    } finally {
      setBriefingSending(false);
    }
  };

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchInvites = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/invites');
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchWaitlist = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/waitlist');
      if (res.ok) {
        const data = await res.json();
        setWaitlist(data.entries);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchInvites();
    fetchWaitlist();
    fetch('/api/auth/session').then((r) => r.json()).then((d) => {
      if (d.authenticated) setSession({ name: d.name, email: d.email });
    }).catch(() => {});
  }, [fetchUsers, fetchInvites, fetchWaitlist]);

  const filtered = users.filter((u) => {
    if (filterTier !== 'all' && u.tier !== filterTier) return false;
    if (filterSource !== 'all' && u.source !== filterSource) return false;
    if (filterStatus === 'active' && !u.active) return false;
    if (filterStatus === 'inactive' && u.active) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!u.email.toLowerCase().includes(q) && !u.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setAddError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, source: 'admin' }),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error); return; }
      setUsers((prev) => [...prev, data.user]);
      setShowAdd(false);
      setAddForm({ email: '', name: '', tier: 'pro', isAdmin: false });
    } catch { setAddError('Network error'); }
    finally { setSaving(false); }
  }

  async function handleUpdate(id: string) {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editForm }),
      });
      if (res.ok) {
        const data = await res.json();
        setUsers((prev) => prev.map((u) => (u.id === id ? data.user : u)));
      }
    } catch { /* ignore */ }
    setEditingId(null);
    setEditForm({});
  }

  async function handleSaveEmailPrefs(id: string) {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, emailPrefs: emailPrefsForm }),
      });
      if (res.ok) {
        const data = await res.json();
        setUsers((prev) => prev.map((u) => (u.id === id ? data.user : u)));
      }
    } catch { /* ignore */ }
    setEmailPrefsId(null);
  }

  async function handleToggleActive(user: User) {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, active: !user.active }),
      });
      if (res.ok) {
        const data = await res.json();
        setUsers((prev) => prev.map((u) => (u.id === user.id ? data.user : u)));
      }
    } catch { /* ignore */ }
  }

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteSaving(true);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteForm),
      });
      if (res.ok) {
        const data = await res.json();
        setInvites((prev) => [...prev, data.invite]);
        setShowInviteForm(false);
        setInviteForm({ label: '', tier: 'pro', maxUses: 0 });
      }
    } catch { /* ignore */ }
    finally { setInviteSaving(false); }
  }

  async function handleToggleInvite(invite: Invite) {
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: invite.code, active: !invite.active }),
      });
      if (res.ok) {
        const data = await res.json();
        setInvites((prev) => prev.map((i) => (i.code === invite.code ? data.invite : i)));
      }
    } catch { /* ignore */ }
  }

  async function handleDeleteInvite(code: string) {
    try {
      const res = await fetch(`/api/admin/invites?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
      if (res.ok) {
        setInvites((prev) => prev.filter((i) => i.code !== code));
      }
    } catch { /* ignore */ }
  }

  async function handleApproveWaitlist(id: string) {
    try {
      const res = await fetch('/api/admin/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, tier: approveTier }),
      });
      if (res.ok) {
        setWaitlist((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'approved' as const } : e)));
        fetchUsers();
        setApprovingId(null);
      }
    } catch { /* ignore */ }
  }

  async function handleRejectWaitlist(id: string) {
    try {
      const res = await fetch('/api/admin/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'rejected' }),
      });
      if (res.ok) {
        setWaitlist((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'rejected' as const } : e)));
      }
    } catch { /* ignore */ }
  }

  async function handleDeleteWaitlist(id: string) {
    try {
      const res = await fetch(`/api/admin/waitlist?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        setWaitlist((prev) => prev.filter((e) => e.id !== id));
      }
    } catch { /* ignore */ }
  }

  function copyInviteLink(code: string) {
    const url = `https://app.confluencetradingtools.com/invite?code=${code}`;
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  const pill = (text: string, color: string) => (
    <span
      className="inline-block rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider"
      style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}
    >
      {text}
    </span>
  );

  const selectStyle = {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-body)',
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-body)' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="CTT" className="h-6 ctt-logo" />
            <span className="text-sm font-bold" style={{ color: 'var(--text-heading)' }}>Admin</span>
          </div>
          <div className="flex items-center gap-4">
            {session && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{session.name}</span>
            )}
            <a href="/dashboard" className="text-xs font-medium text-indigo-400 hover:text-indigo-300">Dashboard</a>
            <a href="/api/auth/logout" className="text-xs font-medium text-rose-400 hover:text-rose-300">Sign Out</a>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-3 md:px-6 py-4 md:py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 md:mb-8">
          {(['users', 'stats'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
              style={{
                background: activeTab === tab ? '#6366f1' : 'var(--bg-surface)',
                color: activeTab === tab ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${activeTab === tab ? '#6366f1' : 'var(--border-subtle)'}`,
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'users' && <>
        {/* Stats */}
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2 md:gap-4 mb-6 md:mb-8">
          {[
            { label: 'Total', value: users.length, color: '#f1f5f9' },
            { label: 'Pro', value: users.filter((u) => u.tier === 'pro' && u.active).length, color: TIER_COLORS.pro },
            { label: 'Core', value: users.filter((u) => u.tier === 'core' && u.active).length, color: TIER_COLORS.core },
            { label: 'Starter', value: users.filter((u) => u.tier === 'starter' && u.active).length, color: TIER_COLORS.starter },
            { label: 'Trials', value: users.filter((u) => ['trial_7', 'trial_14', 'trial_30'].includes(u.tier) && u.active && (!u.accessExpiresAt || new Date(u.accessExpiresAt) >= new Date())).length, color: TIER_COLORS.trial_7 },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl p-3 md:p-4"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              <div className="text-xl md:text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Manual Briefing Send */}
        <div className="mb-6 md:mb-8 rounded-xl p-4 md:p-6" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <h2 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>Send Briefing</h2>
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex items-center gap-3">
              <select
                value={briefingPhase}
                onChange={(e) => setBriefingPhase(e.target.value as 'pre' | 'morning' | 'midday' | 'power' | 'closing' | 'weekly')}
                className="rounded-lg px-3 py-2 text-sm font-semibold cursor-pointer flex-1 md:flex-none"
                style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                disabled={briefingSending}
              >
                <option value="pre">Pre-Market</option>
                <option value="morning">Morning</option>
                <option value="midday">Midday</option>
                <option value="power">Power Hour</option>
                <option value="closing">Closing</option>
                <option value="weekly">Weekly</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={briefingRegenerate} onChange={(e) => setBriefingRegenerate(e.target.checked)} disabled={briefingSending} />
                Regen
              </label>
            </div>
            <button
              onClick={handleSendBriefing}
              disabled={briefingSending}
              className="rounded-lg px-5 py-2 text-sm font-bold text-white cursor-pointer disabled:opacity-50 w-full md:w-auto"
              style={{ background: briefingSending ? '#475569' : '#6366f1' }}
            >
              {briefingSending ? 'Sending…' : 'Send Email + Substack'}
            </button>
          </div>
          {briefingStatus && (
            <div className={`mt-3 text-xs font-semibold px-3 py-2 rounded-lg ${briefingStatus.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              {briefingStatus.message}
            </div>
          )}
          {briefingLog.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {briefingLog.map((entry, i) => (
                <div key={i} className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {entry}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Invite Links */}
        <div className="mb-6 md:mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Invite Links</h2>
            <button
              onClick={() => setShowInviteForm(true)}
              className="rounded-lg px-3 md:px-4 py-2 text-xs md:text-sm font-bold text-white cursor-pointer"
              style={{ background: '#6366f1' }}
            >
              + Create
            </button>
          </div>

          {showInviteForm && (
            <div className="rounded-xl p-4 md:p-6 mb-4" style={{ background: 'var(--bg-surface)', border: '1px solid #6366f133' }}>
              <form onSubmit={handleCreateInvite} className="flex flex-col md:flex-row md:items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Label</label>
                  <input
                    type="text"
                    value={inviteForm.label}
                    onChange={(e) => setInviteForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="Beta testers"
                    required
                    className="rounded-lg px-3 py-2 text-sm outline-none w-full"
                    style={selectStyle}
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Tier</label>
                    <select
                      value={inviteForm.tier}
                      onChange={(e) => setInviteForm((f) => ({ ...f, tier: e.target.value as User['tier'] }))}
                      className="rounded-lg px-3 py-2 text-sm outline-none w-full"
                      style={selectStyle}
                    >
                      {Object.entries(TIER_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-20">
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Max</label>
                    <input
                      type="number"
                      value={inviteForm.maxUses}
                      onChange={(e) => setInviteForm((f) => ({ ...f, maxUses: parseInt(e.target.value) || 0 }))}
                      min={0}
                      className="rounded-lg px-3 py-2 text-sm outline-none w-full"
                      style={selectStyle}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={inviteSaving} className="rounded-lg px-4 py-2 text-sm font-bold text-white cursor-pointer disabled:opacity-50 flex-1 md:flex-none" style={{ background: '#34d399' }}>
                    {inviteSaving ? 'Creating...' : 'Create'}
                  </button>
                  <button type="button" onClick={() => setShowInviteForm(false)} className="rounded-lg px-4 py-2 text-sm font-bold cursor-pointer" style={{ color: 'var(--text-muted)', background: 'var(--bg-panel)' }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {invites.length > 0 && (
            <div className="space-y-2 md:space-y-0">
              {/* Desktop table */}
              <div className="hidden md:block rounded-xl overflow-x-auto" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {['Label', 'Code', 'Tier', 'Uses', 'Status', 'Actions'].map((h) => (
                        <th key={h} className="text-left text-xs font-bold uppercase tracking-wider px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((invite) => (
                      <tr key={invite.code} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-heading)' }}>{invite.label}</td>
                        <td className="px-4 py-3">
                          <code className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-panel)', color: 'var(--text-body)' }}>
                            {invite.code}
                          </code>
                        </td>
                        <td className="px-4 py-3">{pill(TIER_LABELS[invite.tier], TIER_COLORS[invite.tier])}</td>
                        <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-body)' }}>
                          {invite.uses}{invite.maxUses > 0 ? ` / ${invite.maxUses}` : ''}
                        </td>
                        <td className="px-4 py-3">
                          {pill(
                            !invite.active ? 'Disabled' : invite.maxUses > 0 && invite.uses >= invite.maxUses ? 'Exhausted' : 'Active',
                            !invite.active ? '#64748b' : invite.maxUses > 0 && invite.uses >= invite.maxUses ? '#fbbf24' : '#34d399',
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => copyInviteLink(invite.code)} className="text-xs font-bold cursor-pointer" style={{ color: copiedCode === invite.code ? '#34d399' : '#818cf8' }}>
                              {copiedCode === invite.code ? 'Copied!' : 'Copy'}
                            </button>
                            <button onClick={() => handleToggleInvite(invite)} className="text-xs font-bold cursor-pointer" style={{ color: invite.active ? '#fb7185' : '#34d399' }}>
                              {invite.active ? 'Disable' : 'Enable'}
                            </button>
                            <button onClick={() => handleDeleteInvite(invite.code)} className="text-xs font-bold text-rose-400 cursor-pointer">Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {invites.map((invite) => (
                  <div key={invite.code} className="rounded-xl p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-heading)' }}>{invite.label}</span>
                      <div className="flex items-center gap-2">
                        {pill(TIER_LABELS[invite.tier], TIER_COLORS[invite.tier])}
                        {pill(
                          !invite.active ? 'Off' : invite.maxUses > 0 && invite.uses >= invite.maxUses ? 'Full' : 'On',
                          !invite.active ? '#64748b' : invite.maxUses > 0 && invite.uses >= invite.maxUses ? '#fbbf24' : '#34d399',
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <code className="text-[11px] px-2 py-0.5 rounded" style={{ background: 'var(--bg-panel)', color: 'var(--text-body)' }}>{invite.code}</code>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{invite.uses}{invite.maxUses > 0 ? `/${invite.maxUses}` : ''} uses</span>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => copyInviteLink(invite.code)} className="text-xs font-bold cursor-pointer" style={{ color: copiedCode === invite.code ? '#34d399' : '#818cf8' }}>
                        {copiedCode === invite.code ? 'Copied!' : 'Copy Link'}
                      </button>
                      <button onClick={() => handleToggleInvite(invite)} className="text-xs font-bold cursor-pointer" style={{ color: invite.active ? '#fb7185' : '#34d399' }}>
                        {invite.active ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => handleDeleteInvite(invite.code)} className="text-xs font-bold text-rose-400 cursor-pointer">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Waitlist */}
        <div className="mb-6 md:mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Waitlist</h2>
              {(() => {
                const pending = waitlist.filter((e) => e.status === 'pending').length;
                const founders = waitlist.filter((e) => e.type === 'founder').length;
                return (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {pending} pending{founders > 0 ? ` | ${founders}/100 founders` : ''}
                  </span>
                );
              })()}
            </div>
            <div className="flex gap-1">
              {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setWlFilter(f)}
                  className="rounded px-2 md:px-3 py-1 text-xs font-bold cursor-pointer capitalize"
                  style={{
                    background: wlFilter === f ? '#6366f120' : 'transparent',
                    color: wlFilter === f ? '#818cf8' : 'var(--text-muted)',
                    border: wlFilter === f ? '1px solid #6366f133' : '1px solid transparent',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const filteredWl = wlFilter === 'all' ? waitlist : waitlist.filter((e) => e.status === wlFilter);
            const founderEntries = waitlist.filter((e) => e.type === 'founder').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            if (filteredWl.length === 0) {
              return (
                <div className="rounded-xl p-4 md:p-6 text-center text-sm" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                  No {wlFilter === 'all' ? '' : wlFilter + ' '}waitlist entries.
                </div>
              );
            }
            return (
              <>
                {/* Desktop table */}
                <div className="hidden md:block rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                  <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {['#', 'Type', 'Name', 'Email', 'Message', 'Status', 'Date', 'Actions'].map((h) => (
                          <th key={h} className="text-left text-xs font-bold uppercase tracking-wider px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredWl.map((entry) => {
                        const founderNum = entry.type === 'founder' ? founderEntries.findIndex((e) => e.id === entry.id) + 1 : null;
                        return (
                          <tr key={entry.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td className="px-4 py-3 text-sm font-bold" style={{ color: entry.type === 'founder' ? '#fbbf24' : 'var(--text-muted)' }}>
                              {founderNum ? `F${founderNum}` : '—'}
                            </td>
                            <td className="px-4 py-3">
                              {pill(
                                entry.type === 'founder' ? 'Founder' : 'General',
                                entry.type === 'founder' ? '#fbbf24' : '#818cf8',
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-heading)' }}>{entry.name}</td>
                            <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-body)' }}>{entry.email}</td>
                            <td className="px-4 py-3 text-xs max-w-48 truncate" style={{ color: 'var(--text-muted)' }} title={entry.message}>
                              {entry.message || '—'}
                            </td>
                            <td className="px-4 py-3">
                              {pill(
                                entry.status,
                                entry.status === 'pending' ? '#fbbf24' : entry.status === 'approved' ? '#34d399' : '#fb7185',
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                              {new Date(entry.createdAt).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3">
                              {entry.status === 'pending' ? (
                                approvingId === entry.id ? (
                                  <div className="flex items-center gap-2">
                                    <select
                                      value={approveTier}
                                      onChange={(e) => setApproveTier(e.target.value as User['tier'])}
                                      className="rounded px-2 py-1 text-xs outline-none"
                                      style={selectStyle}
                                    >
                                      {Object.entries(TIER_LABELS).map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                      ))}
                                    </select>
                                    <button onClick={() => handleApproveWaitlist(entry.id)} className="text-xs font-bold text-emerald-400 cursor-pointer">Confirm</button>
                                    <button onClick={() => setApprovingId(null)} className="text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                                  </div>
                                ) : (
                                  <div className="flex gap-2">
                                    <button onClick={() => { setApprovingId(entry.id); setApproveTier('pro'); }} className="text-xs font-bold text-emerald-400 cursor-pointer">Approve</button>
                                    <button onClick={() => handleRejectWaitlist(entry.id)} className="text-xs font-bold text-rose-400 cursor-pointer">Reject</button>
                                  </div>
                                )
                              ) : (
                                <button onClick={() => handleDeleteWaitlist(entry.id)} className="text-xs font-bold text-rose-400 cursor-pointer">Remove</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {filteredWl.map((entry) => {
                    const founderNum = entry.type === 'founder' ? founderEntries.findIndex((e) => e.id === entry.id) + 1 : null;
                    return (
                      <div key={entry.id} className="rounded-xl p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            {founderNum && <span className="text-xs font-bold" style={{ color: '#fbbf24' }}>F{founderNum}</span>}
                            <span className="text-sm font-medium" style={{ color: 'var(--text-heading)' }}>{entry.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {pill(
                              entry.type === 'founder' ? 'Founder' : 'General',
                              entry.type === 'founder' ? '#fbbf24' : '#818cf8',
                            )}
                            {pill(
                              entry.status,
                              entry.status === 'pending' ? '#fbbf24' : entry.status === 'approved' ? '#34d399' : '#fb7185',
                            )}
                          </div>
                        </div>
                        <div className="text-xs mb-1" style={{ color: 'var(--text-body)' }}>{entry.email}</div>
                        {entry.message && (
                          <div className="text-xs mb-2 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{entry.message}</div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{new Date(entry.createdAt).toLocaleDateString()}</span>
                          {entry.status === 'pending' ? (
                            approvingId === entry.id ? (
                              <div className="flex items-center gap-2">
                                <select
                                  value={approveTier}
                                  onChange={(e) => setApproveTier(e.target.value as User['tier'])}
                                  className="rounded px-2 py-1 text-xs outline-none"
                                  style={selectStyle}
                                >
                                  {Object.entries(TIER_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                  ))}
                                </select>
                                <button onClick={() => handleApproveWaitlist(entry.id)} className="text-xs font-bold text-emerald-400 cursor-pointer">OK</button>
                                <button onClick={() => setApprovingId(null)} className="text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)' }}>X</button>
                              </div>
                            ) : (
                              <div className="flex gap-3">
                                <button onClick={() => { setApprovingId(entry.id); setApproveTier('pro'); }} className="text-xs font-bold text-emerald-400 cursor-pointer">Approve</button>
                                <button onClick={() => handleRejectWaitlist(entry.id)} className="text-xs font-bold text-rose-400 cursor-pointer">Reject</button>
                              </div>
                            )
                          ) : (
                            <button onClick={() => handleDeleteWaitlist(entry.id)} className="text-xs font-bold text-rose-400 cursor-pointer">Remove</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>

        {/* Controls */}
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 mb-4 md:mb-6">
          <input
            type="text"
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm outline-none w-full md:flex-1 md:min-w-48"
            style={selectStyle}
          />
          <div className="flex gap-2">
            <select value={filterTier} onChange={(e) => setFilterTier(e.target.value as FilterTier)} className="rounded-lg px-3 py-2 text-sm outline-none flex-1 md:flex-none" style={selectStyle}>
              <option value="all">All Tiers</option>
              {Object.entries(TIER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select value={filterSource} onChange={(e) => setFilterSource(e.target.value as FilterSource)} className="rounded-lg px-3 py-2 text-sm outline-none flex-1 md:flex-none" style={selectStyle}>
              <option value="all">All Sources</option>
              <option value="founder">Founder</option>
              <option value="general">General</option>
              <option value="admin">Admin</option>
              <option value="invite">Invite</option>
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as FilterStatus)} className="rounded-lg px-3 py-2 text-sm outline-none flex-1 md:flex-none" style={selectStyle}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-lg px-4 py-2 text-sm font-bold text-white cursor-pointer w-full md:w-auto"
            style={{ background: '#6366f1' }}
          >
            + Add User
          </button>
        </div>

        {/* Add User Form */}
        {showAdd && (
          <div className="rounded-xl p-4 md:p-6 mb-4 md:mb-6" style={{ background: 'var(--bg-surface)', border: '1px solid #6366f133' }}>
            <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text-heading)' }}>Add New User</h3>
            <form onSubmit={handleAdd} className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Email</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  className="rounded-lg px-3 py-2 text-sm outline-none w-full"
                  style={selectStyle}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Name</label>
                  <input
                    type="text"
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="rounded-lg px-3 py-2 text-sm outline-none w-full"
                    style={selectStyle}
                  />
                </div>
                <div className="w-28">
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Tier</label>
                  <select
                    value={addForm.tier}
                    onChange={(e) => setAddForm((f) => ({ ...f, tier: e.target.value as User['tier'] }))}
                    className="rounded-lg px-3 py-2 text-sm outline-none w-full"
                    style={selectStyle}
                  >
                    {Object.entries(TIER_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap" style={{ color: 'var(--text-body)' }}>
                  <input
                    type="checkbox"
                    checked={addForm.isAdmin}
                    onChange={(e) => setAddForm((f) => ({ ...f, isAdmin: e.target.checked }))}
                  />
                  Admin
                </label>
                <button type="submit" disabled={saving} className="rounded-lg px-4 py-2 text-sm font-bold text-white cursor-pointer disabled:opacity-50 flex-1 md:flex-none" style={{ background: '#34d399' }}>
                  {saving ? 'Adding...' : 'Add'}
                </button>
                <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg px-4 py-2 text-sm font-bold cursor-pointer" style={{ color: 'var(--text-muted)', background: 'var(--bg-panel)' }}>
                  Cancel
                </button>
              </div>
            </form>
            {addError && <p className="mt-2 text-sm text-rose-400">{addError}</p>}
          </div>
        )}

        {/* Users */}
        {loading ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>Loading users...</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {['Name', 'Email', 'Tier', 'Source', 'Status', 'Admin', 'Emails', 'Joined', 'Actions'].map((h) => (
                      <th key={h} className="text-left text-xs font-bold uppercase tracking-wider px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => (
                    <tr key={user.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-heading)' }}>
                        {editingId === user.id ? (
                          <input type="text" defaultValue={user.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="rounded px-2 py-1 text-sm w-32 outline-none" style={selectStyle} />
                        ) : (
                          <span className="font-medium">{user.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-body)' }}>{user.email}</td>
                      <td className="px-4 py-3">
                        {editingId === user.id ? (
                          <select defaultValue={user.tier} onChange={(e) => setEditForm((f) => ({ ...f, tier: e.target.value as User['tier'] }))} className="rounded px-2 py-1 text-xs outline-none" style={selectStyle}>
                            {Object.entries(TIER_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {pill(TIER_LABELS[user.tier] || user.tier, TIER_COLORS[user.tier] || '#64748b')}
                            {user.accessExpiresAt && (
                              <span className="text-[10px]" style={{ color: new Date(user.accessExpiresAt) < new Date() ? '#fb7185' : 'var(--text-muted)' }}>
                                {new Date(user.accessExpiresAt) < new Date() ? 'Expired' : `Expires ${new Date(user.accessExpiresAt).toLocaleDateString()}`}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{SOURCE_LABELS[user.source]}</td>
                      <td className="px-4 py-3">{pill(user.active ? 'Active' : 'Inactive', user.active ? '#34d399' : '#64748b')}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: user.isAdmin ? '#fbbf24' : 'var(--text-muted)' }}>
                        {editingId === user.id ? (
                          <input type="checkbox" defaultChecked={user.isAdmin} onChange={(e) => setEditForm((f) => ({ ...f, isAdmin: e.target.checked }))} />
                        ) : user.isAdmin ? 'Yes' : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {emailPrefsId === user.id ? (
                          <div className="flex flex-col gap-1">
                            {(Object.keys(EMAIL_PHASE_LABELS) as (keyof EmailPrefs)[]).map((phase) => {
                              const available = phaseAvailable(user.tier, phase);
                              return (
                                <label key={phase} className="flex items-center gap-1 text-xs" style={{ color: !available ? 'var(--text-muted)' : emailPrefsForm[phase] ? '#34d399' : 'var(--text-muted)', opacity: available ? 1 : 0.35, cursor: available ? 'pointer' : 'default' }}>
                                  <input type="checkbox" checked={emailPrefsForm[phase]} disabled={!available} onChange={(e) => setEmailPrefsForm((f) => ({ ...f, [phase]: e.target.checked }))} />
                                  {EMAIL_PHASE_LABELS[phase]}
                                </label>
                              );
                            })}
                            <div className="flex gap-2 mt-1">
                              <button onClick={() => handleSaveEmailPrefs(user.id)} className="text-xs font-bold text-emerald-400 cursor-pointer">Save</button>
                              <button onClick={() => setEmailPrefsId(null)} className="text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => { setEmailPrefsId(user.id); setEmailPrefsForm(user.emailPrefs || DEFAULT_EMAIL_PREFS); }} className="text-xs font-bold cursor-pointer" style={{ color: '#818cf8' }}>
                            {(() => { const prefs = user.emailPrefs || DEFAULT_EMAIL_PREFS; const phases = Object.keys(prefs) as (keyof EmailPrefs)[]; const applicable = phases.filter(p => phaseAvailable(user.tier, p)); const on = applicable.filter(p => prefs[p]).length; return on === applicable.length ? 'All' : `${on}/${applicable.length}`; })()}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {editingId === user.id ? (
                            <>
                              <button onClick={() => handleUpdate(user.id)} className="text-xs font-bold text-emerald-400 cursor-pointer">Save</button>
                              <button onClick={() => { setEditingId(null); setEditForm({}); }} className="text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingId(user.id); setEditForm({}); }} className="text-xs font-bold text-indigo-400 cursor-pointer">Edit</button>
                              <button onClick={() => handleToggleActive(user)} className="text-xs font-bold cursor-pointer" style={{ color: user.active ? '#fb7185' : '#34d399' }}>{user.active ? 'Deactivate' : 'Activate'}</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {users.length === 0 ? 'No users yet.' : 'No users match filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {filtered.length === 0 ? (
                <div className="rounded-xl p-4 text-center text-sm" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                  {users.length === 0 ? 'No users yet.' : 'No users match filters.'}
                </div>
              ) : filtered.map((user) => (
                <div key={user.id} className="rounded-xl p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                  {editingId === user.id ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Name</label>
                        <input type="text" defaultValue={user.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="rounded px-2 py-1.5 text-sm w-full outline-none" style={selectStyle} />
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Tier</label>
                          <select defaultValue={user.tier} onChange={(e) => setEditForm((f) => ({ ...f, tier: e.target.value as User['tier'] }))} className="rounded px-2 py-1.5 text-sm w-full outline-none" style={selectStyle}>
                            {Object.entries(TIER_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer pt-5" style={{ color: 'var(--text-body)' }}>
                          <input type="checkbox" defaultChecked={user.isAdmin} onChange={(e) => setEditForm((f) => ({ ...f, isAdmin: e.target.checked }))} />
                          Admin
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdate(user.id)} className="rounded-lg px-4 py-1.5 text-xs font-bold text-white cursor-pointer flex-1" style={{ background: '#34d399' }}>Save</button>
                        <button onClick={() => { setEditingId(null); setEditForm({}); }} className="rounded-lg px-4 py-1.5 text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)', background: 'var(--bg-panel)' }}>Cancel</button>
                      </div>
                    </div>
                  ) : emailPrefsId === user.id ? (
                    <div>
                      <div className="text-sm font-medium mb-2" style={{ color: 'var(--text-heading)' }}>{user.name} — Email Prefs</div>
                      <div className="grid grid-cols-2 gap-1.5 mb-3">
                        {(Object.keys(EMAIL_PHASE_LABELS) as (keyof EmailPrefs)[]).map((phase) => {
                          const available = phaseAvailable(user.tier, phase);
                          return (
                            <label key={phase} className="flex items-center gap-1.5 text-xs" style={{ color: !available ? 'var(--text-muted)' : emailPrefsForm[phase] ? '#34d399' : 'var(--text-muted)', opacity: available ? 1 : 0.35, cursor: available ? 'pointer' : 'default' }}>
                              <input type="checkbox" checked={emailPrefsForm[phase]} disabled={!available} onChange={(e) => setEmailPrefsForm((f) => ({ ...f, [phase]: e.target.checked }))} />
                              {EMAIL_PHASE_LABELS[phase]}
                            </label>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleSaveEmailPrefs(user.id)} className="rounded-lg px-4 py-1.5 text-xs font-bold text-white cursor-pointer flex-1" style={{ background: '#34d399' }}>Save</button>
                        <button onClick={() => setEmailPrefsId(null)} className="rounded-lg px-4 py-1.5 text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)', background: 'var(--bg-panel)' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium" style={{ color: 'var(--text-heading)' }}>{user.name}</span>
                          {user.isAdmin && <span className="text-[10px] font-bold" style={{ color: '#fbbf24' }}>ADMIN</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {pill(TIER_LABELS[user.tier] || user.tier, TIER_COLORS[user.tier] || '#64748b')}
                          {pill(user.active ? 'On' : 'Off', user.active ? '#34d399' : '#64748b')}
                        </div>
                      </div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-body)' }}>{user.email}</div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{SOURCE_LABELS[user.source]}</span>
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Joined {new Date(user.createdAt).toLocaleDateString()}</span>
                        {user.accessExpiresAt && (
                          <span className="text-[10px]" style={{ color: new Date(user.accessExpiresAt) < new Date() ? '#fb7185' : 'var(--text-muted)' }}>
                            {new Date(user.accessExpiresAt) < new Date() ? 'Expired' : `Exp ${new Date(user.accessExpiresAt).toLocaleDateString()}`}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => { setEditingId(user.id); setEditForm({}); }} className="text-xs font-bold text-indigo-400 cursor-pointer">Edit</button>
                        <button onClick={() => handleToggleActive(user)} className="text-xs font-bold cursor-pointer" style={{ color: user.active ? '#fb7185' : '#34d399' }}>
                          {user.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => { setEmailPrefsId(user.id); setEmailPrefsForm(user.emailPrefs || DEFAULT_EMAIL_PREFS); }}
                          className="text-xs font-bold cursor-pointer"
                          style={{ color: '#818cf8' }}
                        >
                          Emails {(() => { const prefs = user.emailPrefs || DEFAULT_EMAIL_PREFS; const phases = Object.keys(prefs) as (keyof EmailPrefs)[]; const applicable = phases.filter(p => phaseAvailable(user.tier, p)); const on = applicable.filter(p => prefs[p]).length; return on === applicable.length ? '(All)' : `(${on}/${applicable.length})`; })()}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <p className="text-center text-xs mt-8" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} of {users.length} users shown
        </p>
        </>}

        {activeTab === 'stats' && <StatsTab />}
      </div>
    </div>
  );
}

// --- Stats Tab ---------------------------------------------------------------

interface StatsData {
  users: {
    total: number;
    active: number;
    inactive: number;
    byTier: Record<string, number>;
    bySource: Record<string, number>;
    activeTrials: number;
    expiredTrials: number;
    signupsByDay: Record<string, number>;
  };
  stripe: {
    mrr: number;
    activeSubs: number;
    trialingSubs: number;
    canceledSubs: number;
    pastDueSubs: number;
    subsByTier: Record<string, number>;
    conversionRate: number;
    recentCancellations: { email: string; tier: string; canceledAt: string }[];
  };
}

interface EmailMetricsData {
  startDate: string;
  endDate: string;
  metrics: {
    totals: Record<string, number>;
  };
}

function StatsTab() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [emailMetrics, setEmailMetrics] = useState<EmailMetricsData | null>(null);
  const [emailLoading, setEmailLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/stats')
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
    fetch('/api/admin/email-metrics')
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setEmailMetrics(d); })
      .catch(() => {})
      .finally(() => setEmailLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-xs uppercase tracking-widest animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading stats...</div>;
  if (error) return <div className="text-center py-20 text-xs text-rose-400">{error}</div>;
  if (!data) return null;

  const { users: u, stripe: s } = data;

  const statCard = (label: string, value: string | number, color: string, sub?: string) => (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );

  const fmtMrr = s.mrr.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

  const sortedDays = Object.entries(u.signupsByDay).sort((a, b) => a[0].localeCompare(b[0]));
  const maxSignups = Math.max(...sortedDays.map(([, v]) => v), 1);

  const tierColors: Record<string, string> = {
    starter: '#94a3b8', indicators: '#06b6d4', core: '#34d399', 'core-max': '#34d399',
    pro: '#fbbf24', 'pro-max': '#fbbf24', trial_7: '#fb923c', trial_14: '#f472b6', trial_30: '#f472b6', unknown: '#64748b',
  };

  return (
    <div className="space-y-6">
      {/* Top cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCard('MRR', fmtMrr, '#34d399', `${s.activeSubs} paying`)}
        {statCard('Active Subs', s.activeSubs, '#f1f5f9', Object.entries(s.subsByTier).map(([t, c]) => `${t}: ${c}`).join(' · '))}
        {statCard('In Trial', s.trialingSubs + u.activeTrials, '#fbbf24', `${s.trialingSubs} Stripe + ${u.activeTrials} invite`)}
        {statCard('Canceled', s.canceledSubs, '#fb7185', `${s.conversionRate}% trial conversion`)}
      </div>

      {/* User breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* By Tier */}
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Users by Tier</div>
          <div className="space-y-2">
            {Object.entries(u.byTier).sort((a, b) => b[1] - a[1]).map(([tier, count]) => {
              const pct = u.active > 0 ? (count / u.active) * 100 : 0;
              const color = tierColors[tier] || '#64748b';
              return (
                <div key={tier} className="flex items-center gap-2">
                  <span className="text-xs font-semibold w-20 truncate" style={{ color }}>{TIER_LABELS[tier as User['tier']] || tier}</span>
                  <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--border-subtle)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                  </div>
                  <span className="text-xs font-bold w-6 text-right" style={{ color: 'var(--text-body)' }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* By Source */}
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Users by Source</div>
          <div className="space-y-2">
            {Object.entries(u.bySource).sort((a, b) => b[1] - a[1]).map(([source, count]) => {
              const pct = u.total > 0 ? (count / u.total) * 100 : 0;
              return (
                <div key={source} className="flex items-center gap-2">
                  <span className="text-xs font-semibold w-20 truncate" style={{ color: 'var(--text-body)' }}>{SOURCE_LABELS[source as User['source']] || source}</span>
                  <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--border-subtle)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#818cf8' }} />
                  </div>
                  <span className="text-xs font-bold w-6 text-right" style={{ color: 'var(--text-body)' }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Stripe subscription tiers */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
        <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Stripe Subscriptions by Tier</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(s.subsByTier).sort((a, b) => b[1] - a[1]).map(([tier, count]) => (
            <div key={tier} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: tierColors[tier] || '#64748b' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-body)' }}>{tier}</span>
              <span className="text-xs font-bold ml-auto" style={{ color: tierColors[tier] || '#64748b' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Signups chart (last 30 days) */}
      {sortedDays.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
            Signups — Last 30 Days ({Object.values(u.signupsByDay).reduce((a, b) => a + b, 0)} total)
          </div>
          <div className="flex items-end gap-[2px]" style={{ height: 80 }}>
            {sortedDays.map(([day, count]) => (
              <div key={day} className="flex-1 flex flex-col items-center justify-end" title={`${day}: ${count}`}>
                <div
                  className="w-full rounded-t transition-all"
                  style={{
                    height: `${(count / maxSignups) * 100}%`,
                    minHeight: count > 0 ? 4 : 0,
                    background: '#6366f1',
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{sortedDays[0]?.[0]?.slice(5)}</span>
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{sortedDays[sortedDays.length - 1]?.[0]?.slice(5)}</span>
          </div>
        </div>
      )}

      {/* Key numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCard('Total Users', u.total, '#f1f5f9', `${u.active} active · ${u.inactive} inactive`)}
        {statCard('Expired Trials', u.expiredTrials, '#fb923c')}
        {statCard('Past Due', s.pastDueSubs, s.pastDueSubs > 0 ? '#fb7185' : '#34d399')}
        {statCard('Trial → Paid', `${s.conversionRate}%`, s.conversionRate >= 50 ? '#34d399' : '#fbbf24')}
      </div>

      {/* Recent cancellations */}
      {s.recentCancellations.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
            Recent Cancellations (last 30 days)
          </div>
          <div className="space-y-1">
            {s.recentCancellations.map((c, i) => (
              <div key={i} className="flex items-center gap-3 text-xs py-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-body)' }}>{c.email}</span>
                <span className="text-[10px] font-bold uppercase" style={{ color: tierColors[c.tier] || '#64748b' }}>{c.tier}</span>
                <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>
                  {new Date(c.canceledAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Email Metrics (Resend) */}
      {emailLoading ? (
        <div className="text-center py-6 text-xs uppercase tracking-widest animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading email metrics...</div>
      ) : emailMetrics?.metrics?.totals ? (() => {
        const t = emailMetrics.metrics.totals;
        const num = (v?: number) => v != null ? v.toLocaleString() : '—';
        const rate = (part?: number, whole?: number) => {
          if (part == null || whole == null || whole === 0) return undefined;
          return `${((part / whole) * 100).toFixed(1)}% rate`;
        };
        const sent = t.sent ?? t.delivered;
        return (
          <>
            <div className="text-[10px] font-bold uppercase tracking-wider mt-2" style={{ color: 'var(--text-muted)' }}>
              Email Metrics — Last 30 Days
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {statCard('Sent', num(t.sent), '#818cf8')}
              {statCard('Delivered', num(t.delivered), '#34d399', rate(t.delivered, t.sent))}
              {statCard('Opened', num(t.opened), '#06b6d4', rate(t.opened, t.delivered))}
              {statCard('Clicked', num(t.clicked), '#fbbf24', rate(t.clicked, t.delivered))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {statCard('Bounced', num(t.bounced), (t.bounced ?? 0) > 0 ? '#fb7185' : '#34d399', rate(t.bounced, sent))}
              {statCard('Complaints', num(t.complained), (t.complained ?? 0) > 0 ? '#fb7185' : '#34d399', rate(t.complained, sent))}
              {statCard('Unsubscribed', num(t.unsubscribed), (t.unsubscribed ?? 0) > 0 ? '#fb923c' : '#34d399')}
            </div>
          </>
        );
      })() : null}
    </div>
  );
}
