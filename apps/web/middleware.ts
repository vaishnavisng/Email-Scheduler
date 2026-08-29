import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route gate. The API is the real auth authority (it verifies the JWT signature);
 * middleware only checks the httpOnly session cookie's *presence* to redirect —
 * a cheap, edge-safe guard, not a security boundary. The cookie is host-only for
 * `localhost` and cookies ignore ports, so the one set by the API (:4000) is sent
 * here (:3000) too. A tampered/expired token still passes this check but is
 * rejected by /api on the first data call, which sends the client to /login.
 */
const SESSION_COOKIE = 'outbox_session';

export function middleware(req: NextRequest): NextResponse {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  const { pathname } = req.nextUrl;
  const onLogin = pathname === '/login';

  if (!hasSession && !onLogin) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (hasSession && onLogin) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  return NextResponse.next();
}

// Guard everything except Next internals, the health route, and static assets.
export const config = {
  matcher: ['/((?!_next/static|_next/image|api/health|favicon.ico).*)'],
};
