<script lang="ts">
  import Fa from 'svelte-fa';
  import { faDatabase } from '@fortawesome/free-solid-svg-icons';
  import { loadDatasetFromFile, loadDatasetFromUrl } from '$lib/utils/datasetLoader';
  import { datasetDisplayName, readCurrentDataset, setDataset } from '$lib/utils/datasetStore';
  import { resolve } from '$app/paths';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';

  const dispatch = createEventDispatcher();

  /** The attached dataset, shown next to the attach button; re-read after each attach. */
  let current: ReturnType<typeof readCurrentDataset> = null;
  // read after mount: localStorage is only in the browser, and the server-rendered page has no dataset
  onMount(() => (current = readCurrentDataset()));

  // dataset modal state
  let showDatasetModal: boolean = false;
  let datasetMode: 'file' | 'url' = 'url';
  let datasetFile: File | null = null;
  let datasetFileInput: HTMLInputElement | null = null;
  let datasetUrl: string = '';
  // why the last attach failed, shown in the modal
  let datasetError: string | null = null;

  // dataset help popover state
  let showDatasetHelp = false;
  let helpButtonEl: HTMLButtonElement | null = null;
  let helpPopoverEl: HTMLDivElement | null = null;

  // dataset modal handlers
  function openDatasetModal() {
    datasetMode = 'url';
    datasetFile = null;
    datasetUrl = '';
    datasetError = null;
    showDatasetModal = true;
    setTimeout(() => datasetFileInput?.focus(), 0);
  }

  function onDatasetFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) datasetFile = input.files[0];
    else datasetFile = null;
  }

  /**
   * Loads the chosen file or URL, stores it, and tells the page with `datasetAttached`. On failure the modal stays
   * open with the error.
   */
  async function attachDataset() {
    // close any help popover when confirming
    showDatasetHelp = false;
    document.removeEventListener('mousedown', handleDocClick);
    datasetError = null;
    try {
      let stored: boolean;
      if (datasetMode === 'file' && datasetFile) {
        const res = await loadDatasetFromFile(datasetFile);
        stored = setDataset(res.data, res.columns, { name: datasetFile.name });
      } else if (datasetMode === 'url' && datasetUrl.trim()) {
        datasetUrl = datasetUrl.trim();
        const res = await loadDatasetFromUrl(datasetUrl);
        stored = setDataset(res.data, res.columns, { url: datasetUrl });
      } else {
        return;
      }
      if (!stored) {
        datasetError = 'The dataset is too large to store in the browser.';
        return;
      }
      current = readCurrentDataset();
      dispatch('datasetAttached');
      showDatasetModal = false;
    } catch (err) {
      console.error('Failed to load dataset:', err);
      datasetError = err instanceof Error ? err.message : String(err);
    }
  }

  function cancelDataset() {
    datasetFile = null;
    datasetUrl = '';
    datasetError = null;
    // ensure help popover closed when cancelling
    showDatasetHelp = false;
    document.removeEventListener('mousedown', handleDocClick);
    showDatasetModal = false;
  }

  // helpers for the dataset help popover
  function toggleDatasetHelp() {
    showDatasetHelp = !showDatasetHelp;
    if (showDatasetHelp) document.addEventListener('mousedown', handleDocClick);
    else document.removeEventListener('mousedown', handleDocClick);
  }

  function handleDocClick(e: MouseEvent) {
    const target = e.target as Node;
    if (!helpPopoverEl?.contains(target) && !helpButtonEl?.contains(target)) {
      showDatasetHelp = false;
      document.removeEventListener('mousedown', handleDocClick);
    }
  }

  onDestroy(() => {
    try {
      // ensure any document listener used by the dataset help popover is removed
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousedown', handleDocClick);
      }
    } catch (err) {}
  });
</script>

