import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import clsx from 'clsx';
import type { Application, ApplicationStatus } from '@/types';
import { STATUS_LABELS } from '@/types';
import { ApplicationCard } from './ApplicationCard';
import { statusAccent, statusDot, statusDropZone } from '@/lib/utils';

interface Props {
  status: ApplicationStatus;
  applications: Application[];
  needsReviewIds: Set<string>;
  onCardClick: (id: string) => void;
  onAddClick: (status: ApplicationStatus) => void;
}

export function KanbanColumn({ status, applications, needsReviewIds, onCardClick, onAddClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: 'column', status },
  });

  return (
    <div className="flex h-full min-w-[17rem] flex-1 shrink-0 flex-col p-2">
      <div
        className={clsx(
          'mb-2 flex items-center justify-between rounded-md border px-3 py-1.5',
          statusAccent(status),
        )}
      >
        <div className="flex items-center gap-2">
          <div className={clsx('h-2 w-2 rounded-full', statusDot(status))} />
          <span className="text-xs font-semibold text-content-primary">{STATUS_LABELS[status]}</span>
          <span className="rounded-full bg-dark-surface px-1.5 py-0.5 text-[10px] font-medium text-content-secondary">
            {applications.length}
          </span>
        </div>
        <button
          onClick={() => onAddClick(status)}
          className="rounded p-1 text-content-tertiary transition-colors duration-150 hover:bg-dark-surface hover:text-content-primary"
          aria-label={`Add application to ${STATUS_LABELS[status]}`}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={clsx(
          'flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-md p-1 transition-all duration-150',
          isOver && statusDropZone(status),
        )}
      >
        <SortableContext
          items={applications.map((a) => a.id)}
          strategy={verticalListSortingStrategy}
        >
          {applications.map((app) => (
            <ApplicationCard key={app.id} application={app} needsReview={needsReviewIds.has(app.id)} onClick={onCardClick} />
          ))}
        </SortableContext>

        {applications.length === 0 && (
          <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center text-xs text-content-tertiary">
            Drop an application here
          </div>
        )}
      </div>
    </div>
  );
}
