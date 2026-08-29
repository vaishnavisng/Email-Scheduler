import { z } from 'zod';

/**
 * Single source of truth for configuration. Every value is env-driven with a
 * default that lets `.env.example` boot with zero edits. Parsing happens once,
 * at import; a bad value fails loudly here rather than surfacing as a mystery
 * runtime error later. No limit or timing constant is hardcoded anywhere else.
 */
const IntFromString = (def: number) =>
  z.coerce.number().int().nonnegative().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Backing services. Hostnames are Docker service names; nothing here is
  // localhost, so containers talk to each other by service name (see CLAUDE.md).
  DATABASE_URL: z
    .string()
    .default('postgres://outbox:outbox@postgres:5432/outbox'),
  REDIS_URL: z.string().default('redis://redis:6379'),
  ELASTICSEARCH_URL: z.string().default('http://elasticsearch:9200'),

  // Worker throughput / rate limiting. All configurable, none hardcoded.
  WORKER_CONCURRENCY: IntFromString(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: IntFromString(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: IntFromString(200),
  MAX_EMAILS_PER_HOUR_GLOBAL: IntFromString(1000),
  RATE_LIMIT_WINDOW_MS: IntFromString(3_600_000),
  STALLED_SEND_THRESHOLD_MS: IntFromString(120_000),

  // Google OAuth — filled in during Phase 6, optional until then.
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z
    .string()
    .default('http://localhost:4000/api/auth/google/callback'),

  // Slack OAuth — filled in during Phase 8, optional until then.
  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_REDIRECT_URI: z
    .string()
    .default('http://localhost:4000/api/slack/callback'),

  // Auth + Bull Board.
  JWT_SECRET: z.string().min(1).default('dev-insecure-jwt-secret-change-me'),
  BULLBOARD_USER: z.string().default('admin'),
  BULLBOARD_PASS: z.string().default('admin'),

  // Host port overrides (only these leak localhost, via NEXT_PUBLIC on web).
  API_PORT: IntFromString(4000),
  WEB_PORT: IntFromString(3000),
  NEXT_PUBLIC_API_URL: z.string().default('http://localhost:4000'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Fail loudly at boot rather than limping along with bad config.
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();