<div class="dataset-controls">
  {#if current}
    <a
      class="dataset-link"
      href={resolve('/dataset/[id]', { id: current.id })}
      title="Preview {current.meta.url ?? datasetDisplayName(current.meta)}"
      >Peek at {datasetDisplayName(current.meta)}</a
    >
  or
  {/if}  
  <button
    class="button is-light accent-button"
    aria-label="Attach dataset"
    title={current ? 'Attach a different dataset' : 'Attach a dataset'}
    on:click={openDatasetModal}
  >
    <Fa icon={faDatabase} />&nbsp;{current ? 'Attach a different dataset' : 'Attach a dataset'}
  </button>
</div>

<!-- Dataset modal -->
{#if showDatasetModal}
  <div class="modal is-active" role="dialog" aria-modal="true" aria-label="Attach dataset dialog">
    <div
      class="modal-background"
      role="button"
      tabindex="0"
      aria-label="Close dataset dialog"
      on:click={cancelDataset}
      on:keydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') cancelDataset();
      }}
    ></div>
    <div class="modal-card">
      <header class="modal-card-head">
        <p class="modal-card-title">Attach dataset</p>
        <button class="delete" aria-label="close" on:click={cancelDataset}></button>
      </header>
      <section class="modal-card-body">
        {#if current}
          <p class="mb-4">
            Current dataset: <strong>{datasetDisplayName(current.meta)}</strong>. Attaching a new
            dataset replaces it.
          </p>
        {/if}
        <div class="field">
          <label class="label" for="dataset-mode-select">Source</label>
          <div
            class="control dataset-source-control"
            style="display:flex; align-items:center; gap:0.5rem; position:relative;"
          >
            <div class="select">
              <select
                id="dataset-mode-select"
                bind:value={datasetMode}
                aria-label="Choose dataset source"
              >
                <option value="file">JSON or CSV file</option>
                <option value="url">URL</option>
              </select>
            </div>
            <button
              class="button is-white help-icon-button"
              aria-label="Dataset help"
              bind:this={helpButtonEl}
              on:click={toggleDatasetHelp}
              aria-expanded={showDatasetHelp}
            >
              <span class="icon is-small">?</span>
            </button>
            {#if showDatasetHelp}
              <div
                bind:this={helpPopoverEl}
                class="dataset-help-popover"
                role="dialog"
                aria-live="polite"
              >
                <p style="margin:0; font-size:0.9rem;">
                  Data never leaves the browser's local storage. Only column names and data types
                  are sent to an AI model to aid in generating a visualization specification.
                </p>
              </div>
            {/if}
          </div>
        </div>

        {#if datasetMode === 'file'}
          <div class="field">
            <label class="label" for="dataset-file-input">JSON/CSV file</label>
            <div class="control">
              <input
                id="dataset-file-input"
                bind:this={datasetFileInput}
                class="input"
                type="file"
                accept=".csv,text/csv,.json,application/json"
                on:change={onDatasetFileChange}
              />
            </div>
            {#if datasetFile}
              <p class="help">Selected: {datasetFile.name}</p>
            {/if}
          </div>
        {:else}
          <div class="field">
            <label class="label" for="dataset-url-input">Dataset URL</label>
            <div class="control">
              <input
                id="dataset-url-input"
                class="input"
                type="url"
                placeholder="https://example.com/data.csv or .json"
                bind:value={datasetUrl}
              />
            </div>
            <p class="help">
              You can use public URLs like https://vega.github.io/vega-datasets/data/cars.json
            </p>
          </div>
        {/if}
        {#if datasetError}
          <p class="help is-danger" role="alert" style="white-space: pre-line;">{datasetError}</p>
        {/if}
      </section>
      <footer class="modal-card-foot">
        <button
          class="button accent-button"
          on:click={attachDataset}
          disabled={(datasetMode === 'file' && !datasetFile) ||
            (datasetMode === 'url' && !datasetUrl)}>Attach</button
        >&nbsp;
        <button class="button" on:click={cancelDataset}>Cancel</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .dataset-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  /* underlined so it reads as a link; long names are cut short, with the full name or URL in the title */
  .dataset-link {
    display: inline-block;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: underline;
  }

  .help-icon-button {
    border-radius: 50%;
    width: 1.6rem;
    height: 1.6rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .dataset-help-popover {
    position: absolute;
    top: 2.4rem;
    left: 0;
    z-index: 40;
    padding: 0.5rem;
    border-radius: 6px;
    width: 260px;
    font-size: 0.9rem;
  }

  /* Default (light) theme styles */
  @media (prefers-color-scheme: light) {
    /* dataset help styles (light) */
    .help-icon-button {
      border: 1px solid rgba(0, 0, 0, 0.08);
    }
    .dataset-help-popover {
      background: white;
      border: 1px solid #e6e6e6;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    }
  }

  /* Dark theme styles */
  @media (prefers-color-scheme: dark) {
    /* dataset help styles (dark) */
    .help-icon-button {
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .dataset-help-popover {
      background: #0f0f0f;
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
      color: #eaeaea;
    }
  }
</style>
