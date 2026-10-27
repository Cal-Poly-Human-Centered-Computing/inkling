import { describe, expect, it } from 'vitest';
import { flipInk, invertInk, isInkColor } from './ink';

describe('isInkColor', () => {
  it.each(['#000000', '#1a1a1a', '#f5f5f5', 'FFFFFF'])('treats %s as ink', (color) =>
    expect(isInkColor(color)).toBe(true)
  );

  it.each([
    ['mid-gray', '#808080'],
    ['saturated color', '#ff0000'],
    ['tinted dark (chroma > 24)', '#1a0000'],
    ['named color', 'transparent'],
    ['rgb() string', 'rgb(0, 0, 0)'],
    ['malformed hex', '#00000']
  ])('rejects %s (%s)', (_, color) => expect(isInkColor(color)).toBe(false));

  it.each([null, 0])('rejects non-string %s', (value) => {
    expect(isInkColor(value)).toBe(false);
  });
});

describe('invertInk', () => {
  it('inverts each channel', () => {
    expect(invertInk('#000000')).toBe('#ffffff');
    expect(invertInk('#0a0a0a')).toBe('#f5f5f5');
  });

  it('expands 3-digit hex', () => {
    expect(invertInk('#fff')).toBe('#000000');
  });

  it('passes non-hex input through unchanged', () => {
    expect(invertInk('transparent')).toBe('transparent');
  });
});

describe('flipInk', () => {
  it('flips ink colors', () => {
    expect(flipInk('#000000')).toBe('#ffffff');
    expect(flipInk('#ffffff')).toBe('#000000');
  });

  it.each(['#ff0000', '#808080', 'transparent', null, undefined])('leaves %s alone', (color) => {
    expect(flipInk(color)).toBe(color);
  });
});
