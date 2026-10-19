<script lang="ts">
  import {CodeEditor, ChatBox, VersionControlToolbar, CanvasView} from '$lib/components';
  import { code as codeStore } from '$lib/stores/code';
  import {get} from "svelte/store";
  import { conversationId as convIdStore } from '$lib/stores/conversationId';
  import { observations as observationsStore } from '$lib/stores/observations';
  import {getColumnNames, getColumnSchema} from "$lib/utils/datasetStore";
  import DatasetToolbar from "$lib/components/DatasetToolbar.svelte";

  let uploadedFile: File | null = null;
  let canvasViewRef: any = null;
  let codeEditorRef: any = null;
  let applying = false;
  let showRollbackConfirmationModal = false;

  let historyStacks: Array<Array<string>> = [];
  let historyIndex = -1;

  let message = ''

  function textInputIsActive() {
    return message.trim().length > 0;
  }

  function canvasIsActive() {
    return historyIndex >= 1;
  }

  function handleUpload(e: CustomEvent) {
    uploadedFile = e.detail;
    console.log('Uploaded file:', uploadedFile);
  }

  // helper: convert data URL (data:<mime>;base64,...) to a Blob
  function dataUrlToBlob(dataUrl: string): Blob {
    const parts = dataUrl.split(',');
    if (parts.length !== 2) throw new Error('Invalid data URL');
    const meta = parts[0];
    const base64 = parts[1];
    const match = meta.match(/data:([^;]+);base64/);
    const mime = match ? match[1] : 'image/png';
    const binary = atob(base64);
    const len = binary.length;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) u8[i] = binary.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  // helper: open a new blank tab and write a minimal HTML document embedding the image dataUrl
  // returns true if successful, false if it failed (e.g., blocked by popup or write error)
  function openImageInNewTab(dataUrl: string): boolean {
    const win = window.open('', '_blank');
    if (!win) return false;
    try {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Export Preview</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="${dataUrl}" alt="exported image"/></body></html>`;
      win.document.open();
      win.document.write(html);
      win.document.close();
      return true;
    } catch (err) {
      try { win.close(); } catch (_) {}
      return false;
    }
  }

  // Sends every active input (sketch or annotations, chat, current code) in one request.
  // Triggered by the Apply Changes button and by pressing Enter in the chat box.
  async function handleApplyChanges() {
    if (applying) return;
    applying = true;

    // Read the chat text before any await: the chat box clears itself right after dispatching Enter
    const chatMessage = message.trim() || null;

    try {
      // Export the canvas only if something has been drawn on it
      let dataUrl: string | null = null;
      try {
        if (canvasIsActive() && canvasViewRef && typeof canvasViewRef.exportCanvasDataUrl === 'function') {
          dataUrl = await canvasViewRef.exportCanvasDataUrl('image/png', undefined, window.devicePixelRatio ?? 1);
          // FOR DEBUGGING: uncomment the below block to see a preview of the exported image
          // if (dataUrl) {
          //   const opened = openImageInNewTab(dataUrl);
          //   if (!opened) {
          //     try {
          //       const blob = dataUrlToBlob(dataUrl);
          //       const url = URL.createObjectURL(blob);
          //       try { window.open(url, '_blank'); } catch (err) { /* ignore */ }
          //       // revoke after a short delay
          //       setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 10000);
          //     } catch (err) {
          //       console.error('Blob fallback failed:', err);
          //     }
          //   }
          // }
        }
      } catch (err) {
        console.error('Failed to export canvas image:', err);
        alert('Failed to export canvas image: ' + (err && (err as any).message ? (err as any).message : String(err)));
        applying = false;
        return;
      }

      const bodyPayload = {
        image: dataUrl,
        chatMessage,
        currentSpec: get(codeStore),
        columnNames: getColumnNames(),
        columns: getColumnSchema(),
        renderedVis: canvasViewRef.renderedVisPresent()
      };
      const resp = await fetch('/api/apply-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error('Apply changes failed:', resp.status, text);
        return;
      }

      const jsonResp = await resp.json();
      if (!jsonResp.ok) {
        console.error('Apply changes error:', jsonResp.error);
        return;
      }

      const resultText: string = jsonResp.result ?? '';
      observationsStore.set(jsonResp.observations ?? null);

      // A spec that still has errors is shown anyway, so it can be fixed in the editor
      if (jsonResp.errors?.length) {
        console.warn('Returned spec has errors:', jsonResp.errors);
      }
      message = '';

//       const resultText = `{
//   "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
//   "data": {
//     "url": "https://vega.github.io/vega-datasets/data/cars.json"
//   },
//   "mark": "point",
//   "encoding": {
//     "x": {
//       "field": "Horsepower",
//       "type": "quantitative",
//       "title": "Horsepower"
//     },
//     "y": {
//       "field": "Miles_per_Gallon",
//       "type": "quantitative",
//       "title": "Miles per Gallon"
//     }
//   }
// }`
      await handleIncomingCodeUpdate(resultText);

    } catch (err) {
      console.error('Failed to apply changes:', err);
    } finally {
      applying = false;
    }
  }

  async function handleIncomingCodeUpdate(returnedCode: string) {
    const fenceMatch = returnedCode.match(/```(?:[\w-]*\n)?([\s\S]*?)```/);
    const extracted = fenceMatch ? fenceMatch[1].trim() : returnedCode.trim();

    if (extracted) {
      // prefer updating the editor first so UI shows new code before CanvasView re-renders
      if (codeEditorRef && typeof codeEditorRef.setCode === 'function') {
        await codeEditorRef.setCode(extracted);
      } else {
        // fallback: update store directly
        console.warn('CodeEditor reference missing; updating store directly');
        codeStore.set(extracted);
      }

      // After the editor is updated and the visualization has time to re-render, clear overlays on the canvas
      try {
        // wait a tick for Svelte/Vega to pick up the new spec and render
        await new Promise((resolve) => setTimeout(resolve, 100));
        canvasViewRef.applyChanges();
      } catch (err) {
        console.warn('Failed to clear canvas overlays after applying changes', err);
      }
    } else {
      console.warn('No code block found in response; leaving code unchanged');
    }
  }

  function handleDatasetAttached() {
    codeEditorRef.handleDatasetAttached();
  }


  function handleRollbackChanges() {
    showRollbackConfirmationModal = true;
  }

  function cancelRollback() {
    showRollbackConfirmationModal = false;
  }

  function handleConfirmRollback() {
    showRollbackConfirmationModal = false;
    codeEditorRef.rollbackChanges()
    canvasViewRef.rollbackChanges()
  }

</script>

<div class="container is-fluid" style="height:100vh; padding:1rem; background-color: var(--color-bg)">
  <div class="columns" style="height:100%;">
    <div class="column is-half" style="display:flex; flex-direction:column; padding-right:0.5rem;">
      <div style="flex: 0 0 auto; height: 3rem;">
        <DatasetToolbar on:datasetAttached={handleDatasetAttached}></DatasetToolbar>
      </div>

      <!-- Code editor area -->
      <div style="flex:1 1 auto; min-height:0;">
        <CodeEditor bind:this={codeEditorRef} on:upload={handleUpload} />
      </div>

      <!-- Chatbox pinned to bottom -->
      <div style="flex:0 0 auto; margin-top:0.5rem;">
        <ChatBox bind:message={message} sending={applying} on:send={handleApplyChanges} />
      </div>
    </div>

    <div class="column is-half" style="display:flex; flex-direction:column; padding-left:0.5rem;">
      <!-- VersionControlToolbar -->
      <div style="flex:0 0 auto; height: 3rem;">
        <VersionControlToolbar on:applyChanges={handleApplyChanges} on:rollbackChanges={handleRollbackChanges}
                               canApply={textInputIsActive() || canvasIsActive()} canRollback={historyStacks.length >= 1} applying={applying} />
      </div>

      <!-- Canvas / visualization area -->
      <div style="flex:1 1 auto; min-height:0;">
        <CanvasView bind:this={canvasViewRef} bind:historyIndex={historyIndex} bind:historyStacks={historyStacks} applying={applying} />
      </div>
    </div>
  </div>
</div>

<!--Rollback confirmation modal-->
{#if showRollbackConfirmationModal}
  <div class="modal is-active" role="dialog" aria-modal="true" aria-label="Confirm rollback dialog">
    <div class="modal-background" role="button" tabindex="0" aria-label="Close rollback dialog" on:click={cancelRollback} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') cancelRollback(); }}></div>
    <div class="modal-card">
      <header class="modal-card-head">
        <p class="modal-card-title">Undo changes applied to canvas and code?</p>
      </header>
      <footer class="modal-card-foot" style="justify-content: end;">
        <button class="button" on:click={cancelRollback}>Cancel</button>&nbsp;
        <button class="button is-info" on:click={handleConfirmRollback} >Yes</button>&nbsp;
      </footer>
    </div>
  </div>
{/if}


<style>
  :global(html, body) {
    height: 100%;
  }
  :global(.column) {
    /* ensure columns take full height */
    min-height: 0;
  }
</style>
