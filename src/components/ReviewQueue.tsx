import { useEffect, useState } from 'react';
import { nudgesApi } from '@/lib/api';
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
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Needs Review
              {nudges.length > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-medium text-white">
                  {nudges.length}
                </span>
              )}
            </h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Emails that couldn't be confidently classified. Review and take action.
          </p>
        </div>

        <div className="px-6 py-4">
          {loading && <p className="text-sm text-slate-500">Loading...</p>}
          {error && (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          {!loading && nudges.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-400">
              No emails need review. All clear!
            </div>
          )}

          <div className="space-y-3">
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
  // Parse the message format: "Email from X: "subject" — classified as CATEGORY (confidence). reason"
  const parts = nudge.message.match(
    /Email from (.+?): "(.+?)" — classified as (\w+) \(([\d.]+)\)\. (.+)/,
  );

  const sender = parts?.[1] ?? 'Unknown sender';
  const subject = parts?.[2] ?? nudge.message;
  const category = parts?.[3] ?? 'UNCLEAR';
  const confidence = parts?.[4] ?? '0.00';
  const reason = parts?.[5] ?? '';

  return (
    <div className="rounded-lg border border-slate-200 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900">
              {nudge.application.companyName}
            </span>
            <span className="text-xs text-slate-500">{nudge.application.roleTitle}</span>
          </div>
          <p className="mt-1 truncate text-sm text-slate-700" title={subject}>
            {subject}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            From: {sender}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
              {category}
            </span>
            <span className="text-xs text-slate-400">
              Confidence: {confidence}
            </span>
          </div>
          {reason && (
            <p className="mt-1 text-xs text-slate-500 italic">{reason}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onView}
          className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
        >
          View Application
        </button>
        <button
          onClick={onDismiss}
          className="rounded-md px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
