import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, id, className, ...rest }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-10 rounded-md border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint',
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
Input.displayName = 'Input';
