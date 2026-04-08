import { OPENAI_API_KEY, OPENAI_MODEL } from '$env/static/private';
import prompts from './prompts';
import OpenAI from "openai";
import type {ResponseInput, ResponseInputMessageContentList} from "openai/resources/responses/responses";

if (!OPENAI_API_KEY) {
  throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
}
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

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

async function sendPrompt(promptText: string, opts: { inputText?: string; imageUrl?: any }): Promise<string> {
  const { inputText, imageUrl } = opts;

  console.log(promptText);
  console.log(inputText);

  // Give the instructions using the developer role
  let input: ResponseInput = [
    {
      role: "developer",
      content: promptText
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

  const res = await client.responses.create({
    model: OPENAI_MODEL,
    input: input,
  })

  return res.output_text;
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

async function interpretUserMessage(currentSpec: string, chatMessage: string) {
  let promptText = prompts.interpretUserMessage;

  let inputText = `CURRENT_VEGA_LITE_SPEC:\n${currentSpec}\n\nUSER_MESSAGE:\n${chatMessage}`;

  const instructions = await sendPrompt(promptText, {inputText});

  return instructions;
}

/**
 * Server-side OpenAI helper.
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
 * Server-side OpenAI helper.
 * - Reads the API key from the private env (OPENAI_API_KEY)
 * - Sends a Responses API request (text + optional image) and returns the assistant text
 */
export async function applyAnnotations(payload: any): Promise<string> {

  const currentSpec = payload.currentSpec ?? '';

  const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

  // 1: Send the annotated sketch for analysis

  const instructions = await analyzeAnnotatedSketch(currentSpec, imageUrl);

  // 2: Send the instructions for changes to apply

  const updatedSpec = await applyInstructions(currentSpec, instructions);

  // 3: Match the fields to column names

  const specWithColumns = await matchColumnNames(payload.columnNames, updatedSpec);

  // 4: Validate final spec

  const finalSpec = await reviewFinalOutput(specWithColumns);

  return finalSpec;

}


/**
 * Server-side OpenAI helper.
 * - Reads the API key from the private env (OPENAI_API_KEY)
 * - Sends a Responses API request (text + optional image) and returns the assistant text
 */
export async function sendChat(payload: any): Promise<string> {

  const currentSpec = payload.currentSpec;
  const chatMessage = payload.chatMessage;

  // 1: Turn the user message into specific instructions

  const instructions = await interpretUserMessage(currentSpec, chatMessage);

  // 2: Send the instructions for changes to apply

  const updatedSpec = await applyInstructions(currentSpec, instructions);

  // 3: Match the fields to column names

  const specWithColumns = await matchColumnNames(payload.columnNames, updatedSpec);

  // 4: Validate final spec

  const finalSpec = await reviewFinalOutput(specWithColumns);

  return finalSpec;

}
