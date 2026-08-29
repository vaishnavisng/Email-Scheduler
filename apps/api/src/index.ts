import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { Client as EsClient } from '@elastic/elasticsearch';
import { env, type HealthResponse, type ApiError } from '@outbox/shared';
import { pingDb } from '@outbox/db';
import { createRedis, pingRedis } from '@outbox/queue';
import { api } from './routes.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const redis = createRedis();
const es = new EsClient({ node: env.ELASTICSEARCH_URL });

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
