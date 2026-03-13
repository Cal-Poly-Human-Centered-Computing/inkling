import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { applyChanges } from '$lib/server/openai';

/**
 * Endpoint to apply the annotations the user has made to a rendered visualization, and return the updated Vega-Lite spec
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    // Prefer an explicit image URL field (support both `image` and `imageUrl` keys)
    let imageUrl: string | null = null;
    let currentSpec: string = '';
    let columnNames: string[] | null = null;
    let convId: number | null = null;
    if (body && typeof body === 'object') {
      imageUrl = (body as any).image ?? (body as any).imageUrl ?? null;
      currentSpec = body.currentSpec ?? '';
      columnNames = body.columnNames ?? null;
      convId = body.convId
    }

    const result = await applyChanges({ convId, image: imageUrl, currentSpec, columnNames });
    return json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
