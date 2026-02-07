'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  RefreshCw,
  Link,
  Unlink,
  CheckCircle,
  AlertCircle,
  ArrowRightLeft,
  Settings,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Status {
  configured: { google: boolean; microsoft: boolean };
  connected: { google: boolean; microsoft: boolean };
  lastSync: { at: string; mappings: number } | null;
}

interface SyncReport {
  dryRun: boolean;
  providers: string[];
  lastSyncAt?: string;
  newLastSyncAt: string;
  counts: Record<string, number>;
  actions: Array<{
    kind: string;
    executed: boolean;
    source: { provider: string; id: string };
    target: { provider: string; id?: string };
    title?: string;
    detail: string;
  }>;
  conflicts: unknown[];
  errors: Array<{ provider: string; stage: string; error: string }>;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/*  Dashboard                                                          */
/* ------------------------------------------------------------------ */

export function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      const data: Status = await res.json();
      setStatus(data);
      setError(null);
    } catch {
      setError('Failed to load status. Is the server running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // Handle OAuth redirect results via URL params
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const err = params.get('error');
    if (connected) {
      toast.success(
        `Connected to ${connected === 'google' ? 'Google Tasks' : 'Microsoft To Do'}`,
      );
      window.history.replaceState({}, '', '/');
    }
    if (err) {
      toast.error(`Connection failed: ${err.replace(/_/g, ' ')}`);
      window.history.replaceState({}, '', '/');
    }
  }, [fetchStatus]);

  /* Sync ----------------------------------------------------------- */

  const handleSync = async () => {
    setSyncing(true);
    setLastReport(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Sync failed');
      } else {
        setLastReport(data as SyncReport);
        toast.success(`Synced in ${(data as SyncReport).durationMs}ms`);
        fetchStatus();
      }
    } catch {
      toast.error('Sync request failed');
    } finally {
      setSyncing(false);
    }
  };

  /* Disconnect ------------------------------------------------------ */

  const handleDisconnect = async (provider: 'google' | 'microsoft') => {
    try {
      await fetch(`/api/disconnect/${provider}`, { method: 'DELETE' });
      toast.success(
        `Disconnected from ${provider === 'google' ? 'Google Tasks' : 'Microsoft To Do'}`,
      );
      fetchStatus();
    } catch {
      toast.error('Failed to disconnect');
    }
  };

  /* Loading / Error ------------------------------------------------- */

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const neitherConfigured =
    !status?.configured.google && !status?.configured.microsoft;
  const bothConnected =
    status?.connected.google && status?.connected.microsoft;

  /* Render ---------------------------------------------------------- */

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      {/* Header */}
      <header className="mb-10 text-center">
        <div className="mb-2 flex items-center justify-center gap-2">
          <ArrowRightLeft className="h-7 w-7" />
          <h1 className="text-3xl font-bold tracking-tight">Task Sync</h1>
        </div>
        <p className="text-muted-foreground">
          Keep your Google Tasks and Microsoft To Do in sync.
        </p>
      </header>

      {/* Setup guide when nothing is configured */}
      {neitherConfigured && (
        <Alert className="mb-8">
          <Settings className="h-4 w-4" />
          <AlertDescription>
            <p className="mb-2 font-medium">Setup required</p>
            <p className="mb-3 text-sm text-muted-foreground">
              Create OAuth credentials and add them to{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                .env.local
              </code>{' '}
              in the project root:
            </p>
            <pre className="rounded-md bg-muted p-3 text-xs leading-relaxed overflow-x-auto">
{`# Google — console.cloud.google.com
TASK_SYNC_PROVIDER_A=google
TASK_SYNC_PROVIDER_B=microsoft
TASK_SYNC_GOOGLE_CLIENT_ID=your-client-id
TASK_SYNC_GOOGLE_CLIENT_SECRET=your-client-secret

# Microsoft — portal.azure.com
TASK_SYNC_MS_CLIENT_ID=your-client-id
TASK_SYNC_MS_TENANT_ID=consumers`}
            </pre>
            <p className="mt-3 text-xs text-muted-foreground">
              After saving, restart the dev server.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Provider cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <ProviderCard
          name="Google Tasks"
          provider="google"
          configured={status?.configured.google ?? false}
          connected={status?.connected.google ?? false}
          onDisconnect={() => handleDisconnect('google')}
        />
        <ProviderCard
          name="Microsoft To Do"
          provider="microsoft"
          configured={status?.configured.microsoft ?? false}
          connected={status?.connected.microsoft ?? false}
          onDisconnect={() => handleDisconnect('microsoft')}
        />
      </div>

      <Separator className="mb-8" />

      {/* Sync section */}
      <Card>
        <CardHeader className="text-center">
          <CardTitle>Sync</CardTitle>
          <CardDescription>
            {bothConnected
              ? 'Both providers connected. Ready to sync.'
              : 'Connect both providers to enable sync.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center">
            <Button
              size="lg"
              onClick={handleSync}
              disabled={syncing || !bothConnected}
            >
              {syncing ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Syncing…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync Now
                </>
              )}
            </Button>
          </div>

          {status?.lastSync && (
            <p className="text-center text-sm text-muted-foreground">
              Last synced:{' '}
              {new Date(status.lastSync.at).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {' · '}
              {status.lastSync.mappings} task
              {status.lastSync.mappings !== 1 ? 's' : ''} tracked
            </p>
          )}

          {lastReport && <SyncReportView report={lastReport} />}
        </CardContent>
      </Card>

      {/* Footer */}
      <footer className="mt-12 text-center text-xs text-muted-foreground">
        <p>
          Self-hosted · Open source ·{' '}
          <a
            href="https://github.com/salaamdev/task-sync"
            className="underline underline-offset-4 hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider Card                                                      */
/* ------------------------------------------------------------------ */

function ProviderCard({
  name,
  provider,
  configured,
  connected,
  onDisconnect,
}: {
  name: string;
  provider: 'google' | 'microsoft';
  configured: boolean;
  connected: boolean;
  onDisconnect: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">{name}</CardTitle>
          {connected ? (
            <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <CheckCircle className="mr-1 h-3 w-3" />
              Connected
            </Badge>
          ) : configured ? (
            <Badge variant="secondary">Not connected</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Not configured
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {connected ? (
          <Button variant="outline" size="sm" onClick={onDisconnect}>
            <Unlink className="mr-2 h-3 w-3" />
            Disconnect
          </Button>
        ) : configured ? (
          <Button size="sm" asChild>
            <a href={`/api/auth/${provider}`}>
              <Link className="mr-2 h-3 w-3" />
              Connect
            </a>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Add credentials to{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
              .env.local
            </code>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Sync Report                                                        */
/* ------------------------------------------------------------------ */

function SyncReportView({ report }: { report: SyncReport }) {
  const total =
    (report.counts.create ?? 0) +
    (report.counts.update ?? 0) +
    (report.counts.delete ?? 0) +
    (report.counts.recreate ?? 0);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Sync Report</span>
        <span className="text-muted-foreground">{report.durationMs}ms</span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-sm">
        <div>
          <p className="text-xl font-semibold tabular-nums">
            {report.counts.create ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">Created</p>
        </div>
        <div>
          <p className="text-xl font-semibold tabular-nums">
            {report.counts.update ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">Updated</p>
        </div>
        <div>
          <p className="text-xl font-semibold tabular-nums">
            {report.counts.delete ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">Deleted</p>
        </div>
        <div>
          <p className="text-xl font-semibold tabular-nums">
            {report.counts.noop ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">Unchanged</p>
        </div>
      </div>

      {report.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {report.errors.map((e, i) => (
              <p key={i} className="text-xs">
                {e.provider} ({e.stage}): {e.error}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {report.actions.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {total} action{total !== 1 ? 's' : ''} performed
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-muted-foreground">
            {report.actions.map((a, i) => (
              <li key={i}>
                [{a.kind}] {a.target.provider}
                {a.title ? ` "${a.title}"` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
