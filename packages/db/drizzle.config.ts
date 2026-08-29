import { defineConfig } from 'drizzle-kit';

// Build-time tool, not app runtime: read the URL straight from env (same default
// as packages/shared/env.ts) so drizzle-kit's CJS loader needn't resolve the
// shared ESM package.
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://outbox:outbox@postgres:5432/outbox',
  },
});
