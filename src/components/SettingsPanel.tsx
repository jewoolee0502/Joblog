import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authApi, type ConnectionStatus } from '@/lib/api';
import { supabase } from '@/lib/supabase';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onDeepScanStarted?: () => void;
  userEmail?: string;
}

export function SettingsPanel({ open, onClose, onDeepScanStarted, userEmail }: SettingsPanelProps) {
  const [connections, setConnections] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    authApi
      .getConnections()
      .then(setConnections)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  const handleScan = async (months?: number) => {
    setScanning(true);
    try {
      const result = await authApi.triggerScan(months) as any;

      if (result.background) {
        toast.success(result.message ?? 'Deep scan started in background. Your Kanban board will update automatically.');
        onDeepScanStarted?.();
      } else {
        const parts = [
          `${result.emailsScanned} emails scanned`,
          result.statusUpdates > 0 ? `${result.statusUpdates} status updates` : null,
          result.newApplications > 0 ? `${result.newApplications} new applications` : null,
          result.flaggedForReview > 0 ? `${result.flaggedForReview} flagged for review` : null,
        ].filter(Boolean);
        toast.success(`Scan complete: ${parts.join(', ')}`);
      }
      const updated = await authApi.getConnections();
      setConnections(updated);
    } catch (err: any) {
      toast.error(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  if (!open) return null;

  const handleDisconnect = async (provider: 'gmail' | 'outlook') => {
    try {
      if (provider === 'gmail') {
        await authApi.disconnectGmail();
      } else {
        await authApi.disconnectOutlook();
      }
      const updated = await authApi.getConnections();
      setConnections(updated);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="backdrop-fade-in absolute inset-0" style={{ background: 'oklch(0.08 0.01 240 / 0.5)' }} onClick={onClose} />
      <div className="panel-slide-in relative flex h-full w-full max-w-md flex-col border-l border-border-subtle bg-dark-raised shadow-2xl">
        <div className="shrink-0 border-b border-border-subtle px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-content-primary">Settings</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-content-tertiary transition-colors duration-150 hover:bg-dark-surface hover:text-content-primary"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="auto-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-content-tertiary">
            Email Connections
          </h3>

          {loading && <p className="text-sm text-content-tertiary">Loading...</p>}
          {error && (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
          )}

          {connections && (
            <div className="space-y-2">
              <ConnectionCard
                provider="Gmail"
                connected={connections.gmail.connected}
                lastPolledAt={connections.gmail.lastPolledAt}
                connectPath="/api/auth/gmail"
                onDisconnect={() => handleDisconnect('gmail')}
              />
              <ConnectionCard
                provider="Outlook"
                connected={connections.outlook.connected}
                lastPolledAt={connections.outlook.lastPolledAt}
                connectPath="/api/auth/outlook"
                onDisconnect={() => handleDisconnect('outlook')}
              />
            </div>
          )}

          {connections && (connections.gmail.connected || connections.outlook.connected) && (
            <div className="mt-6">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-content-tertiary">
                Inbox Scanning
              </h3>

              <div className="rounded-lg border border-border-subtle p-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleScan()}
                    disabled={scanning}
                    className="flex-1 rounded-lg bg-content-primary px-4 py-2 text-sm font-medium text-dark-base transition-colors duration-150 hover:opacity-90 disabled:opacity-50"
                  >
                    {scanning ? 'Scanning...' : 'Scan Now'}
                  </button>
                  <button
                    onClick={() => handleScan(3)}
                    disabled={scanning}
                    className="flex-1 rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-content-secondary transition-colors duration-150 hover:bg-dark-overlay hover:text-content-primary disabled:opacity-50"
                  >
                    {scanning ? 'Scanning...' : 'Deep Scan'}
                  </button>
                </div>
                <div className="mt-3 space-y-1 text-xs text-content-tertiary">
                  <p><strong className="text-content-secondary">Scan Now</strong>: checks since last scan or yesterday</p>
                  <p><strong className="text-content-secondary">Deep Scan</strong>: processes the past 3 months (may take several minutes)</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-5 rounded-lg bg-dark-surface px-4 py-3">
            <p className="text-xs text-content-tertiary">
              Joblog scans your connected inboxes daily at 7:00 AM Eastern for job-related emails
              and automatically updates your application statuses.
            </p>
          </div>

        </div>

        <div className="shrink-0 border-t border-border-subtle px-6 py-4">
          {userEmail && (
            <p className="mb-3 truncate text-xs text-content-tertiary">{userEmail}</p>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            className="w-full rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-content-secondary transition-colors duration-150 hover:bg-dark-overlay hover:text-stage-rejected"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionCard({
  provider,
  connected,
  lastPolledAt,
  connectPath,
  onDisconnect,
}: {
  provider: string;
  connected: boolean;
  lastPolledAt: string | null;
  connectPath: string;
  onDisconnect: () => void;
}) {
  const handleConnect = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    window.location.href = `${API_URL}${connectPath}?token=${encodeURIComponent(token)}`;
  };

  return (
    <div className="rounded-lg border border-border-subtle px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`h-2 w-2 rounded-full ${connected ? 'bg-stage-offer' : 'bg-content-tertiary'}`}
          />
          <span className="text-sm font-medium text-content-primary">{provider}</span>
        </div>
        {connected ? (
          <button
            onClick={onDisconnect}
            className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-content-secondary transition-colors duration-150 hover:bg-dark-overlay hover:text-stage-rejected"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            className="rounded-lg bg-content-primary px-3 py-1 text-xs font-medium text-dark-base transition-colors duration-150 hover:opacity-90"
          >
            Connect
          </button>
        )}
      </div>
      {connected && lastPolledAt && (
        <p className="mt-1.5 pl-5 text-xs text-content-tertiary">
          Last scanned: {new Date(lastPolledAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
