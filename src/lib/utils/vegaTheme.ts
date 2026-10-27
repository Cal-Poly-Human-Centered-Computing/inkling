import type { Config } from 'vega-lite';

// Smaller than Vega's defaults (axis labels 10, titles 11)
const LABEL_FONT_SIZE = 12;
const TITLE_FONT_SIZE = 14;
const CHART_TITLE_FONT_SIZE = 12;
const TITLE_FONT_WEIGHT = 'normal';

/**
 * Embed-time Vega-Lite config to control Vega-Lite's default look.
 *
 * In dark mode this also carries the colors of vega-themes' 'dark' theme. We don't pass `theme: 'dark'` alongside it
 * because vega-embed's config merge replaces nested objects (e.g. `axis`) instead of merging them, so the theme's
 * axis and title colors would be dropped as soon as this config sets its own `axis` / `title`.
 */
export function plotTheme(dark: boolean): Config {
  const fg = dark ? '#fff' : '#000';

  return {
    ...(dark ? { background: '#333' } : {}),
    font: 'system-ui, sans-serif',
    view: { stroke: null },
    axis: {
      // gridlines are the foreground color at low opacity so they read on either background
      gridColor: fg,
      gridOpacity: 0.1,
      labelFontSize: LABEL_FONT_SIZE,
      titleFontSize: TITLE_FONT_SIZE,
      titleFontWeight: TITLE_FONT_WEIGHT,
      titlePadding: 10,
      ...(dark ? { domainColor: fg, tickColor: fg } : {})
    },
    legend: {
      labelFontSize: LABEL_FONT_SIZE,
      titleFontSize: TITLE_FONT_SIZE,
      titleFontWeight: TITLE_FONT_WEIGHT
    },
    title: {
      fontSize: CHART_TITLE_FONT_SIZE,
      ...(dark ? { color: fg, subtitleColor: fg } : {})
    },
    ...(dark ? { style: { 'guide-label': { fill: fg }, 'guide-title': { fill: fg } } } : {}),
    // open points (`circle` is Vega-Lite's filled variant of `point`)
    point: { filled: false },
    circle: { filled: true }
  };
}
