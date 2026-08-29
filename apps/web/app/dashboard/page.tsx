'use client';

import { useState } from 'react';
import type { EmailListItem, EmailStatus } from '@outbox/shared';
import { useEmails } from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { Badge, STATUS_TONE } from '@/components/ui/Badge';
import { Table, type Column } from '@/components/ui/Table';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';

type Tab = 'scheduled' | 'sent';

// ponytail: the "Scheduled" tab maps to status=scheduled (the API filters one
// status). Broadening to scheduled+queued+sending is a Phase 9 concern once the
// list view earns it.
const TAB_STATUS: Record<Tab, EmailStatus> = {
  scheduled: 'scheduled',
  sent: 'sent',
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';

const columns: Column<EmailListItem>[] = [
  { key: 'recipient', header: 'Recipient', cell: (r) => r.recipient },
  { key: 'subject', header: 'Subject', cell: (r) => r.subject },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>,
  },
  {
    key: 'when',
    header: 'When',
    cell: (r) => fmt(r.status === 'sent' ? r.sentAt : r.scheduledAt),
  },
];

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>('scheduled');
  const [composeOpen, setComposeOpen] = useState(false);
  const { data, isLoading, isError } = useEmails({
    status: TAB_STATUS[tab],
    pageSize: 50,
  });

  const rows = data?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Emails</h1>
        <Button onClick={() => setComposeOpen(true)}>Compose New Email</Button>
      </div>

      <div className="flex gap-1 border-b border-border">
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

      {isLoading ? (
        <div className="flex justify-center py-16 text-ink-muted">
          <Spinner size={24} />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load emails"
          description="Something went wrong reaching the API. Try again in a moment."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={tab === 'scheduled' ? 'No scheduled emails' : 'Nothing sent yet'}
          description={
            tab === 'scheduled'
              ? 'Emails you schedule will appear here until they send.'
              : 'Once your scheduled emails send, they will show up here.'
          }
          action={
            tab === 'scheduled' && (
              <Button onClick={() => setComposeOpen(true)}>
                Compose New Email
              </Button>
            )
          }
        />
      ) : (
        <Table columns={columns} rows={rows} rowKey={(r) => r.id} />
      )}

      <Modal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title="Compose New Email"
        footer={
          <Button variant="secondary" onClick={() => setComposeOpen(false)}>
            Close
          </Button>
        }
      >
        <p className="text-sm text-ink-muted">
          The compose and scheduling flow arrives in the next phase. The shell,
          auth, and layout are in place.
        </p>
      </Modal>
    </div>
  );
}
