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

  it('fills quantitative columns with numbers', () => {
    for (const { price } of rows) expect(typeof price).toBe('number');
  });

  it('fills temporal columns with parseable dates', () => {
    for (const { date } of rows) {
      expect(typeof date).toBe('string');
      expect(Number.isNaN(Date.parse(date))).toBe(false);
    }
  });

  it('fills nominal columns with a few repeated categories, so grouping has something to group', () => {
    const brands = new Set(rows.map((r) => r.brand));
    for (const brand of brands) expect(typeof brand).toBe('string');
    expect(brands.size).toBeGreaterThan(1);
    expect(brands.size).toBeLessThan(rows.length);
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
    const line = {
      mark: 'line',
      encoding: {
        x: { field: 'date', type: 'temporal' },
        y: { field: 'price', type: 'quantitative' }
      }
    };
    expect((await renderSpec(JSON.stringify(line), columns)).ok).toBe(true);
  });

  it('renders a spec without a dataset', async () => {
    const text = { mark: 'text', encoding: { text: { value: 'hello' } } };
    expect((await renderSpec(JSON.stringify(text), [])).ok).toBe(true);
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
    const result = await renderSpec(JSON.stringify({ encoding: bar.encoding }), columns); // no mark
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a spec that compiles but fails in Vega', async () => {
    // vega-lite accepts the expression; vega rejects the unknown function when it parses the compiled spec
    const unknownFunction = {
      ...bar,
      transform: [{ calculate: 'nope(datum.price)', as: 'total' }]
    };
    const result = await renderSpec(JSON.stringify(unknownFunction), columns);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('collects warnings', async () => {
    const unknownAggregate = {
      ...bar,
      encoding: { ...bar.encoding, y: { ...bar.encoding.y, aggregate: 'totallyNotReal' } }
    };
    const result = await renderSpec(JSON.stringify(unknownAggregate), columns);
    expect(result.warnings).toContain('Invalid aggregation operator "totallyNotReal".');
  });
});
