import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { getUsers } from '@/lib/users';
import { getStripe, tierFromPriceId } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

async function requireAdmin(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const users = await getUsers();
    const stripe = getStripe();
    const now = new Date();

    // --- KV user stats ---
    const active = users.filter(u => u.active);
    const trialTiers = new Set(['trial_7', 'trial_14', 'trial_30']);
    const activeTrials = active.filter(u =>
      trialTiers.has(u.tier) && (!u.accessExpiresAt || new Date(u.accessExpiresAt) >= now)
    );
    const expiredTrials = users.filter(u =>
      trialTiers.has(u.tier) && u.accessExpiresAt && new Date(u.accessExpiresAt) < now
    );

    const byTier: Record<string, number> = {};
    for (const u of active) {
      byTier[u.tier] = (byTier[u.tier] || 0) + 1;
    }

    const bySource: Record<string, number> = {};
    for (const u of users) {
      bySource[u.source] = (bySource[u.source] || 0) + 1;
    }

    // Signups by day (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const signupsByDay: Record<string, number> = {};
    for (const u of users) {
      const d = u.createdAt?.slice(0, 10);
      if (d && new Date(d) >= thirtyDaysAgo) {
        signupsByDay[d] = (signupsByDay[d] || 0) + 1;
      }
    }

    // --- Stripe stats ---
    let mrr = 0;
    let activeSubs = 0;
    let trialingSubs = 0;
    let canceledSubs = 0;
    let pastDueSubs = 0;
    const subsByTier: Record<string, number> = {};
    const recentCancellations: { email: string; tier: string; canceledAt: string }[] = [];

    const subs: import('stripe').Stripe.Subscription[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;
    while (hasMore) {
      const page = await stripe.subscriptions.list({
        limit: 100,
        status: 'all',
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      subs.push(...page.data);
      hasMore = page.has_more;
      if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
    }

    for (const sub of subs) {
      const priceId = sub.items.data[0]?.price?.id;
      const tier = priceId ? tierFromPriceId(priceId) : null;
      const tierKey = tier || 'unknown';

      if (sub.status === 'active') {
        activeSubs++;
        const amount = sub.items.data[0]?.price?.unit_amount || 0;
        const interval = sub.items.data[0]?.price?.recurring?.interval;
        mrr += interval === 'year' ? Math.round(amount / 12) : amount;
        subsByTier[tierKey] = (subsByTier[tierKey] || 0) + 1;
      } else if (sub.status === 'trialing') {
        trialingSubs++;
        subsByTier[tierKey] = (subsByTier[tierKey] || 0) + 1;
      } else if (sub.status === 'canceled') {
        canceledSubs++;
        if (sub.canceled_at) {
          const cancelDate = new Date(sub.canceled_at * 1000);
          if (cancelDate >= thirtyDaysAgo) {
            const email = typeof sub.customer === 'string' ? sub.customer : (sub.customer as any)?.email || '';
            recentCancellations.push({
              email,
              tier: tierKey,
              canceledAt: cancelDate.toISOString(),
            });
          }
        }
      } else if (sub.status === 'past_due') {
        pastDueSubs++;
      }
    }

    // Resolve customer emails for recent cancellations
    for (const c of recentCancellations) {
      if (c.email.startsWith('cus_')) {
        try {
          const cust = await stripe.customers.retrieve(c.email);
          if (!('deleted' in cust) || !cust.deleted) {
            c.email = (cust as any).email || c.email;
          }
        } catch { /* keep customer ID */ }
      }
    }

    const trialConversions = subs.filter(s =>
      s.status === 'active' && s.trial_end && s.trial_end < now.getTime() / 1000
    ).length;
    const totalTrialed = subs.filter(s => s.trial_end != null).length;
    const conversionRate = totalTrialed > 0 ? Math.round((trialConversions / totalTrialed) * 100) : 0;

    return NextResponse.json({
      users: {
        total: users.length,
        active: active.length,
        inactive: users.length - active.length,
        byTier,
        bySource,
        activeTrials: activeTrials.length,
        expiredTrials: expiredTrials.length,
        signupsByDay,
      },
      stripe: {
        mrr: mrr / 100,
        activeSubs,
        trialingSubs,
        canceledSubs,
        pastDueSubs,
        subsByTier,
        conversionRate,
        recentCancellations: recentCancellations.sort((a, b) =>
          new Date(b.canceledAt).getTime() - new Date(a.canceledAt).getTime()
        ).slice(0, 10),
      },
    });
  } catch (err: any) {
    console.error('stats error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to load stats' }, { status: 500 });
  }
}
