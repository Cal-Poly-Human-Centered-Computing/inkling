<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import { faCopy } from '@fortawesome/free-solid-svg-icons/faCopy';
  import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck';
  import { code as codeStore } from '$lib/stores/code';
  import { get } from 'svelte/store';
  import type * as Monaco from 'monaco-editor';
  import { getDataToken, type PersistedDataset } from '$lib/utils/datasetStore';
  import { loadSavedSpecBody, saveSpecBody } from '$lib/utils/savedEditor';
  import constrainedEditor from 'constrained-editor-plugin';
  import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
  import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
  import { diffLines } from 'diff';
  import { isDark } from '$lib/stores/theme';
  import '../../app.css';

  const dispatch = createEventDispatcher();
  let editorContainer: HTMLDivElement | null = null;
  let editorMounted = false;
  let monaco: typeof Monaco | null = null;
  let editorView: Monaco.editor.IStandaloneCodeEditor | null = null;
  let editorModel: Monaco.editor.ITextModel | null = null;
  let containerPointerHandler: ((e: PointerEvent) => void) | null = null;
  let ignoreModelChange = false;
  let constrainedInstance: any = null;

  // copy button state
  let copied = false;

  // Decorations added to indicate server-returned changes (cleared on next local edit)
  let serverChangeDecorationIds: string[] = [];
  type RemovedChunkInfo = { anchorLine: number; lineCount: number; text: string };
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- only read in Monaco handlers, never rendered
  let removedDecorationById = new Map<string, RemovedChunkInfo>();
  let removedLinesOverlay: { anchorLine: number; lineCount: number; text: string } | null = null;
  let removedOverlayWidget: Monaco.editor.IContentWidget | null = null;
  let removedOverlayDomNode: HTMLDivElement | null = null;

  // the dataset's `data`, enforced into any incoming spec
  let data: PersistedDataset | null = null;

  let specHistory: string[] = [];

  /** Stops saving the spec to localStorage; set once the editor has restored the saved spec. */
  let unsubscribeSave: (() => void) | null = null;

  function applyServerDiffDecorations(prevText: string, newText: string) {
    if (!editorModel || !monaco) return;

    const model = editorModel;
    const parts = diffLines(prevText ?? '', newText ?? '');

    let newLine = 1;

    const decos: import('monaco-editor').editor.IModelDeltaDecoration[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- scratch map local to this call, never rendered
    const removedMetaByNewIndex = new Map<number, RemovedChunkInfo>();

    const getLineCount = (value: string): number => {
      if (!value) return 0;

      const newlineCount = (value.match(/\n/g) ?? []).length;

      // If it doesn't end in a newline, there's one additional line.
      return newlineCount + (value.endsWith('\n') ? 0 : 1);
    };

    // Creates one glyph above the removed content and one below,
    // visually joined so it looks like one mark between the lines
    const createRemovedGlyph = (info: RemovedChunkInfo): void => {
      const hoverMessage = {
        value: `${info.lineCount} ${info.lineCount === 1 ? 'line' : 'lines'} removed`
      };

      decos.push({
        range: new monaco!.Range(info.anchorLine - 1, 1, info.anchorLine - 1, 1),
        options: {
          glyphMarginClassName: 'server-removed-glyph server-removed-glyph-bottom',
          glyphMarginHoverMessage: hoverMessage,
          hoverMessage
        }
      });
      removedMetaByNewIndex.set(decos.length - 1, info);

      decos.push({
        range: new monaco!.Range(info.anchorLine, 1, info.anchorLine, 1),
        options: {
          glyphMarginClassName: 'server-removed-glyph server-removed-glyph-top',
          glyphMarginHoverMessage: hoverMessage,
          hoverMessage
        }
      });
      removedMetaByNewIndex.set(decos.length - 1, info);
    };

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const lineCount = getLineCount(part.value ?? '');

      if (part.removed) {
        const modelLineCount = model.getLineCount();
        if (lineCount > 0 && modelLineCount > 0) {
          const anchorLine = Math.min(Math.max(newLine, 1), modelLineCount);
          const removedInfo: RemovedChunkInfo = {
            anchorLine,
            lineCount,
            text: part.value ?? ''
          };

          createRemovedGlyph(removedInfo);
        }
        continue;
      }

      if (part.added) {
        if (lineCount > 0 && newLine <= model.getLineCount()) {
          const startLine = newLine;
          const endLine = Math.min(model.getLineCount(), newLine + lineCount - 1);

          decos.push({
            range: new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
            options: {
              isWholeLine: true,
              className: 'server-added'
            }
          });
        }

        newLine += lineCount;
        continue;
      }

      // Unchanged content exists in the new document,
      // so advance through it.
      newLine += lineCount;
    }

    serverChangeDecorationIds = model.deltaDecorations(serverChangeDecorationIds, decos);
    removedDecorationById.clear();
    for (const [newIndex, removedInfo] of removedMetaByNewIndex.entries()) {
      const newId = serverChangeDecorationIds[newIndex];
      if (newId) {
        removedDecorationById.set(newId, removedInfo);
      }
    }
  }

  function closeRemovedLinesOverlay() {
    if (editorView && removedOverlayWidget) {
      editorView.removeContentWidget(removedOverlayWidget);
    }
    removedOverlayWidget = null;
    removedOverlayDomNode = null;
    removedLinesOverlay = null;
  }

  function showRemovedLinesOverlay(anchorLine: number, lineCount: number, text: string) {
    if (!editorView || !monaco) return;
    const monacoApi = monaco;

    closeRemovedLinesOverlay();
    removedLinesOverlay = { anchorLine, lineCount, text };
    const domNode = document.createElement('div');
    domNode.className = 'removed-lines-overlay';
    domNode.innerHTML = `
			<div class="removed-lines-overlay-title">${lineCount} ${lineCount === 1 ? 'line' : 'lines'} removed</div>
			<pre class="removed-lines-overlay-content"></pre>
		`;
    const contentNode = domNode.querySelector('.removed-lines-overlay-content');
    if (contentNode) contentNode.textContent = text;
    removedOverlayDomNode = domNode;

    const widgetId = `removed-lines-overlay-${Date.now()}`;
    const widget: Monaco.editor.IContentWidget = {
      getId: () => widgetId,
      getDomNode: () => domNode,
      getPosition: () => ({
        position: {
          lineNumber: anchorLine,
          column: 1
        },
        preference: [monacoApi.editor.ContentWidgetPositionPreference.EXACT]
      }),
      allowEditorOverflow: true,
      suppressMouseDown: true
    };
    removedOverlayWidget = widget;
    editorView.addContentWidget(widget);
  }

  function handleRemovedOverlayOutsidePointerDown(e: PointerEvent) {
    const target = e.target;
    if (!(target instanceof Node)) return;

    if (removedOverlayDomNode?.contains(target)) return;
    if (target instanceof Element && target.closest('.server-removed-glyph')) return;

    closeRemovedLinesOverlay();
  }

  /**
   * Copy the full spec (stored in `codeStore`) to the clipboard.
   * Uses navigator.clipboard when available.
   */
  async function copyToClipboard() {
    const text = String(get(codeStore) || '');
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('Clipboard API not available');
      }
    } catch (err) {
      console.log('An error occurred while copying to clipboard.');
    }

    copied = true;
    setTimeout(() => {
      copied = false;
    }, 1500);
    dispatch('copied');
  }

  /**
   * The editor text for the current dataset: the read-only header, then `body` (the editable part; a blank,
   * indented line by default), then the closing brace.
   */
  function getReadonlyText(body = '  ') {
    let str = JSON.stringify({ data: data }, null, '  ');

    str = str.slice(0, -2) + ',\n' + body + '\n}'; // remove closing brace and re-add after the editable part

    return str;
  }

  /**
   * The editable part of `text` (between the read-only header and the closing brace), or null if `text` doesn't
   * start with the current header, e.g. a store reset that isn't editor content.
   */
  function editableBody(text: string): string | null {
    const lines = text.split('\n');
    const header = getReadonlyText().split('\n').slice(0, headerLineCount());
    if (lines.length < header.length + 1 || header.some((line, i) => lines[i] !== line))
      return null;
    return lines.slice(header.length, -1).join('\n');
  }

  /** Number of read-only header lines at the top of the editor; depends on how many lines the dataset's `data` takes. */
  function headerLineCount() {
    // everything except the blank editable line and the closing brace
    return getReadonlyText().split('\n').length - 2;
  }

  // Decorations for readonly lines (highlight only the text, not full-line)
  let readonlyDecorationIds: string[] = [];
  function updateReadonlyDecorations() {
    if (!editorModel || !monaco) return;
    const decos: import('monaco-editor').editor.IModelDeltaDecoration[] = [];
    const lastLine = editorModel.getLineCount();
    const headerMax = Math.min(headerLineCount(), lastLine);
    for (let line = 1; line <= headerMax; line++) {
      const content = editorModel.getLineContent(line);
      const firstNonWs = content.search(/\S/);
      if (firstNonWs === -1) continue; // skip empty lines
      const lastNonWs = content.search(/\s*$/) - 1; // index of last non-whitespace
      const startCol = firstNonWs + 1; // Monaco columns are 1-based
      const endCol = Math.max(startCol, lastNonWs + 1 + 1); // +1 to convert index->col, +1 because end is exclusive
      decos.push({
        range: new monaco.Range(line, startCol, line, endCol),
        options: { className: 'readonly-text-inline' }
      });
    }
    if (lastLine > headerMax) {
      const content = editorModel.getLineContent(lastLine);
      const firstNonWs = content.search(/\S/);
      if (firstNonWs !== -1) {
        const lastNonWs = content.search(/\s*$/) - 1;
        const startCol = firstNonWs + 1;
        const endCol = Math.max(startCol, lastNonWs + 1 + 1);
        decos.push({
          range: new monaco.Range(lastLine, startCol, lastLine, endCol),
          options: { className: 'readonly-text-inline' }
        });
      }
    }
    readonlyDecorationIds = editorModel.deltaDecorations(readonlyDecorationIds, decos as any);
  }

  function initializeReadonlyParts() {
    if (!editorModel || !monaco) return;

    constrainedInstance = constrainedEditor(monaco);
    constrainedInstance.initializeIn(editorView);
    // compute editable range: first line after the header .. second-to-last
    const lastLine = editorModel.getLineCount();
    const editableStart = headerLineCount() + 1;
    const editableEnd = Math.max(editableStart, lastLine - 1);
    if (editableEnd >= editableStart) {
      constrainedInstance.addRestrictionsTo(editorModel, [
        {
          range: [editableStart, 1, editableEnd, editorModel.getLineMaxColumn(editableEnd)],
          allowMultiline: true,
          label: 'editableVegaLite'
        }
      ]);
    }
    updateReadonlyDecorations();
  }

  async function createEditor() {
    if (!monaco || !editorContainer) return;
    disposeEditor();

    const contents = get(codeStore);

    editorView = monaco.editor.create(editorContainer!, {
      value: contents,
      language: 'json',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      tabSize: 2,
      fontSize: 16,
      fontFamily: 'Mono',
      fontWeight: '700',
      insertSpaces: true,
      formatOnPaste: true,
      formatOnType: true,
      lineNumbersMinChars: 2,
      glyphMargin: true,
      lineDecorationsWidth: 4,
      // fold objects and arrays; the arrows show when hovering the gutter
      folding: true,
      showFoldingControls: 'mouseover'
    });
    // set explicitly at creation so there's no flash of the wrong theme; later changes are handled reactively below
    monaco.editor.setTheme(get(isDark) ? 'vs-dark' : 'vs');

    editorModel = editorView.getModel();
    if (!editorModel) {
      console.log('Failed to get editor model');
      return;
    }

    initializeReadonlyParts();

    editorView.onDidChangeModelContent((e: Monaco.editor.IModelContentChangedEvent) => {
      codeStore.set(editorModel?.getValue() ?? '');
      updateReadonlyDecorations();
      // clear server-change highlights when the user edits locally (unless the change was programmatic)
      if (!ignoreModelChange && editorModel) {
        serverChangeDecorationIds = editorModel.deltaDecorations(serverChangeDecorationIds, []);
        removedDecorationById.clear();
        closeRemovedLinesOverlay();
      }
    });
    editorView.onMouseDown((e) => {
      if (!editorView || !monaco) return;
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const lineNumber = e.target.position?.lineNumber;
      if (!lineNumber) return;
      const lineDecorations = editorModel?.getLineDecorations(lineNumber) ?? [];
      for (const decoration of lineDecorations) {
        const removedInfo = removedDecorationById.get(decoration.id);
        if (removedInfo) {
          showRemovedLinesOverlay(removedInfo.anchorLine, removedInfo.lineCount, removedInfo.text);
          return;
        }
      }
    });

    // ensure clicking/tapping the editor container focuses the editor so the caret appears
    if (editorContainer && editorView) {
      containerPointerHandler = () => {
        try {
          editorView?.focus();
        } catch (_) {}
      };
      editorContainer.addEventListener('pointerdown', containerPointerHandler);
    }
  }

  /** Recreates the editor with the current dataset's header and `body` as the editable part (blank by default). */
  async function initializeEditor(body?: string) {
    disposeEditor();

    const initialContents = getReadonlyText(body);

    codeStore.set(initialContents);
    specHistory.push(initialContents);

    await createEditor();
  }

  /**
   * Gives the JSON editor the installed Vega-Lite's schema, for autocomplete and hover docs. Only syntax errors are
   * flagged: a half-typed spec matches none of the schema's top-level shapes, so schema warnings would be noise.
   * Not awaited by callers: the schema is ~2MB, and the editor picks it up whenever it arrives.
   */
  async function useVegaLiteSchema(m: typeof Monaco) {
    const { default: vegaLiteSchema } = await import('vega-lite/vega-lite-schema.json');
    m.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      schemaValidation: 'ignore',
      schemas: [
        {
          uri: 'https://vega.github.io/schema/vega-lite/v6.json',
          fileMatch: ['*'],
          schema: vegaLiteSchema
        }
      ]
    });
  }

  onMount(async () => {
    if (!editorContainer) return;
    monaco = await import('monaco-editor');
    useVegaLiteSchema(monaco).catch((err) =>
      console.warn('Failed to load the Vega-Lite schema for autocomplete', err)
    );

    data = getDataToken();

    // restore the spec from before the editor was last unmounted (e.g. a visit to the dataset preview)
    await initializeEditor(loadSavedSpecBody() ?? undefined);
    // subscribed only now, so the store's initial value never overwrites the saved spec
    unsubscribeSave = codeStore.subscribe((text) => {
      const body = editableBody(text);
      if (body !== null) saveSpecBody(body);
    });
    document.addEventListener('pointerdown', handleRemovedOverlayOutsidePointerDown);

    editorMounted = true;

    // initialize the worker
    self.MonacoEnvironment = {
      getWorker(_workerId: string, label: string) {
        if (label === 'json') {
          return new JsonWorker();
        }

        return new EditorWorker();
      }
    };
  });

  /**
   * Called from page.svelte when the user attaches a dataset (dispatched from DatasetToolbar.svelte)
   */
  export async function handleDatasetAttached() {
    data = getDataToken();

    await initializeEditor();
  }

  /**
   * Called from page.svelte whenever the user applies changes from the canvas
   * newCode is the full JSON text  returned by the AI server
   * @param newCode
   */
  export async function setCode(newCode: string) {
    // save the current spec in case the user rolls back the applied changes
    specHistory.push(editorView?.getModel()?.getValue() ?? String(get(codeStore) || ''));

    let finalObj;
    let finalString;

    try {
      const parsed = JSON.parse(newCode);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const rest: any = {};
        for (const k of Object.keys(parsed)) {
          // the header supplies `data`; `$schema` is dropped, since the editor gets the schema programmatically
          if (k === '$schema' || k === 'data') continue;
          rest[k] = parsed[k];
        }
        finalObj = { data: data, ...rest };
      } else {
        finalObj = { data: data, spec: parsed };
      }
    } catch (err) {
      finalObj = { data: data, _user_raw: newCode };
    }

    try {
      finalString = JSON.stringify(finalObj, null, 2);
    } catch (err) {
      finalString = String(finalObj);
    }

    // Update the shared store and editor doc
    if (editorMounted && editorView) {
      ignoreModelChange = true;
      editorView.getModel()?.setValue(finalString);
      ignoreModelChange = false;
      codeStore.set(finalString);

      // reapply constraints & decorations after replacing whole document
      if (constrainedInstance && editorView.getModel()) {
        const model = editorView.getModel()!;
        const lastLine = model.getLineCount();
        const editableStart = headerLineCount() + 1;
        const editableEnd = Math.max(editableStart, lastLine - 1);
        const restrictions: any[] = [];
        if (editableEnd >= editableStart) {
          restrictions.push({
            range: [editableStart, 1, editableEnd, model.getLineMaxColumn(editableEnd)],
            allowMultiline: true,
            label: 'editableVegaLite'
          });
        }
        // clear old constraints first
        constrainedInstance.removeRestrictionsIn(model);

        if (restrictions.length) constrainedInstance.addRestrictionsTo(model, restrictions);
        updateReadonlyDecorations();
        // highlight what the server changed compared to the spec that was sent
        try {
          const prevSpec = specHistory[specHistory.length - 1] ?? '';
          applyServerDiffDecorations(prevSpec, finalString);
        } catch (err) {
          console.error('Failed to compute server diff decorations', err);
        }
      }

      await tick();
      dispatch('codeApplied');
    } else {
      codeStore.set(finalString);
      dispatch('codeApplied');
    }
  }

  function disposeEditor() {
    closeRemovedLinesOverlay();
    if (editorView) {
      editorView.dispose();
      editorView = null;
    }
    if (editorModel) {
      editorModel.dispose();
      editorModel = null;
    }
    readonlyDecorationIds = [];
    serverChangeDecorationIds = [];
    removedDecorationById.clear();
    if (constrainedInstance) {
      constrainedInstance = null;
    }
  }

  export async function rollbackChanges() {
    const specBeforeAppliedChanges = specHistory[specHistory.length - 1];
    if (editorView?.getModel()) {
      ignoreModelChange = true;
      editorView.getModel()!.setValue(specBeforeAppliedChanges);
      ignoreModelChange = false;
      codeStore.set(specBeforeAppliedChanges);
    }
    specHistory.splice(specHistory.length - 1, 1);
  }

  onDestroy(() => {
    unsubscribeSave?.();
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', handleRemovedOverlayOutsidePointerDown);
    }
    try {
      if (editorView && typeof editorView.dispose === 'function') editorView.dispose();
    } catch (err) {}
    try {
      if (editorContainer && containerPointerHandler)
        editorContainer.removeEventListener('pointerdown', containerPointerHandler);
    } catch (err) {}
  });

  // follow the system color scheme (setTheme is global to Monaco, so one call covers the editor)
  $: if (monaco) monaco.editor.setTheme($isDark ? 'vs-dark' : 'vs');
