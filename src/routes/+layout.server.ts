import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/**
 * Sends signed-out visitors to /auth, unless `DISABLE_AUTH=true` is set.
 * Auth stays wired up either way; the flag only skips the redirect.
 */
export const load = ({ locals, url }) => {
  const authRequired = env.DISABLE_AUTH !== 'true';
  if (authRequired && !url.pathname.startsWith('/auth') && !locals.user) {
    redirect(303, `/auth?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  }

  return { user: locals.user };
};
