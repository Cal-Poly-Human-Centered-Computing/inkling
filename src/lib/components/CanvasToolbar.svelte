<script lang="ts">
	import Fa from 'svelte-fa';
	import {faUndo, faRedo, faPen, faFont} from '@fortawesome/free-solid-svg-icons';
	import { createEventDispatcher } from 'svelte';
	import {faMousePointer} from "@fortawesome/free-solid-svg-icons/faMousePointer";
	import {faTrashCan} from "@fortawesome/free-solid-svg-icons/faTrashCan";
	import {faHand} from "@fortawesome/free-solid-svg-icons/faHand";

	const dispatch = createEventDispatcher();
	export let selected: 'pen' | 'textbox' | 'selector' | 'hand' = 'pen';

	export let brushColor: string = '#000000';
	export let brushWidth: number = 7;

	export let enableDelete: boolean = false;
	export let disableUndo: boolean = true;
	export let disableRedo: boolean = true;

	function select(t: 'pen' | 'textbox' | 'selector' | 'hand') {
		selected = t;
		dispatch('selectTool', t);
	}

	function deleteSelectedObject() {
		dispatch('delete');
	}

	function undo() {
		dispatch('undo');
	}

	function redo() {
		dispatch('redo');
	}
</script>

<div class="toolbar" style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem; width: 100%">
	<!-- Undo/Redo buttons on the left -->
	<div style="display:flex; align-items:center; gap:0.5rem;">
		<div class="buttons" role="toolbar" aria-label="Drawing tools" style="display:flex; align-items:center; gap:0.5rem;">
			<button class="button toolbar-button square is-small"
					on:click={undo}
					aria-label="Undo"
					disabled={disableUndo}>
				<span class="icon toolbar-icon">
					<Fa icon={faUndo} />
				</span>
			</button>
			<button class="button toolbar-button square is-small"
					on:click={redo}
					aria-label="Redo"
					disabled={disableRedo}>
				<span class="icon toolbar-icon">
					<Fa icon={faRedo} />
				</span>
			</button>
		</div>
	</div>

	<!-- Main tool buttons -->
	<div style="display:flex; align-items:center; gap:0.5rem;">
		<div class="buttons" role="toolbar" aria-label="Drawing tools" style="display:flex; align-items:center; gap:0.5rem;">
			<button class="button toolbar-button" on:click={() => select('hand')} aria-label="Hand tool" aria-pressed={selected === 'hand'} class:has-text-weight-bold={selected === 'hand'} class:tool-active={selected === 'hand'}>
				<span class="icon toolbar-icon">
					<Fa icon={faHand} />
				</span>
			</button>
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
				<!-- Keep the button in the DOM so other buttons keep their positions; hide/disable it when no selection -->
				<button
					class="button toolbar-button"
					on:click={deleteSelectedObject}
					aria-label="Delete"
					disabled={!enableDelete}
					aria-hidden={!enableDelete}
					aria-disabled={!enableDelete}
					tabindex={enableDelete ? 0 : -1}
					class:invisible={!enableDelete}
				>
					<span class="icon toolbar-icon">
						<Fa icon={faTrashCan} />
					</span>
				</button>
		</div>
	</div>

	<!-- Brush controls: color and size -->
	<div style="display:flex; align-items:center; gap:8px; padding-left:8px;"
	     class:invisible={selected !== 'pen'} aria-hidden={selected !== 'pen'} aria-disabled={selected !== 'pen'}>
		<label for="brush-color" style="font-size:12px; color:var(--bulma-text);">Color</label>
		<input id="brush-color" type="color" bind:value={brushColor} aria-label="Brush color" />
		<label for="brush-size" style="font-size:12px; color:var(--bulma-text); padding-left:6px;">Size</label>
		<input id="brush-size" type="range" min="1" max="20" bind:value={brushWidth} aria-label="Brush size" />
	</div>
</div>

<style>
	:global(.toolbar-button) {
		display: inline-flex !important;
		align-items: center !important;
		justify-content: center !important;
		/* let normal buttons size naturally */
		padding: 0 0.6rem !important;
		height: 36px !important;
		border-radius: 6px !important;
	}

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

	@media (prefers-color-scheme: light) {
		:global(.toolbar-button.tool-active) {
			background: #111 !important;
			color: #fff !important;
			border: 1px solid rgba(0,0,0,0.12) !important;
			box-shadow: 0 1px 2px rgba(0,0,0,0.06) inset;
		}
		:global(.toolbar-button.tool-active) .toolbar-icon { color: #fff; }
	}

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

	/* When the delete button is not enabled, keep its space but hide it visually */
	:global(.toolbar-button.invisible) {
		visibility: hidden;
		pointer-events: none;
	}

	:global(.invisible) {
		visibility: hidden;
		pointer-events: none;
	}
</style>
