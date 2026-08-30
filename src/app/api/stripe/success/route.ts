import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getStripe, tierFromPriceId } from '@/lib/stripe';
import { getUserByEmail, addUser, updateUser } from '@/lib/users';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');
  if (!sessionId) {
    return NextResponse.redirect(new URL('/pricing', req.url));
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'subscription.items.data.price'],
    });

    if (session.payment_status === 'unpaid' && session.status !== 'complete') {
      return NextResponse.redirect(new URL('/pricing?error=payment-failed', req.url));
    }

    const email = session.customer_details?.email || session.customer_email;
    if (!email) {
      return NextResponse.redirect(new URL('/pricing?error=no-email', req.url));
    }

    const customerId = session.customer as string;
    const subscription = session.subscription as any;
    const subscriptionId = typeof subscription === 'string' ? subscription : subscription?.id;
    const priceId = typeof subscription === 'object' ? subscription?.items?.data?.[0]?.price?.id : null;
    const tier = session.metadata?.tier as 'starter' | 'core' | 'pro' || (priceId ? tierFromPriceId(priceId) : null) || 'core';

    let user = await getUserByEmail(email);

    if (user) {
      await updateUser(user.id, {
        tier,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        accessExpiresAt: undefined,
      });
      user = { ...user, tier, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId };
    } else {
      user = await addUser({
        email,
        name: session.customer_details?.name || email.split('@')[0],
        tier,
        source: 'general',
      });
      await updateUser(user.id, {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      });
      user = { ...user, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId };
    }

    const token = await createSessionToken({
      email: user.email,
      name: user.name,
      tier: user.tier,
      isAdmin: user.isAdmin,
    });

    const res = NextResponse.redirect(new URL(`/welcome?tier=${tier}`, req.url));
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err: any) {
    console.error('stripe success error:', err);
    return NextResponse.redirect(new URL('/pricing?error=verification-failed', req.url));
  }
}
