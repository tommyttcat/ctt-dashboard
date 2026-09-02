import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';

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

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = thirtyDaysAgo.toISOString().slice(0, 10);
    const endDate = now.toISOString().slice(0, 10);

    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
    });

    const res = await fetch(`https://api.resend.com/emails/metrics?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[email-metrics] Resend API error:', res.status, text);
      return NextResponse.json(
        { error: `Resend API returned ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();

    return NextResponse.json({
      startDate,
      endDate,
      metrics: data,
    });
  } catch (err: any) {
    console.error('[email-metrics] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to fetch email metrics' }, { status: 500 });
  }
}
