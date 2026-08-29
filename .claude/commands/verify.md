Run pnpm typecheck, pnpm lint, and pnpm test. Then audit the working tree against
CLAUDE.md's hard constraints: grep for cron libraries, setInterval used for
scheduling, in-memory rate-limit counters, `throw new Error` in rate-limit paths,
and any mock or bypass login. Report anything found. Do not fix without asking.
