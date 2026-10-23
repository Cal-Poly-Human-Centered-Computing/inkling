// Helpers for persisting datasets (arrays of row objects) to localStorage and reading them back.

import { autoType } from 'd3-dsv';

export function getDataToken(): any {
  const dataset = readRaw()
  if (!dataset) return null;

  // TODO: eventually, also account for if a csv was uploaded
  return dataset?.url ? { url: dataset.url } : null;
}

export type ColumnType = 'quantitative' | 'temporal' | 'nominal' | 'ordinal';
// The types estimateType can infer from the values. Ordinal is dropped: whether a column's values have a
// meaningful order (ratings, sizes, cylinder counts) isn't something the values reliably show, so only the user sets it.
export type EstimatedColumnType = Exclude<ColumnType, 'ordinal'>;
export type ColumnSchema = { name: string; type: ColumnType }[];

export type PersistedDataset = {
  url?: string;
  columns?: string[];
  schema?: ColumnSchema; // estimated once, when the dataset is stored
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

// An ISO date followed by a space and a time; the space is swapped for the "T" autoType expects
const SPACE_DATETIME = /^(\d{4}-\d{2}-\d{2}) (?=\d{2}:\d{2})/;

/**
  A column gets a type only if every non-empty value parses as that type under d3's autoType (CSV rows have
  already been through it, so their dates are Date objects; JSON rows haven't); anything mixed is nominal.
  Empty values (null, undefined, '') are skipped; NaN counts as a number.
  One addition to autoType: space-separated datetimes ("2015-03-07 12:32:17") count as dates, as they do in Vega.
*/
export function estimateType(values: any[]): EstimatedColumnType {
  const types = new Set<EstimatedColumnType>();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (value instanceof Date) {
      types.add('temporal');
      continue;
    }
    const text = String(value).trim().replace(SPACE_DATETIME, '$1T');
    const parsed = autoType<{ v: string | number | boolean | Date | null }, 'v'>({ v: text }).v;
    if (parsed === null) continue; // empty or whitespace-only
    types.add(typeof parsed === 'number' ? 'quantitative' : parsed instanceof Date ? 'temporal' : 'nominal');
  }
  return types.size === 1 ? [...types][0] : 'nominal';
}

function estimateSchema(columns: string[], data: Record<string, any>[]): ColumnSchema {
  return columns.map(name => ({
    name,
    type: estimateType(data.map(row => row?.[name]))
  }));
}

/**
 * Column names with estimated Vega-Lite types. This is the only information about the dataset that gets
 * sent to the server/LLM; the rows themselves stay on the client.
 */
export function getColumnSchema(): ColumnSchema {
  const payload = readRaw();
  // datasets stored before the schema was saved alongside them are estimated here instead
  return payload?.schema ?? estimateSchema(payload?.columns ?? [], payload?.data ?? []);
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
 * column names, their estimated types, and optional source URL.
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
    schema: columns?.length ? estimateSchema(columns, data ?? []) : undefined,
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
// - getColumnSchema()
