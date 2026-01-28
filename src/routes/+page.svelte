<script lang="ts">
    import { CodeEditor, ChatBox, Toolbar, CanvasView } from '$lib/components';
    import { loadDatasetFromUrl as loadDatasetFromUrlHelper } from '$lib/utils/datasetLoader';
    import { setDatasetFromDfd, setDatasetUrl, getDfdFromStore, readPersistedDataset } from '$lib/utils/datasetStore';

    let code = `{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
}`;

    let selectedTool: 'pen' | 'textbox' | 'eraser' = 'pen';
    let uploadedFile: File | null = null;
    let canvasViewRef: any = null;

    function handleUpload(e: CustomEvent) {
        uploadedFile = e.detail;
        console.log('Uploaded file:', uploadedFile);
    }

    // apply editor changes immediately
    function handleCodeChange(e: CustomEvent) {
        code = e.detail;
        console.log('Code changed (applied)');
    }

    function handleSend(e: CustomEvent) {
        console.log('Chat message sent:', e.detail);
    }

    function handleSelectTool(e: CustomEvent) {
        selectedTool = e.detail;
        console.log('Selected tool:', selectedTool);
    }

    function handleApplyChanges() {
        // Reserved: Apply changes from the canvas. No-op for code editor edits.
        console.log('Apply Changes clicked (no-op for code editor edits)');
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
                try {
                    const persistedRaw = readPersistedDataset();
                    console.log('Raw persisted payload:', persistedRaw);
                    const rehydrated = await getDfdFromStore();
                    console.log('Rehydrated DataFrame from storage:', rehydrated);
                } catch (rehErr) {
                    console.error('Failed to read/reconstruct persisted dataset', rehErr);
                }

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
                <CodeEditor {code} on:upload={handleUpload} on:codeChange={handleCodeChange} on:attachDataset={handleAttachDataset} />
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
                <CanvasView bind:this={canvasViewRef} spec={code} selectedTool={selectedTool} />
            </div>
        </div>
    </div>
</div>

<style>
    :global(html, body, #svelte) {
        height: 100%;
    }
    :global(.column) {
        /* ensure columns take full height */
        min-height: 0;
    }
</style>
