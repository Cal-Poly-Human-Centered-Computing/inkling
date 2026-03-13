import { OPENAI_API_KEY, OPENAI_MODEL } from '$env/static/private';

/**
 * Server-side OpenAI helper. Initializes the conversation with instructions on how to respond to different requests.
 */
export async function initialize(payload: any): Promise<number> {
  const key = OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
  }

  const promptText = `You are a Vega-Lite expert assistant. Your job is to generate or update valid Vega-Lite JSON specifications based on structured user messages and images.
Output ONLY raw JSON Vega-Lite specifications, without any markdown, explanations, or commentary.
The application separately manages dataset and schema; you must NOT generate, modify, or include the "data" or "schema" field in the output spec.
All field names used in encodings MUST exactly match one of the COLUMN_NAMES which will be provided. You MUST NOT invent new field names.
If a requested field does not have a match in COLUMN_NAMES, ignore that portion of the request and preserve the existing spec structure.`;

  const body = {
    items: [
      {
        type: "message",
        role: "developer",
        content: [
          {
            type: "input_text",
            text: promptText
          }
        ]
      }
    ]
  };

  const res = await fetch("https://api.openai.com/v1/conversations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(await res.text());
  const conversation = await res.json();
  return conversation.id;

}

/**
 * Server-side OpenAI helper.
 * Given a sketch, generates corresponding specs from scratch (without an underlying vis already rendered)
 */
