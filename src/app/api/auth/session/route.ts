import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { getUserByEmail } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  const user = await getUserByEmail(session.email);
  if (!user || !user.active) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    email: user.email,
    name: user.name,
    tier: user.tier,
    isAdmin: user.isAdmin,
  });
}
