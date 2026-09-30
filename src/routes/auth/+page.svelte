<script lang="ts">
	import { supabase } from '$lib/supabase/client';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	let email = '';
	let submittedEmail = '';
	let loading = false;
	let errorMessage = page.url.searchParams.get('error') ?? '';
	let sent = false;
	const redirectTarget = page.url.searchParams.get('redirect')?.startsWith('/')
		? page.url.searchParams.get('redirect')
		: '/';

	onMount(() => {
		if (page.data.user) {
			window.location.replace('/');
		}
	});

	async function requestMagicLink() {
		errorMessage = '';
		loading = true;

		const { error } = await supabase.auth.signInWithOtp({
			email: email.trim(),
			options: {
				emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTarget ?? '/')}`
			}
		});

		loading = false;
		if (error) {
			errorMessage = error.message;
			return;
		}

		submittedEmail = email.trim();
		sent = true;
	}
</script>

<svelte:head>
	<title>Sign in - Sketch to Vis</title>
</svelte:head>

<main class="hero is-fullheight">
	<div class="hero-body">
		<div class="container" style="max-width: 28rem;">
			<div class="box">
				<h1 class="title">Sign in to Sketch to Vis</h1>
				{#if sent}
					<p class="mb-4">
						We sent a link to <strong>{submittedEmail}</strong>. Check your inbox to continue.
					</p>
					<button class="button is-light is-fullwidth" type="button" onclick={requestMagicLink} disabled={loading}>
						{loading ? 'Sending...' : 'Resend link'}
					</button>
				{:else}
					<p class="mb-4">Enter your email and we&apos;ll send you a password-free sign-in link.</p>
					<form onsubmit={(event) => { event.preventDefault(); requestMagicLink(); }}>
						<div class="field">
							<label class="label" for="email">Email</label>
							<div class="control">
								<input class="input" id="email" type="email" bind:value={email} required autocomplete="email" />
							</div>
						</div>
						<button class="button is-primary is-fullwidth" type="submit" disabled={loading}>
							{loading ? 'Sending...' : 'Email me a magic link'}
						</button>
					</form>
				{/if}
				{#if errorMessage}
					<p class="help is-danger mt-4">{errorMessage}</p>
				{/if}
			</div>
		</div>
	</div>
</main>
