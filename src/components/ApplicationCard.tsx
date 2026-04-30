import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import type { Application } from '@/types';
import { daysSince, isStale } from '@/lib/utils';

interface Props {
  application: Application;
  needsReview?: boolean;
  onClick: (id: string) => void;
}

export function ApplicationCard({ application, needsReview, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: application.id,
    data: { type: 'application', status: application.status },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const stale = isStale(application);
  const days = daysSince(application.lastUpdatedAt);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Avoid firing click after a drag
        if (isDragging) return;
        e.stopPropagation();
        onClick(application.id);
      }}
      className={clsx(
        'group cursor-grab select-none rounded-lg border bg-white p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing',
        needsReview
          ? 'border-red-400 ring-1 ring-red-200'
          : stale
            ? 'border-amber-400 ring-1 ring-amber-200'
            : 'border-slate-200',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">
            {application.companyName}
          </div>
          <div className="truncate text-xs text-slate-600">{application.roleTitle}</div>
        </div>
        <div className="flex items-center gap-1">
          {needsReview && (
            <span
              title="Needs review"
              className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800"
            >
              ?
            </span>
          )}
          {stale && (
            <span
              title="Stale — needs follow-up"
              className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
            >
              ⚠
            </span>
          )}
        </div>
      </div>

      {application.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {application.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
        <span>{application.location ?? (application.isRemote ? 'Remote' : '—')}</span>
        <span>{days === 0 ? 'today' : `${days}d`}</span>
      </div>
    </div>
  );
}
