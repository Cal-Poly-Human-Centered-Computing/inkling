import { describe, expect, it } from 'vitest';
import { validateVegaLiteSpec } from './utilities';

const values = [{ a: 'A', b: 1 }];
const xy = {
	x: { field: 'a', type: 'nominal' },
	y: { field: 'b', type: 'quantitative' }
};

const accepted: Record<string, unknown> = {
	'bar chart with inline data': { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', data: { values }, mark: 'bar', encoding: xy },
	'bar chart without data': { mark: 'bar', encoding: xy }
};

const rejected: Record<string, unknown> = {
	'non-string mark': { data: { values }, mark: 123, encoding: xy },
	'top-level array': [{ mark: 'bar' }],
	'missing mark': { data: { values }, encoding: xy },
	'transform that is not an array': { data: { values }, transform: { filter: 'datum.b > 0' }, mark: 'point', encoding: xy },
	'layer that is not an array': { layer: { mark: 'point', encoding: xy }, data: { values } },
	'layer item without a mark': { layer: [{ data: { values } }] }
};

// Invalid specs that vega-lite compiles anyway (sometimes with a warning), so the validator accepts them.
// it.fails passes while the gap exists; if the validator starts catching one, move it to `rejected`.
const knownGaps: Record<string, unknown> = {
	'channel definition that is a string': { data: { values }, mark: 'bar', encoding: { ...xy, x: 'a' } },
	'numeric field name': { data: { values }, mark: 'bar', encoding: { ...xy, x: { field: 42, type: 'nominal' } } },
	'unknown aggregate': { data: { values }, mark: 'bar', encoding: { ...xy, y: { ...xy.y, aggregate: 'totallyNotReal' } } },
	'data values that are not an array': { data: { values: { a: 'A', b: 1 } }, mark: 'point', encoding: xy },
	'repeat that is not an array or object': {
		repeat: 3,
		spec: { mark: 'bar', encoding: { x: { field: { repeat: 'column' }, type: 'nominal' }, y: { field: 'value', type: 'quantitative' } } }
	}
};

describe('validateVegaLiteSpec', () => {
	it.each(Object.entries(accepted))('accepts a %s', (_, spec) => {
		expect(validateVegaLiteSpec(JSON.stringify(spec))).toEqual({ valid: true, errors: [], warnings: [] });
	});

	it.each(Object.entries(rejected))('rejects a %s', (_, spec) => {
		const result = validateVegaLiteSpec(JSON.stringify(spec));
		expect(result.valid).toBe(false);
		expect(result.errors).toHaveLength(1);
	});

	it.fails.each(Object.entries(knownGaps))('rejects a %s (known gap)', (_, spec) => {
		expect(validateVegaLiteSpec(JSON.stringify(spec)).valid).toBe(false);
	});

	it('collects compiler warnings', () => {
		const spec = knownGaps['unknown aggregate'];
		expect(validateVegaLiteSpec(JSON.stringify(spec)).warnings).toEqual(['Invalid aggregation operator "totallyNotReal".']);
	});

	it('rejects invalid JSON', () => {
		const result = validateVegaLiteSpec('hello');
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toMatch(/^Invalid JSON/);
	});
});
