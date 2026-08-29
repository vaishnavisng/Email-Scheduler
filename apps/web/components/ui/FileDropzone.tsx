'use client';

import { useRef, useState, type DragEvent } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  /** Hint text under the prompt, e.g. "CSV up to 5MB". */
  hint?: string;
}

/** Drag-and-drop or click-to-browse file input. Native <input type="file"> does
 * the actual picking; this only adds the drop target and styling. */
export function FileDropzone({ onFiles, accept, multiple, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const emit = (list: FileList | null) => {
    if (list && list.length) onFiles(Array.from(list));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    emit(e.dataTransfer.files);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        dragging ? 'border-brand bg-brand-subtle' : 'border-border bg-surface hover:bg-bg',
      )}
    >
      <p className="text-sm font-medium text-ink">
        Drag a file here, or <span className="text-brand">browse</span>
      </p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => emit(e.target.files)}
      />
    </div>
  );
}
