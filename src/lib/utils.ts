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
  switch (status) {
    case 'SAVED':       return 'bg-slate-50 ring-2 ring-slate-300';
    case 'APPLIED':     return 'bg-blue-50 ring-2 ring-blue-300';
    case 'SCREENING':   return 'bg-violet-50 ring-2 ring-violet-300';
    case 'INTERVIEW':   return 'bg-purple-50 ring-2 ring-purple-300';
    case 'FINAL_ROUND': return 'bg-pink-50 ring-2 ring-pink-300';
    case 'OFFER':       return 'bg-emerald-50 ring-2 ring-emerald-300';
    case 'ACCEPTED':    return 'bg-emerald-50 ring-2 ring-emerald-400';
    case 'REJECTED':    return 'bg-red-50 ring-2 ring-red-300';
    case 'WITHDRAWN':   return 'bg-gray-50 ring-2 ring-gray-300';
    case 'GHOSTED':     return 'bg-slate-100 ring-2 ring-slate-400';
  }
}

export function statusAccent(status: ApplicationStatus): string {
  switch (status) {
    case 'SAVED':
      return 'border-slate-300 bg-slate-50';
    case 'APPLIED':
      return 'border-blue-300 bg-blue-50';
    case 'SCREENING':
      return 'border-violet-300 bg-violet-50';
    case 'INTERVIEW':
      return 'border-purple-300 bg-purple-50';
    case 'FINAL_ROUND':
      return 'border-pink-300 bg-pink-50';
    case 'OFFER':
      return 'border-emerald-300 bg-emerald-50';
    case 'ACCEPTED':
      return 'border-emerald-400 bg-emerald-100';
    case 'REJECTED':
      return 'border-red-300 bg-red-50';
    case 'WITHDRAWN':
      return 'border-gray-300 bg-gray-50';
    case 'GHOSTED':
      return 'border-slate-400 bg-slate-100';
  }
}
