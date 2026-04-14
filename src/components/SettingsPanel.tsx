import { useEffect, useState } from 'react';
import { authApi, type ConnectionStatus } from '@/lib/api';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [connections, setConnections] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
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

  if (!open) return null;

  const handleDisconnect = async (provider: 'gmail' | 'outlook') => {
    try {
      if (provider === 'gmail') {
        await authApi.disconnectGmail();
      } else {
        await authApi.disconnectOutlook();
      }
      // Refresh connection status
      const updated = await authApi.getConnections();
      setConnections(updated);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Email Connections
          </h3>

          {loading && <p className="text-sm text-slate-500">Loading...</p>}
          {error && (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          {connections && (
            <div className="space-y-4">
              <ConnectionCard
                provider="Gmail"
                connected={connections.gmail.connected}
                lastPolledAt={connections.gmail.lastPolledAt}
                connectUrl={`${API_URL}/api/auth/gmail`}
                onDisconnect={() => handleDisconnect('gmail')}
              />
              <ConnectionCard
                provider="Outlook"
                connected={connections.outlook.connected}
                lastPolledAt={connections.outlook.lastPolledAt}
                connectUrl={`${API_URL}/api/auth/outlook`}
                onDisconnect={() => handleDisconnect('outlook')}
              />
            </div>
          )}

          <div className="mt-8 rounded-md bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">
              Joblog scans your connected inboxes daily at 7:00 AM Eastern for job-related emails
              and automatically updates your application statuses.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectionCard({
  provider,
  connected,
  lastPolledAt,
  connectUrl,
  onDisconnect,
}: {
  provider: string;
  connected: boolean;
  lastPolledAt: string | null;
  connectUrl: string;
  onDisconnect: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`}
          />
          <span className="text-sm font-medium text-slate-900">{provider}</span>
        </div>
        {connected ? (
          <button
            onClick={onDisconnect}
            className="rounded-md px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Disconnect
          </button>
        ) : (
          <a
            href={connectUrl}
            className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
          >
            Connect
          </a>
        )}
      </div>
      {connected && lastPolledAt && (
        <p className="mt-1.5 pl-5.5 text-xs text-slate-500">
          Last scanned: {new Date(lastPolledAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
