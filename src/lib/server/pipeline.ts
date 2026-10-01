import prompts from './prompts';
import type {LLM} from './prompting';

export type Pipelines = ReturnType<typeof createPipelines>;

export type PipelineOptions = {
  // Receives each model call's prompt and output; the eval harness uses this to record intermediate steps
  trace?: (step: { prompt: string; output: unknown }) => void;
};

/**
 * Builds the sketch/annotation/chat pipelines on top of a given LLM client.
 * Kept free of SvelteKit imports so the eval harness can use it directly.
 */
export function createPipelines(llm: LLM, options: PipelineOptions = {}) {

  async function sendPrompt(opts: { inputText: string; imageUrl?: string | null }): Promise<string> {
    const {inputText, imageUrl} = opts;
    const output = await llm.text({
      system: prompts.systemPrompt,
      text: inputText,
      images: imageUrl ? [{label: "Image 1: the canvas", dataUrl: imageUrl}] : []
    });
    options.trace?.({prompt: inputText, output});
    return output;
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
      if (res.toLowerCase().includes('no changes')) {
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
  async function sketchToSpec(payload: any): Promise<string> {

    const imageUrl = payload && typeof payload === 'object' ? (payload.image ?? payload.imageUrl ?? null) : null;

    // 1: Send the sketch to be translated into a spec

    const initialSpec = await analyzeSketchFromScratch(imageUrl, payload.columnNames);

    // 2: Review the generated spec

    const reviewedSpec = await compareSpecToSketch(initialSpec, imageUrl);

    return reviewedSpec;
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
