import type {
  MeResponse,
  EmailListResponse,
  EmailSearchResponse,
  EmailStatus,
  CreateCampaignRequest,
  CreateCampaignResponse,
} from '@outbox/shared';

/**
 * Typed API client. The only place in the web app that calls the backend; every
 * response shape is imported from @outbox/shared (never redeclared here), and
 * every request sends the httpOnly session cookie via `credentials: 'include'`.
 * Components never fetch directly — they go through the TanStack hooks in
 * queries.ts, which wrap these functions.
 */

// localhost is correct here: this is the browser-facing base URL (CONVENTIONS §7).
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)
      ?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'error',
      err?.message ?? res.statusText,
    );
  }
  return data as T;
}

export interface EmailListParams {
  status?: EmailStatus | EmailStatus[];
  page?: number;
  pageSize?: number;
}

export interface EmailSearchParams extends EmailListParams {
  q?: string;
}

function emailQuery(params: EmailSearchParams): string {
  const q = new URLSearchParams();
  if (params.status)
    q.set(
      'status',
      Array.isArray(params.status) ? params.status.join(',') : params.status,
    );
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.q) q.set('q', params.q);
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  /** Full-page navigation target that starts the Google OAuth flow. */
  loginUrl: (): string => `${BASE}/api/auth/google`,

  me: (): Promise<MeResponse> => request<MeResponse>('/api/me'),

  emails: (params: EmailListParams = {}): Promise<EmailListResponse> =>
    request<EmailListResponse>(`/api/emails${emailQuery(params)}`),

  search: (params: EmailSearchParams = {}): Promise<EmailSearchResponse> =>
    request<EmailSearchResponse>(`/api/emails/search${emailQuery(params)}`),

  createCampaign: (
    body: CreateCampaignRequest,
  ): Promise<CreateCampaignResponse> =>
    request<CreateCampaignResponse>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  logout: (): Promise<void> =>
    request<void>('/api/auth/logout', { method: 'POST' }),

  slackConnect: (): Promise<{ url: string }> =>
    request<{ url: string }>('/api/slack/connect'),

  slackDisconnect: (): Promise<void> =>
    request<void>('/api/slack/disconnect', { method: 'POST' }),
};
