import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { EmailStatus } from '@outbox/shared';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-bg text-ink-muted border-border',
  brand: 'bg-brand-subtle text-brand border-brand/20',
  success: 'bg-success-subtle text-success border-success/20',
  warning: 'bg-warning-subtle text-warning border-warning/20',
  danger: 'bg-danger-subtle text-danger border-danger/20',
  info: 'bg-info-subtle text-info border-info/20',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Map an email status to a badge tone. One place so tables stay consistent. */
export const STATUS_TONE: Record<EmailStatus, Tone> = {
  scheduled: 'brand',
  queued: 'info',
  sending: 'warning',
  sent: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};
