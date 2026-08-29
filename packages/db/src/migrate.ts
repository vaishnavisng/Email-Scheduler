import { sql, runMigrations } from './index.js';

/**
 * Migration CLI (`pnpm db:migrate`). The compose init container runs the
 * bootstrap script instead (migrations + sender provisioning); this stays for
 * running migrations on their own.
 */
async function main(): Promise<void> {
  await sql`select 1`;
  await runMigrations();
  await sql.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
