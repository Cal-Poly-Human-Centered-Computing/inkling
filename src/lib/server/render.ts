import * as vegaLite from "vega-lite";
import * as vega from "vega";
import type {ColumnSchema} from "./schemas";

// Compiles and runs candidate specs on the server with placeholder data generated from the column schema.
// Real data never reaches the server, so this checks a spec's structure, not the user's actual values.

const NUM_ROWS = 60;
const NUM_CATEGORIES = 5;

// Small seeded PRNG (mulberry32) so placeholder data is identical across runs
function seededRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placeholderData(columns: ColumnSchema): Record<string, any>[] {
  const random = seededRandom(42);

  return Array.from({length: NUM_ROWS}, (_, i) => {
    const row: Record<string, any> = {};
    for (const col of columns) {
      if (col.type === "quantitative") {
        row[col.name] = Math.round(random() * 1000) / 10;
      } else if (col.type === "temporal") {
        // One row per month across 5 years; no timezone suffix, so it parses as local time like the client's data
        const month = String(i % 12 + 1).padStart(2, "0");
        row[col.name] = `${2020 + Math.floor(i / 12)}-${month}-15T00:00:00`;
      } else {
        const letter = String.fromCharCode(65 + Math.floor(random() * NUM_CATEGORIES));
        row[col.name] = `${col.name} ${letter}`;
      }
    }
    return row;
  });
}

export type RenderResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function collectingLogger(warnings: string[], errors: string[]) {
  const log = vega.logger(vega.Warn);
  const format = (args: any[]) => args.map(a => (typeof a === "string" ? a : a?.message ?? JSON.stringify(a))).join(" ");
  log.warn = (...args: any[]) => { warnings.push(format(args)); return log; };
  log.error = (...args: any[]) => { errors.push(format(args)); return log; };
  return log;
}

/**
 * Compiles and runs a spec against placeholder data, returning compile/runtime errors.
 * Catches problems that compiling alone misses, e.g. fields that don't exist.
 */
export async function renderSpec(specString: string, columns: ColumnSchema): Promise<RenderResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  let spec: any;
  try {
    spec = JSON.parse(specString);
  } catch (err) {
    return {
      ok: false,
      errors: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`], warnings
    };
  }

  // The spec deliberately omits data; inject placeholder rows for rendering only
  spec = {...spec, data: {values: placeholderData(columns)}};

  // Vega only warns about fields that don't exist, so they're checked explicitly after rendering
  const known = new Set(columns.map(c => c.name));

  try {
    const log = collectingLogger(warnings, errors);
    const compiled = vegaLite.compile(spec, {logger: log});
    const view = new vega.View(vega.parse(compiled.spec), {renderer: "none", logger: log});
    // Rendering to SVG (and discarding it) surfaces runtime errors that compiling alone misses
    await view.toSVG();
    view.finalize();

    errors.push(...unknownFieldErrors(spec, known));

    return {ok: errors.length === 0, errors, warnings};
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return {ok: false, errors, warnings};
  }
}

// Collects "field" references in the spec that are neither columns nor fields created by a transform
function unknownFieldErrors(spec: any, columns: Set<string>): string[] {
  const derived = new Set<string>();
  const referenced = new Set<string>();

  const walk = (node: any) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      if (key === "data") continue;
      if (key === "as") {
        [value].flat().forEach(v => typeof v === "string" && derived.add(v));
      } else if (key === "field" && typeof value === "string") {
        referenced.add(value);
      } else {
        walk(value);
      }
    }
  };
  walk(spec);

  return [...referenced]
    .filter(f => !columns.has(f) && !derived.has(f))
    .map(f => `Field "${f}" is not a column in the dataset or a field created by a transform`);
}
