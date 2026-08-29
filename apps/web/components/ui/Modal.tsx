'use client';

import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Centered dialog. Closes on Escape and backdrop click; locks body scroll while
 * open. ponytail: no focus-trap library — one modal at a time, Escape closes. */
export function Modal({ open, onClose, title, children, footer, className }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'w-full max-w-lg rounded-lg bg-surface shadow-modal',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
