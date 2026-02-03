import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { generateChanges } from '$lib/server/openai';

export const POST: RequestHandler = async ({ request }) => {
  try {
    // We accept an empty object for now per the user's request
    const body = await request.json().catch(() => ({}));

    const result = await generateChanges(body);
    return json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
