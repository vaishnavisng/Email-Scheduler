import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'bg-surface text-ink border border-border hover:bg-bg',
  ghost: 'bg-transparent text-ink-muted hover:bg-bg hover:text-ink',
  danger: 'bg-danger text-white hover:opacity-90',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm rounded-md gap-1.5',
  md: 'h-10 px-4 text-sm rounded-md gap-2',
};

interface Common {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  className?: string;
  children: ReactNode;
}

type ButtonProps = Common & { as?: 'button' } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    keyof Common
  >;
type AnchorProps = Common & { as: 'a' } & Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    keyof Common
  >;
type Props = ButtonProps | AnchorProps;

const base =
  'inline-flex items-center font-medium transition-colors disabled:opacity-50 ' +
  'disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-brand focus-visible:ring-offset-1';

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, Props>(
  ({ variant = 'primary', size = 'md', loading, className, children, as, ...rest }, ref) => {
    const cls = cn(base, VARIANTS[variant], SIZES[size], className);
    const content = (
      <>
        {loading && <Spinner size={size === 'sm' ? 14 : 16} />}
        {children}
      </>
    );
    // `as` is stripped from `rest`; cast the remainder to the concrete element's
    // attributes (the union is narrowed by which branch we render).
    if (as === 'a') {
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          className={cls}
          {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {content}
        </a>
      );
    }
    const button = rest as ButtonHTMLAttributes<HTMLButtonElement>;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        className={cls}
        disabled={loading || button.disabled}
        {...button}
      >
        {content}
      </button>
    );
  },
);
Button.displayName = 'Button';
