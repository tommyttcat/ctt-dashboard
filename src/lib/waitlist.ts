import { kv } from '@vercel/kv';

const WAITLIST_KEY = 'ctt_waitlist';

export interface WaitlistEntry {
  id: string;
  email: string;
  name: string;
  type: 'general' | 'founder';
  message: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

const FOUNDER_LIMIT = 100;

function genId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'wl_';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export async function getWaitlist(): Promise<WaitlistEntry[]> {
  const entries = await kv.get<WaitlistEntry[]>(WAITLIST_KEY);
  return entries || [];
}

export async function getFounderCount(): Promise<number> {
  const entries = await getWaitlist();
  return entries.filter((e) => e.type === 'founder').length;
}

export async function addToWaitlist(data: {
  email: string;
  name: string;
  type: 'general' | 'founder';
  message?: string;
}): Promise<WaitlistEntry> {
  const entries = await getWaitlist();
  const existing = entries.find((e) => e.email.toLowerCase() === data.email.toLowerCase());
  if (existing) throw new Error('already-on-waitlist');

  if (data.type === 'founder') {
    const founderCount = entries.filter((e) => e.type === 'founder').length;
    if (founderCount >= FOUNDER_LIMIT) throw new Error('founder-spots-full');
  }

  const entry: WaitlistEntry = {
    id: genId(),
    email: data.email.toLowerCase().trim(),
    name: data.name.trim(),
    type: data.type,
    message: data.message?.trim() || '',
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  entries.push(entry);
  await kv.set(WAITLIST_KEY, entries);
  return entry;
}

export async function updateWaitlistEntry(
  id: string,
  status: 'approved' | 'rejected',
): Promise<WaitlistEntry | null> {
  const entries = await getWaitlist();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return null;

  entries[idx] = { ...entries[idx], status };
  await kv.set(WAITLIST_KEY, entries);
  return entries[idx];
}

export async function deleteWaitlistEntry(id: string): Promise<boolean> {
  const entries = await getWaitlist();
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length === entries.length) return false;
  await kv.set(WAITLIST_KEY, filtered);
  return true;
}
