<script lang="ts">
  import { CodeEditor, ChatBox, Toolbar, CanvasView } from '$lib/components';
  import { loadDatasetFromUrl as loadDatasetFromUrlHelper } from '$lib/utils/datasetLoader';
  import { setDatasetFromDfd, setDatasetUrl } from '$lib/utils/datasetStore';
  import { code as codeStore } from '$lib/stores/code';

  let selectedTool: 'pen' | 'textbox' | 'eraser' = 'pen';
  let uploadedFile: File | null = null;
  let canvasViewRef: any = null;
  let codeEditorRef: any = null;
  let applying = false;

  function handleUpload(e: CustomEvent) {
    uploadedFile = e.detail;
    console.log('Uploaded file:', uploadedFile);
  }

  function handleSend(e: CustomEvent) {
    console.log('Chat message sent:', e.detail);
  }

  function handleSelectTool(e: CustomEvent) {
    selectedTool = e.detail;
    console.log('Selected tool:', selectedTool);
  }

  async function handleApplyChanges() {
    applying = true;
    try {
      const resp = await fetch('/api/apply-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
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
      const fenceMatch = resultText.match(/```(?:[\w-]*\n)?([\s\S]*?)```/);
      const extracted = fenceMatch ? fenceMatch[1].trim() : resultText.trim();

      if (extracted) {
        // prefer updating the editor first so UI shows new code before CanvasView re-renders
        if (codeEditorRef && typeof codeEditorRef.setCode === 'function') {
          await codeEditorRef.setCode(extracted);
        } else {
          // fallback: update store directly
          console.warn('CodeEditor reference missing; updating store directly');
          codeStore.set(extracted);
        }
        console.log('Replaced editor code from applyChanges response');
      } else {
        console.warn('No code block found in applyChanges response; leaving code unchanged');
      }
    } catch (err) {
      console.error('Failed to apply changes:', err);
    } finally {
      applying = false;
    }
  }

  function handleUndo() {
    if (canvasViewRef && typeof canvasViewRef.undo === 'function') canvasViewRef.undo();
  }

  function handleRedo() {
    if (canvasViewRef && typeof canvasViewRef.redo === 'function') canvasViewRef.redo();
  }

  // handle dataset attachments coming from the CodeEditor dataset modal
  async function handleAttachDataset(e: CustomEvent) {
    const detail = e.detail || {};
    if (detail.kind === 'url' && detail.url) {
      console.log('Loading dataset via helper:', detail.url);
      try {
        const res = await loadDatasetFromUrlHelper(detail.url);
        console.log('Dataset loaded via helper:', res);

        // Persist the dataset: prefer full df persistence when available
        if (res && res.df) {
          try {
            await setDatasetFromDfd(res.df, detail.url);
            console.log('Persisted dataset to localStorage (from df)');
          } catch (serr) {
            console.warn('Failed to persist df, falling back to URL-only persist', serr);
            setDatasetUrl(detail.url);
          }
        } else {
          // No df to persist; persist the URL reference only
          setDatasetUrl(detail.url);
          console.log('Persisted dataset URL only');
        }

                // Immediately rehydrate from storage and log to confirm
                // TODO: remove this later; just for debugging
                // try {
                //     const persistedRaw = readPersistedDataset();
                //     console.log('Raw persisted payload:', persistedRaw);
                //     const rehydrated = await getDfdFromStore();
                //     console.log('Rehydrated DataFrame from storage:', rehydrated);
                // } catch (rehErr) {
                //     console.error('Failed to read/reconstruct persisted dataset', rehErr);
                // }

                // Optionally: forward to canvas or store; kept as a log for now
            } catch (err) {
                console.error('Failed to load dataset via helper:', err);
            }
        } else if (detail.kind === 'file') {
            // file handling will be implemented later
            console.log('Dataset file attached (not yet handled):', detail.file);
        }
    }

    function handleDatasetLoaded(e: CustomEvent) {
        console.log('Dataset loaded in CanvasView:', e.detail);
    }

    function handleDatasetError(e: CustomEvent) {
        console.error('Dataset error in CanvasView:', e.detail);
    }
</script>

<div class="container is-fluid" style="height:100vh; padding:1rem;">
  <div class="columns" style="height:100%;">
    <div class="column is-half" style="display:flex; flex-direction:column; padding-right:0.5rem;">
      <!-- Code editor area -->
      <div style="flex:1 1 auto; min-height:0;">
        <CodeEditor bind:this={codeEditorRef} on:upload={handleUpload} on:attachDataset={handleAttachDataset} />
      </div>

      <!-- Chatbox pinned to bottom -->
      <div style="flex:0 0 auto; margin-top:0.5rem;">
        <ChatBox on:send={handleSend} />
      </div>
    </div>

    <div class="column is-half" style="display:flex; flex-direction:column; padding-left:0.5rem;">
      <!-- Toolbar -->
      <div style="flex:0 0 auto;">
        <Toolbar selected={selectedTool} on:selectTool={handleSelectTool} on:applyChanges={handleApplyChanges} on:undo={handleUndo} on:redo={handleRedo} />
      </div>

      <!-- Canvas / visualization area -->
      <div style="flex:1 1 auto; min-height:0;">
        <CanvasView bind:this={canvasViewRef} selectedTool={selectedTool} />
      </div>
    </div>
  </div>
</div>

<style>
  :global(html, body) {
    height: 100%;
  }
  :global(.column) {
    /* ensure columns take full height */
    min-height: 0;
  }
</style>
