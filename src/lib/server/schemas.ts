import {z} from "zod";

// Structured-output schemas for each model call.
// Optional values are modelled as nullable rather than optional, since structured outputs require every property.

// The spec is returned as a JSON string: Vega-Lite's schema is too large and recursive for structured outputs.
// `observations` records what the model saw in plain language (not Vega-Lite terms), for evals and debugging.
export const SpecOutput = z.object({
  observations: z.string().describe("Brief plain-language notes as the instructions ask: answers to any questions, how the inputs were interpreted, and assumptions"),
  spec: z.string().describe("The Vega-Lite spec as a JSON string, without a data property")
});
export type SpecOutput = z.infer<typeof SpecOutput>;

// Retry turns return only the revised spec; the first turn's observations stay in the conversation
export const SpecRevision = SpecOutput.pick({spec: true});
export type SpecRevision = z.infer<typeof SpecRevision>;

// The reviewer only reports; any revision happens in the generation conversation
export const ReviewVerdict = z.object({
  matches: z.boolean(),
  issues: z.array(z.string())
});
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

// Column metadata sent by the client; types are estimated client-side, no data rows are sent
export const ColumnSchema = z.array(z.object({
  name: z.string(),
  type: z.enum(["quantitative", "temporal", "nominal"])
}));
export type ColumnSchema = z.infer<typeof ColumnSchema>;
