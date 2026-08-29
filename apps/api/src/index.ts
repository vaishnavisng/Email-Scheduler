import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import basicAuth from 'express-basic-auth';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { env, type HealthResponse, type ApiError } from '@outbox/shared';
import { pingDb } from '@outbox/db';
import { createEs } from '@outbox/search';
import {
  createRedis,
  pingRedis,
  emailSendQueue,
  emailIndexQueue,
} from '@outbox/queue';
import { api } from './routes.js';
import { slackCallbackRouter } from './slack.js';
import { authRouter } from './auth.js';

const app = express();
app.disable('x-powered-by');
// The web app is a separate origin (:3000) sending the session cookie, so CORS
// must echo that specific origin and allow credentials (never `*` with creds).
app.use(cors({ origin: env.WEB_URL, credentials: true }));
app.use(express.json());

const redis = createRedis();
const es = createEs();

async function pingEs(): Promise<boolean> {
  try {
    await es.ping();
    return true;
  } catch {
    return false;
  }
}

// A down dependency must report `down`, not hang the endpoint. ioredis is
// created with maxRetriesPerRequest:null (BullMQ's requirement), so ping()
// queues forever when Redis is offline instead of rejecting — bound every
// probe so /health always answers within the window.
function withTimeout(probe: Promise<boolean>, ms = 3000): Promise<boolean> {
  return Promise.race([
    probe,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

app.get('/health', async (_req, res) => {
  const [db, redisOk, esOk] = await Promise.all([
    withTimeout(pingDb()),
    withTimeout(pingRedis(redis)),
    withTimeout(pingEs()),
  ]);
  const dependencies = {
    db: db ? ('ok' as const) : ('down' as const),
    redis: redisOk ? ('ok' as const) : ('down' as const),
    es: esOk ? ('ok' as const) : ('down' as const),
  };
  const allOk = db && redisOk && esOk;
  const body: HealthResponse = {
    status: allOk ? 'ok' : 'degraded',
    dependencies,
  };
  res.status(allOk ? 200 : 503).json(body);
});

// Bull Board — live queue visibility, behind basic auth. Job history is retained
// (see the queue's removeOnComplete config) so the demo can show completed jobs.
const bullBoard = new ExpressAdapter();
bullBoard.setBasePath('/admin/queues');
createBullBoard({
  queues: [
    new BullMQAdapter(emailSendQueue()),
    new BullMQAdapter(emailIndexQueue()),
  ],
  serverAdapter: bullBoard,
});
app.use(
  '/admin/queues',
  basicAuth({
    users: { [env.BULLBOARD_USER]: env.BULLBOARD_PASS },
    challenge: true,
  }),
  bullBoard.getRouter(),
);

// Public auth routes (Google redirects the browser here with no session cookie
// yet) — must sit BEFORE the guarded /api router.
app.use('/api/auth', authRouter);

// Public Slack OAuth callback — Slack redirects the browser here with no auth
// header, so it must sit BEFORE the Bearer-guarded /api router.
app.use('/api/slack', slackCallbackRouter);

app.use('/api', api);

// Last-resort handler: async route rejections land here. Log server-side, return
// the error envelope — never a stack trace to the client (CONVENTIONS.md).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled API error:', err);
  const body: ApiError = {
    error: { code: 'internal', message: 'Internal server error.' },
  };
  res.status(500).json(body);
});

const server = app.listen(env.API_PORT, () => {
  console.log(`api listening on :${env.API_PORT}`);
});

// Graceful shutdown so `docker compose down` is clean.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      redis.quit();
      process.exit(0);
    });
  });
}