export async function sketchToSpec(payload: any): Promise<string> {
  const key = OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
  }

  // Use a vision-capable model by default; allow override via env
  const model = OPENAI_MODEL ?? 'gpt-4.1';

  const convId = payload.convId;

  const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

  const promptText = `The attached image is a sketch of a data visualization. Your task is to generate a Vega-Lite spec that will reproduce the visualization.
  
    Analyze the image and internally determine:
        - What MARKS are present (point, bar, line, area, text, rule, etc.). There may be multiple mark types.
        - What VISUAL ENCODINGS are used (x, y, color, size, shape, opacity, tooltip, etc.). Use the COLUMN_NAMES below to infer likely field mappings.
        - What LAYERS are present (multiple charts superimposed).
        - What TRANSFORMS are implied (aggregate: sum/mean/count/etc., bin, calculate, filter, regression, window, stack, etc.).
    Using these inferred MARKS, ENCODINGS, LAYERS, and TRANSFORMS, generate the simplest possible corresponding Vega-Lite spec to reproduce the visualization.
    
    Respond with ONLY raw JSON, omitting the "data" and "schema" elements (those are handled separately). No markdown, explanations, commentary, or surrounding text. 
    The top-level object must be a valid Vega-Lite specification (excluding "data" and "schema"). 
    Never invent field names; only use values from COLUMN_NAMES below.
    
    COLUMN_NAMES: ${payload.columnNames.length ? payload.columnNames.join(', ') : 'N/A'}
  `

  // Build the Responses API input content array
  const userContent: any[] = [{ type: 'input_text', text: promptText }];
  if (imageUrl) {
    // The Responses API supports data URLs (data:image/png;base64,...) or image URLs
    userContent.push({ type: 'input_image', image_url: imageUrl });
  }

  const body = {
    model,
    conversation: convId,
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

/**
 * Server-side OpenAI helper.
 * - Reads the API key from the private env (OPENAI_API_KEY)
 * - Sends a Responses API request (text + optional image) and returns the assistant text
 */
export async function applyChanges(payload: any): Promise<string> {
  const key = OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
  }

  // Use a vision-capable model by default; allow override via env
  const model = OPENAI_MODEL ?? 'gpt-4.1';

  const convId = payload.convId;

  const currentSpec = payload.currentSpec ?? '';

  const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

  const promptText = `You will update an existing Vega-Lite specification based on annotations that the user drew on top of a rendered sketch of that spec.

OVERVIEW:
- The attached image shows the CURRENT_VEGA_LITE_SPEC rendering plus the user's annotations (pen strokes and/or typed text).
- Treat CURRENT_VEGA_LITE_SPEC as canonical. Only change fields that the annotations clearly instruct.
- Respond with ONLY raw JSON (no markdown/text) and omit "data" and "$schema"/"schema". The top-level object must be a valid Vega-Lite spec (excluding "data" and "schema").

INPUTS:
COLUMN_NAMES: ${payload.columnNames.length ? payload.columnNames.join(", ") : "N/A"}
CURRENT_VEGA_LITE_SPEC:
${currentSpec}
USER_ANNOTATION_IMAGE: (attached)

DETERMINE USER INTENT FROM IMAGE:
- Internally detect added/edited visual elements present in the image but not present in CURRENT_VEGA_LITE_SPEC.
- Do NOT assume the user changed a property unless the annotation explicitly indicates it.
- If the annotation is ambiguous, prefer making the smallest change that could implement it (see EDITING RULES).

EDITING RULES:
- Do NOT regenerate or replace the whole spec. Do NOT reset values that exist in CURRENT_VEGA_LITE_SPEC unless the annotation **explicitly** indicates that those fields should change.
- Any encoding/transform/filter/calculate that references a field MUST exactly match one of COLUMN_NAMES. Never invent new field names.
- If a property exists and the annotation implies a change, edit that property. If it doesn't exist, add it in the smallest scope consistent with Vega-Lite semantics.
- Do NOT add or modify keys that specify pixel positions (x/y coordinates of title/legend) unless the user explicitly annotated exact placements.

PROCESS (how to implement edits):
- Compare CURRENT_VEGA_LITE_SPEC -> produce a minimal patch:
  1. Compute set of changed visual intents from the image (title, new mark, aggregate line, legend change, etc).
  2. For each intent, edit the *smallest* relevant key(s) only.
  3. If you introduce layers/transforms to add something new, move the existing top-level view down into the layers to avoid duplicating code. When possible hoist shared encodings (e.g., \`x\` field/type) to top-level \`encoding\`.
- Preserve unrelated blocks (transforms, filters, existing scales/config) exactly as they appear unless annotation targets them.

FINAL CHECKS (must pass):
- Do NOT invent new field names and only use COLUMN_NAMES for data fields.
- Do NOT output invalid JSON.
- If you cannot confidently apply the annotation without violating constraints, return CURRENT_VEGA_LITE_SPEC unchanged.
`

  // Build the Responses API input content array
  const userContent: any[] = [{ type: 'input_text', text: promptText }];
  if (imageUrl) {
    // The Responses API supports data URLs (data:image/png;base64,...) or image URLs
    userContent.push({ type: 'input_image', image_url: imageUrl });
  }

  const body = {
    model,
    conversation: convId,
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


/**
 * Server-side OpenAI helper.
 * - Reads the API key from the private env (OPENAI_API_KEY)
 * - Sends a Responses API request (text + optional image) and returns the assistant text
 */
export async function sendChat(payload: any): Promise<string> {
  const key = OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
  }

  // Use a vision-capable model by default; allow override via env
  const model = OPENAI_MODEL ?? 'gpt-4.1';

  const convId = payload.convId;

  const currentSpec = payload.currentSpec;
  const chatMessage = payload.chatMessage;

  const promptText = `You will update a Vega-Lite specification based on the user's instructions.

HARD CONSTRAINTS (must follow):
- Output ONLY raw JSON (no markdown or text).
- Do NOT include "data" or "$schema"/"schema" in the output.
- You MUST NOT invent new field names.
- Any field used anywhere (encoding/transform/filter/calculate/etc.) MUST exactly match one of COLUMN_NAMES.
- If you cannot satisfy the request without using a non-existent field, return CURRENT_VEGA_LITE_SPEC unchanged.

INPUTS:
COLUMN_NAMES: ${payload.columnNames?.length ? payload.columnNames.join(", ") : "N/A"}

CURRENT_VEGA_LITE_SPEC:
${currentSpec}

USER_MESSAGE:
${chatMessage}

TASK:
- If CURRENT_VEGA_LITE_SPEC is EMPTY ({} or contains only "data"/"$schema"), generate a new complete Vega-Lite spec that satisfies USER_MESSAGE using only COLUMN_NAMES (and omitting "data" and schema keys).
- Otherwise, treat CURRENT_VEGA_LITE_SPEC as canonical and modify it to implement USER_MESSAGE.

EDITING RULES (for non-empty specs):
- Apply the smallest possible structural change that satisfies USER_MESSAGE.
- Preserve unrelated transforms/encodings/scales/config as much as possible. Do NOT apply any unnecessary changes that were not specified by the user.
- Prefer editing existing properties over introducing new layers/transforms.
- If you introduce layers/transforms/concatenation to add something new, move the existing top-level view down into the layers to avoid duplicating code.
- If USER_MESSAGE is ambiguous, choose the smallest change and do not add complexity.

OUTPUT:
Return ONLY the updated Vega-Lite JSON spec (raw JSON).`;


  // Build the Responses API input content array
  const userContent: any[] = [{ type: 'input_text', text: promptText }];

  const body = {
    model,
    conversation: convId,
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
