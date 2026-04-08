import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import {sketchToSpec} from '$lib/server/openai';

/**
 * Endpoint to convert a sketch to Vega-Lite from scratch (no rendered visualization present)
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    // Prefer an explicit image URL field (support both `image` and `imageUrl` keys)
    let imageUrl: string | null = null;
    let columnNames: string[] | null = null;
    if (body && typeof body === 'object') {
      imageUrl = (body as any).image ?? (body as any).imageUrl ?? null;
      columnNames = body.columnNames ?? null;
    }

    const result = await sketchToSpec({ image: imageUrl, columnNames });
    return json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
