import { NextResponse } from 'next/server';
import { addToWaitlist } from '@/lib/waitlist';
import { getUserByEmail } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { email, name, type, message } = await req.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }
    if (!['general', 'founder'].includes(type)) {
      return NextResponse.json({ error: 'Invalid inquiry type' }, { status: 400 });
    }

    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json({ error: 'An account with this email already exists. Use the sign-in page.' }, { status: 400 });
    }

    await addToWaitlist({ email, name, type, message });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err.message === 'already-on-waitlist') {
      return NextResponse.json({ error: "You're already on the waitlist. We'll be in touch!" }, { status: 400 });
    }
    if (err.message === 'founder-spots-full') {
      return NextResponse.json({ error: 'All 100 founder spots have been claimed. You can still join the general waitlist.' }, { status: 400 });
    }
    console.error('waitlist error:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
