import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';
import { getUserByEmail, addUser } from '@/lib/users';
import { getInviteByCode, useInvite, updateInvite } from '@/lib/invites';

export const dynamic = 'force-dynamic';

const VALID_TIERS = ['starter', 'core', 'pro'] as const;
const TRIAL_DAYS = 14;

export async function POST(req: Request) {
  try {
    const { code, tier: directTier, email, name } = await req.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists. Use the sign-in page instead.' }, { status: 400 });
    }

    let userTier: string;
    let accessExpiresAt: string | undefined;
    let source: 'invite' | 'general' = 'general';
    let inviteCode: string | undefined;

    if (code) {
      const invite = await getInviteByCode(code);
      if (!invite || !invite.active) {
        return NextResponse.json({ error: 'Invalid or expired invite code' }, { status: 400 });
      }
      if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
        return NextResponse.json({ error: 'This invite has reached its maximum uses' }, { status: 400 });
      }
      if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
        return NextResponse.json({ error: 'This invite has expired' }, { status: 400 });
      }

      userTier = invite.tier;
      source = 'invite';
      inviteCode = code;
      const days = invite.trialDays || (invite.tier === 'trial_7' ? 7 : invite.tier === 'trial_14' ? 14 : 0);
      if (days > 0) {
        accessExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      }

      await useInvite(code);
      if (invite.tier === 'pro') {
        await updateInvite(code, { active: false });
      }
    } else if (directTier && VALID_TIERS.includes(directTier)) {
      userTier = directTier;
      accessExpiresAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    } else {
      return NextResponse.json({ error: 'Invite code or plan selection required' }, { status: 400 });
    }

    const user = await addUser({
      email,
      name: name.trim(),
      tier: userTier as any,
      source,
      accessExpiresAt,
    });

    const sessionToken = await createSessionToken({
      email: user.email,
      name: user.name,
      tier: user.tier,
      isAdmin: false,
      accessExpiresAt: user.accessExpiresAt,
    });

    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const resend = new Resend(apiKey);
      const tierLabels: Record<string, string> = { starter: 'Starter', core: 'Core', pro: 'Pro', trial_7: '7-Day Trial', trial_14: '14-Day Trial' };
      const tierLabel = tierLabels[userTier] || userTier;
      const signupMethod = inviteCode ? `invite <code>${inviteCode}</code>` : 'pricing page trial';
      resend.emails.send({
        from: 'CTT <noreply@confluencetradingtools.com>',
        to: 'thomasbeach@gmail.com',
        subject: `New signup: ${name.trim()} (${tierLabel} trial)`,
        html: `<p><strong>${name.trim()}</strong> (${email}) just signed up via ${signupMethod}.</p><p>Tier: ${tierLabel}</p>${accessExpiresAt ? `<p>Trial expires: ${new Date(accessExpiresAt).toLocaleDateString()}</p>` : ''}`,
      }).catch(() => {});
    }

    const mappedTier = ['trial_7', 'trial_14'].includes(user.tier) ? 'pro' : user.tier;
    const dest = `/welcome?tier=${mappedTier}`;

    const res = NextResponse.json({ ok: true, redirect: dest });
    res.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err: any) {
    console.error('invite redeem error:', err);
    return NextResponse.json({ error: err.message || 'Something went wrong' }, { status: 500 });
  }
}
