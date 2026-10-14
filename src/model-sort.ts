// Ordering for the model picker: the user picks what to sort by and which way.

export type ModelSortKey = 'recommended' | 'name' | 'params' | 'size' | 'released';
export type SortDir = 'asc' | 'desc';
export interface ModelSort { key: ModelSortKey; dir: SortDir }

export const MODEL_SORT_LABELS: Record<ModelSortKey, string> = {
  recommended: 'Best for this PC',
  name: 'Name',
  params: 'Parameters',
  size: 'Download size',
  released: 'Release date',
};

/** The direction each key starts in when chosen: smallest, A to Z, newest first. */
export const DEFAULT_SORT_DIR: Record<ModelSortKey, SortDir> = {
  recommended: 'asc', name: 'asc', params: 'asc', size: 'asc', released: 'desc',
};

export const DEFAULT_MODEL_SORT: ModelSort = { key: 'recommended', dir: 'asc' };

/** Accepts a stored setting, falling back to the default for anything unrecognised. */
export function parseModelSort(value: unknown): ModelSort {
  const v = value as Partial<ModelSort> | null | undefined;
  if (!v || !(v.key && v.key in MODEL_SORT_LABELS)) return DEFAULT_MODEL_SORT;
  return { key: v.key, dir: v.dir === 'desc' ? 'desc' : 'asc' };
}

/** "1.5B" -> 1.5e9, "394M" -> 3.94e8; 0 when it cannot be read. */
export function parseParamCount(text: string): number {
  const m = /^\s*([\d.]+)\s*([KMB])?/i.exec(text);
  if (!m) return 0;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return parseFloat(m[1]) * scale;
}

export interface SortableModel {
  id: string;
  name: string;
  params: number;
  bytes: number;
  /** ISO date, e.g. "2024-09-25". */
  released: string;
  fit: 'great' | 'slow' | 'too-big';
  /** Curated order used to break ties in the recommended view. */
  rank: number;
}

const FIT_ORDER = { great: 0, slow: 1, 'too-big': 2 };

/** Sorts in place and returns the array. Ties fall back to name so the order is stable. */
export function sortModels<T extends SortableModel>(rows: T[], sort: ModelSort, recommendedId: string | null): T[] {
  const sign = sort.dir === 'desc' ? -1 : 1;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const compare: Record<ModelSortKey, (a: T, b: T) => number> = {
    recommended: (a, b) =>
      Number(b.id === recommendedId) - Number(a.id === recommendedId)
      || FIT_ORDER[a.fit] - FIT_ORDER[b.fit]
      || a.rank - b.rank,
    name: byName,
    params: (a, b) => a.params - b.params,
    size: (a, b) => a.bytes - b.bytes,
    released: (a, b) => a.released.localeCompare(b.released),
  };
  return rows.sort((a, b) => sign * compare[sort.key](a, b) || byName(a, b));
}
