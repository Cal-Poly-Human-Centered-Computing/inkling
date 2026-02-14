<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
	import Fa from 'svelte-fa';
	import { faUpload, faDatabase } from '@fortawesome/free-solid-svg-icons';
	import { code as codeStore } from '$lib/stores/code';
	import {get} from "svelte/store";
	import { EditorState, StateEffect, StateField } from '@codemirror/state';
	import {EditorView, keymap, Decoration, WidgetType, ViewPlugin} from '@codemirror/view';
	import { json } from '@codemirror/lang-json';
	import {defaultKeymap, indentLess, indentMore} from "@codemirror/commands";
	import {loadDatasetFromUrl as loadDatasetFromUrlHelper} from "$lib/utils/datasetLoader";
	import {setDatasetFromDfd} from "$lib/utils/datasetStore";

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

	// --- New Code: helpers, CM widgets, and header metadata StateField ---

	// Effect to update header meta (schema + data) in editor state
	const setHeaderMeta = StateEffect.define();

	type HeaderMeta = { schema: string; data: any };

	const headerMetaField: any = StateField.define({
		create(): HeaderMeta | null {
			// initialize from current codeStore value
			try {
				const text = get(codeStore) || '';
				const parsed = JSON.parse(text || '{}');
				return { schema: parsed?.['$schema'] ?? schema, data: parsed?.['data'] ?? data };
			} catch (err) {
				return { schema, data };
			}
		},
		update(value: HeaderMeta | null, tr: any) {
			for (const e of tr.effects) {
				if (e.is(setHeaderMeta)) return e.value;
			}
			return value;
		}
	});

	class HeaderWidget extends WidgetType {
		_meta: { schema: string; data: any } | null;
		constructor(meta: { schema: string; data: any } | null) {
			super();
			this._meta = meta;
		}
		toDOM() {
			const el = document.createElement('div');
			el.className = 'cm-editor-header';
			el.style.pointerEvents = 'none';
			el.style.whiteSpace = 'pre';
			// render opening brace, schema and a compact data preview (no leading spaces; padding handled by CSS)
			const schemaText = this._meta?.schema ? `"$schema": ${JSON.stringify(this._meta.schema)}` : '';
			let dataPreview = '"data": null';
			try {
				if (this._meta?.data) {
					if (typeof this._meta.data === 'string') dataPreview = `"data": ${JSON.stringify(this._meta.data)}`;
					else dataPreview = `"data": ${JSON.stringify(this._meta.data, null, 2)}`;
				}
			} catch (e) {}
			// Normalize any internal indentation so all header lines get a consistent prefix
			function indentLines(s: string, prefix = '  ') {
				if (!s) return '';
				// compute depth at the start of each line by scanning the string once
				const depths: number[] = [];
				let depth = 0;
				let inStr = false;
				let quote = '';
				let lineIdx = 0;
				depths[0] = 0;
				for (let i = 0; i < s.length; i++) {
					const c = s[i];
					if (inStr) {
						if (c === '\\') { i++; continue; }
						if (c === quote) { inStr = false; quote = ''; }
					} else {
						if (c === '"' || c === "'") { inStr = true; quote = c; }
						else if (c === '{' || c === '[') { depth++; }
						else if (c === '}' || c === ']') { depth = Math.max(0, depth - 1); }
					}
					if (c === '\n') { lineIdx++; depths[lineIdx] = depth; }
				}

				const lines = s.split('\n');
				return lines.map((line, idx) => {
					const rest = line.trimStart();
					if (idx === 0) {
						return prefix + rest;
					}
					const depthAtStart = depths[idx] ?? 0;
					// if the line starts with a closing brace/bracket, it should be one level less indented
					const firstChar = rest.charAt(0);
					const effectiveDepth = (firstChar === '}' || firstChar === ']') ? Math.max(0, depthAtStart - 1) : depthAtStart;
					const indent = prefix.repeat(1 + effectiveDepth);
					return indent + rest;
				}).join('\n');
			}
			const schemaBlock = schemaText ? indentLines(schemaText) : '';
			const dataBlock = indentLines(dataPreview);
			el.textContent = '{\n' + (schemaBlock ? schemaBlock + ',\n' : '') + dataBlock + ',';
			return el;
		}
		ignoreEvent() { return true; }
	}

	class FooterWidget extends WidgetType {
		constructor() { super(); }
		toDOM() {
			const el = document.createElement('div');
			el.className = 'cm-editor-footer';
			el.style.pointerEvents = 'none';
			el.style.whiteSpace = 'pre';
			el.textContent = '}';
			return el;
		}
		ignoreEvent() { return true; }
	}

	const headerFooterPlugin = ViewPlugin.fromClass(class {
		decorations: any;
		constructor(view: any) { this.decorations = this.buildDeco(view); }
		update(update: any) { if (update.docChanged || update.viewportChanged || update.startState.field(headerMetaField) !== update.state.field(headerMetaField)) this.decorations = this.buildDeco(update.view); }
		buildDeco(view: any) {
			const meta = view.state.field(headerMetaField);
			const widgets: any[] = [];
			widgets.push(Decoration.widget({ widget: new HeaderWidget(meta), side: -1 }).range(0));
			widgets.push(Decoration.widget({ widget: new FooterWidget(), side: 1 }).range(view.state.doc.length));
			return Decoration.set(widgets, true);
		}
	}, { decorations: (v: any) => v.decorations });

	/**
	 * Extract the "inner" spec portion from a full top-level JSON text.
	 * If the top-level is an object, remove $schema and data keys and return
	 * the pretty-printed remainder (or empty object "{}" if nothing left).
	 * If parsing fails, try to return any _user_raw content, or fallback to '{}'.
	 */
	function extractInnerSpecFromFull(fullText: string): string {
		try {
			const parsed = JSON.parse(fullText || '{}');
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				const rest: any = {};
				for (const k of Object.keys(parsed)) {
					if (k === '$schema' || k === 'data') continue;
					rest[k] = parsed[k];
				}
				// if nothing left, return an empty object for the inner spec
				if (Object.keys(rest).length === 0) return '{}';
				return JSON.stringify(rest, null, 2);
			}
			// non-object top-level -> wrap under "spec"
			return JSON.stringify({ spec: parsed }, null, 2);
		} catch (err) {
			// fallback: preserve _user_raw if present
			try {
				const loose = JSON.parse(fullText.replace(/^\s*/, ''));
				if (loose && typeof loose === 'object' && loose._user_raw) return loose._user_raw;
			} catch (e) {}
			return '{}';
		}
	}

	/**
	 * Extract only the outer "$schema" and "data" values from an arbitrary
	 * text blob that *may not* be valid JSON. This does not attempt to parse
	 * the full text as JSON; instead it locates the keys and extracts the
	 * following value token as a raw string (for objects/arrays the full
	 * balanced text is returned, for quoted strings the inner string is
	 * returned, for primitives the raw token is returned).
	 *
	 * Returns an object: { schema?: string, data?: string }
	 */
	function extractOuterSpecFromFull(fullText: string): { schema?: string; data?: string } {
		const text = String(fullText || '');
		const result: { schema?: string; data?: string } = {};

		// Regex to find occurrences of the quoted keys (handles both single and double quotes)
		const keyRegex = /["'](\$schema|data)["']\s*:/g;
		let match: RegExpExecArray | null;

		// Helper to advance from an index and extract a value token (string, object/array, or primitive)
		function extractValueFromIndex(startIdx: number): { value: string; endIdx: number } {
			let i = startIdx;
			// skip whitespace
			while (i < text.length && /\s/.test(text[i])) i++;
			if (i >= text.length) return { value: '', endIdx: i };

			const ch = text[i];

			// Quoted string
			if (ch === '"' || ch === "'") {
				const quote = ch;
				i++;
				let out = '';
				let escaped = false;
				while (i < text.length) {
					const c = text[i++];
					if (escaped) {
						out += c;
						escaped = false;
						continue;
					}
					if (c === '\\') {
						escaped = true;
						continue;
					}
					if (c === quote) break;
					out += c;
				}
				return { value: out, endIdx: i };
			}

			// Object or array: parse balanced braces/brackets and skip strings inside
			if (ch === '{' || ch === '[') {
				const open = ch;
				const close = open === '{' ? '}' : ']';
				let depth = 0;
				let start = i;
				while (i < text.length) {
					const c = text[i];
					if (c === '"' || c === "'") {
						// skip quoted strings safely
						const quote = c;
						i++;
						while (i < text.length) {
							const cc = text[i++];
							if (cc === '\\') { i++; continue; }
							if (cc === quote) break;
						}
						continue;
					}
					if (c === open) {
						depth++;
					} else if (c === close) {
						depth--;
						if (depth === 0) {
							i++; // include the closing brace
							break;
						}
					}
					i++;
				}
				const slice = text.slice(start, i).trim();
				return { value: slice, endIdx: i };
			}

			// Primitive (unquoted) - read until comma or closing brace/bracket
			const primStart = i;
			while (i < text.length && !/[,\}\]\n\r]/.test(text[i])) i++;
			const prim = text.slice(primStart, i).trim();
			return { value: prim.replace(/^,|,$/g, ''), endIdx: i };
		}

		while ((match = keyRegex.exec(text)) !== null) {
			const key = match[1];
			const colonIdx = match.index + match[0].length;
			const { value } = extractValueFromIndex(colonIdx);
			if (value !== undefined && value !== '') {
				if (key === '$schema') result.schema = value;
				else if (key === 'data') result.data = value;
			} else {
				// store empty string if present but empty
				if (key === '$schema') result.schema = result.schema ?? '';
				else if (key === 'data') result.data = result.data ?? '';
			}
		}

		return result;
	}

	/**
	 * Compose a full JSON text from the editor's inner spec text, injecting
	 * the enforced $schema and current data value.
	 */
	function composeFullFromInner(innerText: string): string {
		let finalObj: any = null;
		try {
			const parsedInner = JSON.parse(innerText);
			if (parsedInner && typeof parsedInner === 'object' && !Array.isArray(parsedInner)) {
				finalObj = { '$schema': schema, 'data': data, ...parsedInner };
			} else {
				finalObj = { '$schema': schema, 'data': data, 'spec': parsedInner };
			}
		} catch (err) {
			// inner not valid JSON: preserve raw under _user_raw
			finalObj = { '$schema': schema, 'data': data, '_user_raw': innerText };
		}
		try { return JSON.stringify(finalObj, null, 2); } catch (e) { return String(finalObj); }
	}

	// --- End new code ---

	onMount(async () => {
		if (!editorContainer) return;

		const state = EditorState.create({
			doc: extractInnerSpecFromFull(get(codeStore)),
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
				// write full JSON back to the shared store whenever inner doc changes
				EditorView.updateListener.of((v: any) => {
					if (v.docChanged) {
						const inner = v.state.doc.toString();
						const full = composeFullFromInner(inner);
						// single writer: editor listener updates the shared store
						codeStore.set(full);
					}
				}),
				headerMetaField,
				headerFooterPlugin
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

	// Expose a method to let parents programmatically set the editor contents — treat it like a user edit
	export async function setCode(newCode: string) {
		// Build final full JSON string using the same tolerant approach as before,
		// but then update the editor's inner doc (not the wrapper) and header meta.

		let finalObj: any = null;
		let finalString = '';

		try {
			const parsed = JSON.parse(newCode);
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

		// Update the shared store and editor inner doc
		if (editorMounted && editorView) {
			// compute inner spec and dispatch to replace editor content
			const inner = extractInnerSpecFromFull(finalString);
			editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: inner }, effects: setHeaderMeta.of({ schema, data }) });
			if (textareaFallback) textareaFallback.value = inner;
			await tick();
			dispatch('codeApplied');
		} else {
			codeStore.set(finalString);
			dispatch('codeApplied');
		}
	}

	// Prevent some static analyzers from flagging `setCode` as an unused export
	// (the function is called via the component instance from the parent).
	void setCode;

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

	/**
	 * Replace only the top-level `data` value in the stored full JSON.
	 * The editor contains only the inner spec, so we update
	 * the shared `codeStore` and the header meta (which updates the widget)
	 * without forcing edits to the inner editor content.
	 */
	export function replaceTopLevelDataValue(datasetUrl: string) {
		const text = get(codeStore) || '';
		try {
			const parsed = JSON.parse(text || '{}');
			if (parsed && typeof parsed === 'object') {
				parsed['data'] = { url: datasetUrl };
				const finalString = JSON.stringify(parsed, null, 2);
				// update shared store
				codeStore.set(finalString);
				// update header meta so widgets re-render
				if (editorView) editorView.dispatch({ effects: setHeaderMeta.of({ schema, data: { url: datasetUrl } }) });
				// also update local data
				data = { url: datasetUrl };
				return finalString;
			}
		} catch (err) {
			// fallback: reconstruct from current inner
			const inner = editorView ? editorView.state.doc.toString() : extractInnerSpecFromFull(text);
			const final = composeFullFromInner(inner);
			codeStore.set(final);
			if (editorView) editorView.dispatch({ effects: setHeaderMeta.of({ schema, data: { url: datasetUrl } }) });
			data = { url: datasetUrl };
			return final;
		}
		return text;
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
			try {
				const res = await loadDatasetFromUrlHelper(datasetUrl);
				console.log('Dataset loaded via helper:', res);

				await setDatasetFromDfd(res.df, datasetUrl);

				// update header meta and shared store without changing inner editor content
				replaceTopLevelDataValue(datasetUrl);

				data = { url: datasetUrl };

				// Optionally: forward to canvas or store; kept as a log for now
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

  /* Header/footer widget styles */
  :global(.cm-editor-header) {
	  background: rgba(0,0,0,0.03);
	  color: inherit;
	  border-bottom: 1px solid rgba(0,0,0,0.06);
	  font-family: monospace; /* use monospace to match editor */
	  pointer-events: none;
	  padding: 0.25rem 0 0.25rem 0.5rem; /* left padding aligns the inner content */
	  white-space: pre;
  }
  :global(.cm-editor-footer) {
	  background: rgba(0,0,0,0.03);
	  color: inherit;
	  border-top: 1px solid rgba(0,0,0,0.04);
	  font-family: monospace; /* use monospace to match editor */
	  pointer-events: none;
	  padding: 0.25rem 0 0.25rem 0.5rem; /* match header padding */
	  white-space: pre;
  }
</style>


