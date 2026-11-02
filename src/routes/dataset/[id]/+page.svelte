<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import type { PageProps } from './$types';
  import {
    datasetDisplayName,
    getSummary,
    readDataset,
    type PersistedDataset
  } from '$lib/utils/datasetStore';
  import type { DatasetSummary } from '$lib/utils/datasetSummary';
  import QuantitativeSummary from '$lib/components/QuantitativeSummary.svelte';
  import CategoricalSummary from '$lib/components/CategoricalSummary.svelte';
  import TemporalSummary from '$lib/components/TemporalSummary.svelte';

  /** Route params; `params.id` is the id of the dataset to preview. */
  export let params: PageProps['params'];
  let summary: DatasetSummary | null = null;
  let meta: PersistedDataset | null = null;

  onMount(() => {
    // Read the dataset
    summary = getSummary(params.id);
    meta = readDataset(params.id);
  })

  $: shown =
    summary?.columns;
</script>

<section class="section" style="min-height:100vh; background-color: var(--color-bg)">
  <div class="container">
    <p><a href={resolve('/')}>← Back to the editor</a></p>
    <h1 class="title">{meta ? datasetDisplayName(meta) : `Dataset ${params.id}`}</h1>

    <!-- column summary goes here -->
    <table class='table'>
      <thead>
        <tr class='is-family-code'>
          {#each shown as col (col.name)}
            <th>{col.name}</th>
          {/each}
        </tr>
        <tr>
          {#each shown as col (col.name)}
            <th class="has-text-grey-light">{col.type}</th>
          {/each}
        </tr>
        <tr>
          {#each shown as col (col.name)}
            <th>
              {#if col.type === 'quantitative'}
                <QuantitativeSummary summary={col} />
              {:else if col.type === 'nominal' || col.type === 'ordinal'}
                <CategoricalSummary summary={col} />
              {:else if col.type === 'temporal'}
                <TemporalSummary summary={col} />
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
      </tbody>
    </table>
  </div>
</section>
