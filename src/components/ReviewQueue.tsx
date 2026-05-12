import { useEffect, useState } from 'react';
import { nudgesApi } from '@/lib/api';
import { useApplicationStore } from '@/store/applicationStore';
import type { Nudge } from '@/types';

interface ReviewQueueProps {
  open: boolean;
  onClose: () => void;
  onViewApplication: (id: string) => void;
  onCountChange: (count: number) => void;
  refreshKey?: number;
}

export function ReviewQueue({ open, onClose, onViewApplication, onCountChange, refreshKey }: ReviewQueueProps) {
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNudges = async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await nudgesApi.list();
      const reviewNudges = all.filter((n) => n.nudgeType === 'email_review');
      setNudges(reviewNudges);
      onCountChange(reviewNudges.length);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNudges();
  }, [open, refreshKey]);

  const handleDismiss = async (id: string) => {
    try {
      await nudgesApi.dismiss(id);
      setNudges((prev) => {
        const updated = prev.filter((n) => n.id !== id);
        onCountChange(updated.length);
        return updated;
      });
      useApplicationStore.getState().loadNeedsReview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="backdrop-fade-in absolute inset-0" style={{ background: 'oklch(0.08 0.01 240 / 0.5)' }} onClick={onClose} />
      <div className="panel-slide-in relative h-full w-full max-w-lg overflow-y-auto border-l border-border-subtle bg-dark-raised shadow-2xl">
        <div className="border-b border-border-subtle px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-content-primary">
                Needs Review
              </h2>
              {nudges.length > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-medium text-white">
                  {nudges.length}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-content-tertiary transition-colors duration-150 hover:bg-dark-surface hover:text-content-primary"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-xs text-content-tertiary">
            Emails that couldn't be confidently classified. Review and take action.
          </p>
        </div>

        <div className="px-6 py-4">
          {loading && <p className="text-sm text-content-tertiary">Loading...</p>}
          {error && (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
          )}

          {!loading && nudges.length === 0 && (
            <div className="py-12 text-center text-sm text-content-tertiary">
              No emails need review. All clear!
            </div>
          )}

          <div className="space-y-2">
            {nudges.map((nudge) => (
              <NudgeCard
                key={nudge.id}
                nudge={nudge}
                onDismiss={() => handleDismiss(nudge.id)}
                onView={() => {
                  onViewApplication(nudge.applicationId);
                  onClose();
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NudgeCard({
  nudge,
  onDismiss,
  onView,
}: {
  nudge: Nudge;
  onDismiss: () => void;
  onView: () => void;
}) {
  const parts = nudge.message.match(
    /Email from (.+?): "(.+?)" — classified as (\w+) \(([\d.]+)\)\. (.+)/,
  );

  const sender = parts?.[1] ?? 'Unknown sender';
  const subject = parts?.[2] ?? nudge.message;
  const category = parts?.[3] ?? 'UNCLEAR';
  const confidence = parts?.[4] ?? '0.00';
  const reason = parts?.[5] ?? '';

  return (
    <div className="rounded-lg border border-border-subtle px-4 py-3 transition-colors duration-150 hover:bg-dark-surface">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-content-primary">
              {nudge.application.companyName}
            </span>
            <span className="text-xs text-content-secondary">{nudge.application.roleTitle}</span>
          </div>
          <p className="mt-1 truncate text-sm text-content-secondary" title={subject}>
            {subject}
          </p>
          <p className="mt-0.5 text-xs text-content-tertiary">
            From: {sender}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-stage-rejected/15 px-2 py-0.5 text-xs font-medium text-stage-rejected ring-1 ring-stage-rejected/25">
              {category}
            </span>
            <span className="text-xs text-content-tertiary">
              Confidence: {confidence}
            </span>
          </div>
          {reason && (
            <p className="mt-1 text-xs italic text-content-tertiary">{reason}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onView}
          className="rounded-lg bg-content-primary px-3 py-1 text-xs font-medium text-dark-base transition-colors duration-150 hover:opacity-90"
        >
          View Application
        </button>
        <button
          onClick={onDismiss}
          className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-content-secondary transition-colors duration-150 hover:bg-dark-overlay hover:text-content-primary"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
