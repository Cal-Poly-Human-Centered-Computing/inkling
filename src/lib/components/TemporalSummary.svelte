<script lang="ts">
  import { scaleLinear, scaleUtc } from 'd3-scale';
  import { format } from 'd3-format';
  import type { TemporalSummary } from '$lib/utils/datasetSummary';
  import { CHART_HEIGHT, CHART_WIDTH } from './summaryLayout';

  /** Summary of one temporal column, from `getSummary`. */
  export let summary: TemporalSummary;

  // the chart fills the shared chart box
  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const barGap = 1;

  const formatPercent = format('.0%');

  const DAY = 24 * 60 * 60 * 1000;
  // Date-only values ("2020-01-15") are parsed as UTC midnight and must be shown in UTC, or they can land on the
  // previous day west of Greenwich; datetimes are parsed as local time and shown in it
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
  const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  $: total = summary.count + summary.missing;
  $: bins = summary.bins;
  /** True when the column holds dates without times, judging by its endpoints. */
  $: dateOnly =
    summary.min !== null &&
    summary.max !== null &&
    summary.min % DAY === 0 &&
    summary.max % DAY === 0;
  $: timeFormat = dateOnly ? dateFormat : dateTimeFormat;
  $: x = scaleUtc()
    .domain([bins[0]?.start ?? 0, bins.at(-1)?.end ?? 1])
    .range([0, width]);
  $: y = scaleLinear()
    .domain([0, Math.max(1, ...bins.map((b) => b.count))])
    .range([height, 0]);
</script>

<div class="temporal-summary">
  <div class="chart" style="width: {CHART_WIDTH}px; height: {CHART_HEIGHT}px">
    {#if summary.count > 0}
      <svg {width} {height} role="img" aria-label="Counts over time of {summary.name}">
        {#each bins as bin (bin.start)}
          <rect
            class="bar"
            x={x(bin.start)}
            y={y(bin.count)}
            width={Math.max(0, x(bin.end) - x(bin.start) - barGap)}
            height={height - y(bin.count)}
          >
            <title>{timeFormat.format(bin.start)} – {timeFormat.format(bin.end)}: {bin.count}</title
            >
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

  <dl class="stats">
    <dt>Records</dt>
    <dd>{total}</dd>
    {#if summary.min !== null && summary.max !== null}
      <dt>From</dt>
      <dd>{timeFormat.format(summary.min)}</dd>
      <dt>To</dt>
      <dd>{timeFormat.format(summary.max)}</dd>
    {/if}
  </dl>
</div>

<style>
  .temporal-summary {
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
