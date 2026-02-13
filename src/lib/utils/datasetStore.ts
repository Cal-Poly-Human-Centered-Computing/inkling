// Helpers for persisting datasets to localStorage and rehydrating them as danfo DataFrames.
// This module intentionally does not modify other files; it depends on the existing
// `datasetLoader` serializer where helpful but is otherwise self-contained.

export type PersistedDataset = {
  url?: string;
  columns?: string[];
  // either array-of-objects (toJSON) or 2D array values
  data?: any[] | any[][];
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
    console.log(payload)
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
 * Persist a danfo DataFrame (or dataframe-like object) to localStorage.
 * The function will attempt to serialize the DataFrame into a JSON-friendly
 * payload using common DataFrame shapes: `values` (2D array) or `toJSON()` (array of objects).
 * If neither is available, it will try to infer from the input object.
 *
 * Note: localStorage has size limits (~5MB). For larger datasets consider using
 * IndexedDB or not persisting the full dataset.
 */
export async function setDatasetFromDfd(df: any, url?: string) {
  if (!isBrowser()) return;
  if (!df && !url) return;

  // Try to serialize using the DataFrame's preferred APIs
  let columns: string[] | undefined;
  let data: any[] | any[][] | undefined;

  try {
    // columns may be an array or a function
    if (df && Array.isArray((df as any).columns)) columns = (df as any).columns;
    else if (df && typeof (df as any).columns === 'function') columns = (df as any).columns();
  } catch (err) {
    columns = undefined;
  }

  try {
    if (df && (df as any).values && Array.isArray((df as any).values)) {
      data = (df as any).values;
    } else if (df && typeof (df as any).toJSON === 'function') {
      const j = (df as any).toJSON();
      if (Array.isArray(j)) data = j;
    }
  } catch (err) {
    data = undefined;
  }

  // Fallback: if df already looks like an array-of-objects
  if (!data && Array.isArray(df) && df.length > 0 && typeof df[0] === 'object') {
    data = df;
    columns = columns ?? Object.keys(df[0]);
  }

  const payload: PersistedDataset = {
    url: url ?? undefined,
    columns: columns ?? undefined,
    data: data ?? undefined,
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

/**
 * Rehydrate a danfo DataFrame from the persisted payload, if present.
 * Returns a DataFrame instance or null if nothing is stored or rehydration fails.
 *
 * This dynamically imports danfojs at runtime to reconstruct the DataFrame
 * (so the module is only loaded when needed).
 */
export async function getDfdFromStore(): Promise<any | null> {
  if (!isBrowser()) return null;

  const payload = readRaw();
  if (!payload || !payload.data) return null;

  try {
    const raw: any = await import('danfojs');
    const dfd = raw && raw.default ? raw.default : raw;
    if (!dfd || typeof dfd.DataFrame !== 'function') {
      console.warn('datasetStore: danfojs DataFrame constructor not available when rehydrating');
      return null;
    }

    // data may be array-of-objects or 2D array; construct accordingly
    if (Array.isArray(payload.data) && payload.data.length > 0 && typeof payload.data[0] === 'object' && !Array.isArray(payload.data[0])) {
      return new dfd.DataFrame(payload.data);
    }

    // else assume 2D values with optional columns
    return new dfd.DataFrame(payload.data, { columns: payload.columns });
  } catch (err) {
    console.warn('datasetStore: failed to reconstruct DataFrame from store', err);
    return null;
  }
}

/**
 * Read the raw persisted payload (no reconstruction). Useful for quick inspection or partial restores.
 */
export function readPersistedDataset(): PersistedDataset | null {
  return readRaw();
}

// Exports summary:
// - setDatasetFromDfd(df, url?)
// - setDatasetUrl(url)
// - getDfdFromStore(): Promise<DataFrame | null>
// - clearDatasetStore()
// - readPersistedDataset()
