<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import '../../app.css';
	const dispatch = createEventDispatcher();
	export let sending: boolean = false;
	export let message = '';

	function send() {
		if (sending) return;
		if (message.trim() === '') return;
		dispatch('send', message.trim());
		message = '';
	}
</script>

<div class="box" style="padding:0.4rem; border-top:1px solid #eee;">
	<div class="field has-addons">
		<div class="control is-expanded">
			<input class="input" type="text" placeholder="Ask the AI to modify the spec..." aria-label="Text input"
				   class:is-active={message.trim().length > 0}
				   bind:value={message}
				   on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!sending) send(); } }}
				   disabled={sending}
				   aria-busy={sending} />
		</div>
	</div>
</div>

<style>
	.input {
		transition: box-shadow 200ms ease, border-color 200ms ease;
	}

	.input:focus {
		border-color: lightgray;
		box-shadow: 0 0 0 1px lightgray;
	}

	.input.is-active {
		border-color: var(--color-apply-changes-dark);
		box-shadow:
				0 0 0 1px var(--color-apply-changes-dark),
				0 2px 4px 1px color-mix(in srgb, var(--color-apply-changes-dark) 45%, transparent),
				0 6px 12px 3px color-mix(in srgb, var(--color-apply-changes-light) 45%, transparent);
	}
</style>
