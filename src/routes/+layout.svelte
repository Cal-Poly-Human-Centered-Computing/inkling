<script lang="ts">
	import 'bulma/css/bulma.min.css';
	import favicon from '$lib/assets/favicon.svg';
	import {onMount} from "svelte";
	import { conversationId as convIdStore } from '$lib/stores/conversationId';
	import {getColumnNames, getFirstRow} from "$lib/utils/datasetStore";

	onMount(async () => {
		// const res = await fetch('/api/initialize', {
		// 	method: 'POST',
		// 	headers: { 'Content-Type': 'application/json' },
		// 	body: JSON.stringify({ columnNames: getColumnNames(), exampleRow: getFirstRow() })
		// });
		//
		// if (!res.ok) throw new Error('Conversation init failed');
		// const jsonResp = await res.json();
		// if (!jsonResp.ok) {
		// 	console.error('Init error:', jsonResp.error);
		// 	return;
		// }
		//
		// const convId = jsonResp.result;
		// convIdStore.set(convId)

	})
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<slot />
