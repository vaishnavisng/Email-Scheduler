'use client';

import { useRouter } from 'next/navigation';
import { useMe, useLogout, useSlackConnect, useSlackDisconnect } from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

function Avatar({ url, name }: { url: string | null; name: string }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (url) {
    // Plain <img>: Google avatars from an external host, no next/image remote
    // config needed for one small circle.
    return <img src={url} alt="" className="h-9 w-9 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-subtle text-sm font-semibold text-brand">
      {initials || '?'}
    </div>
  );
}

export function AppHeader() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: me, isLoading } = useMe();
  const logout = useLogout();
  const connectSlack = useSlackConnect();
  const disconnectSlack = useSlackDisconnect();

  const onLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <span className="text-lg font-semibold text-ink">Outbox</span>

        <div className="flex items-center gap-4">
          {isLoading || !me ? (
            <Spinner className="text-ink-muted" />
          ) : (
            <>
              {me.slack ? (
                <div className="flex items-center gap-2">
                  <Badge tone="success">Slack #{me.slack.channel}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      disconnectSlack()
                        .then(() => toast('Slack disconnected', 'info'))
                        .catch(() => toast('Could not disconnect Slack', 'error'))
                    }
                  >
                    Disconnect
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    connectSlack().catch(() =>
                      toast('Slack is not configured', 'error'),
                    )
                  }
                >
                  Connect Slack
                </Button>
              )}

              <div className="flex items-center gap-3">
                <Avatar url={me.avatarUrl} name={me.name} />
                <div className="hidden leading-tight sm:block">
                  <div className="text-sm font-medium text-ink">{me.name}</div>
                  <div className="text-xs text-ink-muted">{me.email}</div>
                </div>
              </div>

              <Button variant="ghost" size="sm" onClick={onLogout}>
                Log out
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
