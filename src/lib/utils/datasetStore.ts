// Helpers for persisting datasets (arrays of row objects) to localStorage and reading them back.

export function getDataToken(): any {
  const dataset = readRaw()
  if (!dataset) return null;

  // TODO: eventually, also account for if a csv was uploaded
  return dataset?.url ? { url: dataset.url } : null;
}

export type PersistedDataset = {
  url?: string;
  columns?: string[];
  data?: Record<string, any>[];
  timestamp?: number;
};

const STORAGE_KEY = 'app:dataset';

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readRaw(): PersistedDataset | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedDataset;
  } catch (err) {
    console.warn('datasetStore: failed to read from localStorage', err);
    return null;
  }
}

export function getColumnNames(): string[] {
    const payload = readRaw();
    if (payload && payload.columns) {
        return payload.columns;
    } else {
      return []
    }
}

function writeRaw(payload: PersistedDataset | null) {
  if (!isBrowser()) return;
  try {
    if (payload === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }
  } catch (err) {
    console.warn('datasetStore: failed to write to localStorage', err);
  }
}

/**
 * Persist a dataset (array of row objects) to localStorage, along with its
 * column names and optional source URL.
 *
 * Note: localStorage has size limits (~5MB). For larger datasets consider using
 * IndexedDB or not persisting the full dataset.
 */
export function setDataset(data: Record<string, any>[], columns: string[], url?: string) {
  if (!isBrowser()) return;
  if (!data?.length && !url) return;

  const payload: PersistedDataset = {
    url: url ?? undefined,
    columns: columns?.length ? columns : undefined,
    data: data?.length ? data : undefined,
    timestamp: Date.now(),
  };

  writeRaw(payload);
}

/**
 * Persist only a URL reference for the dataset (lightweight)
 */
export function setDatasetUrl(url: string) {
  if (!isBrowser()) return;
  const payload: PersistedDataset = { url, timestamp: Date.now() };
  writeRaw(payload);
}

/**
 * Clear any persisted dataset from localStorage
 */
export function clearDatasetStore() {
  writeRaw(null);
}

export function getFirstRow(): Record<string, any> | null {
  const payload = readRaw();
  if (!payload || !payload.data) return null;

  const { data, columns } = payload;
  if (!Array.isArray(data) || data.length === 0 || !columns || !columns.length) return null;

  const first = data[0];
  if (typeof first !== 'object' || first === null) return null;

  // preserve column order
  const obj: Record<string, any> = {};
  for (const col of columns) {
    obj[col] = (first as Record<string, any>)[col];
  }
  return obj;
}


/**
 * Read the raw persisted payload (no reconstruction). Useful for quick inspection or partial restores.
 */
export function readPersistedDataset(): PersistedDataset | null {
  return readRaw();
}

// Exports summary:
// - setDataset(data, columns, url?)
// - setDatasetUrl(url)
// - clearDatasetStore()
// - readPersistedDataset()
