import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import {sketchToSpec} from '$lib/server/app';

/**
 * Endpoint to convert a sketch to Vega-Lite from scratch (no rendered visualization present)
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    // Prefer an explicit image URL field (support both `image` and `imageUrl` keys)
    let imageUrl: string | null = null;
    let columnNames: string[] | null = null;
    let columns = null;
    if (body && typeof body === 'object') {
      imageUrl = (body as any).image ?? (body as any).imageUrl ?? null;
      columnNames = body.columnNames ?? null;
      columns = body.columns ?? null;
    }

    const payload = { image: imageUrl, columnNames, columns };

    const result = await sketchToSpec(payload);
    return json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
