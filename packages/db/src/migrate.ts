import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './index.js';

/**
 * Migration runner. Runs as the compose `migrate` init container before api and
 * worker start, so it doubles as a Postgres readiness gate. No schema exists
 * yet (Phase 2), so with an empty/absent migrations folder this just verifies
 * connectivity and exits 0.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../drizzle');

async function main(): Promise<void> {
  await sql`select 1`;
  if (existsSync(migrationsFolder)) {
    await migrate(db, { migrationsFolder });
    console.log('Migrations applied.');
  } else {
    console.log('No migrations folder yet — connectivity verified, nothing to apply.');
  }
  await sql.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
