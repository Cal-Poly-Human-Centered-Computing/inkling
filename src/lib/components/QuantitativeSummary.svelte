<script lang="ts">
  import { scaleLinear } from 'd3-scale';
  import { format } from 'd3-format';
  import type { QuantitativeSummary } from '$lib/utils/datasetSummary';
  import { CHART_HEIGHT, CHART_WIDTH } from './summaryLayout';

  /** Summary of one quantitative column, from `getSummary`. */
  export let summary: QuantitativeSummary;

  // the histogram fills the shared chart box
  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const barGap = 1;

  /** Up to 4 significant digits, without trailing zeros (1234, 0.5, 1.235e+6). */
  const formatNumber = format('.4~g');
  const formatPercent = format('.0%');

  $: total = summary.count + summary.missing;
  $: bins = summary.bins;
  $: x = scaleLinear()
    .domain([bins[0]?.start ?? 0, bins.at(-1)?.end ?? 1])
    .range([0, width]);
  $: y = scaleLinear()
    .domain([0, Math.max(1, ...bins.map((b) => b.count))])
    .range([height, 0]);

  $: stats = [
    ['Median', summary.median],
    ['Mean', summary.mean],
    ['Min', summary.min],
    ['Max', summary.max]
  ] as const;
</script>

<div class="quantitative-summary">
  <div class="chart" style="width: {CHART_WIDTH}px; height: {CHART_HEIGHT}px">
    {#if summary.count > 0}
      <svg {width} {height} role="img" aria-label="Histogram of {summary.name}">
        {#each bins as bin (bin.start)}
          <rect
            class="bar"
            x={x(bin.start)}
            y={y(bin.count)}
            width={Math.max(0, x(bin.end) - x(bin.start) - barGap)}
            height={height - y(bin.count)}
          >
            <title>{formatNumber(bin.start)}–{formatNumber(bin.end)}: {bin.count}</title>
          </rect>
        {/each}
        <line class="baseline" x1="0" x2={width} y1={height} y2={height} />
      </svg>
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
      {#each stats as [label, value] (label)}
        <dt>{label}</dt>
        <dd>{value === null ? '–' : formatNumber(value)}</dd>
      {/each}
    </dl>
  {/if}
</div>

<style>
  .quantitative-summary {
    font-size: 0.75rem;
    font-weight: normal;
  }

  .chart {
    margin-bottom: 0.25rem;
  }

  /* block, so no inline gap below the svg pushes content out of the fixed-height box */
  .chart svg {
    display: block;
  }

  .bar {
    fill: var(--color-accent);
  }

  .bar:hover {
    opacity: 0.7;
  }

  .baseline {
    stroke: var(--bulma-border);
  }

  .stats {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.5rem;
    margin: 0.25rem 0;
  }

  .stats dt,
  .counts {
    color: var(--bulma-text-weak);
  }
</style>
