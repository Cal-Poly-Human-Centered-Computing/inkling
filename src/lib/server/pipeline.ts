import prompts from './prompts';
import type {Conversation, LLM} from './prompting';
import {renderSpec} from './render';
import {ReviewVerdict, SpecOutput, SpecRevision, type ColumnSchema} from './schemas';

export type Pipelines = ReturnType<typeof createPipelines>;

const MAX_COMPILE_RETRIES = 2;

export type PipelineInput = {
  image: string | null;
  columns: ColumnSchema;
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
 * Builds the fromScratch and refine pipelines on top of a given LLM client.
 * Kept free of SvelteKit imports; app.ts binds it to the configured client.
 */
export function createPipelines(llm: LLM) {

  // --- Generation ---

  /**
   * Turn 1 of the generation conversation, with the given task instructions after the inputs.
   * Returns the conversation too, so retry turns can continue it.
   */
  async function generate(payload: PipelineInput, instructions: string) {
    const convo = llm.conversation(prompts.system);
    const text = `${formatInputs(payload)}\n\n${instructions.trim()}`;
    const images = payload.image ? [{label: "The canvas", dataUrl: payload.image}] : [];
    const output = await convo.ask({text, images}, SpecOutput);
    return {convo, ...output};
  }

  // --- Verification (shared by the new pipelines) ---

  /**
   * Compiles and runs the spec against placeholder data.
   * Errors cover invalid JSON, compile and runtime errors (not fields that aren't columns).
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
   * The shared new pipeline: generate with the given instructions, compile with retries, then review if there's an image.
   */
  async function runPipeline(payload: PipelineInput, instructions: string): Promise<SpecResult> {

    // 1: Generate

    const {convo, spec: firstSpec, observations} = await generate(payload, instructions);

    // 2: Compile and run against placeholder data, retrying with the errors

    const check = await compileLoop(convo, firstSpec, payload.columns);
    const spec = check.spec;
    if (check.errors.length) {
      return {spec, observations, errors: check.errors, review: null};
    }

    // 3: Review the spec against the image (sketch or annotations), only when there is one. The verdict isn't acted on yet.

    const verdict = payload.image
      ? await review({image: payload.image, spec, chatMessage: payload.chatMessage, columns: payload.columns})
      : null;

    return {spec, observations, errors: [], review: verdict};
  }

  /**
   * A new spec on a blank canvas (or over an invalid spec), from a sketch and/or chat
   */
  async function fromScratch(payload: PipelineInput): Promise<SpecResult> {
    return runPipeline(payload, payload.image ? prompts.fromScratch.withSketch : prompts.fromScratch.withoutSketch);
  }

  /**
   * Changes to a rendered chart, from annotations drawn on or beside it (the image is the chart with strokes) and/or chat
   */
  async function refine(payload: PipelineInput): Promise<SpecResult> {
    return runPipeline(payload, payload.image ? prompts.refine.withSketch : prompts.refine.withoutSketch);
  }

  return {fromScratch, refine};
}
