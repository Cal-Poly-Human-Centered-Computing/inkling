// Utilities for loading CSV/JSON datasets from a URL into plain arrays of row objects.

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

    // array of objects -> keys of first object
    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object' && !Array.isArray(obj[0])) {
      return Object.keys(obj[0]);
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
 *  - on failure, fall back to fetch(url).json() or fetch(url).text() then parse as CSV
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

  // helper to detect extension
  const urlLower = url.split('?')[0].toLowerCase();
  const ext = urlLower.endsWith('.csv') ? 'csv' : urlLower.endsWith('.json') ? 'json' : undefined;
  const contentType = res.headers.get('Content-Type') ?? '';

  const type = ext === 'csv' || contentType.includes('csv') ? 'csv' :
    ext === 'json' || contentType.includes('json') ? 'json' :
      undefined;

  let data;
  try {
    if (type === 'csv') {
      data = csvParse(await res.text(), autoType);
    } else if (type === 'json') {
      data = await res.json();
    } else {
      try {
        data = await res.json();
      } catch (err) {
        // try CSV
        data = csvParse(await res.text(), autoType);
      }
    }
  } catch (err) {
    throw new Error(`Failed to parse data. Expected CSV or JSON-formatted data at URL:\n\t${url}`)
  }

  if (!isRecordArray(data)) {
    throw new Error(`Expected a non-empty array of row objects at \n\t${url}`);
  }

  const columns = extractColumns(data);

  return { data, columns };
}

/**
 * @param data A JSON object
 * @returns true if `data` is a non-empty array of objects, false otherwise
 */
function isRecordArray(data: unknown): boolean {
  return Array.isArray(data) &&
    data.length > 0 &&
    data.every(r => r !== null && typeof r === 'object' && !Array.isArray(r));
}

