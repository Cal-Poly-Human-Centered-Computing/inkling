// Utilities for loading datasets using danfojs and producing JSON-serializable payloads.
// Keeps dynamic import/use of danfojs centralized so UI components can remain small.

export type SerializedDataset = {
  columns?: string[];
  // either an array of objects (toJSON) or 2D array values
  data?: any[] | any[][];
};

export type LoadedDataset = {
  df: any;
  columns: string[];
  // a JSON-serializable representation suitable for localStorage / transmission if needed
  serialized?: SerializedDataset;
  raw?: any; // raw value returned by readJSON or fetch
};

async function importDanfo() {
  const raw: any = await import('danfojs');
  return raw && raw.default ? raw.default : raw;
}

/**
 * Extract column names from a danfo DataFrame or plain JSON structures.
 */
export function extractColumns(obj: any): string[] {
  try {
    // danfo DataFrame: common builds expose `columns` as an array
    if (obj && Array.isArray((obj as any).columns)) return (obj as any).columns;
    // some builds expose columns() as a function
    if (obj && typeof (obj as any).columns === 'function') return (obj as any).columns();

    // array of objects -> keys of first object
    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object' && !Array.isArray(obj[0])) {
      return Object.keys(obj[0]);
    }

    // object with array values: pick the first array-of-objects
    if (obj && typeof obj === 'object') {
      const val = Object.values(obj)[0];
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') return Object.keys(val[0]);
    }
  } catch (err) {
    // ignore and fallthrough
  }
  return [];
}

/**
 * Return a JSON-serializable representation for a DataFrame-like object.
 * Preference: use df.values (2D array) if available, otherwise df.toJSON() (array of objects).
 */
export function serializeDataFrame(df: any): SerializedDataset | undefined {
  try {
    if (!df) return undefined;
    // If df has `values` (2D array), prefer that
    if ((df as any).values && Array.isArray((df as any).values)) {
      return { columns: (df as any).columns ?? undefined, data: (df as any).values };
    }
    // If df has toJSON that yields array-of-objects
    if (typeof (df as any).toJSON === 'function') {
      try {
        const j = (df as any).toJSON();
        if (Array.isArray(j)) return { columns: (df as any).columns ?? undefined, data: j };
      } catch (err) {
        // fallthrough
      }
    }

    // If input already looks like array-of-objects
    if (Array.isArray(df) && df.length > 0 && typeof df[0] === 'object') {
      return { columns: Object.keys(df[0]), data: df };
    }
  } catch (err) {
    // ignore
  }
  return undefined;
}

/**
 * Load JSON from a URL into a danfo DataFrame when possible. Returns df + column names + serialized payload.
 * Behavior:
 *  - dynamically imports danfojs and attempts `dfd.readJSON(url)` if available
 *  - on failure, falls back to fetch(url).json() then `new dfd.DataFrame(data)` if possible
 *  - if danfo isn't available or DataFrame can't be constructed, `df` may be the raw JSON
 */
export async function loadDatasetFromUrl(url: string): Promise<LoadedDataset> {
  if (!url) throw new Error('Invalid URL');

  let dfd: any = null;
  let raw: any = null;
  let df: any = null;

  // attempt to import danfojs; if this fails we'll still try to fetch JSON
  try {
    dfd = await importDanfo();
  } catch (err) {
    // import failure -> log and continue (we'll rely on fetch + raw JSON)
    // consumer can decide how to handle missing danfo dependency
    // console.warn('datasetLoader: failed to import danfojs', err);
  }

  // Try danfo's readJSON first if available
  if (dfd && typeof dfd.readJSON === 'function') {
    try {
      raw = await dfd.readJSON(url);
      // readJSON often returns a DataFrame instance
      df = raw;
    } catch (err) {
      // readJSON failed (CORS, network, or runtime) -> we'll fall back to fetch below
      raw = null;
    }
  }

  // If we don't have raw data yet, fetch JSON explicitly
  if (!df) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Network error: ${resp.status} ${resp.statusText}`);
    raw = await resp.json();

    // try to construct a DataFrame if danfo is available
    if (dfd && typeof dfd.DataFrame === 'function') {
      try {
        df = new dfd.DataFrame(raw);
      } catch (err) {
        // construction failed; keep df as null and leave raw as-is
        df = null;
      }
    }
  }

  // If df is still null, but raw resembles a DataFrame-like object (some danfo builds may return plain objects), try to detect
  if (!df && raw && ((raw as any).data || (raw as any).values || (raw as any).columnNames)) {
    // keep raw as-is; extract columns heuristically
    df = raw;
  }

  const columns = extractColumns(df ?? raw ?? undefined);
  const serialized = serializeDataFrame(df ?? raw);

  return { df: df ?? raw, columns, serialized, raw };
}

/**
 * Construct a DataFrame from an in-memory object (array-of-objects or 2D array) and return same shape as loadDatasetFromUrl.
 */
export async function loadDatasetFromObject(obj: any): Promise<LoadedDataset> {
  if (!obj) throw new Error('No data provided');
  let dfd: any = null;
  try { dfd = await importDanfo(); } catch (err) { dfd = null; }

  let df: any = null;
  if (dfd && typeof dfd.DataFrame === 'function') {
    try { df = new dfd.DataFrame(obj); } catch (err) { df = null; }
  }

  const columns = extractColumns(df ?? obj);
  const serialized = serializeDataFrame(df ?? obj);
  return { df: df ?? obj, columns, serialized, raw: obj };
}
