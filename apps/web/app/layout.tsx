import type { ReactNode } from 'react';

export const metadata = {
  title: 'Outbox Email Scheduler',
  description: 'Schedule and send emails at scale.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
