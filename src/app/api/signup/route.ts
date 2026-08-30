import { NextResponse } from 'next/server';
import { addUser, getUserByEmail } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { email, name, source } = await req.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ ok: true, existing: true });
    }

    const validSource = source === 'founder' || source === 'general' ? source : 'general';

    await addUser({
      email,
      name: name || email.split('@')[0],
      tier: 'starter',
      source: validSource,
    });

    return NextResponse.json({ ok: true, created: true });
  } catch (err: any) {
    console.error('signup error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
