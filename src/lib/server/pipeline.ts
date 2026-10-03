import prompts from './prompts';
import type {Conversation, LLM} from './prompting';
import {renderSpec} from './render';
import {ReviewVerdict, SpecOutput, SpecRevision, type ColumnSchema} from './schemas';

export type Pipelines = ReturnType<typeof createPipelines>;

const MAX_COMPILE_RETRIES = 2;

export type SketchToSpecInput = {
  image: string | null;
  columns: ColumnSchema;
  columnNames: string[]; // still sent by the client; the new prompts use `columns`
  currentSpec?: string | null;
  chatMessage?: string | null;
};

// `errors` is non-empty when no valid spec could be produced; `spec` is then the last invalid attempt
export type SpecResult = {
  spec: string;
  observations: string;
  errors: string[];
  review: ReviewVerdict | null; // null when there was no sketch or the spec never compiled; only recorded for now
};

function formatColumns(columns: ColumnSchema) {
  return columns.map(c => `${c.name}: ${c.type}`).join("\n");
}

// The text inputs in the agreed order (code, chat, columns), each only if present.
// Any image is sent ahead of this text (see buildContent in prompting.ts).
function formatInputs(inputs: { currentSpec?: string | null; chatMessage?: string | null; columns: ColumnSchema }) {
  const blocks: string[] = [];
  if (inputs.currentSpec?.trim()) blocks.push(`<current_spec>\n${inputs.currentSpec}\n</current_spec>`);
  if (inputs.chatMessage?.trim()) blocks.push(`<chat_instruction>\n${inputs.chatMessage}\n</chat_instruction>`);
  blocks.push(`<columns>\n${formatColumns(inputs.columns)}\n</columns>`);
  return blocks.join("\n\n");
}

/**
 * Builds the sketch/annotation/chat pipelines on top of a given LLM client.
 * Kept free of SvelteKit imports; app.ts binds it to the configured client.
 */
export function createPipelines(llm: LLM) {

  async function sendPrompt(opts: { inputText: string; imageUrl?: string | null }): Promise<string> {
    const {inputText, imageUrl} = opts;
    const output = await llm.text({
      system: prompts.systemPrompt,
      text: inputText,
      images: imageUrl ? [{label: "Image 1: the canvas", dataUrl: imageUrl}] : []
    });
    return output;
  }

  // --- Generation ---

  /**
   * Turn 1 of the generation conversation. The long flowchart prompt is only used when there's a sketch.
   * Returns the conversation too, so retry turns can continue it.
   */
  async function generate(payload: SketchToSpecInput) {
    const convo = llm.conversation(prompts.fromScratch.system);
    const instructions = payload.image ? prompts.fromScratch.withSketch : prompts.fromScratch.withoutSketch;
    const text = `${formatInputs(payload)}\n\n${instructions.trim()}`;
    const images = payload.image ? [{label: "The sketch", dataUrl: payload.image}] : [];
    const output = await convo.ask({text, images}, SpecOutput);
    return {convo, ...output};
  }

  // --- Verification (shared by the new pipelines) ---

  /**
   * Compiles and runs the spec against placeholder data.
   * Errors cover invalid JSON, compile and runtime errors, and fields that aren't columns.
   */
  async function checkSpec(spec: string, columns: ColumnSchema) {
    const {errors} = await renderSpec(spec, columns);
    return {errors};
  }

  /**
   * Checks the spec and, while it has errors, asks the generation conversation to fix them.
   * Each retry turn carries only the latest errors. After the last retry, returns the last spec with its errors.
   */
  async function compileLoop(convo: Conversation, spec: string, columns: ColumnSchema) {
    let check = await checkSpec(spec, columns);

    for (let retry = 1; retry <= MAX_COMPILE_RETRIES && check.errors.length; retry++) {
      console.info(`[compileLoop] retry ${retry}:`, check.errors);
      const text = `${prompts.verify.fixErrors.trim()}\n\n<errors>\n${check.errors.join("\n")}\n</errors>`;
      ({spec} = await convo.ask({text}, SpecRevision));
      check = await checkSpec(spec, columns);
    }

    return {spec, ...check};
  }

  /**
   * Asks a separate reviewer whether the spec matches the sketch's structure.
   * The reviewer also sees any chat instruction, since chat takes precedence over the sketch.
   */
  async function review(opts: { image: string; spec: string; chatMessage?: string | null; columns: ColumnSchema }): Promise<ReviewVerdict> {
    const text = `${formatInputs({chatMessage: opts.chatMessage, columns: opts.columns})}\n\n<spec>\n${opts.spec}\n</spec>\n\n${prompts.verify.review}`;
    const verdict = await llm.structured({
      system: prompts.verify.reviewSystem,
      text,
      images: [{label: "The user's sketch", dataUrl: opts.image}]
    }, ReviewVerdict);
    return verdict;
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
      if (res.toLowerCase().includes('no changes')) {
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
      if (res.toLowerCase().includes('no changes')) {
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
   * Given a sketch, generates corresponding specs from scratch (without an underlying vis already rendered)
   */
  async function sketchToSpec(payload: SketchToSpecInput): Promise<SpecResult> {

    // 1: Generate

    const {convo, spec: firstSpec, observations} = await generate(payload);

    // 2: Compile and run against placeholder data, retrying with the errors

    const check = await compileLoop(convo, firstSpec, payload.columns);
    const spec = check.spec;
    if (check.errors.length) {
      return {spec, observations, errors: check.errors, review: null};
    }

    // 3: Review the spec against the sketch, only when there is one. The verdict isn't acted on yet; retries come later.

    const verdict = payload.image
      ? await review({image: payload.image, spec, chatMessage: payload.chatMessage, columns: payload.columns})
      : null;

    return {spec, observations, errors: [], review: verdict};
  }

  /**
   * Given a Vega-Lite spec and annotated visualization, returns corresponding code
   */
  async function applyAnnotations(payload: any): Promise<string> {

    const currentSpec = payload.currentSpec ?? '';

    const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

    // 1: Send the annotations to be translated into an updated spec

    const updatedSpec = await analyzeAnnotatedSketch(currentSpec, imageUrl, payload.columnNames);

    // 2: Review the updated spec

    const reviewedSpec = await compareSpecToAnnotations(updatedSpec, imageUrl);

    return reviewedSpec;

  }

  /**
   * Given a Vega-Lite spec and a user message, returns a corresponding spec applying the user's message
   */
  async function sendChat(payload: any): Promise<string> {

    const currentSpec = payload.currentSpec;
    const chatMessage = payload.chatMessage;

    // 1: Apply the desired changes to the spec

    const updatedSpec = await applyChatMessage(currentSpec, chatMessage);

    // 2: Review the updated spec

    const reviewedSpec = await compareSpecToInstructions(currentSpec, updatedSpec, chatMessage);

    return reviewedSpec;

  }

  return {sketchToSpec, applyAnnotations, sendChat};
}
