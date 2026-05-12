import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { Toaster, toast } from 'sonner';
import { KanbanBoard } from '@/components/KanbanBoard';
import { ApplicationDialog } from '@/components/ApplicationDialog';
import { ReviewQueue } from '@/components/ReviewQueue';
import { SettingsPanel } from '@/components/SettingsPanel';
import { SummaryBar } from '@/components/SummaryBar';
import { useApplicationStore } from '@/store/applicationStore';
import { authApi, setAuthTokenGetter } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { STATUS_LABELS, type ApplicationStatus } from '@/types';

type DialogState =
  | { open: false }
  | { open: true; mode: 'create'; initialStatus: ApplicationStatus }
  | { open: true; mode: 'edit'; applicationId: string };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const applications = useApplicationStore((s) => s.applications);
  const isLoading = useApplicationStore((s) => s.isLoading);
  const isLoaded = useApplicationStore((s) => s.isLoaded);
  const error = useApplicationStore((s) => s.error);
  const loadApplications = useApplicationStore((s) => s.loadApplications);
  const loadNeedsReview = useApplicationStore((s) => s.loadNeedsReview);
  const needsReviewIds = useApplicationStore((s) => s.needsReviewIds);
  const undoApplication = useApplicationStore((s) => s.undoApplication);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [deepScanActive, setDeepScanActive] = useState(false);
  const shownAutoToasts = useRef(new Set<string>());

  // Initialize Supabase auth session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Wire up token getter for API requests
  useEffect(() => {
    setAuthTokenGetter(() => Promise.resolve(session?.access_token ?? null));
  }, [session]);

  // Sync auth token to Chrome extension (if installed)
  useEffect(() => {
    const extensionId = import.meta.env.VITE_EXTENSION_ID;
    const chromeRuntime = (globalThis as Record<string, unknown>).chrome as
      | { runtime?: { sendMessage?: (id: string, msg: unknown) => void } }
      | undefined;
    if (!extensionId || !chromeRuntime?.runtime?.sendMessage) return;
    const token = session?.access_token;
    if (token) {
      chromeRuntime.runtime!.sendMessage!(extensionId, { type: 'JOBLOG_AUTH_TOKEN', token });
    } else {
      chromeRuntime.runtime!.sendMessage!(extensionId, { type: 'JOBLOG_SIGN_OUT' });
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    loadApplications();
    loadNeedsReview();
    // Check for in-progress or already-finished deep scan (e.g. after page refresh)
    authApi.getScanStatus().then((resp) => {
      const s = resp.data;
      if (!s) return;
      if (s.status === 'running') {
        setDeepScanActive(true);
      } else if (s.status === 'completed' && s.result) {
        const r = s.result;
        const parts = [
          `${r.emailsScanned} emails scanned`,
          r.statusUpdates > 0 ? `${r.statusUpdates} status updates` : null,
          r.newApplications > 0 ? `${r.newApplications} new applications` : null,
          r.flaggedForReview > 0 ? `${r.flaggedForReview} flagged for review` : null,
        ].filter(Boolean);
        toast.success(`Deep scan complete: ${parts.join(', ')}`);
      } else if (s.status === 'failed') {
        toast.error(`Deep scan failed: ${s.error ?? 'Unknown error'}`);
      }
    }).catch(() => {});
  }, [session, loadApplications]);

  // Show undo toasts for auto-transitions the user hasn't seen yet
  useEffect(() => {
    if (!isLoaded) return;
    const lastSeen = parseInt(localStorage.getItem('joblog:lastSeenAutoToast') ?? '0', 10);
    let latestChange = lastSeen;

    for (const app of applications) {
      for (const entry of app.history) {
        const changedMs = new Date(entry.changedAt).getTime();
        if (
          entry.trigger === 'email_auto' &&
          changedMs > lastSeen &&
          !shownAutoToasts.current.has(entry.id)
        ) {
          shownAutoToasts.current.add(entry.id);
          if (changedMs > latestChange) latestChange = changedMs;
          const label = STATUS_LABELS[entry.toStatus] ?? entry.toStatus;
          toast(`${app.companyName} moved to ${label}`, {
            description: 'Auto-detected from email',
            duration: 10000,
            action: {
              label: 'Undo',
              onClick: () => undoApplication(app.id),
            },
          });
        }
      }
    }

    if (latestChange > lastSeen) {
      localStorage.setItem('joblog:lastSeenAutoToast', String(latestChange));
    }
  }, [isLoaded, applications, undoApplication]);

  // Poll for deep scan completion
  useEffect(() => {
    if (!deepScanActive) return;

    const intervalId = setInterval(async () => {
      try {
        const resp = await authApi.getScanStatus();
        const scanStatus = resp.data;

        if (!scanStatus) {
          setDeepScanActive(false);
          return;
        }
        if (scanStatus.status === 'running') return;

        setDeepScanActive(false);

        if (scanStatus.status === 'completed' && scanStatus.result) {
          const r = scanStatus.result;
          const parts = [
            `${r.emailsScanned} emails scanned`,
            r.statusUpdates > 0 ? `${r.statusUpdates} status updates` : null,
            r.newApplications > 0 ? `${r.newApplications} new applications` : null,
            r.flaggedForReview > 0 ? `${r.flaggedForReview} flagged for review` : null,
          ].filter(Boolean);
          toast.success(`Deep scan complete: ${parts.join(', ')}`);
          loadApplications();
          loadNeedsReview();
        } else {
          toast.error(`Deep scan failed: ${scanStatus.error ?? 'Unknown error'}`);
        }
      } catch {
        // Network error — retry next interval
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [deepScanActive, loadApplications]);

  const openCreate = (status: ApplicationStatus = 'SAVED') =>
    setDialog({ open: true, mode: 'create', initialStatus: status });

  const openEdit = (id: string) => setDialog({ open: true, mode: 'edit', applicationId: id });

  const close = () => setDialog({ open: false });

  const editingApp =
    dialog.open && dialog.mode === 'edit'
      ? applications.find((a) => a.id === dialog.applicationId) ?? null
      : null;

  if (!authReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div
        className="flex min-h-screen w-screen items-center justify-center px-4"
        style={{
          fontFamily: '"DM Sans", sans-serif',
          background: 'oklch(0.98 0.005 240)',
        }}
      >
        <div className="w-full" style={{ maxWidth: '440px' }}>
          {/* Logo — sized large so tagline is legible; negative margin trims PNG whitespace */}
          <div className="-mb-4 flex justify-center overflow-hidden" style={{ marginTop: '-24px' }}>
            <img
              src="/images/joblog_logo.png"
              alt="Joblog — Smart Job Tracking, Powered by AI"
              style={{ width: '360px', maxWidth: '100%' }}
              className="object-contain"
            />
          </div>

          {/* Auth card */}
          <div
            className="rounded-xl px-8 pb-8 pt-6"
            style={{
              background: 'oklch(1 0 0)',
              boxShadow: '0 1px 3px oklch(0.4 0.01 240 / 0.08), 0 8px 24px oklch(0.4 0.01 240 / 0.06)',
            }}
          >
            <p
              className="mb-5 text-center text-sm"
              style={{ color: 'oklch(0.55 0.01 240)' }}
            >
              Sign in to track your applications
            </p>
            <Auth
              supabaseClient={supabase}
              appearance={{
                theme: ThemeSupa,
                variables: {
                  default: {
                    colors: {
                      brand: 'oklch(0.55 0.15 230)',
                      brandAccent: 'oklch(0.48 0.15 230)',
                      inputBackground: 'oklch(0.985 0.003 240)',
                      inputBorder: 'oklch(0.88 0.01 240)',
                      inputBorderFocus: 'oklch(0.55 0.15 230)',
                      inputBorderHover: 'oklch(0.7 0.08 230)',
                    },
                    borderWidths: {
                      buttonBorderWidth: '0px',
                      inputBorderWidth: '1px',
                    },
                    radii: {
                      borderRadiusButton: '8px',
                      inputBorderRadius: '8px',
                    },
                    fonts: {
                      bodyFontFamily: '"DM Sans", sans-serif',
                      buttonFontFamily: '"DM Sans", sans-serif',
                      labelFontFamily: '"DM Sans", sans-serif',
                      inputFontFamily: '"DM Sans", sans-serif',
                    },
                  },
                },
              }}
              providers={[]}
              theme="light"
            />
          </div>

          <p
            className="mt-4 text-center text-xs"
            style={{ color: 'oklch(0.6 0.01 240)' }}
          >
            Your data is encrypted and never shared.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex w-full items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/images/header_logo.png" alt="Joblog" className="h-20 w-20 -my-5 rounded-lg object-contain" />
            <span className="text-lg font-semibold text-slate-900">Joblog</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setReviewOpen(true)}
              className="relative rounded-md p-2 text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700"
              title="Needs Review"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              {reviewCount > 0 && (
                <span key={reviewCount} className="badge-pulse absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                  {reviewCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-md p-2 text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700"
              title="Settings"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.38.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={() => openCreate('SAVED')}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              + New application
            </button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col px-6 py-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong className="font-semibold">API error:</strong> {error}. Make sure the backend is running at{' '}
            <code className="rounded bg-red-100 px-1">http://localhost:4000</code>.
          </div>
        )}

        <SummaryBar />

        <div className="mt-6 flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-800">Pipeline</h2>
            <span className="text-xs text-slate-500">Drag cards between columns to update status</span>
          </div>
          <div className="min-h-0 flex-1">
            {!isLoaded && isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading applications...
              </div>
            ) : (
              <KanbanBoard onCardClick={openEdit} onAddClick={openCreate} />
            )}
          </div>
        </div>
      </main>

      <ApplicationDialog
        open={dialog.open}
        mode={dialog.open ? dialog.mode : 'create'}
        initialStatus={dialog.open && dialog.mode === 'create' ? dialog.initialStatus : undefined}
        application={editingApp}
        onClose={close}
      />

      <ReviewQueue
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onViewApplication={openEdit}
        onCountChange={setReviewCount}
        refreshKey={needsReviewIds.size}
      />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onDeepScanStarted={() => setDeepScanActive(true)} userEmail={session?.user?.email} />
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
