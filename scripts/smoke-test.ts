import { sql, ensureUser } from '@outbox/db';
import { signJwt, env } from '@outbox/shared';

/**
 * End-to-end smoke test against a running compose stack. Exits non-zero on any
 * failure so CI can gate on it.
 *
 *   node --env-file=.env --import tsx scripts/smoke-test.ts   (or: pnpm smoke-test)
 *
 * Steps: /health is green → create a 3-recipient campaign 5s out over HTTP →
 * poll Postgres until all three send → assert exactly three rows, no duplicates →
 * assert they are searchable via the API. Counts are checked against Postgres (the
 * source of truth); everything else goes through the same HTTP surface the UI uses.
 */

const API = process.env.API_URL ?? `http://localhost:${env.API_PORT}`;
const TIMEOUT_MS = 90_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fail(msg: string, extra?: unknown): never {
  console.error('smoke-test FAIL:', msg, extra ?? '');
  process.exit(1);
}

async function main(): Promise<void> {
  // 1. Health — every dependency must be ok.
  const health = await fetch(`${API}/health`).catch((e) =>
    fail(`cannot reach ${API}/health`, e.message),
  );
  const hb = await health.json();
  if (health.status !== 200 || hb.status !== 'ok')
    fail(`unhealthy (${health.status})`, JSON.stringify(hb));
  console.log('✓ health ok', hb.dependencies);

  // 2. Mint a session token for the seeded demo user (ensureUser is an upsert, so
  //    this is safe whether or not bootstrap already created it).
  const user = await ensureUser({
    googleSub: 'demo-bootstrap-user',
    email: 'demo@outbox.local',
    name: 'Demo User',
  });
  const H = {
    authorization: `Bearer ${signJwt({ sub: user.id }, env.JWT_SECRET)}`,
    'content-type': 'application/json',
  };

  // 3. Create a 3-recipient campaign firing 5s out (unique tag = campaign subject).
  const tag = `smoke-${Date.now()}`;
  const recipients = ['a', 'b', 'c'].map((s) => `${tag}-${s}@example.com`);
  const res = await fetch(`${API}/api/campaigns`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      subject: tag,
      body: 'smoke test',
      startAt: new Date(Date.now() + 5_000).toISOString(),
      delayMs: 500,
      recipients,
      hourlyLimit: null,
    }),
  });
  const camp = await res.json();
  if (res.status !== 201) fail('create campaign failed', JSON.stringify(camp));
  if (camp.totalRecipients !== 3)
    fail(`expected 3 recipients, got ${camp.totalRecipients}`);
  console.log(`✓ created campaign ${camp.id}`);

  // 4. Poll Postgres until all three rows reach 'sent' (or fail on timeout).
  const deadline = Date.now() + TIMEOUT_MS;
  let statuses: string[] = [];
  while (Date.now() < deadline) {
    const rows = await sql<{ status: string }[]>`
      select status from emails where campaign_id = ${camp.id}`;
    statuses = rows.map((r) => r.status);
    if (statuses.length && statuses.every((s) => s === 'sent')) break;
    if (statuses.some((s) => s === 'failed'))
      fail('a row failed to send', statuses);
    await sleep(2_000);
  }
  if (!(statuses.length === 3 && statuses.every((s) => s === 'sent')))
    fail('not all rows sent within timeout', statuses);

  // 5. Exactly three rows, no duplicate recipients (checked against Postgres).
  const rows = await sql<{ recipient: string }[]>`
    select recipient from emails where campaign_id = ${camp.id}`;
  if (rows.length !== 3) fail(`expected exactly 3 rows, got ${rows.length}`);
  if (new Set(rows.map((r) => r.recipient)).size !== 3)
    fail('duplicate recipients detected', rows);
  console.log('✓ all 3 sent, exactly 3 rows, no duplicates');

  // 6. Searchable via the API (eventually consistent — retry through index lag).
  let found = 0;
  for (let i = 0; i < 20 && found < 3; i++) {
    const s = await fetch(
      `${API}/api/emails/search?q=${encodeURIComponent(tag)}`,
      { headers: H },
    );
    const sj = await s.json();
    found = (sj.data ?? []).filter((e: { recipient: string }) =>
      recipients.includes(e.recipient),
    ).length;
    if (found < 3) await sleep(2_000);
  }
  if (found < 3) fail(`search found ${found}/3 for "${tag}"`);
  console.log('✓ searchable: 3/3');

  console.log('smoke-test PASS');
  await sql.end();
  process.exit(0);
}

main().catch((err) => fail('unexpected error', err));
