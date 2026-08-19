import { kv } from '@vercel/kv';

const USERS_KEY = 'ctt_users';

export interface EmailPrefs {
  pre: boolean;
  morning: boolean;
  midday: boolean;
  closing: boolean;
  confluence: boolean;
  weekly: boolean;
}

export const DEFAULT_EMAIL_PREFS: EmailPrefs = {
  pre: true,
  morning: true,
  midday: true,
  closing: true,
  confluence: true,
  weekly: true,
};

export interface User {
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
  };
  users.push(user);
  await kv.set(USERS_KEY, users);
  return user;
}

export async function updateUser(id: string, updates: Partial<Pick<User, 'name' | 'tier' | 'isAdmin' | 'active' | 'emailPrefs'>>): Promise<User | null> {
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

export async function getEmailRecipients(emailType: 'briefing' | 'confluence', phase?: keyof EmailPrefs): Promise<string[]> {
  const users = await getUsers();
  return users
    .filter((u) => {
      if (!u.active) return false;
      if (u.tier === 'full' || u.tier === emailType || u.tier === 'both_email') return true;
      if (emailType === 'briefing' && u.tier === 'briefing_email') return true;
      if (emailType === 'confluence' && u.tier === 'confluence_email') return true;
      return false;
    })
    .filter((u) => {
      if (!phase) return true;
      const prefs = u.emailPrefs || DEFAULT_EMAIL_PREFS;
      return prefs[phase] !== false;
    })
    .map((u) => u.email);
}
