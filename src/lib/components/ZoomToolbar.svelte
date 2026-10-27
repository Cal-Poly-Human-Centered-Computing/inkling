<script lang="ts">
  import Fa from 'svelte-fa';
  import { createEventDispatcher } from 'svelte';
  import { faMinus } from '@fortawesome/free-solid-svg-icons/faMinus';
  import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';

  const dispatch = createEventDispatcher();
  export let zoomPercent: number = 100;

  function zoom(direction: 'in' | 'out') {
    dispatch('zoom', direction);
  }
</script>

<div class="zoom-toolbar" role="toolbar" aria-label="Zoom controls">
  <button class="button zoom-button" on:click={() => zoom('out')} aria-label="Zoom out">
    <span class="icon zoom-icon">
      <Fa icon={faMinus} />
    </span>
  </button>
  <span class="zoom-level" aria-label={`Zoom ${Math.round(zoomPercent)} percent`}>
    {Math.round(zoomPercent)}%
  </span>
  <button class="button zoom-button" on:click={() => zoom('in')} aria-label="Zoom in">
    <span class="icon zoom-icon">
      <Fa icon={faPlus} />
    </span>
  </button>
</div>

<style>
  .zoom-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .zoom-button {
    border-radius: 100%;
    font-size: 0.7rem;
  }

  .zoom-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.7rem;
    height: 0.7rem;
  }

  .zoom-level {
    min-width: 2rem;
    text-align: center;
    font-size: 0.8rem;
    color: var(--bulma-text);
  }
</style>
