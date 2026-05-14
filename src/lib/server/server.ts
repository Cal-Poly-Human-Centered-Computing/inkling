import {CLAUDE_API_KEY, OPENAI_API_KEY, OPENAI_MODEL, CLAUDE_MODEL} from '$env/static/private';
import prompts from './prompts';
import OpenAI from "openai";
import type {ResponseInput, ResponseInputMessageContentList} from "openai/resources/responses/responses";
import {Anthropic} from "@anthropic-ai/sdk";

if (!OPENAI_API_KEY) {
  throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
}
const openAI = new OpenAI({ apiKey: OPENAI_API_KEY });

if (!CLAUDE_API_KEY) {
  throw new Error('Claude API key not configured. Set CLAUDE_API_KEY in your private environment.');
}
const claude = new Anthropic({ apiKey: CLAUDE_API_KEY });

// Choose which API to use: "openai" or "claude"
const api = "claude";

/**
 * Server-side OpenAI helper. Initializes the conversation with instructions on how to respond to different requests.
 */
// export async function initialize(payload: any): Promise<number> {
//
//   const body = {
//     items: [
//       {
//         type: "message",
//         role: "developer",
//         content: [
//           {
//             type: "input_text",
//             text: prompts.initialize
//           }
//         ]
//       }
//     ]
//   };
//
//   const res = await fetch("https://api.openai.com/v1/conversations", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: `Bearer ${key}`
//     },
//     body: JSON.stringify(body)
//   });
//
//   if (!res.ok) throw new Error(await res.text());
//   const conversation = await res.json();
//   return conversation.id;
//
// }

async function sendOpenAIPrompt(promptText: string, opts: { inputText?: string; imageUrl?: any }): Promise<string> {
  const { inputText, imageUrl } = opts;

  console.log(promptText);
  console.log(inputText);

  // Give the instructions using the developer role
  let input: ResponseInput = [
    {
      role: "developer",
      content: prompts.system
    }
  ];

  // Give the input using the user role
  let userContent: ResponseInputMessageContentList = []

  if (inputText) {
    userContent.push({
      type: "input_text", text: `${promptText}\n\n${inputText}`,
    })
  }

  if (imageUrl) {
    userContent.push({
      type: "input_image",
      image_url: imageUrl,
      detail: "auto"
    })
  }

  input.push({
    role: "user",
    content: userContent
  })

  const res = await openAI.responses.create({
    model: OPENAI_MODEL,
    input: input,
  })

  return res.output_text;
}

// For some reason the OpenAI API can handle the raw image URL, but the Claude API needs it without the prefix
function extractBase64(dataUrl: string | null): string | null {
  if (!dataUrl) return null;
  if (typeof dataUrl !== 'string') return null;
  // strip data:image/...;base64, prefix if present
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (match) return match[2];
  // if it already looks like base64, return it
  const maybe = dataUrl.trim();
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(maybe)) return maybe.replace(/\r?\n/g, '');
  return null;
}

async function sendClaudePrompt(promptText: string, opts: { inputText?: string; imageUrl?: any }): Promise<string> {
  const { inputText, imageUrl } = opts;

  console.log(promptText);
  console.log(inputText);

  const base64 = extractBase64(imageUrl);
  if (imageUrl && !base64) {
    console.warn('[Claude] imageUrl present but could not normalize to base64; not sending image.');
  }

  let messages: any[] = [];

  // Give the input using the user role
  let userContent: any[] = []

  if (imageUrl) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: base64
      }
    })
  }

  if (inputText) {
    userContent.push({
      type: "text",
      text: inputText
    })
  }

  messages.push({
    role: "user",
    content: userContent
  })

  const res: any = await claude.messages.create({
    model: CLAUDE_MODEL,
    system: promptText,
    max_tokens: 1024,
    messages: messages,
  })

  return res.content[0].text;
}

async function sendPrompt(promptText: string, opts: { inputText?: string; imageUrl?: any }): Promise<string> {
    if (api === "claude") {
      return await sendClaudePrompt(promptText, opts);
    } else {
      return await sendOpenAIPrompt(promptText, opts);
    }
}

async function analyzeSketchFromScratch(imageUrl: string) {
  let promptText = prompts.analyzeSketchFromScratch;

  const imageElements = await sendPrompt(promptText, {imageUrl});

  return imageElements;
}

