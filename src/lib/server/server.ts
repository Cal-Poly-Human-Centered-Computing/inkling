import {CLAUDE_API_KEY, ANTHROPIC_WORKSPACE_ID, CLAUDE_MODEL, OPENAI_API_KEY, } from '$env/static/private';
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
const claude = new Anthropic({
  apiKey: CLAUDE_API_KEY,
  defaultHeaders: {
    "anthropic-workspace-id": ANTHROPIC_WORKSPACE_ID
  } });

// Choose which API to use: "openai" or "claude"
const api = "claude";

async function sendOpenAIPrompt(opts: { inputText?: string; imageUrl?: any }): Promise<string> {
  const { inputText, imageUrl } = opts;

  console.log(inputText);

  // Give the instructions using the developer role
  let input: ResponseInput = [
    {
      role: "developer",
      content: prompts.systemPrompt
    }
  ];

  // Give the input using the user role
  let userContent: ResponseInputMessageContentList = []

  if (inputText) {
    userContent.push({
      type: "input_text", text: inputText
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

async function sendClaudePrompt(opts: { inputText?: string; imageUrl?: any }): Promise<any> {
  const { inputText, imageUrl } = opts;

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

  let payload: any = {
    model: CLAUDE_MODEL,
    system: prompts.systemPrompt,
    max_tokens: 4096,
    messages: messages,
    output_config: {
      effort: "high"
    },
    thinking: {
      type: "adaptive"
    },
    tools: [{ type: "web_search_20260209", name: "web_search" }]
  }

  const res: any = await claude.messages.create(payload)

  console.log(res)

  // if the agent was thinking or used web search, then the output will be later in the content array
  for (let i = res.content.length - 1; i>=0; i--) {
    if (res.content[i].type === 'text') {
      return res.content[i].text
    }
  }

  return null;
}

async function sendPrompt(opts: { inputText?: string; imageUrl?: any }): Promise<any> {
    if (api === "claude") {
      return await sendClaudePrompt(opts);
    } else {
      return await sendOpenAIPrompt(opts);
    }
}

async function analyzeSketchFromScratch(imageUrl: string, columnNames: string[]) {
  let inputText = `${prompts.analyzeSketchFromScratch}\n\nCOLUMN NAMES: ${columnNames.join(", ")}`;

  const initialSpec = await sendPrompt({inputText, imageUrl});

  return initialSpec;
}

/**
 * Iteratively review the generated spec to make sure it matches the intention of the sketch
 * @param spec
 * @param imageUrl
 */
async function compareSpecToSketch(spec: string, imageUrl: string) {
  let i = 0;
  let currentSpec = spec;

  while (i < 3) { // limit to 3 iterations to avoid infinite loops
    let inputText = `${currentSpec}\n\n${prompts.compareSpecToSketch}`
    let res = await sendPrompt({inputText, imageUrl });

    // even with strict instructions in the prompt, sometimes the AI includes explanations before saying "no changes"
    if ((res as string).toLowerCase().includes('no changes')) {
      break;
    }

    currentSpec = res;
    i++;
  }

  return currentSpec;
}

/**
 * Iteratively review the updated spec to make sure it matches the intention of the annotations
 * @param spec
 * @param imageUrl
 */
async function compareSpecToAnnotations(spec: string, imageUrl: string) {
  let i = 0;
  let currentSpec = spec;

  while (i < 3) { // limit to 3 iterations to avoid infinite loops
    let inputText = `${currentSpec}\n\n${prompts.compareSpecToAnnotations}`
    let res = await sendPrompt({inputText, imageUrl})

    // even with strict instructions in the prompt, sometimes the AI includes explanations before saying "no changes"
    if ((res as string).toLowerCase().includes('no changes')) {
      break;
    }

    currentSpec = res;
    i++;
  }

  return currentSpec;
}

/**
 * Iteratively review the updated spec to make sure it matches the intention of the chat message
 * @param spec
 * @param imageUrl
 */
async function compareSpecToInstructions(oldSpec: string, updatedSpec: string, chatMessage: string) {
  let i = 0;
  let currentSpec = updatedSpec;

  while (i < 3) { // limit to 3 iterations to avoid infinite loops
    let inputText = `SPEC_BEFORE:\n${oldSpec}
    
    INSTRUCTIONS:\n${chatMessage}
    
    SPEC_AFTER:\n${currentSpec}
    
    ${prompts.compareSpecToInstructions}`
    let res = await sendPrompt({inputText})

    // even with strict instructions in the prompt, sometimes the AI includes explanations before saying "no changes"
    if ((res as string).toLowerCase().includes('no changes')) {
      break;
    }

    currentSpec = res;
    i++;
  }

  return currentSpec;
}

async function analyzeAnnotatedSketch(currentSpec: string, imageUrl: string, columnNames: string[]) {
  let inputText = `${currentSpec}\n\n${prompts.analyzeAnnotatedSketch}\n\nCOLUMN NAMES: ${columnNames.join(", ")}`;

  const instructions = await sendPrompt({inputText, imageUrl});

  return instructions;
}

async function applyChatMessage(currentSpec: string, instructions: string) {
  let inputText = `${currentSpec}\n\nINSTRUCTIONS:\n${instructions}\n\n${prompts.applyChatMessage}`;

  const updatedSpec = await sendPrompt({inputText});

  return updatedSpec;
}

/**
 * Server-side helper.
 * Given a sketch, generates corresponding specs from scratch (without an underlying vis already rendered)
 */
export async function sketchToSpec(payload: any): Promise<string> {

  const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

  // 1: Send the sketch to be translated into a spec

  const initialSpec = await analyzeSketchFromScratch(imageUrl, payload.columnNames);

  // 2: Review the generated spec

  const reviewedSpec = await compareSpecToSketch(initialSpec, imageUrl);

  return reviewedSpec;
}

/**
 * Server-side helper.
 * Given a Vega-Lite spec and annotated visualization, returns corresponding code
 */
export async function applyAnnotations(payload: any): Promise<string> {

  const currentSpec = payload.currentSpec ?? '';

  const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

  // 1: Send the annotations to be translated into an updated spec

  const updatedSpec = await analyzeAnnotatedSketch(currentSpec, imageUrl, payload.columnNames);

  // 2: Review the updated spec

  const reviewedSpec = await compareSpecToAnnotations(updatedSpec, imageUrl);

  return reviewedSpec;

}


/**
 * Server-side helper.
 * Given a Vega-Lite spec and a user message, returns a corresponding spec applying the user's message
 */
export async function sendChat(payload: any): Promise<string> {

  const currentSpec = payload.currentSpec;
  const chatMessage = payload.chatMessage;

  // 1: Apply the desired changes to the spec

  const updatedSpec = await applyChatMessage(currentSpec, chatMessage);

  // 2: Review the updated spec

  const reviewedSpec = await compareSpecToInstructions(currentSpec, updatedSpec, chatMessage);

  return reviewedSpec;

}
