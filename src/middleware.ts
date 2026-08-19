import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from './lib/auth';

const ROUTE_TIERS: [string, string[]][] = [
  ['/admin', ['__admin__']],
  ['/dashboard', ['full']],
  ['/analyst', ['full', 'briefing']],
  ['/confluence', ['full', 'confluence']],
];

const EXACT_ROUTES: [string, string[]][] = [
  ['/', ['full']],
];

const ALLOWED_HOST = 'app.confluencetradingtools.com';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.nextUrl.hostname;

  if (host !== 'localhost' && host !== ALLOWED_HOST) {
    const url = new URL(pathname + request.nextUrl.search, `https://${ALLOWED_HOST}`);
    return NextResponse.redirect(url, 301);
  }

  const EMAIL_ONLY_TIERS = ['briefing_email', 'confluence_email', 'both_email'];

  if (pathname === '/login') {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (session && !EMAIL_ONLY_TIERS.includes(session.tier)) {
      const dest = session.tier === 'full' ? '/dashboard' : session.tier === 'briefing' ? '/analyst' : '/confluence';
      return NextResponse.redirect(new URL(dest, request.url));
    }
    return NextResponse.next();
  }

  const exactMatch = EXACT_ROUTES.find(([path]) => pathname === path);
  const match = exactMatch || ROUTE_TIERS.find(([path]) => pathname === path || pathname.startsWith(path + '/'));
  if (!match) return NextResponse.next();

  const ssToken = request.nextUrl.searchParams.get('_ss');
  const cronSecret = process.env.CRON_SECRET;
  if (ssToken && cronSecret && ssToken === cronSecret) return NextResponse.next();

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const [, tiers] = match;
  if (tiers.includes('__admin__')) {
    if (!session.isAdmin) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.next();
  }

  if (!tiers.includes(session.tier)) {
    if (EMAIL_ONLY_TIERS.includes(session.tier)) {
      return NextResponse.redirect(new URL('/login?info=email-only', request.url));
    }
    const dest = session.tier === 'full' ? '/dashboard' : session.tier === 'briefing' ? '/analyst' : '/confluence';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/dashboard', '/analyst', '/confluence', '/admin', '/invite'],
};
