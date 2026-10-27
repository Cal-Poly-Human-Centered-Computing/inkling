// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDatasetStore,
  estimateType,
  getColumnSchema,
  getDataToken,
  getRows,
  readPersistedDataset,
  setDataset
} from './datasetStore';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persistence', () => {
  const rows = [
    { b: 1, a: 'x' },
    { b: 2, a: 'y' }
  ];

  it('stores the url, columns and types of a URL dataset, but not its rows', () => {
    setDataset(rows, ['a', 'b'], 'https://example.com/data.csv');
    expect(getColumnSchema()).toEqual([
      { name: 'a', type: 'nominal' },
      { name: 'b', type: 'quantitative' }
    ]);
    expect(getDataToken()).toEqual({ url: 'https://example.com/data.csv' });
    expect(getRows()).toBeNull();
  });

  it('stores the rows of a dataset without a url', () => {
    expect(setDataset(rows, ['a', 'b'])).toBe(true);
    expect(getRows()).toEqual(rows);
  });

  it("doesn't grow the metadata with the size of the dataset", () => {
    // metadata is read on every request, so it must stay small however many rows the dataset has
    const many = Array.from({ length: 10_000 }, (_, i) => ({ a: `row ${i}`, b: i }));
    setDataset(many, ['a', 'b']);
    expect(localStorage.getItem('app:dataset')!.length).toBeLessThan(1000);
  });

  it('clears the stored rows when a URL dataset replaces a file dataset', () => {
    setDataset(rows, ['a', 'b']);
    setDataset(rows, ['a', 'b'], 'https://example.com/data.csv');
    expect(getRows()).toBeNull();
  });

  it('leaves the previous dataset in place when the rows are too big to store', () => {
    setDataset(rows, ['a', 'b'], 'https://example.com/data.csv');

    // a localStorage whose rows key is over quota; happy-dom's localStorage is a proxy that can't be spied on
    const real = localStorage;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => real.getItem(key),
      removeItem: (key: string) => real.removeItem(key),
      setItem: (key: string, value: string) => {
        if (key === 'app:dataset:rows')
          throw new DOMException('quota exceeded', 'QuotaExceededError');
        real.setItem(key, value);
      }
    });

    expect(setDataset([{ a: 'z', b: 3 }], ['a', 'b'])).toBe(false);
    expect(getDataToken()).toEqual({ url: 'https://example.com/data.csv' });
    expect(getRows()).toBeNull();
  });

  it('has no data token without a url', () => {
    setDataset(rows, ['a', 'b']);
    expect(getDataToken()).toBeNull();
  });

  it('ignores an empty dataset with no url', () => {
    setDataset([], ['a']);
    expect(readPersistedDataset()).toBeNull();
  });

  it('is empty after clearDatasetStore', () => {
    setDataset(rows, ['a', 'b']);
    clearDatasetStore();
    expect(readPersistedDataset()).toBeNull();
    expect(getRows()).toBeNull();
    expect(getColumnSchema()).toEqual([]);
    expect(getDataToken()).toBeNull();
  });

  it('treats corrupted storage as empty instead of throwing', () => {
    localStorage.setItem('app:dataset', '{not json');
    expect(readPersistedDataset()).toBeNull();
    expect(getColumnSchema()).toEqual([]);
  });

  it('treats corrupted rows as missing instead of throwing', () => {
    localStorage.setItem('app:dataset:rows', '{not json');
    expect(getRows()).toBeNull();
  });
});

describe('getColumnSchema', () => {
  it('estimates a type for each column, in column order', () => {
    setDataset(
      [
        { price: 1, date: '2020-01-15', brand: 'Ford' },
        { price: 2.5, date: '2020-02-15', brand: 'Honda' }
      ],
      ['brand', 'price', 'date']
    );
    expect(getColumnSchema()).toEqual([
      { name: 'brand', type: 'nominal' },
      { name: 'price', type: 'quantitative' },
      { name: 'date', type: 'temporal' }
    ]);
  });

  it('treats CSV dates as temporal', () => {
    // csvParse with autoType produces Date objects
    setDataset([{ date: new Date(2020, 0, 15) }, { date: new Date(2020, 1, 15) }], ['date']);
    expect(getColumnSchema()).toEqual([{ name: 'date', type: 'temporal' }]);
  });

  describe('datasets stored in the old format (rows in the metadata, no schema)', () => {
    const old = {
      url: 'https://example.com/data.csv',
      columns: ['n', 's'],
      data: [
        { n: 1, s: 'a' },
        { n: 2, s: 'b' }
      ]
    };
    const schema = [
      { name: 'n', type: 'quantitative' },
      { name: 's', type: 'nominal' }
    ];

    it('estimates the schema from the stored rows', () => {
      localStorage.setItem('app:dataset', JSON.stringify(old));
      expect(getColumnSchema()).toEqual(schema);
    });

    it('saves the estimated schema and drops the rows from the metadata', () => {
      localStorage.setItem('app:dataset', JSON.stringify(old));
      getColumnSchema();
      expect(readPersistedDataset()).toEqual({ url: old.url, columns: old.columns, schema });
    });

    it('returns no schema when there are no rows to estimate from', () => {
      localStorage.setItem('app:dataset', JSON.stringify({ url: old.url, columns: old.columns }));
      expect(getColumnSchema()).toEqual([]);
    });
  });
});

describe('estimateType', () => {
  it.each<[string, any[], string]>([
    ['numbers', [1, 2.5, -3], 'quantitative'],
    ['numeric strings', ['1', '2.5', '-3'], 'quantitative'],
    ['NaN in a numeric column', [1, NaN, 2], 'quantitative'],
    ['"NaN" in a numeric string column', ['1', 'NaN'], 'quantitative'],
    ['years are numbers, not dates', [2019, '2020'], 'quantitative'],
    ['Date objects', [new Date(2020, 0, 15), null], 'temporal'],
    ['ISO dates', ['2020-01-15', '2021-06-01', '2022-12-31'], 'temporal'],
    ['ISO datetimes', ['2020-01-15T00:00:00', '2020-02-15T08:00:00.000Z'], 'temporal'],
    ['space-separated datetimes', ['2015-03-07 12:32:17', '2015-03-08 09:05'], 'temporal'],
    ['a space with no time after it is not a date', ['2015-03-07 noon'], 'nominal'],
    ['missing values in a date column', ['2020-01-15', null, ''], 'temporal'],
    ['slash dates are not ISO, so not dates', ['1/15/2020', '2/3/2021'], 'nominal'],
    ['strings like "Apollo 11" are nominal, not dates', ['Apollo 11', 'Highway 61'], 'nominal'],
    ['words', ['Ford', 'Toyota', 'Honda'], 'nominal'],
    ['booleans', [true, 'false'], 'nominal'],
    ['all empty', [null, undefined, '', '  '], 'nominal'],
    ['empty values ignored', [1, null, '', '  ', 2, undefined], 'quantitative'],
    ['a single non-number makes the column nominal', [1, 2, 'n/a'], 'nominal'],
    ['dates mixed with numbers', ['2020-01-15', 42], 'nominal']
  ])('%s', (_, values, expected) => {
    expect(estimateType(values)).toBe(expected);
  });
});
