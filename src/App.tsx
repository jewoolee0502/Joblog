import { useEffect, useState } from 'react';
import { KanbanBoard } from '@/components/KanbanBoard';
import { ApplicationDialog } from '@/components/ApplicationDialog';
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
          <button
            onClick={() => openCreate('SAVED')}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            + New application
          </button>
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
    </div>
  );
}
