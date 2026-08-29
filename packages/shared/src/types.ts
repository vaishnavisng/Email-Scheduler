/**
 * Shared API response shapes, imported by both API and web. Never redeclare a
 * response shape in the frontend. Fleshed out per phase; only the health
 * contract and the error envelope exist so far.
 */

export type DependencyStatus = 'ok' | 'down';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  dependencies: {
    db: DependencyStatus;
    redis: DependencyStatus;
    es: DependencyStatus;
  };
}

/** Every API error is this shape. Never leak stack traces. */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
