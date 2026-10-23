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

	const rejected: Record<string, unknown> = {
		'non-string mark': { ...bar, mark: 123 },
		'top-level array': [bar],
		'missing mark': { encoding: bar.encoding },
		'transform that is not an array': { ...bar, transform: { filter: 'datum.price > 0' } },
		'layer that is not an array': { layer: bar },
		'layer item without a mark': { layer: [{ encoding: bar.encoding }] }
	};

	// Invalid specs that vega-lite compiles and vega runs anyway (some with a warning), so they come back ok.
	// it.fails passes while the gap exists; if renderSpec starts catching one, move it to `rejected`.
	// (Non-array data.values can't happen here: renderSpec replaces the spec's data.)
	const knownGaps: Record<string, unknown> = {
		'channel definition that is a string': { ...bar, encoding: { ...bar.encoding, x: 'brand' } },
		'numeric field name': { ...bar, encoding: { ...bar.encoding, x: { field: 42, type: 'nominal' } } },
		'unknown aggregate': { ...bar, encoding: { ...bar.encoding, y: { ...bar.encoding.y, aggregate: 'totallyNotReal' } } },
		'repeat that is not an array or object': {
			repeat: 3,
			spec: { mark: 'bar', encoding: { x: { field: { repeat: 'column' }, type: 'nominal' }, y: { field: 'price', type: 'quantitative' } } }
		}
	};

	it.each(Object.entries(rejected))('rejects a %s', async (_, spec) => {
		const result = await renderSpec(JSON.stringify(spec), columns);
		expect(result.ok).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it.fails.each(Object.entries(knownGaps))('rejects a %s (known gap)', async (_, spec) => {
		expect((await renderSpec(JSON.stringify(spec), columns)).ok).toBe(false);
	});

	it('collects warnings', async () => {
		const result = await renderSpec(JSON.stringify(knownGaps['unknown aggregate']), columns);
		expect(result.warnings).toContain('Invalid aggregation operator "totallyNotReal".');
	});
});
