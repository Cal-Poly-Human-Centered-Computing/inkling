<script lang="ts">
	import Fa from 'svelte-fa';
	import { createEventDispatcher } from 'svelte';
	import {faRotateLeft} from "@fortawesome/free-solid-svg-icons/faRotateLeft";
	import {faCodeMerge} from "@fortawesome/free-solid-svg-icons/faCodeMerge";
	import {faSpinner} from "@fortawesome/free-solid-svg-icons/faSpinner";
	const dispatch = createEventDispatcher();

	export let canApply: boolean = false;
	export let canRollback: boolean = false;
	export let applying: boolean = false;

	function applyChanges() {
		if (applying) return; // guard
		dispatch('applyChanges');
	}

	function rollbackChanges() {
		dispatch('rollbackChanges');
	}

</script>

<!-- Container uses flex with center alignment so all buttons line up vertically -->
<div class="toolbar" style="display:flex; align-items:center; justify-content:end; padding:0.5rem;">
	<div>
		<button class="button rollback-button toolbar-button" aria-label="Rollback" on:click={rollbackChanges} disabled="{!canRollback}">
			<span class="icon toolbar-icon">
				<Fa icon={faRotateLeft} />
			</span>
			<span>Rollback</span>
		</button>
		<button class="button apply-changes-button toolbar-button" aria-label="Apply changes" on:click={applyChanges} disabled="{!canApply || applying}">
			<span class="icon toolbar-icon">
				{#if applying}
					<Fa icon={faSpinner} spin />
				{:else}
					<Fa icon={faCodeMerge} />
				{/if}
			</span>
			<span>{#if applying}Applying...{:else}Apply Changes{/if}</span>
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

	:global(.toolbar-icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
	}

	/* Slight transition for visual feedback */
	:global(.toolbar-button) {
		transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
	}

	.apply-changes-button {
		background-color: var(--color-apply-changes-dark);
		color: white;
	}

	.rollback-button {
		background-color: var(--color-rollback-changes);
	}
</style>
