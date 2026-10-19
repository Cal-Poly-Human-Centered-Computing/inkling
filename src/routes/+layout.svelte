<script lang="ts">
	import 'bulma/css/bulma.min.css';
	import favicon from '$lib/assets/favicon.svg';
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<slot />
