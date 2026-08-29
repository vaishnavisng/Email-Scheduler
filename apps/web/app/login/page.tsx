'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

const ERRORS: Record<string, string> = {
  denied: 'Sign-in was cancelled.',
  state: 'Your sign-in session expired. Please try again.',
  oauth: 'Google sign-in failed. Please try again.',
};

function LoginCard() {
  const error = useSearchParams().get('error');
  const message = error ? (ERRORS[error] ?? 'Sign-in failed.') : null;

  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-card">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold text-ink">Outbox</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sign in to schedule and send your emails.
        </p>
      </div>

      {message && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger"
        >
          {message}
        </div>
      )}

      {/* Full-page navigation (anchor, not fetch) so the OAuth redirect chain and
          Set-Cookie work. Do NOT convert to a fetch. */}
      <Button as="a" href={api.loginUrl()} className="w-full justify-center">
        Continue with Google
      </Button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Suspense>
        <LoginCard />
      </Suspense>
    </main>
  );
}
