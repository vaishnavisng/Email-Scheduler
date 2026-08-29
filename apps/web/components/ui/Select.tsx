import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, Props>(
  ({ label, error, options, id, className, ...rest }, ref) => {
    const autoId = useId();
    const selectId = id ?? autoId;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-10 rounded-md border bg-surface px-3 text-sm text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
            error ? 'border-danger' : 'border-border',
            className,
          )}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  },
);
Select.displayName = 'Select';
