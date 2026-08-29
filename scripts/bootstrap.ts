import nodemailer from 'nodemailer';
import { env, signJwt } from '@outbox/shared';
import {
  sql,
  runMigrations,
  ensureUser,
  countSenders,
  insertSenders,
} from '@outbox/db';

/**
 * Boot-time provisioning, run by the compose `migrate` init container before api
 * and worker start. Idempotent: safe to re-run on every `up`.
 *
 *   1. wait for Postgres, apply migrations
 *   2. if the senders table is empty, provision three Ethereal senders
 *   3. seed a demo user to own them (real users arrive via OAuth in Phase 6)
 *
 * The API must never fail to boot because Ethereal was down, so sender
 * provisioning degrades: live Ethereal accounts → ETHEREAL_USER_n/PASS_n env →
 * skip with a warning.
 */

const SENDER_COUNT = 3;
const DEMO_SUB = 'demo-bootstrap-user';

interface Cred {
  user: string;
  pass: string;
  host: string;
  port: number;
}

/** Try live Ethereal accounts; fall back to env creds; else return []. */
async function resolveCreds(): Promise<Cred[]> {
  const creds: Cred[] = [];
  try {
    for (let i = 0; i < SENDER_COUNT; i++) {
      const acct = await nodemailer.createTestAccount();
      creds.push({
        user: acct.user,
        pass: acct.pass,
        host: acct.smtp.host,
        port: acct.smtp.port,
      });
    }
    console.log('Provisioned Ethereal test accounts.');
    return creds;
  } catch (err) {
    console.warn(
      `Ethereal unreachable (${(err as Error).message}); trying ETHEREAL_USER_n env.`,
    );
  }

  for (let i = 1; i <= SENDER_COUNT; i++) {
    const user = process.env[`ETHEREAL_USER_${i}`];
    const pass = process.env[`ETHEREAL_PASS_${i}`];
    if (user && pass) {
      creds.push({ user, pass, host: 'smtp.ethereal.email', port: 587 });
    }
  }
  if (creds.length > 0) console.log(`Using ${creds.length} sender(s) from env.`);
  return creds;
}

async function main(): Promise<void> {
  await sql`select 1`;
  await runMigrations();

  if ((await countSenders()) > 0) {
    console.log('Senders already present — skipping provisioning.');
    await sql.end();
    return;
  }

  const demo = await ensureUser({
    googleSub: DEMO_SUB,
    email: 'demo@outbox.local',
    name: 'Demo User',
  });
  // A never-expiring token for the demo user, so the Phase 3 gate can POST
  // campaigns before Google OAuth (Phase 6) exists.
  console.log(`Demo user id: ${demo.id}`);
  console.log(`Demo JWT: ${signJwt({ sub: demo.id }, env.JWT_SECRET)}`);

  const creds = await resolveCreds();
  if (creds.length === 0) {
    console.warn(
      'No Ethereal senders provisioned. API will still boot; set ETHEREAL_USER_n/PASS_n or restart when Ethereal is reachable.',
    );
    await sql.end();
    return;
  }

  await insertSenders(
    creds.map((c, i) => ({
      userId: demo.id,
      label: `Ethereal ${i + 1}`,
      fromName: `Outbox Sender ${i + 1}`,
      fromEmail: c.user,
      smtpHost: c.host,
      smtpPort: c.port,
      smtpUser: c.user,
      smtpPass: c.pass,
    })),
  );
  for (const c of creds) {
    console.log(`  sender ${c.user} / ${c.pass} @ ${c.host}:${c.port}`);
  }
  console.log(`Provisioned ${creds.length} sender(s).`);
  await sql.end();
}

main().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
