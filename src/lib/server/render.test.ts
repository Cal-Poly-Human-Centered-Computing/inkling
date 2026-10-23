import { describe, expect, it } from 'vitest';
import { placeholderData, renderSpec } from './render';
import type { ColumnSchema } from './schemas';

const columns: ColumnSchema = [
	{ name: 'price', type: 'quantitative' },
	{ name: 'date', type: 'temporal' },
	{ name: 'brand', type: 'nominal' }
];

describe('placeholderData', () => {
	const rows = placeholderData(columns);

	it('returns the same 60 rows every time', () => {
		expect(rows).toHaveLength(60);
		expect(placeholderData(columns)).toEqual(rows);
	});

	it('fills quantitative columns with numbers in [0, 100]', () => {
		for (const { price } of rows) {
			expect(typeof price).toBe('number');
			expect(price).toBeGreaterThanOrEqual(0);
			expect(price).toBeLessThanOrEqual(100);
		}
	});

	it('fills temporal columns with parseable dates', () => {
		for (const { date } of rows) {
			expect(typeof date).toBe('string');
			expect(Number.isNaN(Date.parse(date))).toBe(false);
		}
	});

	it('fills nominal columns with a few named categories', () => {
		const brands = new Set(rows.map((r) => r.brand));
		for (const brand of brands) expect(brand).toMatch(/^brand [A-E]$/);
		expect(brands.size).toBeGreaterThan(1);
	});

	it('returns empty rows when there are no columns', () => {
		expect(placeholderData([])).toEqual(Array.from({ length: 60 }, () => ({})));
	});
});

describe('renderSpec', () => {
	const bar = {
		mark: 'bar',
		encoding: {
			x: { field: 'brand', type: 'nominal' },
			y: { field: 'price', type: 'quantitative', aggregate: 'mean' }
		}
	};

	it('renders a valid spec', async () => {
		expect(await renderSpec(JSON.stringify(bar), columns)).toMatchObject({ ok: true, errors: [] });
	});

	it('renders a temporal encoding', async () => {
		const line = { mark: 'line', encoding: { x: { field: 'date', type: 'temporal' }, y: { field: 'price', type: 'quantitative' } } };
		expect((await renderSpec(JSON.stringify(line), columns)).ok).toBe(true);
	});

	it('replaces any data in the spec with placeholder rows', async () => {
		const withUrl = { ...bar, data: { url: 'https://example.com/does-not-exist.csv' } };
		expect((await renderSpec(JSON.stringify(withUrl), columns)).ok).toBe(true);
	});

	it('rejects invalid JSON', async () => {
		const result = await renderSpec('{', columns);
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toMatch(/^Invalid JSON/);
	});

	it('rejects a spec that fails to compile', async () => {
		const result = await renderSpec(JSON.stringify({ ...bar, transform: { filter: 'datum.price > 0' } }), columns);
		expect(result.ok).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it('rejects a spec without a mark', async () => {
		expect((await renderSpec(JSON.stringify({ encoding: bar.encoding }), columns)).ok).toBe(false);
	});
});
