import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useApplicationStore } from '@/store/applicationStore';
import type { ApplicationStatus } from '@/types';
import { KANBAN_COLUMNS } from '@/types';
import { KanbanColumn } from './KanbanColumn';
import { ApplicationCard } from './ApplicationCard';

interface Props {
  onCardClick: (id: string) => void;
  onAddClick: (status: ApplicationStatus) => void;
}

export function KanbanBoard({ onCardClick, onAddClick }: Props) {
  const applications = useApplicationStore((s) => s.applications);
  const moveApplication = useApplicationStore((s) => s.moveApplication);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const grouped = useMemo(() => {
    const map = {} as Record<ApplicationStatus, typeof applications>;
    KANBAN_COLUMNS.forEach((s) => {
      map[s] = [];
    });
    applications.forEach((a) => {
      if (map[a.status]) map[a.status].push(a);
    });
    return map;
  }, [applications]);

  const activeApp = activeId ? applications.find((a) => a.id === activeId) ?? null : null;

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const activeAppId = String(active.id);
    const overData = over.data.current as { type?: string; status?: ApplicationStatus } | undefined;
    const activeData = active.data.current as { status?: ApplicationStatus } | undefined;

    let targetStatus: ApplicationStatus | undefined;
    if (overData?.type === 'column') {
      targetStatus = overData.status;
    } else if (overData?.type === 'application') {
      targetStatus = overData.status;
    }

    if (targetStatus && activeData?.status !== targetStatus) {
      moveApplication(activeAppId, targetStatus, 'manual');
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="kanban-scroll flex h-full w-full divide-x divide-slate-200/80 overflow-x-auto rounded-lg border border-slate-200 bg-white/40">
        {KANBAN_COLUMNS.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            applications={grouped[status]}
            onCardClick={onCardClick}
            onAddClick={onAddClick}
          />
        ))}
      </div>
      <DragOverlay>
        {activeApp ? <ApplicationCard application={activeApp} onClick={() => {}} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
