import { redirect } from 'next/navigation';

// The shell lives at /dashboard; middleware sends unauthenticated users to /login.
export default function Home() {
  redirect('/dashboard');
}
