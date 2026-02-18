<script lang="ts">
	import Fa from 'svelte-fa';
	import {faUndo, faRedo, faPen, faFont, faEraser, faSync} from '@fortawesome/free-solid-svg-icons';
	import { createEventDispatcher } from 'svelte';
	import {faMousePointer} from "@fortawesome/free-solid-svg-icons/faMousePointer";
	import {faRotateLeft} from "@fortawesome/free-solid-svg-icons/faRotateLeft";
	const dispatch = createEventDispatcher();
	export let selected: 'pen' | 'textbox' | 'eraser' | 'selector' = 'pen';

	function select(t: 'pen' | 'textbox' | 'eraser' | 'selector') {
		selected = t;
		dispatch('selectTool', t);
	}

	function undo() {
		dispatch('undo');
	}

	function redo() {
		dispatch('redo');
	}
</script>

<!-- Container uses flex with center alignment so all buttons line up vertically -->
<div class="toolbar" style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem; width: 100%">
	<!-- Undo/Redo buttons on the left -->
	<div style="display:flex; align-items:center; gap:0.5rem;">
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
		</div>
	</div>

	<!-- Main tool buttons -->
	<div style="display:flex; align-items:center; gap:0.5rem;">
		<div class="buttons" role="toolbar" aria-label="Drawing tools" style="display:flex; align-items:center; gap:0.5rem;">
			<button class="button toolbar-button" on:click={() => select('selector')} aria-label="Selector tool" aria-pressed={selected === 'selector'} class:has-text-weight-bold={selected === 'selector'} class:tool-active={selected === 'selector'}>
				<span class="icon toolbar-icon">
					<Fa icon={faMousePointer} />
				</span>
			</button>
			<button class="button toolbar-button" on:click={() => select('pen')} aria-label="Pen tool" aria-pressed={selected === 'pen'} class:has-text-weight-bold={selected === 'pen'} class:tool-active={selected === 'pen'}>
				<span class="icon toolbar-icon">
					<Fa icon={faPen} />
				</span>
			</button>
			<button class="button toolbar-button" on:click={() => select('textbox')} aria-label="Textbox tool" aria-pressed={selected === 'textbox'} class:has-text-weight-bold={selected === 'textbox'} class:tool-active={selected === 'textbox'}>
				<span class="icon toolbar-icon">
					<Fa icon={faFont} />
				</span>
			</button>
			<button class="button toolbar-button" on:click={() => select('eraser')} aria-label="Eraser tool" aria-pressed={selected === 'eraser'} class:has-text-weight-bold={selected === 'eraser'} class:tool-active={selected === 'eraser'}>
				<span class="icon toolbar-icon">
					<Fa icon={faEraser} />
				</span>
			</button>
		</div>
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

	/* Theme-aware active tool styling */
	/* Light theme: use dark background for active so it remains visible */
	@media (prefers-color-scheme: light) {
		:global(.toolbar-button.tool-active) {
			background: #111 !important;
			color: #fff !important;
			border: 1px solid rgba(0,0,0,0.12) !important;
			box-shadow: 0 1px 2px rgba(0,0,0,0.06) inset;
		}
		:global(.toolbar-button.tool-active) .toolbar-icon { color: #fff; }
	}

	/* Dark theme: keep white inverted button as before */
	@media (prefers-color-scheme: dark) {
		:global(.toolbar-button.tool-active) {
			background: white !important;
			color: #111 !important;
			border: 1px solid rgba(0,0,0,0.08) !important;
			box-shadow: 0 1px 2px rgba(0,0,0,0.04) inset;
		}
		:global(.toolbar-button.tool-active) .toolbar-icon { color: #111; }
	}

	/* Slight transition for visual feedback */
	:global(.toolbar-button) {
		transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
	}
</style>
