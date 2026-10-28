// Helpers for persisting datasets (arrays of row objects) to localStorage and reading them back.

import { autoType } from 'd3-dsv';
import { summarizeDataset, type DatasetSummary } from './datasetSummary';

/**
 * The `data` of the editor's spec header: the URL of a URL dataset, or the id of a dataset with stored rows (bound
 * to the spec by that name at render time). Null when no dataset is stored.
 */
export function getDataToken(): { url: string } | { name: string } | null {
  const current = readCurrent();
  if (!current) return null;
  return current.meta.url ? { url: current.meta.url } : { name: current.id };
}

export type ColumnType = 'quantitative' | 'temporal' | 'nominal' | 'ordinal';
// The types estimateType can infer from the values. Ordinal is dropped: whether a column's values have a
// meaningful order (ratings, sizes, cylinder counts) isn't something the values reliably show, so only the user sets it.
export type EstimatedColumnType = Exclude<ColumnType, 'ordinal'>;
export type ColumnSchema = { name: string; type: ColumnType }[];

// Metadata about the dataset; small, so it's cheap to read on every request
export type PersistedDataset = {
  url?: string;
  name?: string; // display name, e.g. the uploaded file's name
  columns?: string[];
  schema?: ColumnSchema; // estimated once, when the dataset is stored
  timestamp?: number;
};

// Each dataset is stored under a short generated id: metadata at `app:dataset:<id>`, rows (datasets without a URL
// only) at `app:dataset:<id>:rows`, and the preview's column summary at `app:dataset:<id>:summary`. Separate keys
// mean reading the metadata never parses the rows or the summary.
const PREFIX = 'app:dataset:';
const metaKey = (id: string) => `${PREFIX}${id}`;
const rowsKey = (id: string) => `${PREFIX}${id}:rows`;
const summaryKey = (id: string) => `${PREFIX}${id}:summary`;

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

/** Ids of all stored datasets (skips rows and summary keys). */
function listDatasetIds(): string[] {
  if (!isBrowser()) return [];
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) {
      continue;
    }

    const id = key.slice(PREFIX.length);
    if (id && !id.includes(':')) {
      ids.push(id);
    }
  }
  return ids;
}

function newId(): string {
  const taken = new Set(listDatasetIds());
  let id;
  do {
    id = crypto.randomUUID().slice(0, 8);
  } while (taken.has(id));
  return id;
}

/**
 * The stored dataset's id and metadata. Only one dataset is kept, but if a replace was interrupted before the old
 * one was removed, the newest wins.
 */
function readCurrent(): { id: string; meta: PersistedDataset } | null {
  let current: { id: string; meta: PersistedDataset } | null = null;

  // Find the most recent stored dataset
  for (const id of listDatasetIds()) {
    const meta = readJson<PersistedDataset>(metaKey(id));
    if (meta && (!current || (meta.timestamp ?? 0) > (current.meta.timestamp ?? 0))) {
      current = { id, meta };
    }
  }
  return current;
}

/** Removes a dataset's metadata, rows and summary. */
function removeDataset(id: string) {
  writeJson(metaKey(id), null);
  writeJson(rowsKey(id), null);
  writeJson(summaryKey(id), null);
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
    types.add(
      typeof parsed === 'number' ? 'quantitative' : parsed instanceof Date ? 'temporal' : 'nominal'
    );
  }
  return types.size === 1 ? [...types][0] : 'nominal';
}

function estimateSchema(columns: string[], data: Record<string, any>[]): ColumnSchema {
  return columns.map((name) => ({
    name,
    type: estimateType(data.map((row) => row?.[name]))
  }));
}

/**
 * Column names with estimated Vega-Lite types. This is the only information about the dataset that gets
 * sent to the server/LLM; the rows themselves stay on the client.
 */
export function getColumnSchema(): ColumnSchema {
  return readCurrent()?.meta.schema ?? [];
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
 * Persist a dataset's column names and estimated types to localStorage, plus either its source URL or its rows,
 * under a new id. Replaces the previously stored dataset. `name` is a display name, e.g. the uploaded file's name.
 * Rows of a URL dataset are only used to estimate types and summarise the columns, and aren't kept: the chart loads
 * them from the URL.
 * Returns false if nothing was stored; the previously stored dataset is then left as it was.
 *
 * Note: localStorage has size limits (~5MB). For larger datasets consider using IndexedDB.
 */
export function setDataset(
  data: Record<string, any>[],
  columns: string[],
  { url, name }: { url?: string; name?: string } = {}
): boolean {
  if (!isBrowser()) return false;
  if (!data?.length && !url) return false;

  const schema = columns?.length ? estimateSchema(columns, data ?? []) : undefined;
  const payload: PersistedDataset = {
    url: url ?? undefined,
    name: name ?? undefined,
    columns: columns?.length ? columns : undefined,
    schema,
    timestamp: Date.now()
  };
  const summary = summarizeDataset(data ?? [], schema ?? []);

  const previous = listDatasetIds();
  const id = newId();
  // rows and summary before metadata, so a failed (too large) write never leaves metadata without them
  if (
    (!url && !writeJson(rowsKey(id), data)) ||
    !writeJson(summaryKey(id), summary) ||
    !writeJson(metaKey(id), payload)
  ) {
    removeDataset(id);
    return false;
  }
  previous.forEach(removeDataset);
  return true;
}

/**
 * Clear any persisted dataset from localStorage
 */
export function clearDatasetStore() {
  listDatasetIds().forEach(removeDataset);
}

/**
 * The stored rows of a dataset without a URL (e.g. an uploaded file), or null. Parses the whole dataset, so only
 * call this where the rows are actually needed.
 */
export function getRows(): Record<string, any>[] | null {
  const current = readCurrent();
  return current ? readJson<Record<string, any>[]>(rowsKey(current.id)) : null;
}

/**
 * Read the persisted metadata (no rows). Useful for quick inspection or partial restores.
 */
export function readPersistedDataset(): PersistedDataset | null {
  return readCurrent()?.meta ?? null;
}

export function readDataset(id: string): PersistedDataset | null {
  const dataset = listDatasetIds().find((did) => did === id);
  return dataset === undefined ? null : readJson(metaKey(id));
}

/** The column summary computed when the dataset was stored, for the preview page; null for an unknown id. */
export function getSummary(id: string): DatasetSummary | null {
  return readJson<DatasetSummary>(summaryKey(id));
}

// Exports summary:
// - setDataset(data, columns, { url?, name? })
// - clearDatasetStore()
// - readPersistedDataset()
// - getRows()
// - getColumnSchema()
// - readDataset(id)
// - getSummary(id)
