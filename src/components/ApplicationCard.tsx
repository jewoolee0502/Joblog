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
        'cursor-grab select-none rounded-lg border bg-dark-raised p-3 transition-all duration-150',
        needsReview
          ? 'border-stage-rejected/50 ring-1 ring-stage-rejected/20'
          : stale
            ? 'border-amber-500/40 ring-1 ring-amber-500/15'
            : 'border-border-subtle',
        isDragging
          ? 'scale-[0.97] opacity-30'
          : 'hover:-translate-y-0.5 hover:border-border hover:bg-dark-surface hover:shadow-lg hover:shadow-accent/5',
        overlay && 'rotate-[2deg] border-accent/40 bg-dark-surface shadow-xl shadow-accent/10',
        'active:cursor-grabbing',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-sm font-medium text-content-primary"
            title={application.companyName}
          >
            {application.companyName}
          </div>
          <div
            className="truncate text-xs text-content-secondary"
            title={application.roleTitle}
          >
            {application.roleTitle}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {needsReview && (
            <span
              title="Needs review"
              className="rounded-full bg-stage-rejected/15 px-1.5 py-0.5 text-[10px] font-semibold text-stage-rejected"
            >
              ?
            </span>
          )}
          {stale && (
            <span
              title="Stale: needs follow-up"
              className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
            >
              !
            </span>
          )}
        </div>
      </div>

      {application.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {application.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-dark-surface px-1.5 py-0.5 text-[10px] font-medium text-content-secondary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[10px] text-content-tertiary">
        <span>{application.location ?? (application.isRemote ? 'Remote' : '')}</span>
        <span>{days === 0 ? 'today' : `${days}d`}</span>
      </div>
    </div>
  );
}
