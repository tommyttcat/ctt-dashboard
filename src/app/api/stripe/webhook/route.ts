import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe, tierFromPriceId, tierIncludesIndicators, type Tier } from '@/lib/stripe';
import { getUserByEmail, getUserByStripeCustomerId, addUser, updateUser } from '@/lib/users';
import { grantTVAccess, revokeTVAccess } from '@/lib/tradingview';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription') break;

      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;
      const customerEmail = session.customer_details?.email || session.customer_email;
      const tier = session.metadata?.tier as Tier | undefined;
      const tvUsername = session.metadata?.tvUsername;

      if (!customerEmail || !tier) break;

      let user = await getUserByEmail(customerEmail);

      if (user) {
        await updateUser(user.id, {
          tier,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          accessExpiresAt: undefined,
          ...(tvUsername && { tvUsername }),
        });
      } else {
        await addUser({
          email: customerEmail,
          name: customerEmail.split('@')[0],
          tier,
          source: 'general',
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
        } as any);

        if (tvUsername) {
          const newUser = await getUserByEmail(customerEmail);
          if (newUser) await updateUser(newUser.id, { tvUsername });
        }
      }

      if (tvUsername && tierIncludesIndicators(tier)) {
        await grantTVAccess(tvUsername);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const priceId = subscription.items.data[0]?.price?.id;

      if (!priceId) break;

      const newTier = tierFromPriceId(priceId);
      if (!newTier) break;

      const user = await getUserByStripeCustomerId(customerId);
      if (!user) break;

      const oldTier = user.tier;
      const updates: Record<string, any> = {
        tier: newTier,
        stripeSubscriptionId: subscription.id,
      };

      if (subscription.status === 'active') {
        updates.accessExpiresAt = undefined;
        updates.active = true;
      } else if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
        updates.active = false;
      }

      await updateUser(user.id, updates);

      if (user.tvUsername) {
        const hadIndicators = tierIncludesIndicators(oldTier);
        const hasIndicators = tierIncludesIndicators(newTier);

        if (!hadIndicators && hasIndicators) {
          await grantTVAccess(user.tvUsername);
        } else if (hadIndicators && !hasIndicators) {
          await revokeTVAccess(user.tvUsername);
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const user = await getUserByStripeCustomerId(customerId);
      if (!user) break;

      if (user.tvUsername && tierIncludesIndicators(user.tier)) {
        await revokeTVAccess(user.tvUsername);
      }

      await updateUser(user.id, {
        tier: 'starter',
        stripeSubscriptionId: undefined,
        active: true,
      });
      break;
    }
  }

  return NextResponse.json({ received: true });
}
