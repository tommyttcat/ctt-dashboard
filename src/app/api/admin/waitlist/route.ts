import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Resend } from 'resend';
import { verifySession, SESSION_COOKIE, createMagicToken } from '@/lib/auth';
import { getWaitlist, updateWaitlistEntry, deleteWaitlistEntry } from '@/lib/waitlist';
import { addUser } from '@/lib/users';

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

  const entries = await getWaitlist();
  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { id, tier } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Entry ID required' }, { status: 400 });
    }

    const entries = await getWaitlist();
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    const user = await addUser({
      email: entry.email,
      name: entry.name,
      tier: tier || 'full',
      source: 'general',
    });

    await updateWaitlistEntry(id, 'approved');

    const token = await createMagicToken(user.email);
    const link = `https://app.confluencetradingtools.com/api/auth/verify?token=${encodeURIComponent(token)}`;

    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: 'CTT <noreply@confluencetradingtools.com>',
        to: user.email,
        subject: "You're in! Welcome to Confluence Trading Tools",
        html: `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#020408;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#020408;"><tr><td align="center" style="padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#05080f;border:1px solid #0f1729;border-radius:12px;padding:40px 32px;text-align:center;">
    <div style="margin-bottom:24px;">
      <span style="font-size:18px;font-weight:800;color:#f1f5f9;">Confluence Trading Tools</span>
    </div>
    <div style="font-size:14px;color:#94a3b8;margin-bottom:8px;line-height:1.6;">
      Great news, ${user.name}!
    </div>
    <div style="font-size:14px;color:#94a3b8;margin-bottom:32px;line-height:1.6;">
      Your access has been approved. Click below to sign in and get started.
    </div>
    <a href="${link}" style="display:inline-block;background:#6366f1;color:#ffffff;font-weight:700;font-size:14px;padding:12px 32px;border-radius:8px;text-decoration:none;">
      Sign In Now
    </a>
    <div style="font-size:12px;color:#475569;margin-top:32px;line-height:1.5;">
      This link expires in 15 minutes. You can always request a new one from the sign-in page.
    </div>
  </div>
</td></tr></table>
</body></html>`,
      });
    }

    return NextResponse.json({ ok: true, user });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { id, status } = await req.json();
    if (!id || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Valid ID and status required' }, { status: 400 });
    }

    const entry = await updateWaitlistEntry(id, status);
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
    return NextResponse.json({ entry });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Entry ID required' }, { status: 400 });
  }

  const ok = await deleteWaitlistEntry(id);
  if (!ok) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
