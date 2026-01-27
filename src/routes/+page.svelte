<script lang="ts">
    import { CodeEditor, ChatBox, Toolbar, CanvasView } from '$lib/components';

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
</script>

<div class="container is-fluid" style="height:100vh; padding:1rem;">
    <div class="columns" style="height:100%;">
        <div class="column is-half" style="display:flex; flex-direction:column; padding-right:0.5rem;">
            <!-- Code editor area -->
            <div style="flex:1 1 auto; min-height:0;">
                <CodeEditor {code} on:upload={handleUpload} on:codeChange={handleCodeChange} />
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
