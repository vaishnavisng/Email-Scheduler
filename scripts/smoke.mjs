// Minimal smoke test: hit the API /health and assert every dependency is ok.
// Usage: node scripts/smoke.mjs  (API_URL overridable)
const url = `${process.env.API_URL ?? 'http://localhost:4000'}/health`;

const res = await fetch(url).catch((err) => {
  console.error(`smoke: cannot reach ${url}:`, err.message);
  process.exit(1);
});

const body = await res.json();
const deps = body.dependencies ?? {};
const down = Object.entries(deps).filter(([, v]) => v !== 'ok');

if (res.status !== 200 || down.length > 0) {
  console.error(`smoke: unhealthy (${res.status})`, JSON.stringify(body));
  process.exit(1);
}
console.log('smoke: ok', JSON.stringify(body));
