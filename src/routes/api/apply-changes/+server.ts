import { json, type RequestHandler } from '@sveltejs/kit';
import { fromScratch, refine } from '$lib/server/app';

/**
 * Endpoint that receives all inputs and directs a model to
 * produce a Vega-Lite specification.
 *
 * Includes sketches, annotations, chat inputs, code editor contents, and data schema.
 * No rendered chart (blank canvas or invalid spec): fromScratch. Rendered chart: refine.
 * Each pipeline picks its prompt by whether there's an image (sketch or annotations).
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    const image: string | null = body.image ?? null;
    const chatMessage: string | null = body.chatMessage?.trim() || null;
    const currentSpec: string = body.currentSpec ?? '';
    const columns = body.columns ?? [];
    const renderedVis = Boolean(body.renderedVis);

    // Shouldn't happen through the web client, since the Apply Changes button is disabled in this case
    if (!image && !chatMessage) {
      return json(
        { ok: false, error: 'Nothing to apply: no sketch, annotations or chat message' },
        { status: 400 }
      );
    }

    const pipeline = renderedVis ? refine : fromScratch;
    const { spec, observations, errors } = await pipeline({
      image,
      chatMessage,
      currentSpec,
      columns
    });
    return json({ ok: true, result: spec, observations, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
