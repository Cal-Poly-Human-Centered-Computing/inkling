<script lang="ts">
	import Fa from 'svelte-fa';
	import { faUndo, faRedo, faPen, faFont, faEraser, faSync } from '@fortawesome/free-solid-svg-icons';
	import { createEventDispatcher } from 'svelte';
	const dispatch = createEventDispatcher();
	export let selected: 'pen' | 'textbox' | 'eraser' = 'pen';
	let active: 'pen' | 'textbox' | 'eraser' = selected;

	$: if (selected && selected !== active) active = selected;

	function select(t: 'pen' | 'textbox' | 'eraser') {
		active = t;
		dispatch('selectTool', t);
	}

	function applyChanges() {
		dispatch('applyChanges');
	}

	function undo() {
		dispatch('undo');
	}

	function redo() {
		dispatch('redo');
	}
</script>

<!-- Container uses flex with center alignment so all buttons line up vertically -->
<div class="toolbar" style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem;">
	<div style="display:flex; align-items:center; gap:0.5rem;">

		<!-- Main tool buttons -->
		<div class="buttons" role="toolbar" aria-label="Drawing tools" style="display:flex; align-items:center; gap:0.5rem;">
			<button class="button toolbar-button square is-small" on:click={undo} aria-label="Undo">
				<span class="icon toolbar-icon">
					<Fa icon={faUndo} />
				</span>
			</button>
			<button class="button toolbar-button square is-small" on:click={redo} aria-label="Redo">
				<span class="icon toolbar-icon">
					<Fa icon={faRedo} />
				</span>
			</button>
			<button class="button toolbar-button" on:click={() => select('pen')} aria-label="Pen tool" aria-pressed={active === 'pen'} class:has-text-weight-bold={active === 'pen'}>
				<span class="icon toolbar-icon">
					<Fa icon={faPen} />
				</span>
				<span>Pen</span>
			</button>
			<button class="button toolbar-button" on:click={() => select('textbox')} aria-label="Textbox tool" aria-pressed={active === 'textbox'} class:has-text-weight-bold={active === 'textbox'}>
				<span class="icon toolbar-icon">
					<Fa icon={faFont} />
				</span>
				<span>Textbox</span>
			</button>
			<!-- Eraser button immediately to the right of Textbox -->
			<button class="button toolbar-button" on:click={() => select('eraser')} aria-label="Eraser tool" aria-pressed={active === 'eraser'} class:has-text-weight-bold={active === 'eraser'}>
				<span class="icon toolbar-icon">
					<Fa icon={faEraser} />
				</span>
				<span>Eraser</span>
			</button>
		</div>
	</div>

	<div>
		<button class="button is-info toolbar-button" aria-label="Apply changes" on:click={applyChanges}>
			<span class="icon toolbar-icon">
				<Fa icon={faSync} />
			</span>
			<span>Apply Changes</span>
		</button>
	</div>
</div>

<style>
	/* Ensure toolbar buttons align vertically; default buttons are not force-square */
	:global(.toolbar-button) {
		display: inline-flex !important;
		align-items: center !important;
		justify-content: center !important;
		/* let normal buttons size naturally */
		padding: 0 0.6rem !important;
		height: 36px !important;
		border-radius: 6px !important;
	}

	/* Square variant used for undo/redo */
	:global(.toolbar-button.square) {
		width: 36px !important;
		height: 36px !important;
		padding: 0 !important;
	}

	:global(.toolbar-button span) {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		height: 36px;
	}

	:global(.toolbar-icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
	}
</style>
