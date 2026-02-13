import { OPENAI_API_KEY, OPENAI_MODEL } from '$env/static/private';

/**
 * Server-side OpenAI helper.
 * - Reads the API key from the private env (OPENAI_API_KEY)
 * - Sends a Responses API request (text + optional image) and returns the assistant text
 */
export async function generateChanges(payload: any): Promise<string> {
  const key = OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
  }

  // Use a vision-capable model by default; allow override via env
  const model = OPENAI_MODEL ?? 'gpt-4.1';

  const columnNames = payload.columnNames ?? [];
  const columnNamesString = columnNames.join(', ');

  // Build the user prompt using the exact text provided by the user.
  const promptText = `Analyze the provided image. It is a sketch or image of a data visualization.
Determine (but do not output) the following about the visualization:

- What MARKS are present in the visualization? Marks are the basic shapes drawn in a vis, like a point or a line. A visualization may have more than one mark type.
- What VISUAL ENCODINGS are used in the visualization? A visual encoding is a mapping from a mark's visual property to a field in the data (like the mark's color, x,y position, etc.) Use the column names at the end of this prompt to aid in this inference.
- What LAYERS are present in the chart? A LAYER is a chart that superimposed on top of another chart.
- What TRANSFORMS have been performed? Transforms might be aggregations (like count, std, mean, sum), calculation of new fields, or other transformations, like computing a regression or a window transform.

Using these MARKS, VISUAL ENCODINGS, LAYERS, AND TRANSFORMS, generate corresponding valid Vega-Lite specs to generate the given visualization.

Respond with ONLY this Vega-Lite JSON specification.

Match the fields/axis titles to the closest match in these column names:
${columnNamesString}`;


  const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

  // Build the Responses API input content array
  const userContent: any[] = [{ type: 'input_text', text: promptText }];
  if (imageUrl) {
    // The Responses API supports data URLs (data:image/png;base64,...) or image URLs
    userContent.push({ type: 'input_image', image_url: imageUrl });
  }

  const body = {
    model,
    input: [
      {
        role: 'user',
        content: userContent
      }
    ]
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI Responses API error ${res.status}: ${txt}`);
  }

  const data = await res.json();

  // Try common places for textual output from Responses API
  if (typeof data.output_text === 'string' && data.output_text.length > 0) {
    return data.output_text;
  }

  // The `output` array can contain items with a `content` array; try to locate text there
  if (Array.isArray(data.output)) {
    for (const outItem of data.output) {
      if (!outItem || !Array.isArray(outItem.content)) continue;
      for (const c of outItem.content) {
        if (!c) continue;
        // Newer content items often have a `text` property
        if (typeof c.text === 'string' && c.text.length > 0) return c.text;
        // Some items may have type and text fields
        if (c.type === 'output_text' && typeof c.text === 'string') return c.text;
        // In some cases the content item might be a message-like object
        if (c.type === 'message' && typeof c.text === 'string') return c.text;
      }
    }
  }

  // Fallbacks: try a few other known fields
  if (Array.isArray(data.items) && data.items.length > 0) {
    const first = data.items[0];
    if (typeof first.text === 'string' && first.text.length > 0) return first.text;
  }

  // As a last resort return the raw JSON string (caller can parse if needed)
  return JSON.stringify(data);
}