async function elementsToVegaLite(imageElements: string) {
  let promptText = prompts.elementsToVegaLite

  const initialSpec = await sendPrompt(promptText, {inputText: imageElements});

  return initialSpec;
}

async function matchColumnNames(columnNames: string[], initialSpec: string) {
  let promptText = prompts.matchColumnNames

  let inputText = `COLUMN_NAMES: ${columnNames.join(", ")}\n\n${initialSpec}`

  const specWithColumns = await sendPrompt(promptText, {inputText});

  return specWithColumns;
}

async function reviewFinalOutput(spec: string) {
  let promptText = prompts.reviewFinalOutput;

  let inputText = spec;

  const finalSpec = await sendPrompt(promptText, {inputText});

  return finalSpec;
}

async function analyzeAnnotatedSketch(currentSpec: string, imageUrl: string) {
  let promptText = prompts.analyzeAnnotatedSketch;

  let inputText = `CURRENT_VEGA_LITE_SPEC:\n${currentSpec}`

  const instructions = await sendPrompt(promptText, {inputText, imageUrl});

  return instructions;
}

async function applyInstructions(currentSpec: string, instructions: string) {
  let promptText = prompts.applyInstructions;

  let inputText = `CURRENT_VEGA_LITE_SPEC:\n${currentSpec}\n\nINSTRUCTIONS:\n${instructions}`

  const updatedSpec = await sendPrompt(promptText, {inputText});

  return updatedSpec;
}

async function interpretInstructions(currentSpec: string, chatMessage: string) {
  let promptText = prompts.interpretInstructions;

  let inputText = `CURRENT_VEGA_LITE_SPEC:\n${currentSpec}\n\nUSER_MESSAGE:\n${chatMessage}`;

  const instructions = await sendPrompt(promptText, {inputText});

  return instructions;
}

/**
 * Server-side helper.
 * Given a sketch, generates corresponding specs from scratch (without an underlying vis already rendered)
 */
export async function sketchToSpec(payload: any): Promise<string> {

  // 1: Send the image to analyze

  const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

  const imageElements = await analyzeSketchFromScratch(imageUrl);

  // 2: Send the elements to generate a Vega-Lite spec

  const initialSpec = await elementsToVegaLite(imageElements);

  // 3: Match fields to the column names

  const specWithColumns = await matchColumnNames(payload.columnNames, initialSpec);

  // 4: Validate the final spec

  const finalSpec = await reviewFinalOutput(specWithColumns);

  return finalSpec;
}

/**
 * Server-side helper.
 * Given a Vega-Lite spec and annotated visualization, returns corresponding code
 */
export async function applyAnnotations(payload: any): Promise<string> {

  const currentSpec = payload.currentSpec ?? '';

  const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

  // 1: Send the annotated sketch for analysis

  const instructions = await analyzeAnnotatedSketch(currentSpec, imageUrl);

  // 2: Translate the instructions into specific changes to the Vega-Lite spec

  const changesToMake = await interpretInstructions(currentSpec, instructions);

  // 3: Apply the changes to the spec

  const updatedSpec = await applyInstructions(currentSpec, changesToMake);

  // 4: Match the fields to column names

  const specWithColumns = await matchColumnNames(payload.columnNames, updatedSpec);

  // 5: Validate final spec

  const finalSpec = await reviewFinalOutput(specWithColumns);

  return finalSpec;

}


/**
 * Server-side OpenAI helper.
 * Given a Vega-Lite spec and a user message, returns a corresponding spec applying the user's message
 */
export async function sendChat(payload: any): Promise<string> {

  const currentSpec = payload.currentSpec;
  const chatMessage = payload.chatMessage;

  // 1: Turn the user message into specific instructions

  const instructions = await interpretInstructions(currentSpec, chatMessage);

  // 2: Send the instructions for changes to apply

  const updatedSpec = await applyInstructions(currentSpec, instructions);

  // 3: Match the fields to column names

  const specWithColumns = await matchColumnNames(payload.columnNames, updatedSpec);

  // 4: Validate final spec

  const finalSpec = await reviewFinalOutput(specWithColumns);

  return finalSpec;

}
