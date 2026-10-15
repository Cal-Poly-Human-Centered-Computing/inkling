import { redirect, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const next = url.searchParams.get('next') ?? '/';

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			redirect(303, next.startsWith('/') ? next : '/');
		}
	}

	redirect(303, `/auth?error=${encodeURIComponent('This magic link is invalid or has expired. Please request a new one.')}`);
};
