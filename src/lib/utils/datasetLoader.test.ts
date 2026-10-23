import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvParse } from 'd3-dsv';
import { extractColumns, loadDatasetFromUrl } from './datasetLoader';

describe('extractColumns', () => {
	it('uses the columns field from csvParse output', () => {
		expect(extractColumns(csvParse('a,b\n1,2'))).toEqual(['a', 'b']);
	});

	it('uses the keys of the first row of an array of objects', () => {
		expect(extractColumns([{ x: 1, y: 2 }, { z: 3 }])).toEqual(['x', 'y']);
	});

	it.each([
		['an empty array', []],
		['an array of arrays', [[1, 2]]],
		['null', null],
		['a string', 'a,b']
	])('returns [] for %s', (_, input) => {
		expect(extractColumns(input)).toEqual([]);
	});
});

describe('loadDatasetFromUrl', () => {
	// every fetch in a test returns this body and content type
	function serve(body: string, contentType?: string, status = 200) {
		const headers = contentType ? { 'Content-Type': contentType } : undefined;
		vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers })));
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const csv = 'name,value,date\nA,1,2020-01-15\nB,2.5,2020-02-15';
	const json = JSON.stringify([
		{ name: 'A', value: 1 },
		{ name: 'B', value: 2.5 }
	]);

	it('parses a .csv url with autoType', async () => {
		serve(csv, 'text/plain');
		const { data, columns } = await loadDatasetFromUrl('https://example.com/data.csv');
		expect(columns).toEqual(['name', 'value', 'date']);
		expect(data[1].value).toBe(2.5);
		expect(data[0].date).toBeInstanceOf(Date);
	});

	it('ignores the query string when checking the extension', async () => {
		serve(csv, 'text/plain');
		const { columns } = await loadDatasetFromUrl('https://example.com/data.csv?raw=true');
		expect(columns).toEqual(['name', 'value', 'date']);
	});

	it('parses a .json url', async () => {
		serve(json, 'text/plain');
		const { data, columns } = await loadDatasetFromUrl('https://example.com/data.json');
		expect(columns).toEqual(['name', 'value']);
		expect(data).toHaveLength(2);
	});

	it('uses the content type when the url has no extension', async () => {
		serve(csv, 'text/csv; charset=utf-8');
		expect((await loadDatasetFromUrl('https://example.com/export')).columns).toEqual(['name', 'value', 'date']);

		serve(json, 'application/json');
		expect((await loadDatasetFromUrl('https://example.com/api')).columns).toEqual(['name', 'value']);
	});

	it('falls back to JSON when the type is unknown', async () => {
		serve(json, 'text/plain');
		expect((await loadDatasetFromUrl('https://example.com/data')).columns).toEqual(['name', 'value']);
	});

	it('falls back to CSV when the type is unknown and the body is not JSON', async () => {
		serve(csv, 'text/plain');
		expect((await loadDatasetFromUrl('https://example.com/data')).columns).toEqual(['name', 'value', 'date']);
	});

	it('throws on an empty url', async () => {
		await expect(loadDatasetFromUrl('')).rejects.toThrow('Invalid URL');
	});

	it('throws on an error response', async () => {
		serve('not found', 'text/plain', 404);
		await expect(loadDatasetFromUrl('https://example.com/data.csv')).rejects.toThrow('Could not read file');
	});

	it.each([
		['a JSON object', JSON.stringify({ name: 'A' })],
		['an empty array', '[]'],
		['an array of numbers', '[1, 2, 3]']
	])('throws when the JSON is %s', async (_, body) => {
		serve(body, 'application/json');
		await expect(loadDatasetFromUrl('https://example.com/data.json')).rejects.toThrow('non-empty array of row objects');
	});
});
