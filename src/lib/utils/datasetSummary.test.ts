import { describe, expect, it } from 'vitest';
import { summarizeDataset, type ColumnSummary } from './datasetSummary';
import type { ColumnType } from './datasetStore';

/** Summarises a single column of `values` with the given type. */
function summarize(type: ColumnType, values: unknown[]): ColumnSummary {
  const rows = values.map((v) => ({ col: v }));
  return summarizeDataset(rows, [{ name: 'col', type }]).columns[0];
}

const binTotal = (s: ColumnSummary) =>
  'bins' in s ? s.bins.reduce((sum, b) => sum + b.count, 0) : 0;

describe('summarizeDataset', () => {
  it('counts rows and summarises each column in schema order', () => {
    const summary = summarizeDataset(
      [
        { a: 1, b: 'x' },
        { a: 2, b: 'y' }
      ],
      [
        { name: 'b', type: 'nominal' },
        { name: 'a', type: 'quantitative' }
      ]
    );
    expect(summary.rowCount).toBe(2);
    expect(summary.columns.map((c) => c.name)).toEqual(['b', 'a']);
  });

  it('summarises a quantitative column, skipping missing values', () => {
    const s = summarize('quantitative', [1, '2', 3, 10, null, '', NaN]);
    expect(s).toMatchObject({ count: 4, missing: 3, min: 1, max: 10, mean: 4, median: 2.5 });
    expect(binTotal(s)).toBe(4);
  });

  it('summarises a temporal column from Dates and from date strings', () => {
    const s = summarize('temporal', [
      new Date('2020-01-15'),
      '2020-06-01',
      '2021-03-01 12:00',
      null
    ]);
    expect(s).toMatchObject({ count: 3, missing: 1, min: Date.parse('2020-01-15') });
    expect(binTotal(s)).toBe(3);
  });

  it('keeps the most frequent nominal values and counts the rest as other', () => {
    const values = ['a', 'a', 'a', 'b', 'b', ...'cdefghijklm'.split(''), ''];
    const s = summarize('nominal', values);
    if (s.type !== 'nominal') throw new Error('expected a nominal summary');
    expect(s).toMatchObject({ count: 16, missing: 1, distinct: 13 });
    expect(s.top[0]).toEqual({ value: 'a', count: 3 });
    expect(s.top.reduce((sum, t) => sum + t.count, 0) + s.other).toBe(16);
  });

  it('gives a column with no values empty statistics instead of zeros', () => {
    const s = summarize('quantitative', [null, '']);
    expect(s).toMatchObject({ count: 0, missing: 2, min: null, mean: null, bins: [] });
  });
});
