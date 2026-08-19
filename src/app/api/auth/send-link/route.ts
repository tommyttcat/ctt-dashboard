import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createMagicToken } from '@/lib/auth';
import { getUserByEmail } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const user = await getUserByEmail(email);
    if (!user || !user.active) {
      // Don't reveal whether the email exists
      return NextResponse.json({ ok: true });
    }

    const token = await createMagicToken(user.email);

    const origin = new URL(req.url).origin;
    const link = `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`;

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log('AUTH: magic link for', email, link);
      return NextResponse.json({ ok: true });
    }

    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: 'CTT <noreply@confluencetradingtools.com>',
      to: user.email,
      subject: 'Sign in to Confluence Trading Tools',
      html: `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#020408;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#020408;"><tr><td align="center" style="padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#05080f;border:1px solid #0f1729;border-radius:12px;padding:40px 32px;text-align:center;">
    <div style="margin-bottom:24px;">
      <span style="font-size:18px;font-weight:800;color:#f1f5f9;">Confluence Trading Tools</span>
    </div>
    <div style="font-size:14px;color:#94a3b8;margin-bottom:32px;line-height:1.6;">
      Click the button below to sign in. This link expires in 15 minutes.
    </div>
    <a href="${link}" style="display:inline-block;background:#6366f1;color:#ffffff;font-weight:700;font-size:14px;padding:12px 32px;border-radius:8px;text-decoration:none;">
      Sign In
    </a>
    <div style="font-size:12px;color:#475569;margin-top:32px;line-height:1.5;">
      If you didn't request this, you can ignore this email.
    </div>
  </div>
</td></tr></table>
</body></html>`,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('send-link error:', err);
    return NextResponse.json({ error: 'Failed to send link' }, { status: 500 });
  }
}
