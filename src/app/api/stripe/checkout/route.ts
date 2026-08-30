import { NextResponse } from 'next/server';
import { getStripe, PRICES } from '@/lib/stripe';
import { getUserByEmail } from '@/lib/users';

export const dynamic = 'force-dynamic';

type Tier = keyof typeof PRICES;
type Period = 'monthly' | 'yearly';

export async function POST(req: Request) {
  try {
    const { tier, period, email, tvUsername } = await req.json() as {
      tier: string;
      period: string;
      email: string;
      tvUsername?: string;
    };

    if (!email?.includes('@')) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    if (!PRICES[tier as Tier]) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
    }

    const priceId = PRICES[tier as Tier][period as Period];
    if (!priceId) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
    }

    const existingUser = await getUserByEmail(email);
    let customerId = existingUser?.stripeCustomerId;

    if (customerId) {
      try {
        const existing = await getStripe().customers.retrieve(customerId);
        if (existing.deleted) customerId = undefined;
      } catch {
        customerId = undefined;
      }
    }

    if (!customerId) {
      const existing = await getStripe().customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const customer = await getStripe().customers.create({ email });
        customerId = customer.id;
      }
    }

    let hasActiveSub = false;
    if (customerId) {
      const subs = await getStripe().subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
      hasActiveSub = subs.data.length > 0;
    }

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: hasActiveSub ? undefined : tier === 'indicators' ? 7 : 14,
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.confluencetradingtools.com'}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.confluencetradingtools.com'}/pricing`,
      metadata: {
        tier,
        userId: existingUser?.id || '',
        ...(tvUsername && { tvUsername }),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('checkout error:', err?.message || err);
    return NextResponse.json({
      error: err?.message || 'Failed to create checkout session',
    }, { status: 500 });
  }
}
