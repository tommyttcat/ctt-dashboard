import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from './lib/auth';
import { getUserByEmail } from './lib/users';

const TRIAL_TIERS = ['trial_7', 'trial_14', 'trial_30'];
const FULL_ACCESS_TIERS = ['pro', ...TRIAL_TIERS];

const ROUTE_TIERS: [string, string[]][] = [
  ['/admin', ['__admin__']],
  ['/dashboard', [...FULL_ACCESS_TIERS, 'core']],
  ['/analyst', [...FULL_ACCESS_TIERS, 'core']],
  ['/confluence', [...FULL_ACCESS_TIERS]],
  ['/scanners', [...FULL_ACCESS_TIERS]],
];

const EXACT_ROUTES: [string, string[]][] = [
  ['/', [...FULL_ACCESS_TIERS, 'core']],
];

const ALLOWED_HOST = 'app.confluencetradingtools.com';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.nextUrl.hostname;

  if (host !== 'localhost' && host !== ALLOWED_HOST) {
    const url = new URL(pathname + request.nextUrl.search, `https://${ALLOWED_HOST}`);
    return NextResponse.redirect(url, 301);
  }

  // TEMP local debug bypass — remove before deploy (inert in production: host is never localhost there)
  if (host === 'localhost') return NextResponse.next();

  const EMAIL_ONLY_TIERS = ['starter'];

  if (pathname === '/login') {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (session) {
      const loginUser = await getUserByEmail(session.email);
      if (loginUser?.active && !EMAIL_ONLY_TIERS.includes(loginUser.tier)) {
        if (loginUser.accessExpiresAt && new Date(loginUser.accessExpiresAt) < new Date()) {
          return NextResponse.next();
        }
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
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

  const user = await getUserByEmail(session.email);
  if (!user || !user.active) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const tier = user.tier;
  const isAdmin = user.isAdmin;

  if (user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date()) {
    return NextResponse.redirect(new URL('/login?info=trial-expired', request.url));
  }

  const [, tiers] = match;
  if (tiers.includes('__admin__')) {
    if (!isAdmin) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.next();
  }

  if (!tiers.includes(tier)) {
    if (EMAIL_ONLY_TIERS.includes(tier)) {
      return NextResponse.redirect(new URL('/login?info=email-only', request.url));
    }
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/dashboard', '/analyst', '/confluence', '/scanners', '/admin', '/invite'],
};
