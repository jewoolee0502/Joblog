import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import clsx from 'clsx';
import type { Application, ApplicationStatus } from '@/types';
import { STATUS_LABELS } from '@/types';
import { ApplicationCard } from './ApplicationCard';
import { statusAccent } from '@/lib/utils';

interface Props {
  status: ApplicationStatus;
  applications: Application[];
  onCardClick: (id: string) => void;
  onAddClick: (status: ApplicationStatus) => void;
}

export function KanbanColumn({ status, applications, onCardClick, onAddClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: 'column', status },
  });

  return (
    <div className="flex h-full min-w-[18rem] flex-1 shrink-0 flex-col p-3">
      <div
        className={clsx(
          'mb-2 flex items-center justify-between rounded-md border px-3 py-2',
          statusAccent(status),
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">{STATUS_LABELS[status]}</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
            {applications.length}
          </span>
        </div>
        <button
          onClick={() => onAddClick(status)}
          className="rounded p-1 text-slate-500 transition hover:bg-white hover:text-slate-900"
          aria-label={`Add application to ${STATUS_LABELS[status]}`}
        >
          +
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={clsx(
          'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-md p-1 transition',
          isOver && 'bg-blue-50 ring-2 ring-blue-300',
        )}
      >
        <SortableContext
          items={applications.map((a) => a.id)}
          strategy={verticalListSortingStrategy}
        >
          {applications.map((app) => (
            <ApplicationCard key={app.id} application={app} onClick={onCardClick} />
          ))}
        </SortableContext>

        {applications.length === 0 && (
          <div className="rounded border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
            No applications
          </div>
        )}
      </div>
    </div>
  );
}
