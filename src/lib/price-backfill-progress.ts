export type PriceBackfillProgress = {
  active: boolean;
  percent: number;
  stage: string;
  processedDays: number;
  totalDays: number;
  snapshots: number;
  error: string | null;
};

const idle = (): PriceBackfillProgress => ({
  active: false,
  percent: 0,
  stage: "Idle",
  processedDays: 0,
  totalDays: 0,
  snapshots: 0,
  error: null,
});

const state = globalThis as typeof globalThis & { __priceBackfillProgress?: PriceBackfillProgress };

export function getPriceBackfillProgress() {
  return state.__priceBackfillProgress ??= idle();
}

export function beginPriceBackfill(days: number): boolean {
  if (getPriceBackfillProgress().active) return false;
  state.__priceBackfillProgress = { ...idle(), active: true, percent: 1, stage: "Preparing backfill…", totalDays: days };
  return true;
}

export function updatePriceBackfill(patch: Partial<PriceBackfillProgress>) {
  const current = getPriceBackfillProgress();
  state.__priceBackfillProgress = { ...current, ...patch };
}

export function finishPriceBackfill(error?: string) {
  const current = getPriceBackfillProgress();
  state.__priceBackfillProgress = {
    ...current,
    active: false,
    percent: error ? current.percent : 100,
    stage: error ? "Backfill failed" : "Backfill complete",
    error: error ?? null,
  };
}
