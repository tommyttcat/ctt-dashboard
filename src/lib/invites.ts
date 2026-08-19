import { kv } from '@vercel/kv';

const INVITES_KEY = 'ctt_invites';

export interface Invite {
  code: string;
  tier: 'full' | 'briefing' | 'confluence' | 'briefing_email' | 'confluence_email' | 'both_email';
  label: string;
  maxUses: number; // 0 = unlimited
  uses: number;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
}

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `CTT-${code}`;
}

export async function getInvites(): Promise<Invite[]> {
  const invites = await kv.get<Invite[]>(INVITES_KEY);
  return invites || [];
}

export async function getInviteByCode(code: string): Promise<Invite | null> {
  const invites = await getInvites();
  return invites.find((i) => i.code === code) || null;
}

export async function createInvite(data: {
  tier: Invite['tier'];
  label: string;
  maxUses?: number;
  expiresAt?: string | null;
}): Promise<Invite> {
  const invites = await getInvites();
  const invite: Invite = {
    code: genCode(),
    tier: data.tier,
    label: data.label.trim(),
    maxUses: data.maxUses ?? 0,
    uses: 0,
    createdAt: new Date().toISOString(),
    expiresAt: data.expiresAt ?? null,
    active: true,
  };
  invites.push(invite);
  await kv.set(INVITES_KEY, invites);
  return invite;
}

export async function useInvite(code: string): Promise<Invite | null> {
  const invites = await getInvites();
  const idx = invites.findIndex((i) => i.code === code);
  if (idx < 0) return null;

  const invite = invites[idx];
  if (!invite.active) return null;
  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) return null;
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) return null;

  invite.uses += 1;
  invites[idx] = invite;
  await kv.set(INVITES_KEY, invites);
  return invite;
}

export async function updateInvite(
  code: string,
  updates: Partial<Pick<Invite, 'active' | 'label' | 'maxUses' | 'expiresAt'>>,
): Promise<Invite | null> {
  const invites = await getInvites();
  const idx = invites.findIndex((i) => i.code === code);
  if (idx < 0) return null;

  invites[idx] = { ...invites[idx], ...updates };
  await kv.set(INVITES_KEY, invites);
  return invites[idx];
}

export async function deleteInvite(code: string): Promise<boolean> {
  const invites = await getInvites();
  const filtered = invites.filter((i) => i.code !== code);
  if (filtered.length === invites.length) return false;
  await kv.set(INVITES_KEY, filtered);
  return true;
}
