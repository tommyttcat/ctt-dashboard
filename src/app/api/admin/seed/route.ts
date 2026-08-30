import { NextResponse } from 'next/server';
import { addUser, getUserByEmail } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const email = 'thomasbeach@gmail.com';
  const existing = await getUserByEmail(email);
  if (existing) {
    return NextResponse.json({ message: 'Admin user already exists', user: existing });
  }

  const user = await addUser({
    email,
    name: 'Thomas Beach',
    tier: 'pro',
    source: 'admin',
    isAdmin: true,
  });

  return NextResponse.json({ message: 'Admin user created', user });
}
