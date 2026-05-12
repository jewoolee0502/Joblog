import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import type { Application } from '@/types';
import { daysSince, isStale } from '@/lib/utils';

interface Props {
  application: Application;
  needsReview?: boolean;
  onClick: (id: string) => void;
  overlay?: boolean;
}

const STATUS_BORDER: Record<string, string> = {
  SAVED: 'border-l-slate-400',
  APPLIED: 'border-l-blue-500',
  SCREENING: 'border-l-violet-500',
  INTERVIEW: 'border-l-purple-500',
  FINAL_ROUND: 'border-l-pink-500',
  OFFER: 'border-l-emerald-500',
  ACCEPTED: 'border-l-emerald-600',
  REJECTED: 'border-l-red-500',
  WITHDRAWN: 'border-l-gray-400',
  GHOSTED: 'border-l-slate-500',
};

export function ApplicationCard({ application, needsReview, onClick, overlay }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: application.id,
    data: { type: 'application', status: application.status },
    disabled: overlay,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const stale = isStale(application);
  const days = daysSince(application.lastUpdatedAt);

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={overlay ? undefined : style}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      onClick={(e) => {
        if (isDragging || overlay) return;
        e.stopPropagation();
        onClick(application.id);
      }}
      className={clsx(
        'cursor-grab select-none rounded-lg border border-l-[3px] bg-white p-3 transition-all duration-150',
        STATUS_BORDER[application.status] ?? 'border-l-slate-300',
        needsReview
          ? 'border-red-400 border-l-red-500 ring-1 ring-red-200'
          : stale
            ? 'border-amber-400 border-l-amber-500 ring-1 ring-amber-200'
            : 'border-slate-200',
        isDragging
          ? 'scale-[0.97] opacity-30 shadow-none'
          : 'shadow-sm hover:-translate-y-0.5 hover:shadow-md',
        overlay && 'rotate-[2deg] shadow-lg ring-1 ring-slate-200',
        'active:cursor-grabbing',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-sm font-semibold text-slate-900"
            title={application.companyName}
          >
            {application.companyName}
          </div>
          <div
            className="truncate text-xs text-slate-600"
            title={application.roleTitle}
          >
            {application.roleTitle}
          </div>
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
