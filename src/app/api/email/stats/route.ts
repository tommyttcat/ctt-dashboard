import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getUsers } from '@/lib/users';
import { getStripe, tierFromPriceId } from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const force = req.nextUrl.searchParams.get('force') === '1';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !force) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'no RESEND_API_KEY' }, { status: 500 });
  }

  try {
    const users = await getUsers();
    const stripe = getStripe();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const active = users.filter(u => u.active);
    const trialTiers = new Set(['trial_7', 'trial_14', 'trial_30']);
    const activeTrials = active.filter(u =>
      trialTiers.has(u.tier) && (!u.accessExpiresAt || new Date(u.accessExpiresAt) >= now)
    );

    const todaySignups = users.filter(u => u.createdAt?.startsWith(today));

    // Stripe data
    let mrr = 0;
    let activeSubs = 0;
    let trialingSubs = 0;
    let canceledToday = 0;
    const subsByTier: Record<string, number> = {};

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

    const todayStart = new Date(today).getTime() / 1000;

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
      } else if (sub.status === 'canceled' && sub.canceled_at && sub.canceled_at >= todayStart) {
        canceledToday++;
      }
    }

    const trialsExpiringTomorrow = active.filter(u => {
      if (!u.accessExpiresAt) return false;
      const exp = u.accessExpiresAt.slice(0, 10);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return exp === tomorrow;
    });

    const mrrDollars = (mrr / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
    const tierLines = Object.entries(subsByTier)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t}: ${c}`)
      .join(' · ');

    const etDate = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' });

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; color: #e2e8f0; background: #0a1120; padding: 24px; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-size: 16px; color: #f1f5f9; letter-spacing: 0.05em;">CTT Daily Stats</h2>
          <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">${etDate}</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <tr>
            <td style="padding: 12px; background: #111827; border-radius: 8px 0 0 0; border-bottom: 1px solid #1e293b;">
              <div style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em;">MRR</div>
              <div style="font-size: 22px; font-weight: 700; color: #34d399;">${mrrDollars}</div>
            </td>
            <td style="padding: 12px; background: #111827; border-radius: 0 8px 0 0; border-bottom: 1px solid #1e293b;">
              <div style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em;">Active Subs</div>
              <div style="font-size: 22px; font-weight: 700; color: #f1f5f9;">${activeSubs}</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px; background: #111827; border-radius: 0 0 0 8px;">
              <div style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em;">In Trial</div>
              <div style="font-size: 22px; font-weight: 700; color: #fbbf24;">${trialingSubs + activeTrials.length}</div>
            </td>
            <td style="padding: 12px; background: #111827; border-radius: 0 0 8px 0;">
              <div style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em;">Total Users</div>
              <div style="font-size: 22px; font-weight: 700; color: #f1f5f9;">${users.length}</div>
            </td>
          </tr>
        </table>

        <div style="background: #111827; border-radius: 8px; padding: 14px; margin-bottom: 12px;">
          <div style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Today</div>
          <div style="font-size: 13px; color: #e2e8f0; line-height: 1.8;">
            New signups: <strong>${todaySignups.length}</strong>${todaySignups.length > 0 ? ` (${todaySignups.map(u => u.name || u.email).join(', ')})` : ''}<br>
            Cancellations: <strong>${canceledToday}</strong><br>
            Trials expiring tomorrow: <strong>${trialsExpiringTomorrow.length}</strong>${trialsExpiringTomorrow.length > 0 ? ` (${trialsExpiringTomorrow.map(u => u.name || u.email).join(', ')})` : ''}
          </div>
        </div>

        <div style="background: #111827; border-radius: 8px; padding: 14px;">
          <div style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Breakdown</div>
          <div style="font-size: 12px; color: #94a3b8;">${tierLines || 'No active subscriptions'}</div>
        </div>

        <p style="text-align: center; font-size: 10px; color: #475569; margin-top: 16px;">
          Confluence Trading Tools · <a href="https://app.confluencetradingtools.com/admin" style="color: #818cf8;">Admin Panel</a>
        </p>
      </div>
    `;

    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: 'CTT <noreply@confluencetradingtools.com>',
      to: 'thomasbeach@gmail.com',
      subject: `CTT Stats · ${mrrDollars} MRR · ${activeSubs} subs · ${todaySignups.length} new`,
      html,
    });

    return NextResponse.json({ ok: true, mrr: mrr / 100, activeSubs, trialingSubs, todaySignups: todaySignups.length });
  } catch (err: any) {
    console.error('stats email error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}
