import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from 'express';
import { randomUUID } from 'node:crypto';
import { env, signJwt } from '@outbox/shared';
import { ensureUser } from '@outbox/db';

/**
 * Real Google OAuth, hand-rolled on `fetch` (mirrors slack.ts — no passport).
 * The Express API is the single auth authority: it runs the whole code flow and
 * issues an httpOnly JWT cookie the web app never reads. Flow:
 *   GET  /api/auth/google          → redirect to Google consent (+ CSRF state)
 *   GET  /api/auth/google/callback → exchange code, upsert user, set cookie
 *   POST /api/auth/logout          → clear cookie
 * See docs/DECISIONS/0008-cookie-auth.md.
 */

const SESSION_COOKIE = 'outbox_session';
const STATE_COOKIE = 'oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const STATE_TTL_SECONDS = 600; // 10 minutes
const isProd = env.NODE_ENV === 'production';

/** Parse the Cookie header into a flat map. One place, no cookie-parser dep. */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k) out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * The session token, cookie first (browser) then Bearer header (scripts, the
 * bootstrap demo JWT). requireAuth in routes.ts uses this so both keep working.
 */
export function sessionTokenFromRequest(req: Request): string | null {
  const fromCookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.header('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function setCookie(
  res: Response,
  name: string,
  value: string,
  maxAgeSeconds: number,
): void {
  res.cookie(name, value, {
    httpOnly: true,
    secure: isProd,
    // lax: the session cookie must survive the top-level GET redirect back from
    // Google. Cookies ignore ports, so a host-only `localhost` cookie set here
    // (:4000) is also sent to the web origin (:3000) and read by its middleware.
    // ponytail: works for localhost/same registrable domain; split domains in
    // real prod need an explicit shared parent Domain + sameSite=none;secure.
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  });
}

const loginBack = (status: string): string =>
  `${env.WEB_URL}/login?error=${status}`;

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

async function exchangeCode(code: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: env.GOOGLE_CALLBACK_URL,
    }),
  });
  const data = (await res.json()) as GoogleTokenResponse;
  if (!data.access_token) {
    throw new Error(`google token exchange failed: ${data.error ?? 'no token'}`);
  }
  return data.access_token;
}

async function fetchProfile(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`google userinfo failed: ${res.status}`);
  const data = (await res.json()) as GoogleUserInfo;
  if (!data.sub || !data.email) throw new Error('google userinfo missing sub/email');
  return data;
}

export const authRouter: IRouter = Router();

// Start the flow: stash a random CSRF nonce in a short-lived httpOnly cookie and
// echo it in `state`; the callback rejects any mismatch.
authRouter.get('/google', (_req, res) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    res.status(503).json({
      error: { code: 'oauth_not_configured', message: 'Google OAuth is not configured.' },
    });
    return;
  }
  const state = randomUUID();
  setCookie(res, STATE_COOKIE, state, STATE_TTL_SECONDS);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

authRouter.get('/google/callback', (req, res) => {
  void (async () => {
    if (typeof req.query.error === 'string') {
      res.redirect(loginBack('denied')); // user cancelled consent
      return;
    }
    const state = req.query.state;
    const cookieState = parseCookies(req.headers.cookie)[STATE_COOKIE];
    const code = req.query.code;
    if (
      typeof state !== 'string' ||
      !cookieState ||
      state !== cookieState ||
      typeof code !== 'string' ||
      code === ''
    ) {
      res.redirect(loginBack('state'));
      return;
    }
    res.clearCookie(STATE_COOKIE, { path: '/' });
    try {
      const profile = await fetchProfile(await exchangeCode(code));
      const user = await ensureUser({
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name ?? profile.email,
        avatarUrl: profile.picture ?? null,
      });
      const token = signJwt(
        { sub: user.id, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS },
        env.JWT_SECRET,
      );
      setCookie(res, SESSION_COOKIE, token, SESSION_TTL_SECONDS);
      res.redirect(`${env.WEB_URL}/dashboard`);
    } catch (err) {
      console.error('google callback:', err);
      res.redirect(loginBack('oauth'));
    }
  })();
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.status(204).end();
});
