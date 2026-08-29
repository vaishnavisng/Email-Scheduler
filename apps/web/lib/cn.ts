import clsx, { type ClassValue } from 'clsx';

/** Conditional className join. Kept tiny — no tailwind-merge; our variants don't
 * fight each other, so clsx alone is enough. */
export const cn = (...inputs: ClassValue[]): string => clsx(inputs);
