/**
 * Shared API response shapes, imported by both API and web. Never redeclare a
 * response shape in the frontend. Fleshed out per phase.
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

export type EmailStatus =
  | 'scheduled'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export const EMAIL_STATUSES: readonly EmailStatus[] = [
  'scheduled',
  'queued',
  'sending',
  'sent',
  'failed',
  'cancelled',
];

/** GET /api/me — the authenticated user. */
export interface Me {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** GET /api/senders — one row. Secrets (smtpPass) are never serialized. */
export interface Sender {
  id: string;
  label: string;
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  hourlyLimit: number | null;
  isActive: boolean;
  createdAt: string;
}

/** POST /api/campaigns request body. Timestamps are ISO-8601 UTC strings. */
export interface CreateCampaignRequest {
  subject: string;
  body: string;
  startAt: string;
  delayMs: number;
  recipients: string[];
  hourlyLimit?: number | null;
}

/** POST /api/campaigns response. */
export interface CreateCampaignResponse {
  id: string;
  totalRecipients: number;
  startAt: string;
  delayMs: number;
}

/** GET /api/emails — one row. */
export interface EmailListItem {
  id: string;
  campaignId: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  seq: number;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** GET /api/emails — paginated envelope. */
export interface EmailListResponse {
  data: EmailListItem[];
  page: number;
  pageSize: number;
  total: number;
}
