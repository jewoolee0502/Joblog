import { useEffect, useState } from 'react';
import { KanbanBoard } from '@/components/KanbanBoard';
import { ApplicationDialog } from '@/components/ApplicationDialog';
import { SettingsPanel } from '@/components/SettingsPanel';
import { SummaryBar } from '@/components/SummaryBar';
import { useApplicationStore } from '@/store/applicationStore';
import type { ApplicationStatus } from '@/types';

type DialogState =
  | { open: false }
  | { open: true; mode: 'create'; initialStatus: ApplicationStatus }
  | { open: true; mode: 'edit'; applicationId: string };

export default function App() {
  const applications = useApplicationStore((s) => s.applications);
  const isLoading = useApplicationStore((s) => s.isLoading);
  const isLoaded = useApplicationStore((s) => s.isLoaded);
  const error = useApplicationStore((s) => s.error);
  const loadApplications = useApplicationStore((s) => s.loadApplications);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  const openCreate = (status: ApplicationStatus = 'SAVED') =>
    setDialog({ open: true, mode: 'create', initialStatus: status });

  const openEdit = (id: string) => setDialog({ open: true, mode: 'edit', applicationId: id });

  const close = () => setDialog({ open: false });

  const editingApp =
    dialog.open && dialog.mode === 'edit'
      ? applications.find((a) => a.id === dialog.applicationId) ?? null
      : null;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex w-full items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
              <span className="text-sm font-bold">J</span>
            </div>
            <div>
              <div className="text-lg font-semibold text-slate-900">Joblog</div>
              <div className="text-xs text-slate-500">Automated job application tracker</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
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

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
