export type TcgSyncProgress = {
  runId: string | null;
  active: boolean;
  percent: number;
  stage: string;
  processedGroups: number;
  totalGroups: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

const initial = (): TcgSyncProgress => ({
  runId: null,
  active: false,
  percent: 0,
  stage: "Idle",
  processedGroups: 0,
  totalGroups: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
});

const globalProgress = globalThis as typeof globalThis & { __tcgSyncProgress?: TcgSyncProgress };

export function getTcgSyncProgress(): TcgSyncProgress {
  return globalProgress.__tcgSyncProgress ??= initial();
}

export function beginTcgSync(): string | null {
  const current = getTcgSyncProgress();
  if (current.active) return null;
  const runId = crypto.randomUUID();
  globalProgress.__tcgSyncProgress = {
    ...initial(),
    runId,
    active: true,
    percent: 1,
    stage: "Checking TCGCSV for new prices…",
    startedAt: new Date().toISOString(),
  };
  return runId;
}

export function updateTcgSync(runId: string, patch: Partial<TcgSyncProgress>) {
  const current = getTcgSyncProgress();
  if (current.runId !== runId) return;
  globalProgress.__tcgSyncProgress = {
    ...current,
    ...patch,
    percent: Math.max(current.percent, Math.min(100, Math.round(patch.percent ?? current.percent))),
  };
}

export function finishTcgSync(runId: string, error?: string) {
  updateTcgSync(runId, {
    active: false,
    percent: error ? getTcgSyncProgress().percent : 100,
    stage: error ? "Sync failed" : "Sync complete",
    finishedAt: new Date().toISOString(),
    error: error ?? null,
  });
}
