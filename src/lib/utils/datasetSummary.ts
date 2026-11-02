// Per-column summaries for the dataset preview. Computed once over all the rows when a dataset is attached, and
// stored as numbers only, so the preview never needs the rows.

import { bin, descending, extent, mean, median, nice, rollups } from 'd3-array';
import { autoType } from 'd3-dsv';
import { utcTicks } from 'd3-time';
import type { ColumnSchema, ColumnType } from './datasetStore';

/** Roughly how many bins quantitative and temporal histograms get; d3 picks round bin edges near this count. */
const BIN_COUNT = 20;
/** Number of most frequent values kept for nominal and ordinal columns; the rest are counted as `other`. */
export const TOP_K = 10;

/** A histogram bin over [start, end); the last bin includes `end`. Temporal bins are in epoch milliseconds. */
export type Bin = { start: number; end: number; count: number };

type Base = {
  name: string;
  count: number; // non-missing values
  missing: number; // null, undefined, empty or NaN
};

// Statistics are null when the column has no values
export type QuantitativeSummary = Base & {
  type: 'quantitative';
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  bins: Bin[];
};

export type TemporalSummary = Base & {
  type: 'temporal';
  min: number | null; // epoch milliseconds
  max: number | null;
  bins: Bin[];
};

export type CategoricalSummary = Base & {
  type: 'nominal' | 'ordinal';
  distinct: number;
  top: { value: string; count: number }[];
  other: number; // count of values outside `top`
};

export type ColumnSummary = QuantitativeSummary | TemporalSummary | CategoricalSummary;

export type DatasetSummary = {
  rowCount: number;
  columns: ColumnSummary[];
};

/** Summarises every column in `schema` over all of `rows`, by the column's type. */
export function summarizeDataset(
  rows: Record<string, unknown>[],
  schema: ColumnSchema
): DatasetSummary {
  return {
    rowCount: rows.length,
    columns: schema.map(({ name, type }) =>
      summarizeColumn(
        name,
        type,
        rows.map((row) => row?.[name])
      )
    )
  };
}

function summarizeColumn(name: string, type: ColumnType, values: unknown[]): ColumnSummary {
  if (type === 'quantitative') return summarizeQuantitative(name, values);
  if (type === 'temporal') return summarizeTemporal(name, values);
  return summarizeCategorical(name, type, values);
}

// d3's statistics skip null and NaN but coerce '' to 0, so missing values are dropped before they reach d3
function isMissing(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' && Number.isNaN(value)) ||
    (typeof value === 'string' && value.trim() === '')
  );
}

function summarizeQuantitative(name: string, values: unknown[]): QuantitativeSummary {
  // JSON rows may hold numbers as strings
  const numbers = values
    .filter((v) => !isMissing(v))
    .map((v) => (typeof v === 'number' ? v : Number(String(v).trim())))
    .filter((n) => !Number.isNaN(n));
  const [min, max] = extent(numbers);
  const bins =
    min === undefined
      ? []
      : bin()
          .domain(nice(min, max, BIN_COUNT))
          .thresholds(BIN_COUNT)(numbers)
          .map((b) => ({ start: b.x0!, end: b.x1!, count: b.length }));
  return {
    name,
    type: 'quantitative',
    count: numbers.length,
    missing: values.length - numbers.length,
    min: min ?? null,
    max: max ?? null,
    mean: mean(numbers) ?? null,
    median: median(numbers) ?? null,
    bins
  };
}

function summarizeTemporal(name: string, values: unknown[]): TemporalSummary {
  const dates = values
    .filter((v) => !isMissing(v))
    .map(toDate)
    .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  const [min, max] = extent(dates);
  const bins =
    min === undefined
      ? []
      : bin<Date, Date>()
          .domain([min, max])
          .thresholds(utcTicks(min, max, BIN_COUNT))(dates)
          .map((b) => ({ start: b.x0!.getTime(), end: b.x1!.getTime(), count: b.length }));
  return {
    name,
    type: 'temporal',
    count: dates.length,
    missing: values.length - dates.length,
    min: min?.getTime() ?? null,
    max: max?.getTime() ?? null,
    bins
  };
}

function summarizeCategorical(
  name: string,
  type: 'nominal' | 'ordinal',
  values: unknown[]
): CategoricalSummary {
  const kept = values
    .filter((v) => !isMissing(v))
    .map((v) => (v instanceof Date ? v.toISOString() : String(v)));
  const counts = rollups(
    kept,
    (group) => group.length,
    (v) => v
  ).sort((a, b) => descending(a[1], b[1]));
  const top = counts.slice(0, TOP_K).map(([value, count]) => ({ value, count }));
  return {
    name,
    type,
    count: kept.length,
    missing: values.length - kept.length,
    distinct: counts.length,
    top,
    other: kept.length - top.reduce((sum, t) => sum + t.count, 0)
  };
}

/**
 * Parses a value the way the column's type was estimated: CSV rows already hold Dates; JSON rows hold strings, parsed
 * with d3's autoType (space-separated datetimes count, as in `estimateType`).
 */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  const text = String(value)
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2}) (?=\d{2}:\d{2})/, '$1T');
  const parsed = autoType<{ v: unknown }, 'v'>({ v: text }).v;
  return parsed instanceof Date ? parsed : null;
}
