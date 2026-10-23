const MAX_CHROMA = 24; // max(r,g,b) - min(r,g,b) for a color to count as neutral
const DARK_LUM = 0.18; // at or below: near-black
const LIGHT_LUM = 0.82; // at or above: near-white

function parseHex(color: unknown): [number, number, number] | null {
	if (typeof color !== 'string') return null;
	let h = color.trim().replace(/^#/, '');
	if (h.length === 3) h = h.split('').map((c) => c + c).join('');
	if (!/^[0-9a-f]{6}$/i.test(h)) return null;
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Near-black or near-white are considered "ink" that should be
 * inverted when the theme changes.
 * Mid-grays and colors are not.
 */
export function isInkColor(color: unknown): boolean {
	const rgb = parseHex(color);
	if (!rgb) return false;
	const [r, g, b] = rgb;
  if (Math.max(r, g, b) - Math.min(r, g, b) > MAX_CHROMA) return false;

  // Compute relative luminance
  // Source: https://en.wikipedia.org/wiki/Relative_luminance
	const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
	return lum <= DARK_LUM || lum >= LIGHT_LUM;
}

// 255 - c per channel keeps the deviation from pure black/white (#0a0a0a -> #f5f5f5) and is its
// own inverse, so flipping back restores the original color exactly.
export function invertInk(color: string): string {
	const rgb = parseHex(color);
	if (!rgb) return color;
	return '#' + rgb.map((c) => (255 - c).toString(16).padStart(2, '0')).join('');
}

// inverts ink colors; anything else (colors, mid-grays, 'transparent', null) passes through unchanged
export function flipInk<T>(color: T): T | string {
	return isInkColor(color) ? invertInk(color as string) : color;
}
