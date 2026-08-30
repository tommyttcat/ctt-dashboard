import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';
import { getInvites, createInvite, updateInvite, deleteInvite } from '@/lib/invites';

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

  const invites = await getInvites();
  return NextResponse.json({ invites });
}

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { tier, label, maxUses, expiresAt, trialDays } = await req.json();

    if (!label?.trim()) {
      return NextResponse.json({ error: 'Label required' }, { status: 400 });
    }
    const validTiers = ['starter', 'core', 'pro', 'trial_7', 'trial_14', 'trial_30'];
    if (!validTiers.includes(tier)) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
    }

    const invite = await createInvite({
      tier,
      label,
      maxUses: maxUses || 0,
      expiresAt: expiresAt || null,
      trialDays: trialDays || undefined,
    });
    return NextResponse.json({ invite }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { code, ...updates } = await req.json();
    if (!code) {
      return NextResponse.json({ error: 'Invite code required' }, { status: 400 });
    }

    const allowed = ['active', 'label', 'maxUses', 'expiresAt'] as const;
    const clean: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in updates) clean[key] = updates[key as string];
    }

    const invite = await updateInvite(code, clean);
    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }
    return NextResponse.json({ invite });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return NextResponse.json({ error: 'Invite code required' }, { status: 400 });
  }

  const ok = await deleteInvite(code);
  if (!ok) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
