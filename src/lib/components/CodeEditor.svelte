<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';
	import { writable } from 'svelte/store';

	export let code: string = '{\n  "$schema": "https://vega.github.io/schema/vega-lite/v5.json"\n}';
	const dispatch = createEventDispatcher();
	let editorContainer: HTMLDivElement | null = null;
	let textareaFallback: HTMLTextAreaElement | null = null;
	let editorMounted = false;

	const codeStore = writable(code);

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

	function onUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			dispatch('upload', input.files[0]);
		}
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
		<label class="button is-light" aria-label="Upload sketch image">
			<span class="icon is-small">
				<!-- upload icon -->
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 5 17 10"/><line x1="12" y1="5" x2="12" y2="19"/></svg>
			</span>
			<input type="file" accept="image/*" on:change={onUpload} style="display:inline-block; margin-left:0.5rem;" />
		</label>
		<p class="control"><strong>Vega-Lite Spec</strong></p>
	</div>

	<div bind:this={editorContainer} class="content" style="flex:1 1 auto; min-height:0; border:1px solid #eaeaea;">
		{#if !editorMounted}
			<textarea bind:this={textareaFallback} class="textarea" bind:value={fallbackValue} on:input={onFallbackInput} aria-label="Vega-Lite editor fallback" style="height:100%; width:100%;"></textarea>
		{/if}
	</div>
</div>
