import { NextResponse } from 'next/server';
import { verifyMagicToken, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';
import { getUserByEmail } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing-token', url.origin));
  }

  const email = await verifyMagicToken(token);
  if (!email) {
    return NextResponse.redirect(new URL('/login?error=invalid-or-expired', url.origin));
  }

  const user = await getUserByEmail(email);
  if (!user || !user.active) {
    return NextResponse.redirect(new URL('/login?error=account-inactive', url.origin));
  }

  if (user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date()) {
    return NextResponse.redirect(new URL('/login?info=trial-expired', url.origin));
  }

  const sessionToken = await createSessionToken({
    email: user.email,
    name: user.name,
    tier: user.tier,
    isAdmin: user.isAdmin,
    accessExpiresAt: user.accessExpiresAt,
  });

  const dest = user.tier === 'starter'
    ? '/login?info=email-only'
    : '/dashboard';

  const res = NextResponse.redirect(new URL(dest, url.origin));
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
