import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import {sendChat} from '$lib/server/app';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    let currentSpec = body.currentSpec ?? '';
    let chatMessage = body.chatMessage;
    let columnNames = body.columnNames ?? null;
    let columns = body.columns ?? null;

    const payload = { currentSpec, chatMessage, columnNames, columns };

    const result = await sendChat(payload);
    return json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
