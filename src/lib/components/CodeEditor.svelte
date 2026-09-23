<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
	import Fa from 'svelte-fa';
	import { faUpload, faDatabase } from '@fortawesome/free-solid-svg-icons';
	import { faCopy } from '@fortawesome/free-solid-svg-icons/faCopy';
	import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck';
	import { code as codeStore } from '$lib/stores/code';
	import {get} from "svelte/store";
	import type * as Monaco from 'monaco-editor';
	import {loadDatasetFromUrl as loadDatasetFromUrlHelper} from "$lib/utils/datasetLoader";
	import {getColumnNames, getDataToken, getFirstRow, setDataset} from "$lib/utils/datasetStore";
	import { conversationId as convIdStore } from '$lib/stores/conversationId';
	import constrainedEditor from 'constrained-editor-plugin';
	import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
	import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
	import { diffLines } from 'diff';

	const dispatch = createEventDispatcher();
	let editorContainer: HTMLDivElement | null = null;
	let textareaFallback: HTMLTextAreaElement | null = null;
	let editorMounted = false;
	let monaco: typeof Monaco | null = null;
	let editorView: Monaco.editor.IStandaloneCodeEditor | null = null;
	let editorModel: Monaco.editor.ITextModel | null = null;
	let containerPointerHandler: ((e: PointerEvent) => void) | null = null;
	let ignoreModelChange = false;
	let constrainedInstance: any = null;

	// Decorations added to indicate server-returned changes (cleared on next local edit)
	let serverChangeDecorationIds: string[] = [];
	type RemovedChunkInfo = { lineCount: number; text: string };
	let removedDecorationById = new Map<string, RemovedChunkInfo>();
	let removedLinesOverlay:
		| { anchorLine: number; lineCount: number; text: string }
		| null = null;
	let removedOverlayWidget: Monaco.editor.IOverlayWidget | null = null;
	let removedOverlayDomNode: HTMLDivElement | null = null;

	function applyServerDiffDecorations(prevText: string, newText: string) {
		if (!editorModel || !monaco) return;

		const model = editorModel;
		const parts = diffLines(prevText ?? '', newText ?? '');

		let newLine = 1;

		const decos: import('monaco-editor').editor.IModelDeltaDecoration[] = [];
		const removedMetaByNewIndex = new Map<number, RemovedChunkInfo>();

		const getLineCount = (value: string): number => {
			if (!value) return 0;

			const newlineCount = (value.match(/\n/g) ?? []).length;

			// If it doesn't end in a newline, there's one additional line.
			return newlineCount + (value.endsWith('\n') ? 0 : 1);
		};

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const lineCount = getLineCount(part.value ?? '');

			if (part.removed) {
				const modelLineCount = model.getLineCount();
				if (lineCount > 0 && modelLineCount > 0) {
					const anchorLine = Math.min(Math.max(newLine, 1), modelLineCount);
					decos.push({
						range: new monaco.Range(anchorLine, 1, anchorLine, 1),
						options: {
							glyphMarginClassName: 'server-removed-glyph',
							glyphMarginHoverMessage: {
								value: `${lineCount} ${lineCount === 1 ? 'line' : 'lines'} removed`
							},
							hoverMessage: {
								value: `${lineCount} ${lineCount === 1 ? 'line' : 'lines'} removed`
							}
						}
					});
					removedMetaByNewIndex.set(decos.length - 1, {
						lineCount,
						text: part.value ?? ''
					});
				}
				continue;
			}

			if (part.added) {
				const previousPart = parts[i - 1];

				// jsdiff generally represents a modified line as:
				//
				// removed chunk
				// added chunk
				//
				// So if this addition immediately follows a removal,
				// treat the new lines as modified rather than purely added.
				const isModified = previousPart?.removed === true;

				if (lineCount > 0 && newLine <= model.getLineCount()) {
					const startLine = newLine;
					const endLine = Math.min(
							model.getLineCount(),
							newLine + lineCount - 1
					);

					decos.push({
						range: new monaco.Range(
								startLine,
								1,
								endLine,
								model.getLineMaxColumn(endLine)
						),
						options: {
							isWholeLine: true,
							className: isModified
									? 'server-modified'
									: 'server-added'
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

		serverChangeDecorationIds = model.deltaDecorations(
				serverChangeDecorationIds,
				decos
		);
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
			editorView.removeOverlayWidget(removedOverlayWidget);
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
		const widget: Monaco.editor.IOverlayWidget = {
			getId: () => widgetId,
			getDomNode: () => domNode,
			getPosition: () => ({
				preference: monacoApi.editor.OverlayWidgetPositionPreference.TOP_RIGHT_CORNER
			})
		};
		removedOverlayWidget = widget;
		editorView.addOverlayWidget(widget);
	}

	// copy button state
	let copied = false;

	/**
	 * Copy the full spec (stored in `codeStore`) to the clipboard.
	 * Uses navigator.clipboard when available, with a textarea fallback.
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
	        // Fallback: use an existing fallback textarea if present, otherwise create a temporary one
	        let ta = textareaFallback as HTMLTextAreaElement | null;
	        let created = false;
	        if (!ta) {
	            created = true;
	            ta = document.createElement('textarea');
	            ta.value = text;
	            // keep off-screen and invisible but selectable
	            ta.style.position = 'fixed';
	            ta.style.left = '-9999px';
	            ta.style.top = '0';
	            ta.style.opacity = '0';
	            document.body.appendChild(ta);
	        } else {
	            ta.value = text;
	        }
	        try {
	            ta.focus();
	            ta.select();
	            document.execCommand('copy');
	        } catch (e) {
	            // swallow
	        }
	        if (created && ta && ta.parentNode) ta.parentNode.removeChild(ta);
	    }

	    copied = true;
	    setTimeout(() => { copied = false; }, 1500);
	    dispatch('copied');
	}

	// upload modal state
	let showUploadModal = false;
	let selectedFile: File | null = null;
	let fileInputEl: HTMLInputElement | null = null;

	// dataset modal state
	let showDatasetModal: boolean = false;
	let datasetMode: 'file' | 'url' = 'file';
	let datasetFile: File | null = null;
	let datasetFileInput: HTMLInputElement | null = null;
	let datasetUrl: string = '';

	// dataset help popover state
	let showDatasetHelp = false;
	let helpButtonEl: HTMLButtonElement | null = null;
	let helpPopoverEl: HTMLDivElement | null = null;

	// hold canonical schema and data enforced into any incoming spec
	const schema = "https://vega.github.io/schema/vega-lite/v6.json";
	let data: any = null;

	let specHistory: string[] = []

	function getReadonlyText() {
		let str = JSON.stringify({"$schema": schema, "data": data}, null, "  ");

		str = str.slice(0, -2) + ',\n  \n}'; // remove closing brace and re-add with extra space for user edits

		return str;
	}

	// Decorations for readonly lines (highlight only the text, not full-line)
	let readonlyDecorationIds: string[] = [];
	function updateReadonlyDecorations() {
		if (!editorModel || !monaco) return;
		const decos: import('monaco-editor').editor.IModelDeltaDecoration[] = [];
		const lastLine = editorModel.getLineCount();
		const headerMax = Math.min(5, lastLine);
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
		// compute editable range: lines 6 .. second-to-last
		const lastLine = editorModel.getLineCount();
		const editableStart = 6;
		const editableEnd = Math.max(editableStart, lastLine - 1);
		if (editableEnd >= editableStart) {
			constrainedInstance.addRestrictionsTo(editorModel, [{
				range: [editableStart, 1, editableEnd, editorModel.getLineMaxColumn(editableEnd)],
				allowMultiline: true,
				label: 'editableVegaLite'
			}]);
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
			insertSpaces: true,
			formatOnPaste: true,
			formatOnType: true,
			lineNumbersMinChars: 2,
			glyphMargin: true,
			lineDecorationsWidth: 4,
			folding: false
		});
		monaco.editor.setTheme('vs-dark');

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
					showRemovedLinesOverlay(lineNumber, removedInfo.lineCount, removedInfo.text);
					return;
				}
			}
		});

		// ensure clicking/tapping the editor container focuses the editor so the caret appears
		if (editorContainer && editorView) {
			containerPointerHandler = () => { try { editorView?.focus(); } catch (_) {} };
			editorContainer.addEventListener('pointerdown', containerPointerHandler);
		}
	}

	async function initializeEditor() {
		disposeEditor();

		const initialContents = getReadonlyText();

		codeStore.set(initialContents);
		specHistory.push(initialContents);

		await createEditor();
	}

	onMount(async () => {
		if (!editorContainer) return;
		monaco = await import('monaco-editor');

		data = getDataToken();

		await initializeEditor();

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
	 * Called from page.svelte whenever the user applies changes from the canvas
	 * newCode is the full JSON text  returned by the AI server
	 * @param newCode
	 */
	export async function setCode(newCode: string) {
		// save the current spec in case the user rolls back the applied changes
		specHistory.push(editorView?.getModel()?.getValue() ?? String(get(codeStore) || ''))

		let finalObj: any = null;
		let finalString = '';

		console.log(newCode);

		try {
			const parsed = JSON.parse(newCode);
			console.log(parsed);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				const rest: any = {};
				for (const k of Object.keys(parsed)) {
					if (k === '$schema' || k === 'data') continue;
					rest[k] = parsed[k];
				}
				finalObj = { '$schema': schema, 'data': data, ...rest };
			} else {
				finalObj = { '$schema': schema, 'data': data, 'spec': parsed };
			}
		} catch (err) {
			finalObj = { '$schema': schema, 'data': data, '_user_raw': newCode };
		}

		try { finalString = JSON.stringify(finalObj, null, 2); } catch (err) { finalString = String(finalObj); }

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
				const editableStart = 6;
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

			if (textareaFallback) textareaFallback.value = finalString;
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
		specHistory.splice(specHistory.length - 1, 1)
	}


	// on fallback textarea input, write to store directly
	let fallbackValue = get(codeStore) || '';
	function onFallbackInput(e: Event) {
		const t = e.target as HTMLTextAreaElement;
		fallbackValue = t.value;
		codeStore.set(t.value);
	}

	onDestroy(() => {
	    try {
	        if (editorView && typeof editorView.dispose === 'function') editorView.dispose();
	    } catch (err) {}
	    try {
	        if (editorContainer && containerPointerHandler) editorContainer.removeEventListener('pointerdown', containerPointerHandler);
	    } catch (err) {}
	    try {
			// ensure any document listener used by the dataset help popover is removed
			document.removeEventListener('mousedown', handleDocClick);
		} catch (err) {}
	});

	function openUploadModal() {
		selectedFile = null;
		showUploadModal = true;
		setTimeout(() => fileInputEl?.focus(), 0);
	}

	function onFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			selectedFile = input.files[0];
		} else {
			selectedFile = null;
		}
	}

	function confirmUpload() {
		if (selectedFile) {
			dispatch('upload', selectedFile);
		}
		showUploadModal = false;
	}

	function cancelUpload() {
		selectedFile = null;
		showUploadModal = false;
	}

	// dataset modal handlers
	function openDatasetModal() {
		datasetMode = 'file';
		datasetFile = null;
		datasetUrl = '';
		showDatasetModal = true;
		setTimeout(() => datasetFileInput?.focus(), 0);
	}

	function onDatasetFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files[0]) datasetFile = input.files[0];
		else datasetFile = null;
	}

	async function attachDataset() {
		// close any help popover when confirming
		showDatasetHelp = false;
		document.removeEventListener('mousedown', handleDocClick);
		if (datasetMode === 'file' && datasetFile) {
			dispatch('attachDataset', { kind: 'file', file: datasetFile });
			showDatasetModal = false;
		} else if (datasetMode === 'url' && datasetUrl.trim()) {
			datasetUrl = datasetUrl.trim()
			data = { url: datasetUrl }
			try {
				const res = await loadDatasetFromUrlHelper(datasetUrl);
				console.log('Dataset loaded via helper:', res);

				setDataset(res.data, res.columns, datasetUrl);

				// reset the editor contents with the new dataset
				await initializeEditor();

				// const bodyPayload: any = { convId: get(convIdStore), columnNames: getColumnNames(), exampleRow: getFirstRow() };

				// const resp = await fetch('/api/upload-column-names', {
				// 	method: 'POST',
				// 	headers: { 'Content-Type': 'application/json' },
				// 	body: JSON.stringify(bodyPayload)
				// });
				//
				// if (!resp.ok) {
				// 	console.error('Upload Column Names failed');
				// 	return;
				// }
			} catch (err) {
				console.error('Failed to load dataset via helper:', err);
			}
			showDatasetModal = false;
		}
	}

	function cancelDataset() {
		datasetFile = null;
		datasetUrl = '';
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

	// hide the help popover whenever the user switches away from file mode
	$: if (datasetMode !== 'file') {
		showDatasetHelp = false;
		document.removeEventListener('mousedown', handleDocClick);
	}
</script>

<div class="box" style="height:100%; display:flex; flex-direction:column;">
	<div class="field" style="flex:0 0 auto; display:flex; align-items:center; gap:0.5rem;">
		<button class="button is-light" aria-label="Upload sketch image" on:click={openUploadModal}>
			<span class="icon is-small"><Fa icon={faUpload} /></span>
		</button>
		<!-- dataset attach button to the right -->
		<button class="button is-light" aria-label="Attach dataset" on:click={openDatasetModal}>
			<span class="icon is-small"><Fa icon={faDatabase} /></span>
		</button>
	</div>

	<div bind:this={editorContainer} class="content" style="flex:1 1 auto; min-height:0; border:1px solid #eaeaea; position:relative;">
		{#if !editorMounted}
			<textarea bind:this={textareaFallback} class="textarea code-fallback" bind:value={fallbackValue} on:input={onFallbackInput} aria-label="Vega-Lite editor fallback" style="height:100%; width:100%; overflow:auto; white-space:pre; resize:none;"></textarea>
		{/if}

		<!-- Copy button placed in the editor overlay (top-right). Visible on hover or when editor has focus. -->
		<button class="copy-button" type="button" aria-label={copied ? 'Copied' : 'Copy code'} title={copied ? 'Copied' : 'Copy'} on:click={copyToClipboard}>
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

<!-- Upload modal -->
{#if showUploadModal}
	<div class="modal is-active" role="dialog" aria-modal="true" aria-label="Upload sketch dialog">
		<div class="modal-background" role="button" tabindex="0" aria-label="Close upload dialog" on:click={cancelUpload} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') cancelUpload(); }}></div>
		<div class="modal-card">
			<header class="modal-card-head">
				<p class="modal-card-title">Upload sketch image</p>
				<button class="delete" aria-label="close" on:click={cancelUpload}></button>
			</header>
			<section class="modal-card-body">
				<div class="field">
					<label class="label" for="upload-file-input">Choose image</label>
					<div class="control">
						<input id="upload-file-input" bind:this={fileInputEl} class="input" type="file" accept="image/*" on:change={onFileChange} />
					</div>
					{#if selectedFile}
						<p class="help">Selected: {selectedFile.name}</p>
					{/if}
				</div>
			</section>
			<footer class="modal-card-foot">
				<button class="button is-info" on:click={confirmUpload} disabled={!selectedFile}>Upload</button>&nbsp;
				<button class="button" on:click={cancelUpload}>Cancel</button>
			</footer>
		</div>
	</div>
{/if}

<!-- Dataset modal -->
{#if showDatasetModal}
	<div class="modal is-active" role="dialog" aria-modal="true" aria-label="Attach dataset dialog">
		<div class="modal-background" role="button" tabindex="0" aria-label="Close dataset dialog" on:click={cancelDataset} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') cancelDataset(); }}></div>
		<div class="modal-card">
			<header class="modal-card-head">
				<p class="modal-card-title">Attach dataset</p>
				<button class="delete" aria-label="close" on:click={cancelDataset}></button>
			</header>
			<section class="modal-card-body">
				<div class="field">
					<label class="label" for="dataset-mode-select">Source</label>
					<div class="control dataset-source-control" style="display:flex; align-items:center; gap:0.5rem; position:relative;">
						<div class="select">
							<select id="dataset-mode-select" bind:value={datasetMode} aria-label="Choose dataset source">
								<option value="file">Upload CSV file</option>
								<option value="url">Use URL</option>
							</select>
						</div>
						{#if datasetMode === 'file'}
							<button class="button is-white help-icon-button" aria-label="Dataset help" bind:this={helpButtonEl} on:click={toggleDatasetHelp} aria-expanded={showDatasetHelp}>
								<span class="icon is-small">?</span>
							</button>
							{#if showDatasetHelp}
								<div bind:this={helpPopoverEl} class="dataset-help-popover" role="dialog" aria-live="polite">
									<p style="margin:0; font-size:0.9rem;">Only CSV column names (not data values) are sent to the AI server to build the Vega-Lite specifications.</p>
								</div>
							{/if}
						{/if}
					</div>
				</div>

				{#if datasetMode === 'file'}
					<div class="field">
						<label class="label" for="dataset-file-input">CSV file</label>
						<div class="control">
							<input id="dataset-file-input" bind:this={datasetFileInput} class="input" type="file" accept=".csv,text/csv" on:change={onDatasetFileChange} />
						</div>
						{#if datasetFile}
							<p class="help">Selected: {datasetFile.name}</p>
						{/if}
					</div>
				{:else}
					<div class="field">
						<label class="label" for="dataset-url-input">Dataset URL</label>
						<div class="control">
							<input id="dataset-url-input" class="input" type="url" placeholder="https://example.com/data.csv or .json" bind:value={datasetUrl} />
						</div>
						<p class="help">You can use public URLs like https://vega.github.io/vega-datasets/data/cars.json</p>
					</div>
				{/if}
			</section>
			<footer class="modal-card-foot">
				<button class="button is-info" on:click={attachDataset} disabled={(datasetMode === 'file' && !datasetFile) || (datasetMode === 'url' && !datasetUrl)}>Attach</button>&nbsp;
				<button class="button" on:click={cancelDataset}>Cancel</button>
			</footer>
		</div>
	</div>
{/if}

<style>
  /* Default (light) theme styles */
  @media (prefers-color-scheme: light) {
	  :global(.code-fallback) { caret-color: black !important; }

	  /* scrollbars - dark thumbs on light track */
    :global(.cm-scroller::-webkit-scrollbar), :global(.code-fallback::-webkit-scrollbar) {
      height: 10px; width: 10px;
    }
    :global(.cm-scroller::-webkit-scrollbar-track), :global(.code-fallback::-webkit-scrollbar-track) {
      background: rgba(0,0,0,0.04);
      border-radius: 6px;
    }
    :global(.cm-scroller::-webkit-scrollbar-thumb), :global(.code-fallback::-webkit-scrollbar-thumb) {
      background: rgba(0,0,0,0.28);
      border-radius: 6px;
    }
    :global(.cm-scroller), :global(.code-fallback) {
      scrollbar-width: thin;
      scrollbar-color: rgba(0,0,0,0.28) rgba(0,0,0,0.04);
    }

	/* dataset help styles (light) */
	.dataset-source-control .help-icon-button {
		border-radius: 50%;
		width: 1.6rem;
		height: 1.6rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid rgba(0,0,0,0.08);
	}
	.dataset-help-popover {
		position: absolute;
		top: 2.4rem;
		left: 0;
		z-index: 40;
		background: white;
		border: 1px solid #e6e6e6;
		padding: 0.5rem;
		border-radius: 6px;
		width: 260px;
		box-shadow: 0 2px 8px rgba(0,0,0,0.12);
		font-size: 0.9rem;
	}
  }

  /* Dark theme styles */
  @media (prefers-color-scheme: dark) {
	  :global(.cm-content), :global(.code-fallback) { caret-color: white !important; }

    /* scrollbars - light thumbs on subtle dark track */
    :global(.cm-scroller::-webkit-scrollbar), :global(.code-fallback::-webkit-scrollbar) {
      height: 10px; width: 10px;
    }
    :global(.cm-scroller::-webkit-scrollbar-track), :global(.code-fallback::-webkit-scrollbar-track) {
      background: rgba(255,255,255,0.03);
      border-radius: 6px;
    }
    :global(.cm-scroller::-webkit-scrollbar-thumb), :global(.code-fallback::-webkit-scrollbar-thumb) {
      background: rgba(255,255,255,0.54);
      border-radius: 6px;
    }
    :global(.cm-scroller), :global(.code-fallback) {
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.54) rgba(255,255,255,0.03);
    }

	/* dataset help styles (dark) */
	.dataset-source-control .help-icon-button {
		border-radius: 50%;
		width: 1.6rem;
		height: 1.6rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid rgba(255,255,255,0.06);
	}
	.dataset-help-popover {
		position: absolute;
		top: 2.4rem;
		left: 0;
		z-index: 40;
		background: #0f0f0f;
		border: 1px solid rgba(255,255,255,0.06);
		padding: 0.5rem;
		border-radius: 6px;
		width: 260px;
		box-shadow: 0 2px 8px rgba(0,0,0,0.6);
		font-size: 0.9rem;
		color: #eaeaea;
	}
  }
  :global(.readonly-text-inline) {
  		background: rgba(128,128,128,0.22);
  		border-radius: 4px;
  		padding: 0 6px;
  	}
  /* server-returned change highlights */
  :global(.server-added) {
  	background: rgba(76,175,80,0.14);
  	border-left: 3px solid rgba(76,175,80,0.9);
  }
  :global(.server-modified) {
  	background: rgba(255,193,7,0.12);
  	border-left: 3px solid rgba(255,193,7,0.9);
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
	  top: -1px;
	  height: 5px;
	  border-radius: 1px;
	  background: rgba(244,67,54,0.95);
  }
  :global(.removed-lines-overlay) {
	  max-width: min(40vw, 540px);
	  max-height: 48vh;
	  overflow: auto;
	  background: #161616;
	  border: 1px solid rgba(244,67,54,0.5);
	  border-radius: 8px;
	  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
	  padding: 0.6rem 0.75rem;
	  color: #efefef;
	  font-size: 0.84rem;
	  z-index: 80;
  }
  :global(.removed-lines-overlay-title) {
	  color: rgba(244,67,54,0.95);
	  font-weight: 600;
	  margin-bottom: 0.4rem;
  }
  :global(.removed-lines-overlay-content) {
	  margin: 0;
	  white-space: pre-wrap;
	  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }

  /* Copy button styles: positioned top-right inside .content and visible on hover/focus */
  .content {
    position: relative; /* ensure overlay positioning context */
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
    background: rgba(255,255,255,0.9);
    border: 1px solid rgba(0,0,0,0.08);
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    cursor: pointer;
    transition: opacity 160ms ease, transform 160ms ease;
    opacity: 0;
    transform: translateY(-4px);
    pointer-events: none;
  }
  .copy-button:focus {
    outline: 2px solid rgba(0,0,0,0.12);
  }
  .content:hover .copy-button,
  .content:focus-within .copy-button,
  .copy-button:focus {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
  .copy-button .icon { width: 1rem; height: 1rem; }
  .copy-button[title="Copied"] {
    background: rgba(22,163,74,0.95);
    border-color: rgba(22,163,74,0.9);
    color: white;
  }

</style>
