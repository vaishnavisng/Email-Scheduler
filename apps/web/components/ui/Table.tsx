import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer for this column. */
  cell: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  className?: string;
}

/** Generic, typed data table. Column cells receive the fully-typed row. Wrapped
 * in an overflow-x container so wide tables scroll rather than break the layout. */
export function Table<T>({ columns, rows, rowKey, className }: Props<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className={cn('w-full text-left text-sm', className)}>
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'px-4 py-3 font-medium text-ink-muted',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-border last:border-0 hover:bg-bg"
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 py-3 text-ink', c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
