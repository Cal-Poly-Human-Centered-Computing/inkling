// Utilities for loading CSV/JSON datasets from a URL or a file into plain arrays of row objects.

import { csvParse, autoType } from 'd3-dsv';

export type LoadedDataset = {
  data: Record<string, unknown>[];
  columns: string[];
};

/**
 * Extract column names.
 *
 * @param obj An array of objects, or an object that contains a "columns" field
 * @return A list of column names
 */
export function extractColumns(obj: any): string[] {
  try {
    // csvParse output includes a `columns` array
    if (obj && Array.isArray((obj as any).columns)) return (obj as any).columns;

    // array of objects -> every key that appears in any row, in order of first appearance
    if (
      Array.isArray(obj) &&
      obj.length > 0 &&
      typeof obj[0] === 'object' &&
      !Array.isArray(obj[0])
    ) {
      const keys = new Set<string>();
      for (const row of obj) {
        for (const key of Object.keys(row ?? {})) keys.add(key);
      }
      return [...keys];
    }
  } catch (err) {
    // ignore and fallthrough
  }
  return [];
}

/**
 * Load JSON or CSV from a URL into an array of objects and a list of column names.
 * Behavior:
 *  - determine resource type by URL extension and Content-Type header
 *  - if neither identifies the type, try parsing as JSON, then as CSV
 *  - for CSVs, use d3.autoType
 *
 * @param url Passed directly to `fetch`
 * @returns { LoadedDataset }
 */
export async function loadDatasetFromUrl(url: string): Promise<LoadedDataset> {
  if (!url) throw new Error(`Invalid URL:\n\t${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not read file from URL\n\t${url}`);
  }

  // the body can only be read once, so read it as text and parse from that
  const type = detectType(url.split('?')[0], res.headers.get('Content-Type') ?? '');
  return parseDataset(await res.text(), type, `URL:\n\t${url}`);
}

/**
 * Load a CSV or JSON file (e.g. from a file input) into an array of objects and a list of column names.
 * The type comes from the file's extension or MIME type, as for {@link loadDatasetFromUrl}.
 */
export async function loadDatasetFromFile(file: File): Promise<LoadedDataset> {
  return parseDataset(await file.text(), detectType(file.name, file.type), `file ${file.name}`);
}

/** CSV or JSON, from a path's extension or else a MIME type; undefined if neither says. */
function detectType(path: string, mimeType: string): 'csv' | 'json' | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.csv') || mimeType.includes('csv')) return 'csv';
  if (lower.endsWith('.json') || mimeType.includes('json')) return 'json';
  return undefined;
}

/**
 * Parse CSV (with d3.autoType) or JSON text into rows and columns. With no type, tries JSON, then CSV.
 * `source` names where the text came from, for error messages.
 */
function parseDataset(
  text: string,
  type: 'csv' | 'json' | undefined,
  source: string
): LoadedDataset {
  let data;
  try {
    if (type === 'csv') {
      data = csvParse(text, autoType);
    } else if (type === 'json') {
      data = JSON.parse(text);
    } else {
      // Neither the extension nor the contentType told us the data format
      try {
        data = JSON.parse(text);
      } catch (err) {
        // try CSV
        data = csvParse(text, autoType);
      }
    }
  } catch (err) {
    throw new Error(`Failed to parse data. Expected CSV or JSON-formatted data at ${source}`, {
      cause: err
    });
  }

  if (!isRecordArray(data)) {
    throw new Error(`Expected a non-empty array of row objects at ${source}`);
  }

  return { data, columns: extractColumns(data) };
}

/**
 * @param data A JSON object
 * @returns true if `data` is a non-empty array of objects, false otherwise
 */
function isRecordArray(data: unknown): boolean {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))
  );
}
