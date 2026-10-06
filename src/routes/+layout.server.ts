import { redirect } from '@sveltejs/kit';

export const load = ({ locals, url }) => {
	if (!url.pathname.startsWith('/auth') && !locals.user) {
		redirect(303, `/auth?redirect=${encodeURIComponent(url.pathname + url.search)}`);
	}

	return { user: locals.user };
};
