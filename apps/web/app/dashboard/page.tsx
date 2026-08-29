'use client';

import { useEffect, useMemo, useState } from 'react';
import type { EmailListItem, EmailStatus } from '@outbox/shared';
import { useEmails } from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { Badge, STATUS_TONE } from '@/components/ui/Badge';
import { Table, type Column } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ComposeModal } from '@/components/ComposeModal';
import { cn } from '@/lib/cn';

type Tab = 'scheduled' | 'sent';

// Scheduled = everything still in flight; Sent = terminal states. A row migrates
// scheduled→queued→sending→sent, so grouping this way keeps it visible in exactly
// one tab the whole time (the live demo watches it cross over).
const TAB_STATUS: Record<Tab, EmailStatus[]> = {
  scheduled: ['scheduled', 'queued', 'sending'],
  sent: ['sent', 'failed'],
};

const PAGE_SIZE = 25;

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

const statusCell = (r: EmailListItem) => (
  <div className="flex flex-col gap-1">
    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
    {r.status === 'failed' && r.lastError && (
      <span className="max-w-xs truncate text-xs text-danger" title={r.lastError}>
        {r.lastError}
      </span>
    )}
  </div>
);

const COLUMNS: Record<Tab, Column<EmailListItem>[]> = {
  scheduled: [
    { key: 'recipient', header: 'Email', cell: (r) => r.recipient },
    { key: 'subject', header: 'Subject', cell: (r) => r.subject },
    { key: 'when', header: 'Scheduled time', cell: (r) => fmt(r.scheduledAt) },
    { key: 'status', header: 'Status', cell: statusCell },
  ],
  sent: [
    { key: 'recipient', header: 'Email', cell: (r) => r.recipient },
    { key: 'subject', header: 'Subject', cell: (r) => r.subject },
    { key: 'when', header: 'Sent time', cell: (r) => fmt(r.sentAt) },
    { key: 'status', header: 'Status', cell: statusCell },
    {
      key: 'preview',
      header: 'Preview',
      cell: (r) =>
        r.previewUrl ? (
          <a
            href={r.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
          >
            View
          </a>
        ) : (
          '—'
        ),
    },
  ],
};

/** Debounce a fast-changing value (the search box) so we don't fire a request per
 * keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-4 border-b border-border px-4 py-3.5 last:border-0">
          {Array.from({ length: cols }).map((__, j) => (
            <div key={j} className="h-4 flex-1 animate-pulse rounded bg-bg" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>('scheduled');
  const [composeOpen, setComposeOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const q = useDebounced(searchInput.trim(), 300);

  // Any tab/search change resets to the first page.
  useEffect(() => setPage(1), [tab, q]);

  const { data, isLoading, isError, isFetching } = useEmails({
    status: TAB_STATUS[tab],
    page,
    pageSize: PAGE_SIZE,
    q: q || undefined,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const columns = useMemo(() => COLUMNS[tab], [tab]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Emails</h1>
        <Button onClick={() => setComposeOpen(true)}>Compose New Email</Button>
      </div>

      <div className="flex items-center justify-between gap-4 border-b border-border">
        <div className="flex gap-1">
          {(['scheduled', 'sent'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2 text-sm font-medium capitalize transition-colors -mb-px border-b-2',
                tab === t
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search email or subject…"
          className="mb-2 w-64"
          aria-label="Search emails"
        />
      </div>

      {isLoading ? (
        <TableSkeleton cols={columns.length} />
      ) : isError ? (
        <EmptyState
          title="Couldn't load emails"
          description="Something went wrong reaching the API. Try again in a moment."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            q
              ? `No results for "${q}"`
              : tab === 'scheduled'
                ? 'No scheduled emails'
                : 'Nothing sent yet'
          }
          description={
            q
              ? 'Try a different email address or subject.'
              : tab === 'scheduled'
                ? 'Emails you schedule will appear here until they send.'
                : 'Once your scheduled emails send, they will show up here.'
          }
          action={
            !q && (
              <Button onClick={() => setComposeOpen(true)}>Compose New Email</Button>
            )
          }
        />
      ) : (
        <>
          <Table columns={columns} rows={rows} rowKey={(r) => r.id} />
          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>
              {total} email{total === 1 ? '' : 's'}
              {isFetching && ' · updating…'}
            </span>
            <div className="flex items-center gap-3">
              <span>
                Page {page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}
