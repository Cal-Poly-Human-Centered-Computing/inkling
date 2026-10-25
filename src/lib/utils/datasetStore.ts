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

// Metadata about the dataset; small, so it's cheap to read on every request
export type PersistedDataset = {
  url?: string;
  columns?: string[];
  schema?: ColumnSchema; // estimated once, when the dataset is stored
  timestamp?: number;
};

// Metadata and rows are stored under separate keys so reading the metadata never parses the rows
const STORAGE_KEY = 'app:dataset';
const ROWS_KEY = 'app:dataset:rows';

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readJson<T>(key: string): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn('datasetStore: failed to read from localStorage', err);
    return null;
  }
}

function readRaw(): PersistedDataset | null {
  return readJson<PersistedDataset>(STORAGE_KEY);
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
  if (!payload) return [];
  if (payload.schema) return payload.schema;

  // Datasets stored in the old format kept their rows in the metadata and had no schema. Estimate the schema once
  // and save it, dropping the rows: they were only ever URL datasets, whose rows aren't kept.
  const { data, ...metadata } = payload as PersistedDataset & { data?: Record<string, any>[] };
  if (!data?.length || !metadata.columns?.length) return [];
  const schema = estimateSchema(metadata.columns, data);
  writeJson(STORAGE_KEY, { ...metadata, schema });
  return schema;
}

// Stores the value under the key, or removes the key when the value is null. Returns false if the write failed
// (e.g. the dataset is over localStorage's ~5MB quota).
function writeJson(key: string, value: unknown): boolean {
  if (!isBrowser()) return false;
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
    return true;
  } catch (err) {
    console.warn('datasetStore: failed to write to localStorage', err);
    return false;
  }
}

/**
 * Persist a dataset's column names and estimated types to localStorage, plus either its source URL or its rows.
 * Rows of a URL dataset are only used to estimate types and aren't kept: the chart loads them from the URL.
 * Returns false if nothing was stored; the previously stored dataset is then left as it was.
 *
 * Note: localStorage has size limits (~5MB). For larger datasets consider using IndexedDB.
 */
export function setDataset(data: Record<string, any>[], columns: string[], url?: string): boolean {
  if (!isBrowser()) return false;
  if (!data?.length && !url) return false;

  const payload: PersistedDataset = {
    url: url ?? undefined,
    columns: columns?.length ? columns : undefined,
    schema: columns?.length ? estimateSchema(columns, data ?? []) : undefined,
    timestamp: Date.now(),
  };

  // rows first, so a failed (too large) write doesn't leave new metadata alongside the old dataset's rows
  if (!writeJson(ROWS_KEY, url ? null : data)) return false;
  return writeJson(STORAGE_KEY, payload);
}

/**
 * Clear any persisted dataset from localStorage
 */
export function clearDatasetStore() {
  writeJson(STORAGE_KEY, null);
  writeJson(ROWS_KEY, null);
}

/**
 * The stored rows of a dataset without a URL (e.g. an uploaded file), or null. Parses the whole dataset, so only
 * call this where the rows are actually needed.
 */
export function getRows(): Record<string, any>[] | null {
  return readJson<Record<string, any>[]>(ROWS_KEY);
}

/**
 * Read the persisted metadata (no rows). Useful for quick inspection or partial restores.
 */
export function readPersistedDataset(): PersistedDataset | null {
  return readRaw();
}

// Exports summary:
// - setDataset(data, columns, url?)
// - clearDatasetStore()
// - readPersistedDataset()
// - getRows()
// - getColumnSchema()
