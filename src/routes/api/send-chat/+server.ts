import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import {generateChanges, sendChat} from '$lib/server/openai';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    let currentSpec = body.currentSpec ?? '';
    let chatMessage = body.chatMessage;

    const result = await sendChat({ currentSpec, chatMessage });
    return json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
