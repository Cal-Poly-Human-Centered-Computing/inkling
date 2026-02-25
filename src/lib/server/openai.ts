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

The application separately manages dataset and schema.
You must NOT generate, modify, or include the "data" or "schema" field in the output spec.
All field names used in encodings MUST exactly match one of the recorded COLUMN_NAMES.
You MUST NOT invent new field names.
If a requested field does not have a match in COLUMN_NAMES, ignore that portion of the request and preserve the existing spec structure.

MESSAGE TYPES:
    1. COLUMN_NAMES: col1, col2, ... EXAMPLE_ROW: {col1: val1, col2: val2, ...}
        - Record the column names as the authoritative dataset schema for the session.
        - Use the example row to help infer data types and possible values for the columns.
        - Do not output anything.

    2. VEGA_LITE_SPEC: <JSON> USER_MESSAGE: <text>
        - The user provides the current spec (may be empty) and instructions.
        - Understand the USER_MESSAGE intent and return a fully updated Vega-Lite JSON spec.
    
    3. VEGA_LITE_SPEC: <JSON> + image
        - If the spec is non-empty: treat it as canonical and modify it according to the image and USER_MESSAGE. Preserve unrelated structure.
        - If the spec is empty: generate a new complete Vega-Lite spec from scratch using the image and USER_MESSAGE.

IMAGE ANALYSIS (DO NOT OUTPUT THIS ANALYSIS):
    When an image is provided, internally determine:
        - What MARKS are present (point, bar, line, area, text, rule, etc.). There may be multiple mark types.
        - What VISUAL ENCODINGS are used (x, y, color, size, shape, opacity, tooltip, etc.). Use the recorded COLUMN_NAMES to infer likely field mappings.
        - What LAYERS are present (multiple charts superimposed).
        - What TRANSFORMS are implied (aggregate: sum/mean/count/etc., bin, calculate, filter, regression, window, stack, etc.).
    Using these inferred MARKS, ENCODINGS, LAYERS, and TRANSFORMS, generate a valid Vega-Lite spec that reproduces the visualization.
    If modifying an existing spec (VEGA_LITE_SPEC is not empty):
        - Apply the smallest set of changes necessary.
        - Do not reconstruct from scratch unless the provided spec is empty.
        - Preserve unrelated transforms, encodings, scales, and configuration.
        
USER_MESSAGE INTERPRETATION RULES:
    When processing USER_MESSAGE:
        Determine whether the request is:
            - A structural change (mark type, layering, adding/removing encodings)
            - A field change (mapping a different column to an encoding)
            - A transform change (aggregate, filter, bin, regression, window, stack)
            - A styling change (color, size, opacity, axis title, scale, legend)
            - A sorting or ordering change
            - An annotation or layering request
        Determine which columns the user is referring to, and match them to the closest value in COLUMN_NAMES. If no match exists for a referenced column, ignore that part of the request.
        Apply ONLY the smallest structural modification necessary.
        Do NOT rewrite the entire spec unless the original spec is empty.
        Preserve key ordering and overall structure where possible.
        If the instruction is ambiguous:
            - Choose the smallest reasonable interpretation.
            - Do not introduce additional complexity.

SPEC RULES:
    - Output a complete Vega-Lite spec (except for "schema" and "data" which must be omitted).
    - All fields used in encodings MUST exactly match one of the recorded COLUMN_NAMES.
         You MUST NOT invent new field names.
         If no suitable column exists, modify the spec without introducing new fields.
    - Prefer minimal, conservative assumptions when ambiguous.
    - Maintain structural validity (valid Vega-Lite JSON syntax).

OUTPUT RULES:
    - Output ONLY raw JSON.
    - No markdown, explanations, commentary, or surrounding text
    - The top-level object must be a valid Vega-Lite specification (excluding "data" and "schema").
    - If modification fails, return the original spec unchanged.

Operate under these rules for all subsequent messages in this conversation.`;

  const items = [
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

  const columnNames = payload.columnNames ?? [];
  const exampleRow = payload.exampleRow ?? null;
  if (columnNames.length) {
    const schemaText = `COLUMN_NAMES:\n${columnNames.join(', ')}\n\nEXAMPLE_ROW:\n${exampleRow ? JSON.stringify(exampleRow, null, "  ") : 'N/A'}`
    items.push({
      type: "message",
      role: "developer",
      content: [{
        type: "input_text",
        text: schemaText
      }]
    });
  }

  const body = {
    items
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
 * Sends the user's column names to the Responses API to be used as context for future image analysis and spec generation.
 * @param payload
 */
export async function uploadColumnNames(payload: any): Promise<boolean> {
  const key = OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
  }

  // Use a vision-capable model by default; allow override via env
  const model = OPENAI_MODEL ?? 'gpt-4.1';

  const convId = payload.convId;

  const columnNames = payload.columnNames ?? [];
  const columnNamesString = columnNames.join(', ');

  const exampleRow = payload.exampleRow ?? null;

  const body = {
    model,
    conversation: convId,
    input: [
      {
        role: 'user',
        content: [
            { type: 'input_text', text: `COLUMN_NAMES:\n${columnNamesString}\n\nEXAMPLE_ROW:\n${exampleRow ? JSON.stringify(exampleRow, null, "  ") : 'N/A'}` }
        ]
      }
    ]
  };

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });

    return res.ok;
  } catch {
    return false;
  }
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

  // Build the Responses API input content array
  const userContent: any[] = [{ type: 'input_text', text: "VEGA_LITE_SPEC:\n" + currentSpec }];
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

  // Build the Responses API input content array
  const userContent: any[] = [{ type: 'input_text', text: "VEGA_LITE_SPEC:\n" + currentSpec + "\n\nUSER_MESSAGE:\n" + chatMessage }];

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
