import { NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';
import { getUserByEmail, addUser } from '@/lib/users';
import { getInviteByCode, useInvite } from '@/lib/invites';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { code, email, name } = await req.json();

    if (!code) {
      return NextResponse.json({ error: 'Invite code required' }, { status: 400 });
    }
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }

    const invite = await getInviteByCode(code);
    if (!invite || !invite.active) {
      return NextResponse.json({ error: 'Invalid or expired invite code' }, { status: 400 });
    }
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      return NextResponse.json({ error: 'This invite has reached its maximum uses' }, { status: 400 });
    }
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'This invite has expired' }, { status: 400 });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists. Use the sign-in page instead.' }, { status: 400 });
    }

    const user = await addUser({
      email,
      name: name.trim(),
      tier: invite.tier,
      source: 'invite',
    });

    await useInvite(code);

    const sessionToken = await createSessionToken({
      email: user.email,
      name: user.name,
      tier: user.tier,
      isAdmin: false,
    });

    const dest = user.tier === 'full'
      ? '/dashboard'
      : user.tier === 'briefing'
      ? '/analyst'
      : user.tier === 'confluence'
      ? '/confluence'
      : '/login?info=email-only';

    const res = NextResponse.json({ ok: true, redirect: dest });
    res.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err: any) {
    console.error('invite redeem error:', err);
    return NextResponse.json({ error: err.message || 'Something went wrong' }, { status: 500 });
  }
}
