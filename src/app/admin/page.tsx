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

interface User {
  id: string;
  email: string;
  name: string;
  tier: 'full' | 'briefing' | 'confluence' | 'briefing_email' | 'confluence_email' | 'both_email';
  source: 'founder' | 'general' | 'admin' | 'invite';
  isAdmin: boolean;
  active: boolean;
  createdAt: string;
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
  full: '#34d399',
  briefing: '#818cf8',
  confluence: '#22d3ee',
  briefing_email: '#a78bfa',
  confluence_email: '#67e8f9',
  both_email: '#fbbf24',
};

const TIER_LABELS: Record<User['tier'], string> = {
  full: 'Full',
  briefing: 'Briefing',
  confluence: 'Confluence',
  briefing_email: 'Briefing (Email)',
  confluence_email: 'Confluence (Email)',
  both_email: 'Both (Email)',
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
  const [addForm, setAddForm] = useState({ email: '', name: '', tier: 'full' as User['tier'], isAdmin: false });
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<User>>({});

  const [emailPrefsId, setEmailPrefsId] = useState<string | null>(null);
  const [emailPrefsForm, setEmailPrefsForm] = useState<EmailPrefs>(DEFAULT_EMAIL_PREFS);

  const [invites, setInvites] = useState<Invite[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ label: '', tier: 'full' as User['tier'], maxUses: 0 });
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
  const [approveTier, setApproveTier] = useState<User['tier']>('full');

  const [briefingPhase, setBriefingPhase] = useState<'pre' | 'morning' | 'midday' | 'power' | 'closing'>('closing');
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
      const sendRes = await fetch(`/api/email/briefing?phase=${briefingPhase}&force=1`);
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
      setAddForm({ email: '', name: '', tier: 'full', isAdmin: false });
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
        setInviteForm({ label: '', tier: 'full', maxUses: 0 });
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

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Users', value: users.length, color: '#f1f5f9' },
            { label: 'Full Access', value: users.filter((u) => u.tier === 'full' && u.active).length, color: TIER_COLORS.full },
            { label: 'Page Access', value: users.filter((u) => ['full', 'briefing', 'confluence'].includes(u.tier) && u.active).length, color: '#818cf8' },
            { label: 'Email Only', value: users.filter((u) => ['briefing_email', 'confluence_email', 'both_email'].includes(u.tier) && u.active).length, color: TIER_COLORS.both_email },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl p-4"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Manual Briefing Send */}
        <div className="mb-8 rounded-xl p-6" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <h2 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>Send Briefing</h2>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Phase</label>
              <select
                value={briefingPhase}
                onChange={(e) => setBriefingPhase(e.target.value as 'pre' | 'morning' | 'midday' | 'power' | 'closing')}
                className="rounded-lg px-3 py-2 text-sm font-semibold cursor-pointer"
                style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                disabled={briefingSending}
              >
                <option value="pre">Pre-Market</option>
                <option value="morning">Morning</option>
                <option value="midday">Midday</option>
                <option value="power">Power Hour</option>
                <option value="closing">Closing</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={briefingRegenerate} onChange={(e) => setBriefingRegenerate(e.target.checked)} disabled={briefingSending} />
                Regenerate brief
              </label>
            </div>
            <button
              onClick={handleSendBriefing}
              disabled={briefingSending}
              className="rounded-lg px-5 py-2 text-sm font-bold text-white cursor-pointer disabled:opacity-50"
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
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Invite Links</h2>
            <button
              onClick={() => setShowInviteForm(true)}
              className="rounded-lg px-4 py-2 text-sm font-bold text-white cursor-pointer"
              style={{ background: '#6366f1' }}
            >
              + Create Invite
            </button>
          </div>

          {showInviteForm && (
            <div className="rounded-xl p-6 mb-4" style={{ background: 'var(--bg-surface)', border: '1px solid #6366f133' }}>
              <form onSubmit={handleCreateInvite} className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Label</label>
                  <input
                    type="text"
                    value={inviteForm.label}
                    onChange={(e) => setInviteForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="Beta testers"
                    required
                    className="rounded-lg px-3 py-2 text-sm outline-none w-48"
                    style={selectStyle}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Tier</label>
                  <select
                    value={inviteForm.tier}
                    onChange={(e) => setInviteForm((f) => ({ ...f, tier: e.target.value as User['tier'] }))}
                    className="rounded-lg px-3 py-2 text-sm outline-none"
                    style={selectStyle}
                  >
                    {Object.entries(TIER_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Max Uses</label>
                  <input
                    type="number"
                    value={inviteForm.maxUses}
                    onChange={(e) => setInviteForm((f) => ({ ...f, maxUses: parseInt(e.target.value) || 0 }))}
                    min={0}
                    className="rounded-lg px-3 py-2 text-sm outline-none w-24"
                    style={selectStyle}
                  />
                  <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>0 = unlimited</span>
                </div>
                <button type="submit" disabled={inviteSaving} className="rounded-lg px-4 py-2 text-sm font-bold text-white cursor-pointer disabled:opacity-50" style={{ background: '#34d399' }}>
                  {inviteSaving ? 'Creating...' : 'Create'}
                </button>
                <button type="button" onClick={() => setShowInviteForm(false)} className="rounded-lg px-4 py-2 text-sm font-bold cursor-pointer" style={{ color: 'var(--text-muted)', background: 'var(--bg-panel)' }}>
                  Cancel
                </button>
              </form>
            </div>
          )}

          {invites.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {['Label', 'Code', 'Tier', 'Uses', 'Status', 'Created', 'Actions'].map((h) => (
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
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(invite.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => copyInviteLink(invite.code)}
                            className="text-xs font-bold cursor-pointer"
                            style={{ color: copiedCode === invite.code ? '#34d399' : '#818cf8' }}
                          >
                            {copiedCode === invite.code ? 'Copied!' : 'Copy Link'}
                          </button>
                          <button
                            onClick={() => handleToggleInvite(invite)}
                            className="text-xs font-bold cursor-pointer"
                            style={{ color: invite.active ? '#fb7185' : '#34d399' }}
                          >
                            {invite.active ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            onClick={() => handleDeleteInvite(invite.code)}
                            className="text-xs font-bold text-rose-400 hover:text-rose-300 cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Waitlist */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Waitlist</h2>
              {(() => {
                const pending = waitlist.filter((e) => e.status === 'pending').length;
                const founders = waitlist.filter((e) => e.type === 'founder').length;
                return (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {pending} pending{founders > 0 ? ` | ${founders}/100 founder spots claimed` : ''}
                  </span>
                );
              })()}
            </div>
            <div className="flex gap-1">
              {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setWlFilter(f)}
                  className="rounded px-3 py-1 text-xs font-bold cursor-pointer capitalize"
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
                <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                  No {wlFilter === 'all' ? '' : wlFilter + ' '}waitlist entries.
                </div>
              );
            }
            return (
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
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
                                  <button onClick={() => handleApproveWaitlist(entry.id)} className="text-xs font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer">
                                    Confirm
                                  </button>
                                  <button onClick={() => setApprovingId(null)} className="text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <button onClick={() => { setApprovingId(entry.id); setApproveTier('full'); }} className="text-xs font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer">
                                    Approve
                                  </button>
                                  <button onClick={() => handleRejectWaitlist(entry.id)} className="text-xs font-bold text-rose-400 hover:text-rose-300 cursor-pointer">
                                    Reject
                                  </button>
                                </div>
                              )
                            ) : (
                              <button onClick={() => handleDeleteWaitlist(entry.id)} className="text-xs font-bold text-rose-400 hover:text-rose-300 cursor-pointer">
                                Remove
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm outline-none flex-1 min-w-48"
            style={selectStyle}
          />
          <select value={filterTier} onChange={(e) => setFilterTier(e.target.value as FilterTier)} className="rounded-lg px-3 py-2 text-sm outline-none" style={selectStyle}>
            <option value="all">All Tiers</option>
            {Object.entries(TIER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select value={filterSource} onChange={(e) => setFilterSource(e.target.value as FilterSource)} className="rounded-lg px-3 py-2 text-sm outline-none" style={selectStyle}>
            <option value="all">All Sources</option>
            <option value="founder">Founder</option>
            <option value="general">General</option>
            <option value="admin">Admin</option>
            <option value="invite">Invite</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as FilterStatus)} className="rounded-lg px-3 py-2 text-sm outline-none" style={selectStyle}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-lg px-4 py-2 text-sm font-bold text-white cursor-pointer"
            style={{ background: '#6366f1' }}
          >
            + Add User
          </button>
        </div>

        {/* Add User Form */}
        {showAdd && (
          <div className="rounded-xl p-6 mb-6" style={{ background: 'var(--bg-surface)', border: '1px solid #6366f133' }}>
            <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text-heading)' }}>Add New User</h3>
            <form onSubmit={handleAdd} className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Email</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  className="rounded-lg px-3 py-2 text-sm outline-none w-64"
                  style={selectStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Name</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="rounded-lg px-3 py-2 text-sm outline-none w-48"
                  style={selectStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Tier</label>
                <select
                  value={addForm.tier}
                  onChange={(e) => setAddForm((f) => ({ ...f, tier: e.target.value as User['tier'] }))}
                  className="rounded-lg px-3 py-2 text-sm outline-none"
                  style={selectStyle}
                >
                  {Object.entries(TIER_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-body)' }}>
                <input
                  type="checkbox"
                  checked={addForm.isAdmin}
                  onChange={(e) => setAddForm((f) => ({ ...f, isAdmin: e.target.checked }))}
                />
                Admin
              </label>
              <button type="submit" disabled={saving} className="rounded-lg px-4 py-2 text-sm font-bold text-white cursor-pointer disabled:opacity-50" style={{ background: '#34d399' }}>
                {saving ? 'Adding...' : 'Add'}
              </button>
              <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg px-4 py-2 text-sm font-bold cursor-pointer" style={{ color: 'var(--text-muted)', background: 'var(--bg-panel)' }}>
                Cancel
              </button>
            </form>
            {addError && <p className="mt-2 text-sm text-rose-400">{addError}</p>}
          </div>
        )}

        {/* Users Table */}
        {loading ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>Loading users...</div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
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
                        <input
                          type="text"
                          defaultValue={user.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          className="rounded px-2 py-1 text-sm w-32 outline-none"
                          style={selectStyle}
                        />
                      ) : (
                        <span className="font-medium">{user.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-body)' }}>{user.email}</td>
                    <td className="px-4 py-3">
                      {editingId === user.id ? (
                        <select
                          defaultValue={user.tier}
                          onChange={(e) => setEditForm((f) => ({ ...f, tier: e.target.value as User['tier'] }))}
                          className="rounded px-2 py-1 text-xs outline-none"
                          style={selectStyle}
                        >
                          {Object.entries(TIER_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      ) : pill(TIER_LABELS[user.tier] || user.tier, TIER_COLORS[user.tier] || '#64748b')}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{SOURCE_LABELS[user.source]}</td>
                    <td className="px-4 py-3">
                      {pill(
                        user.active ? 'Active' : 'Inactive',
                        user.active ? '#34d399' : '#64748b',
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: user.isAdmin ? '#fbbf24' : 'var(--text-muted)' }}>
                      {editingId === user.id ? (
                        <input
                          type="checkbox"
                          defaultChecked={user.isAdmin}
                          onChange={(e) => setEditForm((f) => ({ ...f, isAdmin: e.target.checked }))}
                        />
                      ) : user.isAdmin ? 'Yes' : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {emailPrefsId === user.id ? (
                        <div className="flex flex-col gap-1">
                          {(Object.keys(EMAIL_PHASE_LABELS) as (keyof EmailPrefs)[]).map((phase) => (
                            <label key={phase} className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: emailPrefsForm[phase] ? '#34d399' : 'var(--text-muted)' }}>
                              <input
                                type="checkbox"
                                checked={emailPrefsForm[phase]}
                                onChange={(e) => setEmailPrefsForm((f) => ({ ...f, [phase]: e.target.checked }))}
                              />
                              {EMAIL_PHASE_LABELS[phase]}
                            </label>
                          ))}
                          <div className="flex gap-2 mt-1">
                            <button onClick={() => handleSaveEmailPrefs(user.id)} className="text-xs font-bold text-emerald-400 cursor-pointer">Save</button>
                            <button onClick={() => setEmailPrefsId(null)} className="text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEmailPrefsId(user.id); setEmailPrefsForm(user.emailPrefs || DEFAULT_EMAIL_PREFS); }}
                          className="text-xs font-bold cursor-pointer"
                          style={{ color: '#818cf8' }}
                        >
                          {(() => {
                            const prefs = user.emailPrefs || DEFAULT_EMAIL_PREFS;
                            const on = Object.values(prefs).filter(Boolean).length;
                            return on === 6 ? 'All' : `${on}/6`;
                          })()}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {editingId === user.id ? (
                          <>
                            <button
                              onClick={() => handleUpdate(user.id)}
                              className="text-xs font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => { setEditingId(null); setEditForm({}); }}
                              className="text-xs font-bold cursor-pointer"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => { setEditingId(user.id); setEditForm({}); }}
                              className="text-xs font-bold text-indigo-400 hover:text-indigo-300 cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleToggleActive(user)}
                              className="text-xs font-bold cursor-pointer"
                              style={{ color: user.active ? '#fb7185' : '#34d399' }}
                            >
                              {user.active ? 'Deactivate' : 'Activate'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {users.length === 0 ? 'No users yet. Add your first user above.' : 'No users match the current filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-center text-xs mt-8" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} of {users.length} users shown
        </p>
      </div>
    </div>
  );
}
