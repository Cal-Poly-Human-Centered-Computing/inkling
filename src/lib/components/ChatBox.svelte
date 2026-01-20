<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	const dispatch = createEventDispatcher();
	let message = '';

	function send() {
		if (message.trim() === '') return;
		dispatch('send', message.trim());
		message = '';
	}
</script>

<div class="box" style="padding:0.75rem; border-top:1px solid #eee;">
	<div class="field has-addons">
		<div class="control is-expanded">
			<input class="input" type="text" placeholder="Ask the AI to modify the spec or sketch..." bind:value={message} aria-label="Chat input" on:keydown={(e) => e.key === 'Enter' && send()} />
		</div>
		<div class="control">
			<button class="button is-info" aria-label="Send message" on:click={send}>
				<span class="icon">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
				</span>
			</button>
		</div>
	</div>
</div>
