import type { Application, ApplicationStatus } from '@/types';
import { STALE_THRESHOLDS } from '@/types';

export function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function isStale(app: Application): boolean {
  const threshold = STALE_THRESHOLDS[app.status];
  if (threshold == null) return false;
  return daysSince(app.lastUpdatedAt) >= threshold;
}

export function statusDropZone(status: ApplicationStatus): string {
  const map: Record<ApplicationStatus, string> = {
    SAVED:     'bg-stage-saved/10 ring-1 ring-stage-saved/40',
    APPLIED:   'bg-stage-applied/10 ring-1 ring-stage-applied/40',
    INTERVIEW: 'bg-stage-interview/10 ring-1 ring-stage-interview/40',
    ACCEPTED:  'bg-stage-accepted/10 ring-1 ring-stage-accepted/40',
    REJECTED:  'bg-stage-rejected/10 ring-1 ring-stage-rejected/40',
    WITHDRAWN: 'bg-stage-withdrawn/10 ring-1 ring-stage-withdrawn/40',
    GHOSTED:   'bg-stage-ghosted/10 ring-1 ring-stage-ghosted/40',
  };
  return map[status];
}

export function statusAccent(status: ApplicationStatus): string {
  const map: Record<ApplicationStatus, string> = {
    SAVED:     'border-stage-saved/30 bg-stage-saved/8',
    APPLIED:   'border-stage-applied/30 bg-stage-applied/8',
    INTERVIEW: 'border-stage-interview/30 bg-stage-interview/8',
    ACCEPTED:  'border-stage-accepted/30 bg-stage-accepted/8',
    REJECTED:  'border-stage-rejected/30 bg-stage-rejected/8',
    WITHDRAWN: 'border-stage-withdrawn/30 bg-stage-withdrawn/8',
    GHOSTED:   'border-stage-ghosted/30 bg-stage-ghosted/8',
  };
  return map[status];
}

/** Tailwind color class for the status dot/indicator */
export function statusDot(status: ApplicationStatus): string {
  const map: Record<ApplicationStatus, string> = {
    SAVED:     'bg-stage-saved',
    APPLIED:   'bg-stage-applied',
    INTERVIEW: 'bg-stage-interview',
    ACCEPTED:  'bg-stage-accepted',
    REJECTED:  'bg-stage-rejected',
    WITHDRAWN: 'bg-stage-withdrawn',
    GHOSTED:   'bg-stage-ghosted',
  };
  return map[status];
}
