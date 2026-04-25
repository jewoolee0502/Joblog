export interface ScanStatus {
  status: 'running' | 'completed' | 'failed';
  result?: {
    emailsScanned: number;
    statusUpdates: number;
    newApplications: number;
    flaggedForReview: number;
    errors: string[];
  };
  error?: string;
  startedAt: number;
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes

const store = new Map<string, ScanStatus>();

export function setScanStatus(userId: string, status: ScanStatus): void {
  store.set(userId, status);
}

export function getScanStatus(userId: string): ScanStatus | null {
  const entry = store.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.startedAt > TTL_MS) {
    store.delete(userId);
    return null;
  }
  return entry;
}

export function deleteScanStatus(userId: string): void {
  store.delete(userId);
}
