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
  type CreateCampaignResponse,
  type EmailListResponse,
} from '@outbox/shared';
import {
  getUser,
  listSenders,
  listEmails,
  createCampaignWithEmails,
  deleteSlackIntegration,
} from '@outbox/db';
import { enqueueEmailSends } from '@outbox/queue';
import { authorizeUrl } from './slack.js';

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

/** Verifies the Bearer JWT and pins req.userId. Phase 6's OAuth issues the token. */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
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
  const me = await getUser(userId(req));
  if (!me) {
    fail(res, 404, 'not_found', 'User not found.');
    return;
  }
  res.json(me);
}));

api.get('/senders', ah(async (req, res) => {
  res.json(await listSenders(userId(req)));
}));

api.get('/emails', ah(async (req, res) => {
  const rawStatus = req.query.status;
  let status: EmailStatus | undefined;
  if (typeof rawStatus === 'string' && rawStatus !== '') {
    if (!EMAIL_STATUSES.includes(rawStatus as EmailStatus)) {
      fail(res, 400, 'bad_request', `Unknown status: ${rawStatus}`);
      return;
    }
    status = rawStatus as EmailStatus;
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
  const response: CreateCampaignResponse = { id, totalRecipients, startAt, delayMs };
  res.status(201).json(response);
}));
