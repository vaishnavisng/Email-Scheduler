import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(
  ({ label, error, id, className, ...rest }, ref) => {
    const autoId = useId();
    const areaId = id ?? autoId;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={areaId} className="text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={areaId}
          aria-invalid={error ? true : undefined}
          className={cn(
            'min-h-24 rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
            error ? 'border-danger' : 'border-border',
            className,
          )}
          {...rest}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
