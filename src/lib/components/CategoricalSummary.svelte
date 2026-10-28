<script lang="ts">
  import { scaleBand, scaleLinear } from 'd3-scale';
  import { format } from 'd3-format';
  import type { CategoricalSummary } from '$lib/utils/datasetSummary';
  import { BAR_SLOT, CHART_HEIGHT, CHART_WIDTH } from './summaryLayout';

  /** Summary of one nominal (or ordinal) column, from `getSummary`. */
  export let summary: CategoricalSummary;

  // bars sit at the top of the shared chart box, one fixed-height slot each
  const width = CHART_WIDTH;
  /** Gap between bars, as a fraction of each bar's slot. */
  const padding = 0.15;
  /** Space between a label and the end of its bar. */
  const labelInset = 3;
  /** Rough width of one label character, for deciding whether a label fits; labels aren't measured. */
  const charWidth = 6;
  /** Values longer than this are cut short with an ellipsis in bar labels. */
  const maxValueChars = 12;

  type ValueCount = CategoricalSummary['top'][number];

  const formatPercent = format('.0%');

  $: total = summary.count + summary.missing;
  /** Distinct values without a bar. */
  $: unshown = summary.distinct - summary.top.length;
  $: height = summary.top.length * BAR_SLOT;
  $: y = scaleBand<string>()
    .domain(summary.top.map((t) => t.value))
    .range([0, height])
    .padding(padding);
  $: x = scaleLinear()
    .domain([0, Math.max(1, ...summary.top.map((t) => t.count))])
    .range([0, width]);

  /** The first `n` characters of `text`, followed by an ellipsis if anything was cut. */
  function truncate(text: string, n: number): string {
    return text.length <= n ? text : `${text.slice(0, Math.max(1, n))}…`;
  }

  /**
   * A bar's label, e.g. "Afghanistan (11)", and whether it goes inside the end of the bar. A label too long for its
   * bar goes just past the end instead, with the value cut further if it would run off the chart.
   */
  function barLabel(t: ValueCount): { text: string; inside: boolean } {
    const count = ` (${t.count})`;
    const text = truncate(t.value, maxValueChars) + count;
    const fits = (chars: number, space: number) => chars * charWidth + 2 * labelInset <= space;
    if (fits(text.length, x(t.count))) return { text, inside: true };
    const outsideSpace = width - x(t.count);
    if (fits(text.length, outsideSpace)) return { text, inside: false };
    // room for the count, an ellipsis and as much of the value as fits
    const valueChars = Math.floor((outsideSpace - 2 * labelInset) / charWidth) - count.length - 1;
    return { text: truncate(t.value, valueChars) + count, inside: false };
  }

  /** The bar under the pointer; the other bars are dimmed. */
  let hovered: ValueCount | null = null;
</script>

<div class="categorical-summary">
  <div class="chart" style="width: {CHART_WIDTH}px; height: {CHART_HEIGHT}px">
    {#if summary.count > 0}
      <svg {width} {height} role="img" aria-label="Most common values of {summary.name}">
        {#each summary.top as t (t.value)}
          {@const { text, inside } = barLabel(t)}
          <g
            class="bar"
            class:dimmed={hovered !== null && hovered !== t}
            role="presentation"
            on:mouseenter={() => (hovered = t)}
            on:mouseleave={() => (hovered = null)}
          >
            <title>{t.value}: {t.count}</title>
            <rect x="0" y={y(t.value)} width={x(t.count)} height={y.bandwidth()} />
            <text
              class:inside
              x={inside ? x(t.count) - labelInset : x(t.count) + labelInset}
              y={(y(t.value) ?? 0) + y.bandwidth() / 2}
              text-anchor={inside ? 'end' : 'start'}
              dominant-baseline="middle">{text}</text
            >
          </g>
        {/each}
        <line class="baseline" x1="0" x2="0" y1="0" y2={height} />
      </svg>

      {#if unshown > 0}
        <p class="more">({unshown} more)</p>
      {/if}
    {:else}
      <p class="has-text-grey">No values</p>
    {/if}
  </div>

  <p class="counts">
    {summary.count} valid ({formatPercent(total ? summary.count / total : 0)}) · {summary.missing} missing
    ({formatPercent(total ? summary.missing / total : 0)})
  </p>

  {#if summary.count > 0}
    <dl class="stats">
      <dt>Distinct</dt>
      <dd>{summary.distinct}</dd>
      <dt>Most common</dt>
      <dd>{summary.top[0].value} ({summary.top[0].count})</dd>
    </dl>
  {/if}
</div>

<style>
  .categorical-summary {
    font-size: 0.75rem;
    font-weight: normal;
  }

  .bar {
    transition: opacity 120ms ease;
  }

  .bar rect {
    fill: var(--color-accent);
  }

  .bar text {
    fill: var(--bulma-text);
    font-size: 0.65rem;
  }

  .bar text.inside {
    fill: var(--color-accent-text);
  }

  .bar.dimmed {
    opacity: 0.35;
  }

  .baseline {
    stroke: var(--bulma-border);
  }

  .chart {
    margin-bottom: 0.25rem;
  }

  /* block, so no inline gap below the svg pushes content out of the fixed-height box */
  .chart svg {
    display: block;
  }

  .stats {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.5rem;
    margin: 0.25rem 0;
  }

  .stats dt,
  .more,
  .counts {
    color: var(--bulma-text-weak);
  }
</style>
