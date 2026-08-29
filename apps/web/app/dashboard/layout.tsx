import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
