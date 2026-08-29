import { Client } from '@elastic/elasticsearch';
import { env, type EmailListItem, type EmailStatus } from '@outbox/shared';

/**
 * Elasticsearch access for email search. Kept out of the send path entirely:
 * the worker indexes through the `email-index` BullMQ queue (never inline), and
 * the API reads through here. A down ES degrades search (Postgres fallback in the
 * route) but can never slow or fail a send. See docs/DECISIONS/0008-search-indexing.md.
 */

export const EMAILS_INDEX = 'emails';

/** One client per process. Cheap to construct; no connection is opened until first use. */
let client: Client | undefined;
export function createEs(): Client {
  if (!client) client = new Client({ node: env.ELASTICSEARCH_URL });
  return client;
}

/**
 * Explicit mapping. `recipient` is a keyword (exact filter/sort) with a `.text`
 * subfield so free-text search matches partial addresses; subject/body are
 * analysed text; the id-like fields are keywords; the timestamps are dates.
 * Dynamic mapping covers the remaining stored fields (seq, attempts, …) — they
 * are returned in hits but never queried, so their inferred types don't matter.
 */
const mappings = {
  properties: {
    recipient: { type: 'keyword', fields: { text: { type: 'text' } } },
    subject: { type: 'text' },
    body: { type: 'text' },
    status: { type: 'keyword' },
    user_id: { type: 'keyword' },
    sender_id: { type: 'keyword' },
    scheduled_at: { type: 'date' },
    sent_at: { type: 'date' },
  },
} as const;

/** Create the index with the explicit mapping if it doesn't exist yet. Idempotent. */
export async function ensureEmailsIndex(es: Client = createEs()): Promise<void> {
  const exists = await es.indices.exists({ index: EMAILS_INDEX });
  if (exists) return;
  try {
    await es.indices.create({ index: EMAILS_INDEX, mappings });
  } catch (err) {
    // A concurrent creator (another worker, bootstrap) won the race — fine.
    const type = (err as { body?: { error?: { type?: string } } })?.body?.error
      ?.type;
    if (type !== 'resource_already_exists_exception') throw err;
  }
}

/** The subset of an email row needed to build a search document. */
export interface EmailDocSource {
  id: string;
  campaignId: string;
  userId: string;
  senderId: string | null;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  seq: number;
  scheduledAt: Date;
  sentAt: Date | null;
  attempts: number;
  lastError: string | null;
  previewUrl: string | null;
  createdAt: Date;
}

/** Stored _source shape (snake_case to match the mapping). */
interface EmailDoc {
  id: string;
  campaign_id: string;
  user_id: string;
  sender_id: string | null;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  seq: number;
  scheduled_at: string;
  sent_at: string | null;
  attempts: number;
  last_error: string | null;
  preview_url: string | null;
  created_at: string;
}

const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toEmailDoc(row: EmailDocSource): EmailDoc {
  return {
    id: row.id,
    campaign_id: row.campaignId,
    user_id: row.userId,
    sender_id: row.senderId,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    seq: row.seq,
    scheduled_at: row.scheduledAt.toISOString(),
    sent_at: toIso(row.sentAt),
    attempts: row.attempts,
    last_error: row.lastError,
    preview_url: row.previewUrl,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Upsert one email by `_id = email.id`. Upsert (not create) makes reprocessing a
 * queued index job harmless — a status transition re-indexes the same doc id.
 */
export async function indexEmail(
  row: EmailDocSource,
  es: Client = createEs(),
): Promise<void> {
  const doc = toEmailDoc(row);
  await es.index({ index: EMAILS_INDEX, id: doc.id, document: doc });
}

function docToItem(d: EmailDoc): EmailListItem {
  return {
    id: d.id,
    campaignId: d.campaign_id,
    recipient: d.recipient,
    subject: d.subject,
    status: d.status,
    seq: d.seq,
    scheduledAt: d.scheduled_at,
    sentAt: d.sent_at,
    attempts: d.attempts,
    lastError: d.last_error,
    previewUrl: d.preview_url ?? null,
    createdAt: d.created_at,
  };
}

export interface SearchParams {
  userId: string;
  q?: string;
  status?: EmailStatus | EmailStatus[];
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface SearchResult {
  data: EmailListItem[];
  total: number;
}

/**
 * User-scoped search. Always filtered by user_id; free text (`q`) is a
 * multi_match over subject, body and the recipient text subfield; `status` and a
 * `scheduled_at` range narrow further; results are date-sorted and paginated.
 */
/** Pure query builder — the `user_id` filter is ALWAYS present (search must never
 * cross users). Extracted so that invariant is unit-testable without a live ES. */
export function buildSearchBody(params: SearchParams): {
  from: number;
  size: number;
  sort: unknown[];
  query: Record<string, unknown>;
} {
  const filter: Record<string, unknown>[] = [
    { term: { user_id: params.userId } },
  ];
  if (params.status)
    filter.push(
      Array.isArray(params.status)
        ? { terms: { status: params.status } }
        : { term: { status: params.status } },
    );
  if (params.from || params.to) {
    filter.push({
      range: {
        scheduled_at: {
          ...(params.from ? { gte: params.from } : {}),
          ...(params.to ? { lte: params.to } : {}),
        },
      },
    });
  }

  const must = params.q
    ? [
        {
          multi_match: {
            query: params.q,
            fields: ['subject', 'body', 'recipient.text'],
          },
        },
      ]
    : [{ match_all: {} }];

  return {
    from: (params.page - 1) * params.pageSize,
    size: params.pageSize,
    sort: [{ scheduled_at: 'desc' }],
    query: { bool: { must, filter } },
  };
}

export async function searchEmails(
  params: SearchParams,
  es: Client = createEs(),
): Promise<SearchResult> {
  const res = await es.search<EmailDoc>({
    index: EMAILS_INDEX,
    ...buildSearchBody(params),
  });

  const total =
    typeof res.hits.total === 'number'
      ? res.hits.total
      : (res.hits.total?.value ?? 0);
  const data = res.hits.hits
    .map((h) => h._source)
    .filter((s): s is EmailDoc => Boolean(s))
    .map(docToItem);
  return { data, total };
}
