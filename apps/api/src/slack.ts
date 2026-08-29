import { Router, type IRouter } from 'express';
import { env, signJwt, verifyJwt } from '@outbox/shared';
import { upsertSlackIntegration, type SlackIntegrationInput } from '@outbox/db';

/**
 * Slack OAuth v2 (incoming-webhook scope). The `connect` endpoint (in routes.ts,
 * behind auth) hands the browser this authorize URL; Slack redirects back to the
 * public callback below with a code + our signed state. We reuse the HS256 JWT
 * (packages/shared/jwt.ts) for the state param — a short-TTL token carrying the
 * user id — so the stateless callback can recover who initiated the flow without
 * a session store. See docs/DECISIONS/0007-slack.md.
 */

const STATE_TTL_SECONDS = 600;

/** Build the Slack authorize URL, embedding a signed 10-min state = { sub: userId }. */
export function authorizeUrl(userId: string): string {
  const state = signJwt(
    { sub: userId, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS },
    env.JWT_SECRET,
  );
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: 'incoming-webhook',
    redirect_uri: env.SLACK_REDIRECT_URI,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

/** Recover the user id from a state param, or null if missing/tampered/expired. */
function userIdFromState(state: unknown): string | null {
  if (typeof state !== 'string' || state === '') return null;
  return verifyJwt(state, env.JWT_SECRET)?.sub ?? null;
}

// Shape of the oauth.v2.access response we consume (fields we don't need omitted).
interface OAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id: string; name: string };
  incoming_webhook?: { url: string; channel: string };
}

/** Exchange the authorization code for a webhook URL + team/channel metadata. */
async function exchangeCode(code: string): Promise<SlackIntegrationInput> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
  });
  const data = (await res.json()) as OAuthAccessResponse;
  if (
    !data.ok ||
    !data.access_token ||
    !data.team ||
    !data.incoming_webhook?.url
  ) {
    throw new Error(`slack oauth failed: ${data.error ?? 'malformed response'}`);
  }
  return {
    teamId: data.team.id,
    teamName: data.team.name,
    channel: data.incoming_webhook.channel,
    webhookUrl: data.incoming_webhook.url,
    accessToken: data.access_token,
  };
}

const back = (status: string): string => `${env.WEB_URL}/?slack=${status}`;

/**
 * Public callback router (no auth header — Slack redirects the browser here).
 * Mounted at /api/slack in index.ts BEFORE the authed /api router. Always ends in
 * a redirect back to the dashboard with a status flag; never leaks error detail.
 */
export const slackCallbackRouter: IRouter = Router();

slackCallbackRouter.get('/callback', (req, res) => {
  void (async () => {
    if (typeof req.query.error === 'string') {
      // User clicked "Cancel" on Slack's consent screen.
      res.redirect(back('denied'));
      return;
    }
    const userId = userIdFromState(req.query.state);
    const code = req.query.code;
    if (!userId || typeof code !== 'string' || code === '') {
      res.redirect(back('error'));
      return;
    }
    try {
      await upsertSlackIntegration(userId, await exchangeCode(code));
      res.redirect(back('connected'));
    } catch (err) {
      console.error('slack callback:', err);
      res.redirect(back('error'));
    }
  })();
});
