import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { generateChanges } from '$lib/server/openai';
import { getColumnNames } from '$lib/utils/datasetStore';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    // Prefer an explicit image URL field (support both `image` and `imageUrl` keys)
    let imageUrl: string | null = null;
    let columnNames: string[] | null = null;
    if (body && typeof body === 'object') {
      imageUrl = (body as any).image ?? (body as any).imageUrl ?? null;
      columnNames = body.columnNames ?? null
    }

    // Forward only the image URL (or null) to the generateChanges helper
    const result = await generateChanges({ image: imageUrl, columnNames: columnNames });
    return json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
