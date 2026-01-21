<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';
	import { writable } from 'svelte/store';
	import Fa from 'svelte-fa';
	import { faUpload } from '@fortawesome/free-solid-svg-icons';

	export let code: string = '{\n  "$schema": "https://vega.github.io/schema/vega-lite/v5.json"\n}';
	const dispatch = createEventDispatcher();
	let editorContainer: HTMLDivElement | null = null;
	let textareaFallback: HTMLTextAreaElement | null = null;
	let editorMounted = false;

	const codeStore = writable(code);

	// modal state
	let showUploadModal = false;
	let selectedFile: File | null = null;
	let fileInputEl: HTMLInputElement | null = null;

	onMount(async () => {
		if (!editorContainer) return;
		// Dynamic imports to avoid SSR issues
		const stateModule: any = await import('@codemirror/state');
		const viewModule: any = await import('@codemirror/view');
		const jsonModule: any = await import('@codemirror/lang-json');

		const { EditorState } = stateModule;
		const { EditorView } = viewModule;
		const { json } = jsonModule;

		const state = EditorState.create({
			doc: code,
			extensions: [
				json(),
				EditorView.updateListener.of((v: any) => {
					if (v.docChanged) {
						const val = v.state.doc.toString();
						codeStore.set(val);
						dispatch('codeChange', val);
					}
				})
			]
		});

		new EditorView({
			state,
			parent: editorContainer
		});

		editorMounted = true;
	});

	function openUploadModal() {
		selectedFile = null;
		showUploadModal = true;
		// focus the input after the modal is visible
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

	let fallbackValue = code;
	function onFallbackInput(e: Event) {
		const t = e.target as HTMLTextAreaElement;
		fallbackValue = t.value;
		dispatch('codeChange', t.value);
	}
</script>

<div class="box" style="height:100%; display:flex; flex-direction:column;">
	<div class="field" style="flex:0 0 auto; display:flex; align-items:center; gap:0.5rem;">
		<button class="button is-light" aria-label="Upload sketch image" on:click={openUploadModal}>
			<span class="icon is-small"><Fa icon={faUpload} /></span>
		</button>
	</div>

	<div bind:this={editorContainer} class="content" style="flex:1 1 auto; min-height:0; border:1px solid #eaeaea;">
		{#if !editorMounted}
			<textarea bind:this={textareaFallback} class="textarea" bind:value={fallbackValue} on:input={onFallbackInput} aria-label="Vega-Lite editor fallback" style="height:100%; width:100%;"></textarea>
		{/if}
	</div>
</div>

<!-- Upload modal -->
{#if showUploadModal}
	<div class="modal is-active" role="dialog" aria-modal="true" aria-label="Upload sketch dialog">
		<div class="modal-background" on:click={cancelUpload}></div>
		<div class="modal-card">
			<header class="modal-card-head">
				<p class="modal-card-title">Upload sketch image</p>
				<button class="delete" aria-label="close" on:click={cancelUpload}></button>
			</header>
			<section class="modal-card-body">
				<div class="field">
					<label class="label">Choose image</label>
					<div class="control">
						<input bind:this={fileInputEl} class="input" type="file" accept="image/*" on:change={onFileChange} />
					</div>
					{#if selectedFile}
						<p class="help">Selected: {selectedFile.name}</p>
					{/if}
				</div>
			</section>
			<footer class="modal-card-foot">
				<button class="button is-info" on:click={confirmUpload} disabled={!selectedFile}>Upload</button>
				<button class="button" on:click={cancelUpload}>Cancel</button>
			</footer>
		</div>
	</div>
{/if}
