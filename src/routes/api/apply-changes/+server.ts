import { json, type RequestHandler } from "@sveltejs/kit";
import {sketchToSpec, applyAnnotations, sendChat} from '$lib/server/app';

/**
 * Endpoint that receives all inputs and directs a model to
 * produce a Vega-Lite specification.
 *
 * Includes sketches, annotations, chat inputs, code editor contents, and data schema.
 * Until the refine pipeline exists, requests are routed to whichever pipeline handles them today.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    const image: string | null = body.image ?? null;
    const chatMessage: string | null = body.chatMessage?.trim() || null;
    const currentSpec: string = body.currentSpec ?? '';
    const columns = body.columns ?? [];
    const columnNames: string[] = body.columnNames ?? [];
    const renderedVis = Boolean(body.renderedVis);

    // The new pipeline, which takes every active input
    // No renderedVis means this is a first-turn input
    if (!renderedVis) {
      if (image || chatMessage) {
        // There is a sketch or chat message.
        const { spec, observations, errors } = await sketchToSpec({image, chatMessage, currentSpec, columns, columnNames});
        return json({ ok: true, result: spec, observations, errors });
      } else {
        // Don't do anything.
        // Shouldn't reach here through the web client, since
        // the Apply Changes button is disabled in this case.
        return json({ ok: false, error: 'Nothing to apply: no sketch, annotations, or chat message' }, { status: 400 });
      }
    }

    // Annotations on a rendered chart: the old pipeline, which can't take chat yet
    if (image) {
      if (chatMessage) {
        console.warn('[apply-changes] chat message ignored: the annotations pipeline does not take chat yet');
      }
      const result = await applyAnnotations({image, currentSpec, columnNames, columns});
      return json({ ok: true, result, observations: null, errors: [] });
    }

    // Chat (and code) only: the old chat pipeline, until refine exists
    if (chatMessage) {
      const result = await sendChat({currentSpec, chatMessage, columnNames, columns});
      return json({ ok: true, result, observations: null, errors: [] });
    }

    return json({ ok: false, error: 'Nothing to apply: no sketch, annotations or chat message' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }
}
