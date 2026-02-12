<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
	import Fa from 'svelte-fa';
	import { faUpload, faDatabase } from '@fortawesome/free-solid-svg-icons';
	import { code as codeStore } from '$lib/stores/code';
	import {get} from "svelte/store";
	import { EditorState } from '@codemirror/state';
	import {EditorView, keymap} from '@codemirror/view';
	import { json } from '@codemirror/lang-json';
	import readOnlyRangesExtension from 'codemirror-readonly-ranges'
	import {indentOnInput} from "@codemirror/language";
	import {defaultKeymap, indentLess, indentMore} from "@codemirror/commands";

	const dispatch = createEventDispatcher();
	let editorContainer: HTMLDivElement | null = null;
	let textareaFallback: HTMLTextAreaElement | null = null;
	let editorMounted = false;
	let editorView: any = null;
	let containerPointerHandler: ((e: PointerEvent) => void) | null = null;

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
	const schema = "https://vega.github.io/schema/vega-lite/v5.json";
	let data: any = null; // will be wired later when datasets are attached

	onMount(async () => {
		if (!editorContainer) return;

		const state = EditorState.create({
			doc: get(codeStore),
			extensions: [
				json(),
				// Theme to make editor fill container and allow scrolling
				EditorView.theme({
					'&': { height: '100%', display: 'flex', flexDirection: 'column' },
					'.cm-scroller': { flex: '1 1 auto', minHeight: '0', overflow: 'auto', overflowX: 'auto', overflowY: 'auto' },
					'.cm-content': { whiteSpace: 'pre' },
					'.cm-gutters': { flex: '0 0 auto' }
				}),
				keymap.of([
					{ key: 'Tab', run: indentMore },
					{ key: 'Shift-Tab', run: indentLess },
					...defaultKeymap
				]),
				EditorView.updateListener.of((v: any) => {
					if (v.docChanged) {
						const val = v.state.doc.toString();
						// Always let the editor listener be the single writer to the shared store
						codeStore.set(val);
					}
				}),
				readOnlyRangesExtension(getReadOnlyRanges)
			]
		});

		editorView = new EditorView({
			state,
			parent: editorContainer
		});

		// ensure clicking/tapping the editor container focuses the editor so the caret appears
		if (editorContainer && editorView) {
			containerPointerHandler = () => { try { editorView.focus(); } catch (_) {} };
			editorContainer.addEventListener('pointerdown', containerPointerHandler);
		}

		editorMounted = true;
	});

	/**
	 * Find the document index (0-based) where a value starting at `startIdx` ends.
	 * Handles objects { ... }, arrays [ ... ], strings and simple primitives.
	 */
	function findValueEndIndex(text: string, startIdx: number): number {
		let i = startIdx;
		const len = text.length;
		// skip initial whitespace
		while (i < len && /\s/.test(text[i])) i++;
		if (i >= len) return len - 1;

		const open = text[i];
		if (open === '{' || open === '[') {
			// scan for matching closing bracket, handling nested and strings
			const closing = open === '{' ? '}' : ']';
			let depth = 0;
			let inString = false;
			let escaped = false;
			for (; i < len; i++) {
				const ch = text[i];
				if (inString) {
					if (escaped) escaped = false;
					else if (ch === '\\') escaped = true;
					else if (ch === '"') inString = false;
					continue;
				}
				if (ch === '"') { inString = true; continue; }
				if (ch === open) depth++;
				else if (ch === closing) {
					depth--;
					if (depth === 0) return i; // return index of closing bracket
				}
			}
			return len - 1;
		} else if (open === '"') {
			// string literal: find closing quote
			i++;
			let escaped = false;
			for (; i < len; i++) {
				const ch = text[i];
				if (escaped) { escaped = false; continue; }
				if (ch === '\\') { escaped = true; continue; }
				if (ch === '"') return i;
			}
			return len - 1;
		} else {
			// primitive (number, true, false, null or unquoted token) - scan until comma or closing brace/bracket
			for (; i < len; i++) {
				const ch = text[i];
				if (ch === ',' || ch === '}' || ch === ']' || ch === '\n') return i - 1;
			}
			return len - 1;
		}
	}

	/**
	 * Convenience helper that reads the shared `code` store and returns the
	 * 1-based line number where the top-level `data` value ends. Falls back to 3.
	 */
	export function findDataEndLineInStore(): number {
		try {
			const text = get(codeStore) || '';
			const m = /"data"\s*:\s*/g.exec(text);
			if (!m || !m.index) return 3;
			const idx = m.index + m[0].length;
			const endIdx = findValueEndIndex(text, idx);
			// compute line by counting newlines up to endIdx
			const slice = text.slice(0, endIdx + 1);
			const line = slice.split('\n').length;
			return line;
		} catch (err) {
			return 3;
		}
	}

	const getReadOnlyRanges = (targetState: any):Array<{from:number|undefined, to:number|undefined}> => {
		// compute the end line for the top-level data value so we can protect the data block
		let dataEndLine = findDataEndLineInStore()

		return [
			{
				from: undefined, // same as: targetState.doc.line(0).from or 0
				to: targetState.doc.line(dataEndLine).to
			},
			{
				from: targetState.doc.line(targetState.doc.lines).from,
				to: undefined // same as: targetState.doc.line(targetState.doc.lines).to
			}
		];
	}

	// Expose a method to let parents programmatically set the editor contents — treat it like a user edit
	export async function setCode(newCode: string) {
		// We implement Option B (tolerant) fallback: try to parse incoming text as JSON.
		// If parsing succeeds and top-level is an object, create a new object with "$schema" and "data" first
		// and then copy the remaining keys in their original order. If parsing succeeds but top-level is not an object,
		// wrap it under "spec" while still enforcing schema/data. If parsing fails, create a wrapper object that
		// preserves the raw string under _user_raw and enforces schema/data.

		let finalObj: any = null;
		let finalString = '';

		try {
			const parsed = JSON.parse(newCode);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				// top-level object: build a new object where $schema and data are first
				const rest: any = {};
				for (const k of Object.keys(parsed)) {
					if (k === '$schema' || k === 'data') continue; // skip these so we can place ours first
					rest[k] = parsed[k];
				}
				finalObj = { '$schema': schema, 'data': data, ...rest };
			} else {
				// not an object (array/primitive): wrap under `spec`, maintaining order
				finalObj = { '$schema': schema, 'data': data, 'spec': parsed };
			}
		} catch (err) {
			// parsing failed: preserve raw input under `_user_raw` so the user content isn't lost
			console.warn('setCode: incoming code not valid JSON; using tolerant fallback and preserving raw content.');
			finalObj = { '$schema': schema, 'data': data, '_user_raw': newCode };
		}

		try {
			finalString = JSON.stringify(finalObj, null, 2);
		} catch (err) {
			// unlikely, but ensure we still have a string to insert
			finalString = String(finalObj);
		}

		if (editorMounted && editorView) {
			try {
				// Programmatic replace: don't write the store here. The updateListener will observe the
				// change and write to the store exactly once, same as a user edit.
				editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: finalString } });
				if (textareaFallback) textareaFallback.value = finalString;
				// wait a tick so the editor and update listener run
				await tick();
				dispatch('codeApplied');
			} catch (err) {
				// fallback: if dispatch fails, write store directly
				codeStore.set(finalString);
				dispatch('codeApplied');
			}
		} else {
			// editor not ready; set store directly and dispatch
			codeStore.set(finalString);
			dispatch('codeApplied');
		}
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

	function confirmDataset() {
		// close any help popover when confirming
		showDatasetHelp = false;
		document.removeEventListener('mousedown', handleDocClick);
		if (datasetMode === 'file' && datasetFile) {
			dispatch('attachDataset', { kind: 'file', file: datasetFile });
			showDatasetModal = false;
		} else if (datasetMode === 'url' && datasetUrl.trim()) {
			dispatch('attachDataset', { kind: 'url', url: datasetUrl.trim() });
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

	<div bind:this={editorContainer} class="content" style="flex:1 1 auto; min-height:0; border:1px solid #eaeaea;">
		{#if !editorMounted}
			<textarea bind:this={textareaFallback} class="textarea code-fallback" bind:value={fallbackValue} on:input={onFallbackInput} aria-label="Vega-Lite editor fallback" style="height:100%; width:100%; overflow:auto; white-space:pre; resize:none;"></textarea>
		{/if}
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
				<button class="button is-info" on:click={confirmDataset} disabled={(datasetMode === 'file' && !datasetFile) || (datasetMode === 'url' && !datasetUrl)}>Attach</button>&nbsp;
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
</style>
