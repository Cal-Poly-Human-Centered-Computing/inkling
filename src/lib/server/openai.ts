import { OPENAI_API_KEY, OPENAI_MODEL } from '$env/static/private';
import prompts from './prompts';

/**
 * Server-side OpenAI helper. Initializes the conversation with instructions on how to respond to different requests.
 */
export async function initialize(payload: any): Promise<number> {
  const key = OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
  }

  const body = {
    items: [
      {
        type: "message",
        role: "developer",
        content: [
          {
            type: "input_text",
            text: prompts.initialize
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

async function sendPrompt(convId: number, promptText: string, imageUrl?: any): Promise<string> {
  const key = OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
  }

  const model = OPENAI_MODEL ?? 'gpt-4.1';

  const userContent: any[] = [{ type: 'input_text', text: promptText }];

  if (imageUrl) {
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

  return data.output_text;
}

/**
 * Server-side OpenAI helper.
 * Given a sketch, generates corresponding specs from scratch (without an underlying vis already rendered)
 */
export async function sketchToSpec(payload: any): Promise<string> {

  const convId = payload.convId;

  // 1: Send the image to analyze

  const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

  const imageElements = sendPrompt(convId, prompts.analyzeSketchFromScratch, imageUrl);

  // 2: Send the elements to generate a Vega-Lite spec

  const initialSpec = sendPrompt(convId, `${prompts.elementsToVegaLite}\n\n${imageElements}`);

  // 3: Match fields to the column names

  const specWithColumns = sendPrompt(convId, `${prompts.matchColumnNames} ${payload.columnNames.join(", ")}\n\n${initialSpec}`);

  // 4: Validate the final spec

  const finalSpec = sendPrompt(convId, `${prompts.reviewFinalOutput}\n\n${specWithColumns}`);

  return finalSpec;
}

/**
 * Server-side OpenAI helper.
 * - Reads the API key from the private env (OPENAI_API_KEY)
 * - Sends a Responses API request (text + optional image) and returns the assistant text
 */
export async function applyAnnotations(payload: any): Promise<string> {

  const convId = payload.convId;

  const currentSpec = payload.currentSpec ?? '';

  const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

  // 1: Send the annotated sketch for analysis

  let promptText = `${prompts.analyzeAnnotatedSketch}\n\n${currentSpec}`;

  const instructions = sendPrompt(convId, promptText, imageUrl);

  // 2: Send the instructions for changes to apply

  promptText = `${prompts.applyInstructions}\n\n${currentSpec}\n\n${instructions}`;

  const updatedSpec = sendPrompt(convId, promptText, imageUrl);

  // 3: Match the fields to column names

  promptText = `${prompts.matchColumnNames} ${payload.columnNames.join(", ")}\n\n${updatedSpec}`

  const specWithColumns = sendPrompt(convId, promptText);

  // 4: Validate final spec

  promptText = `${prompts.reviewFinalOutput}\n\n${specWithColumns}`

  const finalSpec = sendPrompt(convId, promptText);

  return finalSpec;

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
