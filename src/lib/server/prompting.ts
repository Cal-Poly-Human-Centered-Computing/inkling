import Anthropic from "@anthropic-ai/sdk";
import {zodOutputFormat} from "@anthropic-ai/sdk/helpers/zod";
import type {z} from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ImageInput = {
  label: string;   // e.g. "Image 1: the user's sketch"
  dataUrl: string; // data:<mime>;base64,<data>
};

export type PromptRequest = {
  system: string;
  text: string;
  // Usually zero or one image; the visual review sends two (sketch + render of the candidate spec)
  images?: ImageInput[];
  effort?: Effort;
};

export type LLMConfig = {
  apiKey: string;
  model: string;
  workspaceId?: string;
  // Called after every response; the eval harness uses this to record token usage
  onResponse?: (info: { model: string; usage: Anthropic.Usage; stopReason: string | null }) => void;
};

export type LLM = {
  text(req: PromptRequest): Promise<string>;
  structured<T>(req: PromptRequest, schema: z.ZodType<T>): Promise<T>;
};

const MEDIA_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type MediaType = typeof MEDIA_TYPES[number];

function toImageBlock(dataUrl: string): Anthropic.ImageBlockParam {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) {
    throw new Error("Image must be a base64 data URL");
  }
  const mediaType = match[1] as MediaType;
  if (!MEDIA_TYPES.includes(mediaType)) {
    throw new Error(`Unsupported image type: ${mediaType}`);
  }
  return {type: "image", source: {type: "base64", media_type: mediaType, data: match[2]}};
}

function buildContent(req: PromptRequest): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = [];
  const images = req.images ?? [];

  for (const image of images) {
    // Only label images when there's more than one to tell apart
    if (images.length > 1) {
      content.push({type: "text", text: image.label});
    }
    content.push(toImageBlock(image.dataUrl));
  }

  content.push({type: "text", text: req.text});
  return content;
}

function checkStopReason(res: Anthropic.Message) {
  if (res.stop_reason === "max_tokens") {
    throw new Error("Claude response was truncated (hit max_tokens)");
  }
  if (res.stop_reason === "refusal") {
    throw new Error(`Claude declined the request: ${JSON.stringify(res.stop_details)}`);
  }
}

export function createLLM(config: LLMConfig): LLM {
  const client = new Anthropic({
    apiKey: config.apiKey,
    defaultHeaders: config.workspaceId ? {"anthropic-workspace-id": config.workspaceId} : undefined
  });

  function baseParams(req: PromptRequest) {
    return {
      model: config.model,
      max_tokens: 16000, // thinking tokens count against this, so leave plenty of room
      system: req.system,
      messages: [{role: "user" as const, content: buildContent(req)}],
      thinking: {type: "adaptive" as const}
    };
  }

  function report(res: Anthropic.Message) {
    config.onResponse?.({model: res.model, usage: res.usage, stopReason: res.stop_reason});
  }

  return {
    async text(req) {
      const res = await client.messages.create({
        ...baseParams(req),
        output_config: {effort: req.effort ?? "high"}
      });
      report(res);
      checkStopReason(res);

      // Thinking blocks come before the answer, so take the last text block
      const textBlocks = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      return textBlocks.at(-1)?.text ?? "";
    },

    async structured(req, schema) {
      const res = await client.messages.parse({
        ...baseParams(req),
        output_config: {effort: req.effort ?? "high", format: zodOutputFormat(schema)}
      });
      report(res);
      checkStopReason(res);

      if (res.parsed_output == null) {
        throw new Error("Claude response did not match the expected schema");
      }
      return res.parsed_output as any;
    }
  };
}
