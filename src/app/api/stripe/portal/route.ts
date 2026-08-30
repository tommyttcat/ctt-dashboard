import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { getUserByEmail } from '@/lib/users';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await getUserByEmail(session.email);
    if (!user?.stripeCustomerId) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 400 });
    }

    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.confluencetradingtools.com'}/dashboard`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err: any) {
    console.error('portal error:', err);
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 });
  }
}
