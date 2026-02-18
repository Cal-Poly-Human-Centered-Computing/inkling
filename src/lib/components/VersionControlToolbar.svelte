<script lang="ts">
	import Fa from 'svelte-fa';
	import {faSync} from '@fortawesome/free-solid-svg-icons';
	import { createEventDispatcher } from 'svelte';
	import {faRotateLeft} from "@fortawesome/free-solid-svg-icons/faRotateLeft";
	const dispatch = createEventDispatcher();

	function applyChanges() {
		dispatch('applyChanges');
	}

</script>

<!-- Container uses flex with center alignment so all buttons line up vertically -->
<div class="toolbar" style="display:flex; align-items:center; justify-content:end; padding:0.5rem;">
	<div>
		<button class="button is-warning toolbar-button" aria-label="Rollback">
			<span class="icon toolbar-icon">
				<Fa icon={faRotateLeft} />
			</span>
			<span>Rollback</span>
		</button>
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
</style>