</script>

<div style="height:100%; display:flex; flex-direction:column;">
  <div
    bind:this={editorContainer}
    class="editor-container"
    style="flex:1 1 auto; min-height:0; border:1px solid var(--bulma-border); position:relative;"
  >
    <!-- Copy button placed in the editor overlay (top-right). Visible on hover or when editor has focus. -->
    <button
      class="copy-button"
      type="button"
      aria-label={copied ? 'Copied' : 'Copy code'}
      title={copied ? 'Copied' : 'Copy'}
      on:click={copyToClipboard}
    >
      <span class="icon is-small">
        {#if copied}
          <Fa icon={faCheck} />
        {:else}
          <Fa icon={faCopy} />
        {/if}
      </span>
    </button>
  </div>
</div>

<style>
  :global(.readonly-text-inline) {
    background: rgba(128, 128, 128, 0.22);
    border-radius: 4px;
    padding: 0 6px;
  }
  /* server-returned change highlights */
  :global(.server-added) {
    background: rgba(76, 175, 80, 0.14);
    border-left: 3px solid rgba(76, 175, 80, 0.9);
  }
  :global(.server-removed-glyph) {
    position: relative;
    cursor: pointer;
  }
  :global(.server-removed-glyph::before) {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    height: 4px;
    border-radius: 2px;
    background: var(--color-rollback-changes);
  }
  :global(.server-removed-glyph-top::before) {
    top: -1px;
  }
  :global(.server-removed-glyph-bottom::before) {
    bottom: -1px;
  }
  :global(.removed-lines-overlay) {
    position: absolute;
    margin-left: 0.25rem;
    margin-top: 0.25rem;
    max-width: min(40vw, 540px);
    max-height: 48vh;
    overflow: auto;
    background: var(--color-float-bg);
    border: 1px solid var(--color-float-border);
    border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 0.6rem 0.6rem;
    color: var(--color-float-text);
    font-size: 0.84rem;
    z-index: 80;
  }
  :global(.removed-lines-overlay-title) {
    color: var(--color-warm-gray);
    font-weight: 400;
    font-size: 0.7rem;
    margin-bottom: 0.4rem;
  }
  :global(.removed-lines-overlay-content) {
    margin: 0;
    white-space: pre-wrap;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  /* Copy button styles: positioned top-right inside .content and visible on hover/focus */
  .editor-container {
    position: relative; /* ensure overlay positioning context */
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    border-radius: var(--bulma-radius-medium);
    overflow: hidden;
  }
  .copy-button {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 60;
    border-radius: 6px;
    padding: 0.35rem 0.45rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--color-float-bg);
    color: var(--color-float-text);
    border: 1px solid var(--color-float-border);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    cursor: pointer;
    transition:
      opacity 160ms ease,
      transform 160ms ease;
    opacity: 0;
    transform: translateY(-4px);
    pointer-events: none;
  }
  .copy-button:focus {
    outline: 2px solid rgba(0, 0, 0, 0.12);
  }
  .editor-container:hover .copy-button,
  .editor-container:focus-within .copy-button,
  .copy-button:focus {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
  .copy-button .icon {
    width: 1rem;
    height: 1rem;
  }
  .copy-button[title='Copied'] {
    background: rgba(22, 163, 74, 0.95);
    border-color: rgba(22, 163, 74, 0.9);
    color: white;
  }
</style>
