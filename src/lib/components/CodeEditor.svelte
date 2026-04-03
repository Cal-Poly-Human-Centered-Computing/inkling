<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
	import Fa from 'svelte-fa';
	import { faUpload, faDatabase } from '@fortawesome/free-solid-svg-icons';
	import { faCopy } from '@fortawesome/free-solid-svg-icons/faCopy';
	import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck';
	import { code as codeStore } from '$lib/stores/code';
	import {get} from "svelte/store";
	import { EditorState, StateEffect, StateField } from '@codemirror/state';
	import {
		EditorView,
		keymap,
		Decoration,
		WidgetType,
		ViewPlugin,
		gutter,
		highlightActiveLineGutter
	} from '@codemirror/view';
	import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
	import { json } from '@codemirror/lang-json';
	import {defaultKeymap, history, historyKeymap, indentLess, indentMore} from "@codemirror/commands";
	import {loadDatasetFromUrl as loadDatasetFromUrlHelper} from "$lib/utils/datasetLoader";
	import {getColumnNames, getDataToken, getFirstRow, setDatasetFromDfd} from "$lib/utils/datasetStore";
	import { conversationId as convIdStore } from '$lib/stores/conversationId';
	import {bracketMatching, syntaxHighlighting} from "@codemirror/language";
	import readOnlyRangesExtension from "codemirror-readonly-ranges";

	const dispatch = createEventDispatcher();
	let editorContainer: HTMLDivElement | null = null;
	let textareaFallback: HTMLTextAreaElement | null = null;
	let editorMounted = false;
	let editorView: any = null;
	let containerPointerHandler: ((e: PointerEvent) => void) | null = null;

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

	let specBeforeAppliedChanges: string = ''

	function getReadonlyText() {
		let str = JSON.stringify({"$schema": schema, "data": data}, null, "  ");

		str = str.slice(0, -2) + ',\n  \n}'; // remove closing brace and re-add with extra space for user edits

		return str;
	}

	const getReadOnlyRanges = (targetState: any):Array<{from:number|undefined, to:number|undefined}> => {
		const doc = targetState.doc;
		const headerEndLine = Math.min(5, doc.lines);
		return [
			{
				from: 0,
				to: doc.line(headerEndLine).to
			},
			{
				from: doc.line(doc.lines).from,
				to: undefined // same as targetState.doc.line(targetState.doc.lines).to
			}
		]
	}

	// Decoration plugin: apply the `readonly-text` class to the first five lines
	// and to the last line of the document. This is purely visual and complements the
	// `readOnlyRangesExtension` (which enforces read-only behavior).
	const headerFooterLineDecoration = ViewPlugin.fromClass(class {
		decorations: any;
		constructor(view: any) { this.decorations = this.buildDeco(view); }
		update(update: any) {
			if (update.docChanged || update.viewportChanged) this.decorations = this.buildDeco(update.view);
		}
		buildDeco(view: any) {
			const decos: any[] = [];
			const seen = new Set<string>();
			const doc = view.state.doc;
			const maxHeader = Math.min(5, doc.lines);
			for (let i = 1; i <= maxHeader; i++) {
				const line = doc.line(i);
				const from = line.from, to = line.to;
				const key = `${from}-${to}`;
				if (!seen.has(key)) {
					seen.add(key);
					decos.push(Decoration.mark({ class: 'readonly-text' }).range(from, to));
				}
			}

			// Last line
			if (doc.lines >= 1) {
				const lastLine = doc.line(doc.lines);
				const from = lastLine.from, to = lastLine.to;
				const key = `${from}-${to}`;
				if (!seen.has(key)) {
					seen.add(key);
					decos.push(Decoration.mark({ class: 'readonly-text' }).range(from, to));
				}
			}

			return Decoration.set(decos, true);
		}
	}, {
		decorations: (v: any) => v.decorations
	});

	async function createNewEditorState(spec: string) {
		const { jsonSchema } = await import('codemirror-json-schema');
		const vegaLiteSchema = await (await fetch(schema)).json();
		return EditorState.create({
			doc: spec,
			extensions: [
				jsonSchema(vegaLiteSchema),
				// Theme to make editor fill container and allow scrolling
				EditorView.theme({
					'&': { height: '100%', display: 'flex', flexDirection: 'column' },
					'.cm-scroller': { flex: '1 1 auto', minHeight: '0', overflow: 'auto', overflowX: 'auto', overflowY: 'auto' },
					'.cm-content': { whiteSpace: 'pre' },
					'.cm-gutters': { flex: '0 0 auto' }
				}),
				history(),
				gutter({ class: "CodeMirror-lint-markers" }),
				bracketMatching(),
				highlightActiveLineGutter(),
				syntaxHighlighting(oneDarkHighlightStyle),
				keymap.of([
					...historyKeymap,
					{ key: 'Tab', run: indentMore },
					{ key: 'Shift-Tab', run: indentLess },
					...defaultKeymap
				]),
				// write full JSON back to the shared store whenever doc changes
				EditorView.updateListener.of((v: any) => {
					if (v.docChanged) {
						const text = v.state.doc.toString();
						codeStore.set(text);
					}
				}),
				// Add visual decoration for header/footer lines
				headerFooterLineDecoration,
				readOnlyRangesExtension(getReadOnlyRanges)
			]
		});
	}

	async function initializeEditor() {
		const initialContents = getReadonlyText();

		codeStore.set(initialContents);
		const state = await createNewEditorState(initialContents);

		console.log(getColumnNames().join(', '))

		if (editorView) {
			editorView.destroy();
		}
		editorView = new EditorView({
			state,
			parent: editorContainer
		});

		// ensure clicking/tapping the editor container focuses the editor so the caret appears
		if (editorContainer && editorView) {
			containerPointerHandler = () => { try { editorView.focus(); } catch (_) {} };
			editorContainer.addEventListener('pointerdown', containerPointerHandler);
		}
	}

	onMount(async () => {
		if (!editorContainer) return;

		data = getDataToken();

		await initializeEditor();

		editorMounted = true;
	});

	/**
	 * Called from page.svelte whenever the user applies changes from the canvas
	 * newCode is the full JSON text  returned by the AI server
	 * @param newCode
	 */
	export async function setCode(newCode: string) {
		// save the current spec in case the user rolls back the applied changes
		specBeforeAppliedChanges = editorView.state.doc.toString();

		let finalObj: any = null;
		let finalString = '';

		console.log(newCode);

		try {
			// TODO: first attempt to parse newCode as JSON somewhere else, to guarantee that it is JSON when it gets here
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
			const newState = await createNewEditorState(finalString);
			editorView.setState(newState)

			editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: finalString }});

			if (textareaFallback) textareaFallback.value = finalString;
			await tick();
			dispatch('codeApplied');
		} else {
			codeStore.set(finalString);
			dispatch('codeApplied');
		}
	}


	export async function rollbackChanges() {
		console.log(specBeforeAppliedChanges)
		editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: specBeforeAppliedChanges }});
		const newState = await createNewEditorState(specBeforeAppliedChanges);
		editorView.setState(newState)
		specBeforeAppliedChanges = '';
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
	        if (editorView && typeof editorView.destroy === 'function') editorView.destroy();
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

				await setDatasetFromDfd(res.df, datasetUrl);

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
  :global(.readonly-text) {
	  display: inline; /* allow fragmentation across lines */
	  white-space: pre; /* preserve newlines */
	  background: rgba(70,70,70,0.8);
	  border-radius: 4px;
	  -webkit-box-decoration-break: clone;
	  box-decoration-break: clone;
	  background-clip: padding-box;
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
