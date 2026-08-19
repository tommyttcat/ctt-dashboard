import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(new URL('/login', origin));
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, path: '/', maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(new URL('/login', origin));
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, path: '/', maxAge: 0 });
  return res;
}
