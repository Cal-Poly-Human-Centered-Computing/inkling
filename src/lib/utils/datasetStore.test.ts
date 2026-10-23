// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearDatasetStore,
	estimateType,
	getColumnNames,
	getColumnSchema,
	getDataToken,
	getFirstRow,
	readPersistedDataset,
	setDataset,
	setDatasetUrl
} from './datasetStore';

beforeEach(() => {
	localStorage.clear();
});

describe('persistence', () => {
	const rows = [
		{ b: 1, a: 'x' },
		{ b: 2, a: 'y' }
	];

	it('reads back what setDataset stored', () => {
		setDataset(rows, ['a', 'b'], 'https://example.com/data.csv');
		expect(getColumnNames()).toEqual(['a', 'b']);
		expect(readPersistedDataset()?.data).toEqual(rows);
		expect(getDataToken()).toEqual({ url: 'https://example.com/data.csv' });
	});

	it('returns the first row in column order', () => {
		setDataset(rows, ['a', 'b']);
		expect(Object.keys(getFirstRow()!)).toEqual(['a', 'b']);
		expect(getFirstRow()).toEqual({ a: 'x', b: 1 });
	});

	it('has no data token without a url', () => {
		setDataset(rows, ['a', 'b']);
		expect(getDataToken()).toBeNull();
	});

	it('stores only a url with setDatasetUrl', () => {
		setDatasetUrl('https://example.com/data.json');
		expect(getDataToken()).toEqual({ url: 'https://example.com/data.json' });
		expect(getColumnNames()).toEqual([]);
		expect(getFirstRow()).toBeNull();
	});

	it('ignores an empty dataset with no url', () => {
		setDataset([], ['a']);
		expect(readPersistedDataset()).toBeNull();
	});

	it('is empty after clearDatasetStore', () => {
		setDataset(rows, ['a', 'b'], 'https://example.com/data.csv');
		clearDatasetStore();
		expect(readPersistedDataset()).toBeNull();
		expect(getColumnNames()).toEqual([]);
		expect(getDataToken()).toBeNull();
	});

	it('treats corrupted storage as empty instead of throwing', () => {
		localStorage.setItem('app:dataset', '{not json');
		expect(readPersistedDataset()).toBeNull();
		expect(getColumnNames()).toEqual([]);
		expect(getColumnSchema()).toEqual([]);
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

	it('estimates types when the dataset is stored, not when they are read', () => {
		setDataset([{ n: 1 }, { n: 2 }], ['n']);
		// change the stored rows behind the store's back; the saved schema should not change
		const stored = readPersistedDataset()!;
		localStorage.setItem('app:dataset', JSON.stringify({ ...stored, data: [{ n: 'n/a' }] }));
		expect(getColumnSchema()).toEqual([{ name: 'n', type: 'quantitative' }]);
	});

	it('estimates types for datasets stored without a schema', () => {
		localStorage.setItem('app:dataset', JSON.stringify({ columns: ['n'], data: [{ n: 1 }, { n: 2 }] }));
		expect(getColumnSchema()).toEqual([{ name: 'n', type: 'quantitative' }]);
	});

	it('checks every row, not just the first few hundred', () => {
		const rows: Record<string, any>[] = Array.from({ length: 1000 }, (_, i) => ({ n: i }));
		rows[999].n = 'n/a';
		setDataset(rows, ['n']);
		expect(getColumnSchema()).toEqual([{ name: 'n', type: 'nominal' }]);
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
