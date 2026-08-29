import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { z } from 'zod';
import {
  env,
  verifyJwt,
  EMAIL_STATUSES,
  type ApiError,
  type EmailStatus,
  type MeResponse,
  type CreateCampaignResponse,
  type EmailListResponse,
  type EmailSearchResponse,
} from '@outbox/shared';
import {
  getUser,
  getSlackIntegration,
  listSenders,
  listEmails,
  createCampaignWithEmails,
  deleteSlackIntegration,
  searchEmailsPg,
  clampPagination,
} from '@outbox/db';
import { enqueueEmailSends, enqueueIndexBulk } from '@outbox/queue';
import { searchEmails } from '@outbox/search';
import { authorizeUrl } from './slack.js';
import { sessionTokenFromRequest } from './auth.js';

function fail(res: Response, status: number, code: string, message: string): void {
  const body: ApiError = { error: { code, message } };
  res.status(status).json(body);
}

// Express 4 doesn't forward async rejections; funnel them to the error handler.
const ah =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/** Verifies the session JWT (httpOnly cookie, or Bearer for scripts) and pins
 * req.userId. The Google OAuth callback in auth.ts issues the token. */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = sessionTokenFromRequest(req);
  const claims = token ? verifyJwt(token, env.JWT_SECRET) : null;
  if (!claims) {
    fail(res, 401, 'unauthorized', 'Missing or invalid authentication token.');
    return;
  }
  req.userId = claims.sub;
  next();
}

/** Narrows the optional req.userId to string; requireAuth ran first, so it's set. */
function userId(req: Request): string {
  if (!req.userId) throw new Error('userId missing after requireAuth');
  return req.userId;
}

const createCampaignSchema = z.object({
  subject: z.string().trim().min(1).max(998),
  body: z.string().min(1),
  startAt: z.string().datetime({ offset: true }),
  delayMs: z.number().int().nonnegative(),
  recipients: z.array(z.string().email()).min(1),
  hourlyLimit: z.number().int().positive().nullish(),
});

export const api: IRouter = Router();
api.use(requireAuth);

api.get('/me', ah(async (req, res) => {
  const uid = userId(req);
  const me = await getUser(uid);
  if (!me) {
    fail(res, 404, 'not_found', 'User not found.');
    return;
  }
  const slack = await getSlackIntegration(uid);
  const body: MeResponse = {
    ...me,
    slack: slack ? { teamName: slack.teamName, channel: slack.channel } : null,
  };
  res.json(body);
}));

api.get('/senders', ah(async (req, res) => {
  res.json(await listSenders(userId(req)));
}));

api.get('/emails', ah(async (req, res) => {
  const status = parseStatus(req.query.status);
  if (status === 'invalid') {
    fail(res, 400, 'bad_request', `Unknown status: ${String(req.query.status)}`);
    return;
  }
  const page = Number(req.query.page);
  const pageSize = Number(req.query.pageSize);
  const result: EmailListResponse = await listEmails(userId(req), {
    status,
    page,
    pageSize,
  });
  res.json(result);
}));

/** Parse and validate the shared status query param. Returns undefined if absent,
 * or throws a 400-shaped sentinel string if unknown. */
function parseStatus(raw: unknown): EmailStatus | undefined | 'invalid' {
  if (typeof raw !== 'string' || raw === '') return undefined;
  return EMAIL_STATUSES.includes(raw as EmailStatus)
    ? (raw as EmailStatus)
    : 'invalid';
}

// Full-text search over the user's emails. Elasticsearch is primary; if it's
// unreachable we fall back to a Postgres ILIKE query and flag `degraded: true`
// so the send path and the dashboard both survive a down ES.
api.get('/emails/search', ah(async (req, res) => {
  const status = parseStatus(req.query.status);
  if (status === 'invalid') {
    fail(res, 400, 'bad_request', `Unknown status: ${String(req.query.status)}`);
    return;
  }
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const fromRaw = typeof req.query.from === 'string' ? req.query.from : undefined;
  const toRaw = typeof req.query.to === 'string' ? req.query.to : undefined;
  for (const [name, v] of [['from', fromRaw], ['to', toRaw]] as const) {
    if (v && Number.isNaN(Date.parse(v))) {
      fail(res, 400, 'bad_request', `Invalid ${name} date: ${v}`);
      return;
    }
  }
  const { page, pageSize } = clampPagination({
    page: Number(req.query.page),
    pageSize: Number(req.query.pageSize),
  });

  const uid = userId(req);
  try {
    const { data, total } = await searchEmails({
      userId: uid,
      q,
      status: status || undefined,
      from: fromRaw,
      to: toRaw,
      page,
      pageSize,
    });
    const body: EmailSearchResponse = { data, page, pageSize, total, degraded: false };
    res.json(body);
  } catch (err) {
    // ES down/unreachable → degrade to Postgres rather than 500 the dashboard.
    console.warn('search: Elasticsearch unavailable, falling back to Postgres:', err);
    const pg = await searchEmailsPg(uid, {
      q,
      status: status || undefined,
      from: fromRaw ? new Date(fromRaw) : undefined,
      to: toRaw ? new Date(toRaw) : undefined,
      page,
      pageSize,
    });
    const body: EmailSearchResponse = { ...pg, degraded: true };
    res.json(body);
  }
}));

// Slack OAuth start: hand the browser an authorize URL (the SPA fetches this
// with its Bearer token, then redirects). The public callback lives in slack.ts.
api.get('/slack/connect', (req, res) => {
  if (!env.SLACK_CLIENT_ID) {
    fail(res, 503, 'slack_not_configured', 'Slack OAuth is not configured.');
    return;
  }
  res.json({ url: authorizeUrl(userId(req)) });
});

api.post('/slack/disconnect', ah(async (req, res) => {
  await deleteSlackIntegration(userId(req));
  res.status(204).end();
}));

api.post('/campaigns', ah(async (req, res) => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid body.');
    return;
  }
  const { subject, body, startAt, delayMs, recipients, hourlyLimit } = parsed.data;
  const { id, totalRecipients, emails } = await createCampaignWithEmails(
    userId(req),
    {
      subject,
      body,
      startAt: new Date(startAt),
      delayMs,
      recipients,
      hourlyLimit,
    },
  );
  // Enqueue only after the transaction has committed — see ARCHITECTURE §2.
  await enqueueEmailSends(emails);
  // Index the freshly-created rows (async, via the email-index queue — never
  // inline). A slow ES can't slow campaign creation; a failed enqueue must not
  // fail the request, so swallow it (the boot/reindex path backfills).
  await enqueueIndexBulk(emails.map((e) => e.id)).catch((err) =>
    console.error('campaigns: index enqueue failed', err),
  );
  const response: CreateCampaignResponse = { id, totalRecipients, startAt, delayMs };
  res.status(201).json(response);
}));
