import { kv } from '@vercel/kv';

const USERS_KEY = 'ctt_users';

export interface EmailPrefs {
  pre: boolean;
  morning: boolean;
  midday: boolean;
  power: boolean;
  closing: boolean;
  confluence: boolean;
  weekly: boolean;
}

export const DEFAULT_EMAIL_PREFS: EmailPrefs = {
  pre: true,
  morning: true,
  midday: true,
  power: true,
  closing: true,
  confluence: true,
  weekly: true,
};

export interface User {
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
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  tvUsername?: string;
}

function genId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'u_';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export async function getUsers(): Promise<User[]> {
  const users = await kv.get<User[]>(USERS_KEY);
  return users || [];
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const users = await getUsers();
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
}

export async function getUserById(id: string): Promise<User | null> {
  const users = await getUsers();
  return users.find((u) => u.id === id) || null;
}

export async function addUser(data: {
  email: string;
  name: string;
  tier: User['tier'];
  source: User['source'];
  isAdmin?: boolean;
  accessExpiresAt?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}): Promise<User> {
  const users = await getUsers();
  const existing = users.find((u) => u.email.toLowerCase() === data.email.toLowerCase());
  if (existing) throw new Error('User with this email already exists');

  const user: User = {
    id: genId(),
    email: data.email.toLowerCase().trim(),
    name: data.name.trim(),
    tier: data.tier,
    source: data.source,
    isAdmin: data.isAdmin || false,
    active: true,
    createdAt: new Date().toISOString(),
    ...(data.accessExpiresAt ? { accessExpiresAt: data.accessExpiresAt } : {}),
    ...(data.stripeCustomerId ? { stripeCustomerId: data.stripeCustomerId } : {}),
    ...(data.stripeSubscriptionId ? { stripeSubscriptionId: data.stripeSubscriptionId } : {}),
  };
  users.push(user);
  await kv.set(USERS_KEY, users);
  return user;
}

export async function getUserByStripeCustomerId(customerId: string): Promise<User | null> {
  const users = await getUsers();
  return users.find((u) => u.stripeCustomerId === customerId) || null;
}

export async function updateUser(id: string, updates: Partial<Pick<User, 'name' | 'tier' | 'isAdmin' | 'active' | 'emailPrefs' | 'accessExpiresAt' | 'stripeCustomerId' | 'stripeSubscriptionId' | 'tvUsername'>>): Promise<User | null> {
  const users = await getUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) return null;

  const user = { ...users[idx], ...updates };
  users[idx] = user;
  await kv.set(USERS_KEY, users);
  return user;
}

export async function deleteUser(id: string): Promise<boolean> {
  const users = await getUsers();
  const filtered = users.filter((u) => u.id !== id);
  if (filtered.length === users.length) return false;
  await kv.set(USERS_KEY, filtered);
  return true;
}

export async function getUsersByTier(...tiers: User['tier'][]): Promise<User[]> {
  const users = await getUsers();
  return users.filter((u) => u.active && tiers.includes(u.tier));
}

const STARTER_PHASES = new Set<keyof EmailPrefs>(['pre', 'midday', 'closing']);

export async function getEmailRecipients(emailType: 'briefing' | 'confluence', phase?: keyof EmailPrefs): Promise<string[]> {
  const users = await getUsers();
  return users
    .filter((u) => {
      if (!u.active) return false;
      if (u.accessExpiresAt && new Date(u.accessExpiresAt) < new Date()) return false;
      if (u.tier === 'pro' || u.tier === 'trial_7' || u.tier === 'trial_14' || u.tier === 'trial_30') return true;
      if (u.tier === 'core') return true;
      if (u.tier === 'starter' && emailType === 'briefing') {
        if (phase && !STARTER_PHASES.has(phase)) return false;
        return true;
      }
      return false;
    })
    .filter((u) => {
      if (!phase) return true;
      const prefs = u.emailPrefs || DEFAULT_EMAIL_PREFS;
      return prefs[phase] !== false;
    })
    .map((u) => u.email);
}
