export const dynamic = 'force-dynamic';

// Liveness for the compose healthcheck — the web process is up if this responds.
export function GET() {
  return Response.json({ status: 'ok' });
}
